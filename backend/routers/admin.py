"""Admin endpoints for processing queue visibility and manual recovery."""

import logging
import uuid as uuid_lib
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Photo
from routers.auth import require_gallery_access

router = APIRouter(tags=["admin"])
logger = logging.getLogger(__name__)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/processing-stats", dependencies=[Depends(require_gallery_access("admin"))])
def get_processing_stats(db: Session = Depends(get_db)):
    """Return a count of photos in each processing state plus the age of the
    oldest pending job.  Requires an admin-tier token.
    """
    pending_count = db.query(Photo).filter(Photo.processing_status == "pending").count()
    processing_count = db.query(Photo).filter(Photo.processing_status == "processing").count()
    failed_count = db.query(Photo).filter(Photo.processing_status == "failed").count()
    done_count = db.query(Photo).filter(Photo.processing_status == "done").count()

    oldest = (
        db.query(Photo)
        .filter(Photo.processing_status == "pending")
        .order_by(Photo.created_at.asc())
        .first()
    )
    oldest_pending_seconds = (
        (datetime.utcnow() - oldest.created_at).total_seconds() if oldest else 0
    )

    return {
        "pending": pending_count,
        "processing": processing_count,
        "failed": failed_count,
        "done": done_count,
        "oldestPendingSeconds": int(oldest_pending_seconds),
    }


@router.post("/retry-photo/{photo_id}", dependencies=[Depends(require_gallery_access("admin"))])
def retry_photo(photo_id: str, db: Session = Depends(get_db)):
    """Re-queue a failed (or stuck) photo for processing.

    Resets processing_attempts to 0 so the full MAX_ATTEMPTS budget is
    available again.  Clears next_attempt_at so the worker picks it up
    on the next poll cycle.  Any token with 'admin' permission can call
    this endpoint.
    """
    try:
        photo_uuid = uuid_lib.UUID(photo_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid photo ID")

    photo = db.query(Photo).filter(Photo.id == photo_uuid).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    previous_status = photo.processing_status
    photo.processing_status = "pending"
    photo.processing_attempts = 0
    photo.processing_error = None
    photo.next_attempt_at = None
    db.commit()

    logger.info(
        "Photo %s manually re-queued for processing (was: %s)",
        photo_id,
        previous_status,
    )
    return {"status": "requeued", "photoId": photo_id}
