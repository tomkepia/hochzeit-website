"""Background worker: polls the database for pending photo-processing jobs
and async download-ZIP jobs.

Architecture
------------
The database acts as the job queue — no Redis, no Celery.  A single row in
the ``photos`` table with ``processing_status = 'pending'`` is a job.

The worker loop:
1. SELECT up to BATCH_SIZE oldest pending photos whose next_attempt_at is in
   the past (or NULL), ordered so new jobs (NULL) precede retried jobs, using
   FOR UPDATE SKIP LOCKED for concurrency safety.
2. Claim each by setting status = 'processing', incrementing
   processing_attempts, and clearing next_attempt_at, then commit.
3. Call process_photo_safe(), which downloads the original from S3,
   generates preview + thumbnail, uploads them, and writes variant keys to
   the DB.  It raises on any failure.
4. On success  → status = 'done', next_attempt_at = None.
   On failure and attempts < MAX_ATTEMPTS → status = 'pending',
     next_attempt_at = now + backoff (30s × attempts, capped at 5 min).
   On failure and attempts >= MAX_ATTEMPTS → status = 'failed' (give up).

Download-ZIP jobs
-----------------
After each photo-processing batch the worker also processes one queued
DownloadJob:
1. Set status = 'processing'.
2. For each photo_id, generate a signed S3 URL, stream the bytes through a
   zipstream.ZipStream and upload the result to S3 via multipart upload.
3. On success → status = 'ready', zip_key set.
   On failure → status = 'failed', error_message set.

Cleanup
-------
Expired DownloadJobs (expires_at < now) are deleted from the DB and their
ZIP files are removed from S3.  Cleanup runs once per worker loop iteration.

Retry backoff
-------------
After each failure the job is re-queued with a next_attempt_at in the future.
The worker skips any row whose next_attempt_at has not yet passed, preventing
rapid retry storms after a transient error.

Backoff schedule: 30 s, 60 s, then capped at 300 s (5 min).

Restart safety
--------------
On startup the worker resets any photos stuck in 'processing' back to
'pending'.  These are photos that were claimed but never finished because
the worker was killed mid-job.  Their processing_attempts counter is NOT
reset, so they count against MAX_ATTEMPTS.  next_attempt_at is cleared so
they are eligible to run immediately on the next poll cycle.
"""

import logging
import os
import sys
import time
import uuid as uuid_lib
from collections.abc import Iterator
from datetime import datetime, timedelta

import requests
import zipstream
from database import SessionLocal
from models import DownloadJob, Photo
from services import storage
from services.image_processing import process_photo_safe

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

POLL_INTERVAL = 2           # seconds to sleep when the queue is empty
MAX_ATTEMPTS = 3            # a photo is permanently failed after this many errors
BATCH_SIZE = 2              # photos claimed per loop iteration (keeps CPU controlled)
BACKOFF_BASE_SECONDS = 30   # first retry delay; scales linearly with attempt count
BACKOFF_MAX_SECONDS = 300   # cap at 5 minutes
# Pause between productive batches.  Gives S3 (and CPU) breathing room when
# many photos are queued.  0 means process continuously until the queue drains.
INTER_BATCH_SLEEP = 1       # seconds

ZIP_CHUNK_SIZE = 64 * 1024  # 64 KB read chunks when streaming photo bytes into ZIP

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [worker] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Startup recovery
# ---------------------------------------------------------------------------

def _reset_stuck_jobs() -> None:
    """Reset photos stuck in 'processing' to 'pending' on startup.

    A photo can be stuck in 'processing' if the worker was killed while
    handling it.  Resetting allows those photos to be retried on the next
    poll cycle.  processing_attempts is NOT reset so the MAX_ATTEMPTS cap
    is respected.  next_attempt_at is cleared so the job is eligible
    immediately — a stuck job has already paid its delay.
    """
    db = SessionLocal()
    try:
        stuck = db.query(Photo).filter(Photo.processing_status == "processing").all()
        if stuck:
            logger.warning(
                "Found %d stuck job(s) in 'processing' state — resetting to 'pending'",
                len(stuck),
            )
            for photo in stuck:
                photo.processing_status = "pending"
                photo.next_attempt_at = None
            db.commit()

        # Also reset download jobs stuck in 'processing' back to 'queued'.
        stuck_dl = db.query(DownloadJob).filter(DownloadJob.status == "processing").all()
        if stuck_dl:
            logger.warning(
                "Found %d stuck download job(s) in 'processing' — resetting to 'queued'",
                len(stuck_dl),
            )
            for dj in stuck_dl:
                dj.status = "queued"
            db.commit()
    except Exception:
        logger.exception("Failed to reset stuck jobs on startup")
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _backoff_seconds(attempts: int) -> int:
    """Return the number of seconds to wait before the next attempt.

    Scales linearly: 30 s, 60 s, 90 s … capped at BACKOFF_MAX_SECONDS.
    """
    return min(BACKOFF_BASE_SECONDS * attempts, BACKOFF_MAX_SECONDS)


