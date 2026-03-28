"""Image processing service for Phase 3.

Responsibilities:
- Download original image from S3
- Fix EXIF rotation
- Generate preview (~1200px JPEG)
- Generate thumbnail (~300px JPEG)
- Handle HEIC/HEIF conversion transparently (via pillow-heif)
- Upload derived variants to S3
- Update photo DB record with result URLs
- Track processing status and errors

HEIC support requires the pillow-heif registration call below,
which must happen before any Image.open() call on HEIC data.
"""

import logging
import time
import uuid as uuid_lib
from datetime import datetime
from io import BytesIO
from threading import Thread
from typing import Optional

import pillow_heif
import requests
from PIL.ExifTags import TAGS
from PIL import Image, ImageOps

from database import SessionLocal
from models import Photo
from services import storage

# Register HEIC/HEIF opener with Pillow — must be called at import time.
pillow_heif.register_heif_opener()

logger = logging.getLogger(__name__)

PREVIEW_MAX_PX = 1200
PREVIEW_JPEG_QUALITY = 80
THUMBNAIL_MAX_PX = 300
THUMBNAIL_JPEG_QUALITY = 70

# Pre-signed download URLs expire in 1 hour; processing happens within seconds.
DOWNLOAD_TIMEOUT_SECONDS = 60
MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 3


def parse_exif_datetime(value) -> Optional[datetime]:
    """Parse EXIF datetime value of format YYYY:MM:DD HH:MM:SS."""
    if not value:
        return None

    try:
        return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None


def extract_taken_at(img: Image.Image) -> Optional[datetime]:
    """Extract capture timestamp from image EXIF metadata when available.

    Preference order:
      1. DateTimeOriginal — shutter-press time; most accurate.
      2. DateTime         — fallback for edited images that strip DateTimeOriginal
                           but retain the baseline DateTime tag.
    Returns None when neither tag is present or parseable.
    """
    try:
        exif = img.getexif()
        if not exif:
            return None

        date_time_original: Optional[datetime] = None
        date_time_fallback: Optional[datetime] = None

        for tag, value in exif.items():
            tag_name = TAGS.get(tag)
            if tag_name == "DateTimeOriginal":
                date_time_original = parse_exif_datetime(value)
            elif tag_name == "DateTime" and date_time_fallback is None:
                date_time_fallback = parse_exif_datetime(value)

        return date_time_original or date_time_fallback

    except Exception:
        return None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def trigger_processing(photo_id: str) -> None:
    """Start image processing for a photo in a background thread.

    Called immediately after the photo is registered in the DB.
    The thread is daemonized so it does not prevent server shutdown.
    Errors are caught and logged; they never propagate to the caller.
    """
    thread = Thread(
        target=_safe_process_photo,
        args=(photo_id,),
        name=f"img-process-{photo_id[:8]}",
        daemon=True,
    )
    thread.start()
    logger.info("Processing thread started for photo_id=%s", photo_id)


# ---------------------------------------------------------------------------
# Internal implementation
# ---------------------------------------------------------------------------

def _safe_process_photo(photo_id: str) -> None:
    """Top-level wrapper that guarantees no exception escapes the thread."""
    try:
        _process_photo(photo_id)
    except Exception as exc:
        logger.exception("Unhandled error in processing thread for photo_id=%s: %s", photo_id, exc)
        _mark_failed(photo_id, f"Unhandled error: {exc}")


