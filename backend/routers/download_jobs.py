"""Async download-job router.

This router supports two download paths:
1. User-scoped ad-hoc ZIP jobs.
2. System archive planning for "download all" using fixed 100-photo parts plus
   a rolling tail archive.
"""

import hashlib
import logging
import uuid as uuid_lib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from database import SessionLocal
from models import DownloadJob, Photo
from routers.auth import require_gallery_access
from services import storage

router = APIRouter(prefix="/api/download-jobs", tags=["download-jobs"])
logger = logging.getLogger(__name__)

JOB_TTL_HOURS = 4
ARCHIVE_TTL_HOURS = 24 * 365
MAX_JOBS_PER_LIST = 20
MAX_PHOTO_IDS = 2000
ZIP_DOWNLOAD_URL_EXPIRY = 4 * 3600
SYSTEM_OWNER_KEY = "system"
ARCHIVE_SEGMENT_SIZE = 100
ALLOWED_ARCHIVE_CATEGORIES = {"guest", "photographer"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _owner_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _extract_raw_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    parts = auth_header.split()
    if len(parts) == 2 and parts[0] == "Bearer":
        return parts[1]
    raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")


def _archive_label(category: str) -> str:
    return "gaestefotos" if category == "guest" else "fotografenfotos"


def _file_name_for_job(job_kind: str, category: str | None, segment_index: int | None, photo_count: int) -> str:
    if job_kind == "archive_fixed" and category and segment_index is not None:
        return f"hochzeit-{_archive_label(category)}-teil-{segment_index:03d}.zip"
    if job_kind == "archive_tail" and category:
        return f"hochzeit-{_archive_label(category)}-neueste-fotos.zip"
    if category:
        return f"hochzeit-{_archive_label(category)}-{photo_count}-fotos.zip"
    return f"hochzeit-fotos-{photo_count}.zip"


def _job_dict(job: DownloadJob) -> dict:
    return {
        "jobId": str(job.id),
        "jobKind": job.job_kind,
        "status": job.status,
        "photoCount": len(job.photo_ids) if job.photo_ids else 0,
        "category": job.category,
        "segmentIndex": job.segment_index,
        "fileName": job.file_name,
        "createdAt": job.created_at.isoformat() if job.created_at else None,
        "expiresAt": job.expires_at.isoformat() if job.expires_at else None,
        "errorMessage": job.error_message,
    }


def _archive_payload(job: DownloadJob) -> dict:
    payload = _job_dict(job)
    payload["downloadUrl"] = None
    if job.status == "ready" and job.zip_key:
        payload["downloadUrl"] = storage.generate_download_url_with_expiry(
            job.zip_key,
            ZIP_DOWNLOAD_URL_EXPIRY,
        )
    return payload


def _ordered_done_photos(db: Session, category: str) -> list[Photo]:
    return (
        db.query(Photo)
        .filter(Photo.category == category, Photo.processing_status == "done")
        .order_by(Photo.created_at.asc(), Photo.id.asc())
        .all()
    )


def _create_download_job(
    db: Session,
    *,
    owner_key: str,
    photo_ids: list[str],
    job_kind: str = "user",
    category: str | None = None,
    segment_index: int | None = None,
    file_name: str | None = None,
    ttl_hours: int = JOB_TTL_HOURS,
) -> DownloadJob:
    job = DownloadJob(
        id=uuid_lib.uuid4(),
        owner_key=owner_key,
        job_kind=job_kind,
        category=category,
        segment_index=segment_index,
        file_name=file_name,
        status="queued",
        photo_ids=photo_ids,
        expires_at=datetime.utcnow() + timedelta(hours=ttl_hours),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _find_reusable_user_job(
    db: Session,
    *,
    owner_key: str,
    category: str | None,
    photo_ids: list[str],
) -> DownloadJob | None:
    jobs = (
        db.query(DownloadJob)
        .filter(DownloadJob.owner_key == owner_key, DownloadJob.job_kind == "user")
        .filter(DownloadJob.category == category)
        .filter(DownloadJob.status.in_(["queued", "processing", "ready"]))
        .order_by(DownloadJob.created_at.desc())
        .all()
    )

    now = datetime.utcnow()
    for job in jobs:
        if job.photo_ids != photo_ids:
            continue
        if job.status == "ready" and job.expires_at < now:
            continue
        return job
    return None


def _latest_matching_ready_archive(
    db: Session,
    *,
    category: str,
    job_kind: str,
    photo_ids: list[str],
    segment_index: int | None = None,
) -> DownloadJob | None:
    query = (
        db.query(DownloadJob)
        .filter(DownloadJob.owner_key == SYSTEM_OWNER_KEY)
        .filter(DownloadJob.category == category)
        .filter(DownloadJob.job_kind == job_kind)
        .filter(DownloadJob.status == "ready")
    )
    if segment_index is None:
        query = query.filter(DownloadJob.segment_index.is_(None))
    else:
        query = query.filter(DownloadJob.segment_index == segment_index)

    jobs = query.order_by(DownloadJob.updated_at.desc(), DownloadJob.created_at.desc()).all()
    for job in jobs:
        if job.photo_ids == photo_ids:
            return job
    return None


class CreateJobRequest(BaseModel):
    photoIds: list[str]
    category: str | None = None

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

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if value not in ALLOWED_ARCHIVE_CATEGORIES:
            raise ValueError("Invalid category")
        return value


class DownloadAllPlanRequest(BaseModel):
    category: str

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        if value not in ALLOWED_ARCHIVE_CATEGORIES:
            raise ValueError("Invalid category")
        return value


@router.post("", dependencies=[Depends(require_gallery_access())])
def create_download_job(
    payload: CreateJobRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

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

    reusable = _find_reusable_user_job(
        db,
        owner_key=owner,
        category=payload.category,
        photo_ids=payload.photoIds,
    )
    if reusable:
        return {"jobId": str(reusable.id)}

    job = _create_download_job(
        db,
        owner_key=owner,
        photo_ids=payload.photoIds,
        category=payload.category,
        file_name=_file_name_for_job("user", payload.category, None, len(payload.photoIds)),
    )
    logger.info("Created user download job %s (%d photos)", job.id, len(payload.photoIds))
    return {"jobId": str(job.id)}


@router.post("/download-all-plan", dependencies=[Depends(require_gallery_access())])
def create_download_all_plan(
    payload: DownloadAllPlanRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    photos = _ordered_done_photos(db, payload.category)
    ordered_ids = [str(photo.id) for photo in photos]
    total_photo_count = len(ordered_ids)
    fixed_segment_count = total_photo_count // ARCHIVE_SEGMENT_SIZE

    ready_archives: list[dict] = []
    covered_count = 0

    for segment_index in range(1, fixed_segment_count + 1):
        expected_ids = ordered_ids[
            (segment_index - 1) * ARCHIVE_SEGMENT_SIZE: segment_index * ARCHIVE_SEGMENT_SIZE
        ]
        ready_job = _latest_matching_ready_archive(
            db,
            category=payload.category,
            job_kind="archive_fixed",
            segment_index=segment_index,
            photo_ids=expected_ids,
        )
        if not ready_job:
            break
        ready_archives.append(_archive_payload(ready_job))
        covered_count += ARCHIVE_SEGMENT_SIZE

    pending_job = None
    remaining_ids = ordered_ids[covered_count:]
    if remaining_ids:
        ready_tail = _latest_matching_ready_archive(
            db,
            category=payload.category,
            job_kind="archive_tail",
            photo_ids=remaining_ids,
        )
        if ready_tail:
            ready_archives.append(_archive_payload(ready_tail))
        else:
            reusable = _find_reusable_user_job(
                db,
                owner_key=owner,
                category=payload.category,
                photo_ids=remaining_ids,
            )
            if reusable is None:
                reusable = _create_download_job(
                    db,
                    owner_key=owner,
                    photo_ids=remaining_ids,
                    category=payload.category,
                    file_name=_file_name_for_job("user", payload.category, None, len(remaining_ids)),
                )
                logger.info(
                    "Created fallback tail job %s for category=%s (%d photos)",
                    reusable.id,
                    payload.category,
                    len(remaining_ids),
                )
            pending_job = _job_dict(reusable)

    return {
        "category": payload.category,
        "totalPhotoCount": total_photo_count,
        "readyPhotoCount": sum(item["photoCount"] for item in ready_archives),
        "archives": ready_archives,
        "pendingJob": pending_job,
    }


@router.get("", dependencies=[Depends(require_gallery_access())])
def list_download_jobs(
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    jobs = (
        db.query(DownloadJob)
        .filter(DownloadJob.owner_key == owner, DownloadJob.job_kind == "user")
        .order_by(DownloadJob.created_at.desc())
        .limit(MAX_JOBS_PER_LIST)
        .all()
    )
    return [_job_dict(job) for job in jobs]


@router.get("/{job_id}", dependencies=[Depends(require_gallery_access())])
def get_download_job(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    try:
        job_uuid = uuid_lib.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    job = db.query(DownloadJob).filter(DownloadJob.id == job_uuid).first()
    if not job or job.owner_key != owner or job.job_kind != "user":
        raise HTTPException(status_code=404, detail="Job not found")

    return _job_dict(job)


@router.get("/{job_id}/url", dependencies=[Depends(require_gallery_access())])
def get_download_url(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = _extract_raw_token(request)
    owner = _owner_key(raw_token)

    try:
        job_uuid = uuid_lib.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    job = db.query(DownloadJob).filter(DownloadJob.id == job_uuid).first()
    if not job or job.owner_key != owner or job.job_kind != "user":
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "ready":
        raise HTTPException(status_code=409, detail=f"Job is not ready (status: {job.status})")
    if job.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Job has expired")
    if not job.zip_key:
        raise HTTPException(status_code=500, detail="Job has no ZIP file")

    try:
        url = storage.generate_download_url_with_expiry(job.zip_key, ZIP_DOWNLOAD_URL_EXPIRY)
    except Exception as exc:
        logger.error("Failed to generate signed URL for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Could not generate download URL")

    return {"url": url}
