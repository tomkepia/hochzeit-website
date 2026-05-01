"""Async download-job router.

Flow
----
1. POST /api/download-jobs          – create a job; returns { job_id }
2. GET  /api/download-jobs          – list jobs for the caller (last 20)
3. GET  /api/download-jobs/{id}     – single job status
4. GET  /api/download-jobs/{id}/url – get a fresh signed download URL (status must be 'ready')

The worker (image_worker.py) picks up 'queued' jobs, builds the ZIP on the
fly, uploads it to S3 via multipart upload, and marks the job 'ready'.

Owner scoping
-------------
Jobs are scoped by an *owner_key*: a SHA-256 hash of the raw Bearer token.
This avoids storing raw tokens in the DB while still preventing one user from
seeing another's jobs.
"""

import hashlib
import logging
import uuid as uuid_lib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from database import SessionLocal
from models import DownloadJob, AccessToken, Photo
from routers.auth import require_gallery_access
from services import storage

router = APIRouter(prefix="/api/download-jobs", tags=["download-jobs"])
logger = logging.getLogger(__name__)

JOB_TTL_HOURS = 4          # ZIP stays on S3 for 4 hours
MAX_JOBS_PER_LIST = 20
MAX_PHOTO_IDS = 2000        # safety cap; split into multiple jobs on frontend if needed
ZIP_DOWNLOAD_URL_EXPIRY = 4 * 3600  # 4-hour signed URL for the final ZIP


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _owner_key(token: str) -> str:
    """Return a stable, non-reversible key derived from the raw token."""
    return hashlib.sha256(token.encode()).hexdigest()


def _extract_raw_token(request: Request) -> str:
    """Pull the raw Bearer token from the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    parts = auth_header.split()
    if len(parts) == 2 and parts[0] == "Bearer":
        return parts[1]
    raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class CreateJobRequest(BaseModel):
    photoIds: list[str]

    @field_validator("photoIds")
    @classmethod
    def validate_ids(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("photoIds must not be empty")
        if len(value) > MAX_PHOTO_IDS:
            raise ValueError(f"Maximum {MAX_PHOTO_IDS} photos per job")

        normalized: list[str] = []
        seen: set[str] = set()
        for pid in value:
            try:
                parsed = str(uuid_lib.UUID(pid))
            except ValueError as exc:
                raise ValueError(f"Invalid photoId: {pid}") from exc
            if parsed not in seen:
                seen.add(parsed)
                normalized.append(parsed)
        return normalized


def _job_dict(job: DownloadJob) -> dict:
    return {
        "jobId": str(job.id),
        "status": job.status,
        "photoCount": len(job.photo_ids) if job.photo_ids else 0,
        "createdAt": job.created_at.isoformat() if job.created_at else None,
        "expiresAt": job.expires_at.isoformat() if job.expires_at else None,
        "errorMessage": job.error_message,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", dependencies=[Depends(require_gallery_access())])
def create_download_job(
    payload: CreateJobRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Create an async ZIP download job.

    The backend worker will build the ZIP and upload it to S3.  Poll GET
    /api/download-jobs to check when it is ready.
    """
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    # Verify all requested photos exist and are done.
    photo_uuids = [uuid_lib.UUID(pid) for pid in payload.photoIds]
    photos = (
        db.query(Photo)
        .filter(Photo.id.in_(photo_uuids), Photo.processing_status == "done")
        .all()
    )
    found_ids = {str(p.id) for p in photos}
    missing = [pid for pid in payload.photoIds if pid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Some photos do not exist or are not ready",
                "missingPhotoIds": missing,
            },
        )

    job = DownloadJob(
        id=uuid_lib.uuid4(),
        owner_key=owner,
        status="queued",
        photo_ids=payload.photoIds,
        expires_at=datetime.utcnow() + timedelta(hours=JOB_TTL_HOURS),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info("Created download job %s (%d photos)", job.id, len(payload.photoIds))
    return {"jobId": str(job.id)}


@router.get("", dependencies=[Depends(require_gallery_access())])
def list_download_jobs(
    request: Request,
    db: Session = Depends(get_db),
):
    """Return the most recent jobs for the calling user."""
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    jobs = (
        db.query(DownloadJob)
        .filter(DownloadJob.owner_key == owner)
        .order_by(DownloadJob.created_at.desc())
        .limit(MAX_JOBS_PER_LIST)
        .all()
    )
    return [_job_dict(j) for j in jobs]


@router.get("/{job_id}", dependencies=[Depends(require_gallery_access())])
def get_download_job(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return the status of a single job."""
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    try:
        job_uuid = uuid_lib.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    job = db.query(DownloadJob).filter(DownloadJob.id == job_uuid).first()
    if not job or job.owner_key != owner:
        raise HTTPException(status_code=404, detail="Job not found")

    return _job_dict(job)


@router.get("/{job_id}/url", dependencies=[Depends(require_gallery_access())])
def get_download_url(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return a fresh signed URL for a ready job's ZIP.

    The URL expires after ZIP_DOWNLOAD_URL_EXPIRY seconds.  The job must be
    in 'ready' status and not yet expired.
    """
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    try:
        job_uuid = uuid_lib.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    job = db.query(DownloadJob).filter(DownloadJob.id == job_uuid).first()
    if not job or job.owner_key != owner:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "ready":
        raise HTTPException(status_code=409, detail=f"Job is not ready (status: {job.status})")

    if job.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Job has expired")

    try:
        url = storage.generate_download_url_with_expiry(job.zip_key, ZIP_DOWNLOAD_URL_EXPIRY)
    except Exception as exc:
        logger.error("Failed to generate signed URL for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Could not generate download URL")

    return {"url": url}