def _process_photo(photo_id: str) -> None:
    start_time = time.monotonic()
    db = SessionLocal()

    try:
        photo = db.query(Photo).filter(Photo.id == uuid_lib.UUID(photo_id)).first()
        if photo is None:
            logger.error("Processing: photo not found in DB for id=%s", photo_id)
            return

        # Idempotency: skip if variant keys already exist
        if photo.preview_key and photo.thumbnail_key:
            logger.info("Processing: skipping %s — variants already exist", photo_id)
            return

        # Skip if already processing (concurrent trigger guard)
        if photo.processing_status == "processing":
            logger.info("Processing: skipping %s — already in progress", photo_id)
            return

        _set_status(db, photo, "processing")

        # Resolve the storage key
        original_key = _resolve_key(photo)
        if not original_key:
            _mark_failed_in_session(db, photo, "No usable original_key or original_url")
            return

        # Download original with retry
        image_data = _download_with_retry(original_key)
        if image_data is None:
            _mark_failed_in_session(db, photo, "Failed to download original after retries")
            return

        file_size_kb = len(image_data) / 1024
        logger.info("Processing %s: downloaded %.1f KB", photo_id, file_size_kb)

        # Open and process image
        try:
            img = Image.open(BytesIO(image_data))
            taken_at = extract_taken_at(img)
            img = ImageOps.exif_transpose(img)  # fix EXIF rotation
        except Exception as exc:
            _mark_failed_in_session(db, photo, f"Failed to open image: {exc}")
            return

        # Generate preview
        preview_key, preview_url = _generate_and_upload_variant(
            img, photo.category, str(photo.id), "preview",
            PREVIEW_MAX_PX, PREVIEW_JPEG_QUALITY,
        )
        if preview_key is None:
            _mark_failed_in_session(db, photo, "Failed to generate/upload preview")
            return

        # Generate thumbnail
        thumb_key, thumb_url = _generate_and_upload_variant(
            img, photo.category, str(photo.id), "thumb",
            THUMBNAIL_MAX_PX, THUMBNAIL_JPEG_QUALITY,
        )
        if thumb_key is None:
            _mark_failed_in_session(db, photo, "Failed to generate/upload thumbnail")
            return

        # Update DB with keys (canonical) and convenience URLs
        photo.preview_key = preview_key
        photo.preview_url = preview_url
        photo.thumbnail_key = thumb_key
        photo.thumbnail_url = thumb_url
        photo.taken_at = taken_at
        photo.processing_status = "done"
        photo.processing_error = None
        db.commit()

        elapsed = time.monotonic() - start_time
        logger.info(
            "Processing done for %s in %.2fs (original %.1f KB, category=%s)",
            photo_id, elapsed, file_size_kb, photo.category,
        )

    except Exception as exc:
        logger.exception("Processing error for photo_id=%s: %s", photo_id, exc)
        try:
            photo = db.query(Photo).filter(Photo.id == uuid_lib.UUID(photo_id)).first()
            if photo:
                _mark_failed_in_session(db, photo, str(exc))
        except Exception:
            pass
    finally:
        db.close()


def _resolve_key(photo: Photo) -> Optional[str]:
    """Return the S3 key for the original file.

    Prefers the stored original_key. Falls back to extracting the path
    portion from original_url when original_key is absent (legacy rows).
    """
    if photo.original_key:
        return photo.original_key

    if photo.original_url:
        # original_url = {endpoint}/{bucket}/{key}
        # Extract everything after the second slash-separated segment (bucket name)
        try:
            parts = photo.original_url.split("/", 3)
            if len(parts) == 4:
                return parts[3]
        except Exception:
            pass

    return None


def _download_with_retry(key: str) -> Optional[bytes]:
    """Download a file from S3 using a fresh pre-signed URL. Retries on failure."""
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            download_url = storage.generate_download_url(key)
            response = requests.get(download_url, timeout=DOWNLOAD_TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.content
        except Exception as exc:
            logger.warning("Download attempt %d/%d failed for key=%s: %s",
                           attempt, MAX_RETRIES + 1, key, exc)
            if attempt <= MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)

    return None


def _generate_and_upload_variant(
    img: Image.Image,
    category: str,
    photo_uuid: str,
    variant: str,
    max_px: int,
    jpeg_quality: int,
) -> tuple[Optional[str], Optional[str]]:
    """Resize a copy of img, encode as JPEG, upload to S3.

    Returns (key, url) on success, (None, None) on failure.
    variant is "preview" or "thumb".
    """
    try:
        copy = img.copy()
        copy.thumbnail((max_px, max_px), Image.LANCZOS)

        # HEIC/PNG/WebP may have an alpha channel — flatten to RGB before JPEG encoding
        if copy.mode != "RGB":
            copy = copy.convert("RGB")

        buf = BytesIO()
        copy.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        buf.seek(0)
        raw = buf.read()

        key = storage.generate_photo_key(category, variant, photo_uuid, extension="jpg")
        storage.upload_buffer(key, raw, "image/jpeg")
        url = storage.get_file_url(key)

        logger.info("Uploaded %s variant for %s (%d bytes)", variant, photo_uuid, len(raw))
        return key, url

    except Exception as exc:
        logger.error("Failed to generate/upload %s for %s: %s", variant, photo_uuid, exc)
        return None, None


def _set_status(db, photo: Photo, status: str) -> None:
    photo.processing_status = status
    db.commit()


def _mark_failed_in_session(db, photo: Photo, error: str) -> None:
    photo.processing_status = "failed"
    photo.processing_error = error
    try:
        db.commit()
    except Exception:
        db.rollback()
    logger.error("Processing failed for photo %s: %s", photo.id, error)


def _mark_failed(photo_id: str, error: str) -> None:
    """Fallback for when the DB session isn't available in the calling scope."""
    db = SessionLocal()
    try:
        photo = db.query(Photo).filter(Photo.id == uuid_lib.UUID(photo_id)).first()
        if photo:
            _mark_failed_in_session(db, photo, error)
    except Exception as exc:
        logger.error("Could not mark photo %s as failed: %s", photo_id, exc)
    finally:
        db.close()