# ---------------------------------------------------------------------------
# Download-ZIP job helpers
# ---------------------------------------------------------------------------

def _extension_from_key(key: str | None) -> str:
    """Extract a safe file extension from a storage key; fallback to jpg."""
    if not key:
        return "jpg"
    last = key.rsplit("/", 1)[-1]
    if "." not in last:
        return "jpg"
    ext = last.rsplit(".", 1)[-1].lower().strip()
    ext = "".join(ch for ch in ext if ch.isalnum())
    return ext or "jpg"


def _iter_photo_chunks(download_url: str, photo_id: str) -> Iterator[bytes]:
    """Stream photo bytes from a signed S3 URL in ZIP_CHUNK_SIZE chunks."""
    try:
        with requests.get(download_url, stream=True, timeout=30) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_content(chunk_size=ZIP_CHUNK_SIZE):
                if chunk:
                    yield chunk
    except Exception as exc:
        logger.error("Streaming photo %s failed: %s", photo_id, exc)


def _process_download_job(db, job: DownloadJob) -> None:
    """Build the ZIP for a download job and upload it to S3."""
    job_id = str(job.id)
    job.status = "processing"
    db.commit()
    logger.info("Processing download job %s (%d photos)", job_id, len(job.photo_ids))

    try:
        photo_uuids = [uuid_lib.UUID(pid) for pid in job.photo_ids]
        photos = (
            db.query(Photo)
            .filter(Photo.id.in_(photo_uuids), Photo.processing_status == "done")
            .all()
        )
        photo_map = {str(p.id): p for p in photos}

        z = zipstream.ZipStream(compress_type=zipstream.ZIP_DEFLATED)
        added = 0
        for pid in job.photo_ids:
            photo = photo_map.get(pid)
            if not photo or not photo.original_key:
                logger.warning("Skipping photo %s: not ready or missing key", pid)
                continue
            try:
                url = storage.generate_download_url(photo.original_key)
            except Exception as exc:
                logger.error("Signed URL failed for photo %s: %s", pid, exc)
                continue
            ext = _extension_from_key(photo.original_key)
            z.add(_iter_photo_chunks(url, pid), f"wedding-{pid}.{ext}")
            added += 1

        if added == 0:
            raise RuntimeError("No downloadable photos available for this job")

        zip_key = f"zips/{job_id}.zip"
        storage.upload_stream_as_zip(zip_key, z)

        job.status = "ready"
        job.zip_key = zip_key
        job.error_message = None
        db.commit()
        logger.info("Download job %s complete → s3 key=%s", job_id, zip_key)

    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)
        db.commit()
        logger.error("Download job %s failed: %s", job_id, exc)


def _cleanup_expired_download_jobs(db) -> None:
    """Delete expired download jobs and their ZIPs from S3."""
    now = datetime.utcnow()
    expired = (
        db.query(DownloadJob)
        .filter(DownloadJob.expires_at < now)
        .all()
    )
    for job in expired:
        if job.zip_key:
            try:
                storage.delete_file(job.zip_key)
                logger.info("Deleted expired ZIP %s", job.zip_key)
            except Exception as exc:
                logger.warning("Could not delete ZIP %s: %s", job.zip_key, exc)
        db.delete(job)
    if expired:
        db.commit()
        logger.info("Cleaned up %d expired download job(s)", len(expired))


# ---------------------------------------------------------------------------
# Per-photo processing (called inside the batch loop)
# ---------------------------------------------------------------------------

