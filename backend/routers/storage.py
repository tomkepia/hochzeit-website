import uuid
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from botocore.exceptions import ClientError

from routers.auth import require_gallery_access
from services import storage

router = APIRouter(prefix="/api/storage", tags=["storage"])
logger = logging.getLogger(__name__)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "video/mp4",
    "video/quicktime",
    "video/webm",
}
MAX_IMAGE_FILE_SIZE_BYTES = 50 * 1024 * 1024
MAX_VIDEO_FILE_SIZE_BYTES = int(os.getenv("MAX_VIDEO_FILE_SIZE_BYTES", str(250 * 1024 * 1024)))
VIDEO_UPLOAD_ENABLED = os.getenv("VIDEO_UPLOAD_ENABLED", "true").lower() == "true"

# Maps MIME type → canonical file extension for original uploads
CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
}

ALLOWED_CATEGORIES = {"guest", "photographer"}


class UploadUrlRequest(BaseModel):
    filename: str
    contentType: str
    category: str
    fileSize: int | None = None


def _is_video_content_type(content_type: str) -> bool:
    return content_type.startswith("video/")


@router.post("/upload-url", dependencies=[Depends(require_gallery_access())])
def get_upload_url(request: UploadUrlRequest):
    """Generate a pre-signed PUT URL so the client can upload directly to S3."""
    if request.contentType not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type '{request.contentType}'. "
                   f"Allowed: {sorted(ALLOWED_CONTENT_TYPES)}",
        )

    if _is_video_content_type(request.contentType) and not VIDEO_UPLOAD_ENABLED:
        raise HTTPException(status_code=403, detail="Video uploads are currently disabled")

    if request.category not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{request.category}'. "
                   f"Must be one of: {sorted(ALLOWED_CATEGORIES)}",
        )

    if request.fileSize is not None:
        if request.fileSize < 0:
            raise HTTPException(status_code=400, detail="Invalid file size")
        max_bytes = MAX_VIDEO_FILE_SIZE_BYTES if _is_video_content_type(request.contentType) else MAX_IMAGE_FILE_SIZE_BYTES
        max_mb = round(max_bytes / 1024 / 1024)
        if request.fileSize > max_bytes:
            raise HTTPException(status_code=400, detail=f"File too large (max. {max_mb} MB)")

    photo_uuid = str(uuid.uuid4())
    extension = CONTENT_TYPE_EXTENSIONS[request.contentType]
    key = storage.generate_photo_key(request.category, "original", photo_uuid, extension)

    try:
        upload_url = storage.generate_upload_url(key, request.contentType)
    except EnvironmentError as exc:
        logger.error("Storage misconfiguration: %s", exc)
        raise HTTPException(status_code=503, detail="Storage service is not configured.")
    except ClientError as exc:
        logger.error("S3 ClientError generating upload URL: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to reach storage service.")
    except Exception as exc:
        logger.error("Unexpected error generating upload URL: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate upload URL.")

    # storageRef is a canonical, non-expiring path reference for internal use only.
    # It is NOT guaranteed to be publicly accessible — the bucket may be private.
    # Always use GET /api/storage/download-url?key=... to get a real access URL.
    # NOTE: Content-type is enforced in the presigned URL (S3 rejects mismatched headers),
    # but file content authenticity (e.g. non-image data) is validated by Phase 3 processing.
    storage_ref = storage.get_file_url(key)
    return {
        "uploadUrl": upload_url,
        "photoId": photo_uuid,
        "key": key,
        "extension": extension,
        "storageRef": storage_ref,
    }


@router.get("/download-url", dependencies=[Depends(require_gallery_access)])
def get_download_url(key: str = Query(..., description="Storage key of the file to download")):
    """Generate a pre-signed GET URL for downloading a file from S3."""
    # Basic key validation to avoid path-traversal style abuse
    if ".." in key or key.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid storage key.")

    try:
        download_url = storage.generate_download_url(key)
    except EnvironmentError as exc:
        logger.error("Storage misconfiguration: %s", exc)
        raise HTTPException(status_code=503, detail="Storage service is not configured.")
    except ClientError as exc:
        logger.error("S3 ClientError generating download URL: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to reach storage service.")
    except Exception as exc:
        logger.error("Unexpected error generating download URL: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate download URL.")

    return {"downloadUrl": download_url}


@router.get("/health")
def storage_health():
    """Check whether the S3 bucket is reachable."""
    result = storage.check_connection()
    if result["status"] != "ok":
        raise HTTPException(status_code=503, detail=result)
    return result
