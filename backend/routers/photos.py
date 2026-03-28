import logging
import uuid as uuid_lib
from collections.abc import Iterator

import requests
import zipstream
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Photo
from routers.auth import require_gallery_access
from services import storage
from services.image_processing import trigger_processing

router = APIRouter(prefix="/api/photos", tags=["photos"])
logger = logging.getLogger(__name__)

ALLOWED_CATEGORIES = {"guest", "photographer"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class PhotoRegisterRequest(BaseModel):
    photoId: str
    key: str
    category: str
    uploadedBy: str | None = None

    @field_validator("photoId")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        try:
            uuid_lib.UUID(v)
        except ValueError:
            raise ValueError("photoId must be a valid UUID")
        return v

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not v or ".." in v or v.startswith("/"):
            raise ValueError("Invalid storage key")
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        if v not in ALLOWED_CATEGORIES:
            raise ValueError(f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
        return v


def _trigger_photo_processing(photo_id: str) -> None:
    """Kept for reference — replaced by image_processing.trigger_processing."""
    pass  # pragma: no cover


@router.post("", dependencies=[Depends(require_gallery_access)])
def register_photo(
    request: PhotoRegisterRequest,
    db: Session = Depends(get_db),
):
    """Register a photo that has already been uploaded directly to S3.

    original_url and original_key are both stored:
    - original_key is the canonical S3 key used for generating signed URLs.
    - original_url is a convenience copy of the non-expiring path (NOT an access URL).

    After a successful DB commit, image processing is triggered asynchronously.
    """
    original_url = storage.get_file_url(request.key)

    photo = Photo(
        id=uuid_lib.UUID(request.photoId),
        original_key=request.key,
        original_url=original_url,
        preview_url=None,
        thumbnail_url=None,
        category=request.category,
        uploaded_by=request.uploadedBy,
        processing_status="pending",
    )

    try:
        db.add(photo)
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.warning("Duplicate photo registration attempt for photoId=%s", request.photoId)
        raise HTTPException(status_code=409, detail="A photo with this ID already exists.")
    except Exception as exc:
        db.rollback()
        logger.error("DB error registering photo %s: %s", request.photoId, exc)
        raise HTTPException(status_code=500, detail="Failed to register photo.")

    # Trigger async image processing (daemon thread — does not block HTTP response).
    trigger_processing(request.photoId)

    logger.info("Registered photo id=%s category=%s", request.photoId, request.category)
    return {"status": "ok"}


SIGNED_URL_EXPIRY = 3600  # 1 hour; matches storage.DOWNLOAD_URL_EXPIRY
MAX_LIMIT = 100
MAX_ZIP_PHOTOS = 100
ZIP_STREAM_CHUNK_SIZE = 64 * 1024


class DownloadZipRequest(BaseModel):
    photoIds: list[str]

    @field_validator("photoIds")
    @classmethod
    def validate_photo_ids(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("photoIds must not be empty")
        if len(value) > MAX_ZIP_PHOTOS:
            raise ValueError(f"A maximum of {MAX_ZIP_PHOTOS} photos can be downloaded at once")

        normalized: list[str] = []
        seen: set[str] = set()
        for photo_id in value:
            try:
                parsed = str(uuid_lib.UUID(photo_id))
            except ValueError as exc:
                raise ValueError(f"Invalid photoId: {photo_id}") from exc

            if parsed not in seen:
                seen.add(parsed)
                normalized.append(parsed)

        return normalized


def _iter_photo_chunks(download_url: str, photo_id: str) -> Iterator[bytes]:
    """Stream photo bytes from signed URL to zip writer without buffering whole files."""
    try:
        with requests.get(download_url, stream=True, timeout=30) as response:
            response.raise_for_status()
            for chunk in response.iter_content(chunk_size=ZIP_STREAM_CHUNK_SIZE):
                if chunk:
                    yield chunk
    except Exception as exc:
        logger.error("ZIP download failed for photo %s: %s", photo_id, exc)
        return


def _extension_from_original_key(original_key: str | None) -> str:
    """Extract a safe file extension from original_key; fallback to jpg."""
    if not original_key:
        return "jpg"

    last_segment = original_key.rsplit("/", 1)[-1]
    if "." not in last_segment:
        return "jpg"

    extension = last_segment.rsplit(".", 1)[-1].lower().strip()
    if not extension:
        return "jpg"

    # Keep extension conservative for attachment filenames.
    safe_extension = "".join(ch for ch in extension if ch.isalnum())
    return safe_extension or "jpg"


@router.post("/download-zip", dependencies=[Depends(require_gallery_access)])
def download_zip(
    request: DownloadZipRequest,
    db: Session = Depends(get_db),
):
    photo_ids = [uuid_lib.UUID(photo_id) for photo_id in request.photoIds]

    photos = (
        db.query(Photo)
        .filter(Photo.id.in_(photo_ids), Photo.processing_status == "done")
        .all()
    )

    found_ids = {str(photo.id) for photo in photos}
    missing_ids = [photo_id for photo_id in request.photoIds if photo_id not in found_ids]
    if missing_ids:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Some photos do not exist or are not ready for download",
                "missingPhotoIds": missing_ids,
            },
        )

    photo_by_id = {str(photo.id): photo for photo in photos}

    z = zipstream.ZipStream(compress_type=zipstream.ZIP_DEFLATED)
    added_files = 0

    for photo_id in request.photoIds:
        photo = photo_by_id.get(photo_id)
        if not photo or not photo.original_key:
            logger.warning("Skipping photo %s because original_key is missing", photo_id)
            continue

        try:
            download_url = storage.generate_download_url(photo.original_key)
        except Exception as exc:
            logger.error("ZIP download failed for photo %s (signed URL generation): %s", photo_id, exc)
            continue

        extension = _extension_from_original_key(photo.original_key)
        filename = f"wedding-{photo_id}.{extension}"
        z.add(_iter_photo_chunks(download_url, photo_id), filename)
        added_files += 1

    if added_files == 0:
        raise HTTPException(status_code=500, detail="Could not prepare any photos for ZIP download")

    return StreamingResponse(
        z,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="wedding-photos.zip"'},
    )


@router.get("", dependencies=[Depends(require_gallery_access)])
def list_photos(
    category: str | None = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "upload",
    db: Session = Depends(get_db),
):
    """Return photos that have completed processing, with signed access URLs.

    Filtering:
    - Only photos with processing_status = 'done' are returned.
    - Optionally filter by category ('guest' | 'photographer').

    Pagination:
    - Offset-based; default limit 50, max 100.
    - Response includes hasMore: true when another page exists.

    Signed URL strategy (Option A):
    - Backend generates signed URLs for thumbnail, preview, and original.
    - Frontend uses URLs directly — no extra requests needed.
    - All signed URLs expire after 1 hour.
    """
    if category is not None and category not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{category}'. Must be one of: {sorted(ALLOWED_CATEGORIES)}",
        )

    limit = min(max(1, limit), MAX_LIMIT)
    sort_mode = sort if sort in {"upload", "taken"} else "upload"

    query = db.query(Photo).filter(Photo.processing_status == "done")
    if category:
        query = query.filter(Photo.category == category)

    # Fetch one extra row to determine whether more pages exist.
    # Secondary sort by id ensures stable ordering when created_at timestamps collide.
    if sort_mode == "taken":
        query = query.order_by(Photo.taken_at.desc().nullslast(), Photo.created_at.desc(), Photo.id.desc())
    else:
        query = query.order_by(Photo.created_at.desc(), Photo.id.desc())

    raw = (
        query
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    has_more = len(raw) > limit
    photos_to_process = raw[:limit]

    result = []
    for photo in photos_to_process:
        try:
            thumbnail_url = storage.generate_download_url(photo.thumbnail_key) if photo.thumbnail_key else None
            preview_url = storage.generate_download_url(photo.preview_key) if photo.preview_key else None
            original_url = storage.generate_download_url(photo.original_key) if photo.original_key else None
        except Exception as exc:
            logger.error(
                "Skipping photo %s from response: signed URL generation failed — %s",
                photo.id,
                exc,
            )
            continue  # skip this photo rather than failing the entire response

        result.append({
            "id": str(photo.id),
            "category": photo.category,
            "uploadedBy": photo.uploaded_by,
            "createdAt": photo.created_at.isoformat() if photo.created_at else None,
            "thumbnailUrl": thumbnail_url,
            "previewUrl": preview_url,
            "originalUrl": original_url,
        })

    return {"photos": result, "hasMore": has_more}