def _handle_photo(db, photo: Photo) -> None:
    """Claim, process, and persist the outcome for a single photo."""
    photo_id = str(photo.id)

    # ----------------------------------------------------------------
    # Claim: mark as processing, increment attempt counter, clear backoff
    # ----------------------------------------------------------------
    photo.processing_status = "processing"
    photo.processing_attempts += 1
    photo.next_attempt_at = None
    db.commit()  # releases the row lock; other workers can claim other rows

    logger.info(
        "Worker picked job %s (attempt %d/%d)",
        photo_id,
        photo.processing_attempts,
        MAX_ATTEMPTS,
    )

    try:
        process_photo_safe(photo_id)

        # Re-read: process_photo_safe committed variant keys in its own session.
        photo = db.query(Photo).filter(Photo.id == photo.id).first()
        photo.processing_status = "done"
        photo.processing_error = None
        photo.next_attempt_at = None
        db.commit()

        logger.info("Processing success %s", photo_id)

    except Exception as exc:
        # Re-read to get the latest processing_attempts from the DB.
        photo = db.query(Photo).filter(Photo.id == photo.id).first()
        if photo:
            photo.processing_error = str(exc)
            if photo.processing_attempts >= MAX_ATTEMPTS:
                photo.processing_status = "failed"
                photo.next_attempt_at = None
                logger.error(
                    "Processing failed permanently %s after %d attempt(s): %s",
                    photo_id,
                    photo.processing_attempts,
                    exc,
                )
            else:
                delay = _backoff_seconds(photo.processing_attempts)
                photo.processing_status = "pending"
                photo.next_attempt_at = datetime.utcnow() + timedelta(seconds=delay)
                logger.warning(
                    "Retry scheduled for %s in %ds (attempt %d failed): %s",
                    photo_id,
                    delay,
                    photo.processing_attempts,
                    exc,
                )
            db.commit()


# ---------------------------------------------------------------------------
# Main worker loop
# ---------------------------------------------------------------------------

def run_worker() -> None:
    logger.info(
        "Image processing worker started "
        "(MAX_ATTEMPTS=%d, POLL_INTERVAL=%ds, BATCH_SIZE=%d, INTER_BATCH_SLEEP=%ds)",
        MAX_ATTEMPTS,
        POLL_INTERVAL,
        BATCH_SIZE,
        INTER_BATCH_SLEEP,
    )

    _reset_stuck_jobs()

    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()

            # Fetch a small batch of eligible pending jobs:
            # - status = 'pending'
            # - next_attempt_at is NULL (first attempt / manual retry) OR has passed
            # - ORDER BY:
            #     1. next_attempt_at NULLS FIRST  — new jobs (NULL) before retries
            #     2. created_at ASC               — FIFO tiebreaker within each tier
            #   This ensures fresh uploads are never queued behind retried photos.
            # - FOR UPDATE SKIP LOCKED: safe with multiple worker instances
            photos = (
                db.query(Photo)
                .filter(Photo.processing_status == "pending")
                .filter(
                    (Photo.next_attempt_at == None) | (Photo.next_attempt_at <= now)  # noqa: E711
                )
                .order_by(Photo.next_attempt_at.asc().nullsfirst(), Photo.created_at.asc())
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
                .all()
            )

            if not photos:
                db.rollback()  # release FOR UPDATE lock immediately

                # No photo-processing work — check for a queued download job.
                dl_job = (
                    db.query(DownloadJob)
                    .filter(DownloadJob.status == "queued")
                    .order_by(DownloadJob.created_at.asc())
                    .with_for_update(skip_locked=True)
                    .first()
                )
                if dl_job:
                    _process_download_job(db, dl_job)
                else:
                    time.sleep(POLL_INTERVAL)

                # Cleanup expired download jobs once per idle cycle.
                _cleanup_expired_download_jobs(db)
                continue

            for photo in photos:
                _handle_photo(db, photo)

            # After processing a photo batch, also try one queued download job.
            dl_job = (
                db.query(DownloadJob)
                .filter(DownloadJob.status == "queued")
                .order_by(DownloadJob.created_at.asc())
                .with_for_update(skip_locked=True)
                .first()
            )
            if dl_job:
                _process_download_job(db, dl_job)

            # Cleanup expired download jobs.
            _cleanup_expired_download_jobs(db)

            # Brief pause between productive batches to throttle S3 request rate
            # and give the CPU a moment between back-to-back Pillow operations.
            if INTER_BATCH_SLEEP > 0:
                time.sleep(INTER_BATCH_SLEEP)

        except Exception:
            logger.exception("Unexpected error in worker loop — continuing")
            try:
                db.rollback()
            except Exception:
                pass
            # Avoid tight-loop CPU burn when a persistent error occurs
            # (e.g. database temporarily unavailable).
            time.sleep(POLL_INTERVAL)
        finally:
            db.close()


if __name__ == "__main__":
    run_worker()
