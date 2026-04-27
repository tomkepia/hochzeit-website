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
      1. DateTimeOriginal from the Exif sub-IFD (0x8769) — shutter-press time;
         this is where iOS, Android and all EXIF-compliant cameras write it.
      2. DateTimeOriginal from IFD0 — uncommon but possible.
      3. DateTime from IFD0 — fallback for edited images that only retain the
         baseline DateTime tag.
    Returns None when neither tag is present or parseable.

    Note: Pillow's getexif() only returns IFD0 tags in its flat dict; sub-IFD
    tags (including DateTimeOriginal, tag 36867) must be read via get_ifd().
    """
    # Tag number for the Exif sub-IFD pointer stored in IFD0.
    EXIF_IFD_TAG = 0x8769  # 34665

    try:
        exif = img.getexif()
        if not exif:
            return None

        # 1. Check Exif sub-IFD first — this is the canonical location for
        #    DateTimeOriginal on all modern cameras and smartphones.
        try:
            exif_ifd = exif.get_ifd(EXIF_IFD_TAG)
            for tag, value in exif_ifd.items():
                if TAGS.get(tag) == "DateTimeOriginal":
                    result = parse_exif_datetime(value)
                    if result:
                        return result
        except Exception:
            pass

        # 2 & 3. Fall back to scanning IFD0 for DateTimeOriginal or DateTime.
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
# Public entry point (called by the background worker)
# ---------------------------------------------------------------------------

def process_photo_safe(photo_id: str) -> None:
    """Process a photo and re-raise any exception so the worker can retry.

    The worker is responsible for all processing_status transitions
    (pending → processing → done / failed).  This function only performs
    the image work and persists variant keys to the DB.
    """
    try:
        _process_photo(photo_id)
    except Exception:
        logger.exception("Processing failed for photo_id=%s", photo_id)
        raise


# ---------------------------------------------------------------------------
# Internal implementation
# ---------------------------------------------------------------------------


def _process_photo(photo_id: str) -> None:
    """Download the original, generate preview + thumbnail, upload to S3.

    Updates the photo row with variant keys/URLs and taken_at.
    Does NOT modify processing_status — that is owned exclusively by the worker.
    Raises on any failure so the worker can apply its retry/failure logic.
    """
    start_time = time.monotonic()
    db = SessionLocal()

    try:
        photo = db.query(Photo).filter(Photo.id == uuid_lib.UUID(photo_id)).first()
        if photo is None:
            raise RuntimeError(f"Photo not found in DB: {photo_id}")

        # Idempotency: variants already generated (e.g. worker restarted after they were written)
        if photo.preview_key and photo.thumbnail_key:
            logger.info("Processing: skipping %s — variants already exist", photo_id)
            return

        # Resolve the storage key
        original_key = _resolve_key(photo)
        if not original_key:
            raise RuntimeError("No usable original_key or original_url")

        # Download original with retry
        image_data = _download_with_retry(original_key)
        if image_data is None:
            raise RuntimeError("Failed to download original after retries")

        file_size_kb = len(image_data) / 1024
        logger.info("Processing %s: downloaded %.1f KB", photo_id, file_size_kb)

        # Open and process image
        try:
            img = Image.open(BytesIO(image_data))
            taken_at = extract_taken_at(img)
            img = ImageOps.exif_transpose(img)  # fix EXIF rotation
        except Exception as exc:
            raise RuntimeError(f"Failed to open image: {exc}") from exc

        # Generate preview
        preview_key, preview_url = _generate_and_upload_variant(
            img, photo.category, str(photo.id), "preview",
            PREVIEW_MAX_PX, PREVIEW_JPEG_QUALITY,
        )
        if preview_key is None:
            raise RuntimeError("Failed to generate/upload preview")

        # Generate thumbnail
        thumb_key, thumb_url = _generate_and_upload_variant(
            img, photo.category, str(photo.id), "thumb",
            THUMBNAIL_MAX_PX, THUMBNAIL_JPEG_QUALITY,
        )
        if thumb_key is None:
            raise RuntimeError("Failed to generate/upload thumbnail")

        # Persist variant keys/URLs and EXIF capture date.
        # processing_status is managed exclusively by the worker.
        photo.preview_key = preview_key
        photo.preview_url = preview_url
        photo.thumbnail_key = thumb_key
        photo.thumbnail_url = thumb_url
        # Only fill taken_at when the client didn't already provide it
        # (client-side EXIF extraction is more reliable for resized uploads).
        if photo.taken_at is None:
            photo.taken_at = taken_at
        db.commit()

        elapsed = time.monotonic() - start_time
        logger.info(
            "Processing done for %s in %.2fs (original %.1f KB, category=%s)",
            photo_id, elapsed, file_size_kb, photo.category,
        )

    except Exception:
        # Re-raise so process_photo_safe / the worker can handle retries.
        raise
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
        # Use LANCZOS for the large preview (quality matters) and BICUBIC for
        # thumbnails (much faster, imperceptible difference at 300 px).
        resample = Image.LANCZOS if max_px >= 800 else Image.BICUBIC
        copy.thumbnail((max_px, max_px), resample)

        # HEIC/PNG/WebP may have an alpha channel — flatten to RGB before JPEG encoding
        if copy.mode != "RGB":
            copy = copy.convert("RGB")

        buf = BytesIO()
        # optimize=True runs a slow multi-pass Huffman search — omit it to cut
        # encoding CPU time by ~60 % with no visible quality difference.
        copy.save(buf, format="JPEG", quality=jpeg_quality)
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



