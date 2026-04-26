# Phase 13 Implementation – Background Worker & Persistent Processing Queue

**Date:** 3. April 2026  
**Phase:** 13 of 13  
**Status:** Complete  
**Builds on:** Phase 12 (Upload Reliability & CPU Protection)

---

## Overview

Phase 13 fully decouples image processing from the web server process. Before this phase, processing jobs ran inside the FastAPI/uvicorn process — first as unbounded threads (Phase 11), then as a `ThreadPoolExecutor` (Phase 12). Both approaches kept CPU-heavy Pillow work inside the same OS process that handles HTTP requests. Under concurrent load this caused API latency spikes and, before Phase 12's retry additions, lost photos.

After Phase 13, the web server only writes a database row and returns. A dedicated background worker process polls the database for pending jobs and processes them independently. No job is ever lost: the database row survives restarts, and the worker resumes from where it left off on next boot.

No new API endpoints were introduced. No frontend changes were required. The API contract is unchanged — `POST /api/photos` still returns `{"status": "ok"}` immediately after the DB write.

---

## Architecture

### Before (Phase 12)

```
HTTP request
     ↓
POST /api/photos  (FastAPI / uvicorn process)
     ↓
DB write (status="pending")
     ↓
ThreadPoolExecutor.submit(_safe_process_photo)
     ↓
Pillow resize + S3 upload  ← runs inside API process, shares CPU
```

The API process handles HTTP requests and runs image processing in the same OS process. They compete for the same CPU cores. A surge of uploads triggered a surge of processing threads, degrading API response times for every concurrent user.

### After (Phase 13)

```
HTTP request
     ↓
POST /api/photos  (FastAPI / uvicorn process)
     ↓
DB write (status="pending")  ← returns immediately
     ↑
     ↓   (separate Docker container / OS process)
Background worker
     ↓
SELECT oldest pending WHERE status='pending' FOR UPDATE SKIP LOCKED
     ↓
status="processing", processing_attempts += 1
     ↓
process_photo_safe()  ← Pillow resize + S3 upload, isolated CPU
     ↓
status="done"  (or "pending" for retry / "failed" after 3 attempts)
```

The database row is the job ticket. The worker is the only process that owns `processing_status` transitions.

### Key design principles

| Principle | Implementation |
|---|---|
| DB as job queue | No Redis, no Celery — a `photos` row with `status='pending'` is a job |
| CPU isolation | Worker runs in a separate Docker container; cannot steal CPU from the API |
| Persistence | Jobs survive any restart — rows remain in DB until explicitly updated |
| Restart safety | On startup the worker resets stuck `processing` rows back to `pending` |
| Retry with cap | `processing_attempts` counter prevents infinite retry loops |
| Concurrency safety | `FOR UPDATE SKIP LOCKED` allows multiple worker instances without double-claiming |

---

## Part 1 – Database Changes

### 1.1 New column: `processing_attempts`

File: `backend/models.py`

**Before:**

```python
processing_status = Column(String, default="pending")
processing_error = Column(Text)
```

**After:**

```python
processing_status = Column(String, default="pending")
processing_attempts = Column(Integer, default=0, server_default="0", nullable=False)
processing_error = Column(Text)
```

`processing_attempts` is incremented by the worker each time it claims a job. The worker uses it to decide whether to retry or permanently fail a photo. It is never reset after a failure — the counter accumulates across all attempts to ensure the cap is respected even across worker restarts.

**Migration for existing databases:**

```sql
ALTER TABLE photos ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;
```

New databases created via `Base.metadata.create_all()` get the column automatically.

### 1.2 `processing_status` semantics (unchanged values, new ownership rule)

| Status | Meaning | Who sets it |
|---|---|---|
| `pending` | Waiting to be picked up | API (on registration); worker (on retry) |
| `processing` | Currently being processed | Worker only |
| `done` | Fully processed and ready to serve | Worker only |
| `failed` | Permanently failed after `MAX_ATTEMPTS` | Worker only |

The critical change from Phase 12: `processing_status` was previously also written by `_process_photo()` inside the API process. It is now written **exclusively by the worker**. `_process_photo()` no longer touches `processing_status` at all.

---

## Part 2 – Backend: `image_processing.py` Refactor

File: `backend/services/image_processing.py`

### 2.1 Remove `ThreadPoolExecutor`

**Before:**

```python
from concurrent.futures import ThreadPoolExecutor

_PROCESSING_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="img-process")

def trigger_processing(photo_id: str) -> None:
    _PROCESSING_POOL.submit(_safe_process_photo, photo_id)
    logger.info("Processing enqueued for photo_id=%s", photo_id)

def _safe_process_photo(photo_id: str) -> None:
    try:
        _process_photo(photo_id)
    except Exception as exc:
        logger.exception("Unhandled error in processing thread for photo_id=%s: %s", photo_id, exc)
        _mark_failed(photo_id, f"Unhandled error: {exc}")
```

**After:**

```python
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
```

`trigger_processing`, `_safe_process_photo`, `_PROCESSING_POOL`, and all associated imports (`ThreadPoolExecutor`, `Thread`) are completely removed. The public interface is now `process_photo_safe()`, which performs work and re-raises on failure so the calling worker can apply its retry logic.

**Why re-raise instead of suppress:**

The old `_safe_process_photo` swallowed exceptions. That was correct when the thread was fire-and-forget — there was no caller to propagate to. Now the worker is the caller, and it needs the exception to decide whether to retry or fail. `process_photo_safe` logs the exception (for observability) and then re-raises it.

### 2.2 `_process_photo` no longer owns `processing_status`

**Before:** `_process_photo` called `_set_status(db, photo, "processing")` at the start and `photo.processing_status = "done"` at the end. Failures called `_mark_failed_in_session(db, photo, ...)`.

**After:** `_process_photo` writes only `preview_key`, `preview_url`, `thumbnail_key`, `thumbnail_url`, and `taken_at`. It never touches `processing_status` or `processing_error`. All early-return error paths became `raise RuntimeError(...)`.

```python
def _process_photo(photo_id: str) -> None:
    """Download the original, generate preview + thumbnail, upload to S3.

    Updates the photo row with variant keys/URLs and taken_at.
    Does NOT modify processing_status — that is owned exclusively by the worker.
    Raises on any failure so the worker can apply its retry/failure logic.
    """
    ...
    # Persist variant keys/URLs and EXIF capture date.
    # processing_status is managed exclusively by the worker.
    photo.preview_key = preview_key
    photo.preview_url = preview_url
    photo.thumbnail_key = thumb_key
    photo.thumbnail_url = thumb_url
    photo.taken_at = taken_at
    db.commit()
    ...
```

This separation of concerns is important: `_process_photo` is purely about image work and data persistence. All scheduling, retry, and lifecycle management is the worker's responsibility.

### 2.3 Removed helpers: `_set_status`, `_mark_failed_in_session`, `_mark_failed`

These three helper functions existed solely to write `processing_status` from within the old in-process path. With the worker owning all status transitions, they are no longer needed and have been deleted.

### 2.4 Idempotency guard simplified

**Before:** The idempotency guard checked both `preview_key and thumbnail_key` and `processing_status == "processing"` (to prevent re-entry from two concurrent threads).

**After:** Only the key-existence check remains:

```python
if photo.preview_key and photo.thumbnail_key:
    logger.info("Processing: skipping %s — variants already exist", photo_id)
    return
```

The `status == "processing"` guard is no longer needed because `FOR UPDATE SKIP LOCKED` in the worker's SELECT prevents two workers from claiming the same row. The key-existence guard handles the case where the worker is restarted after `_process_photo` committed variant keys but before the worker committed `status="done"`.

---

## Part 3 – Backend: `routers/photos.py` Changes

File: `backend/routers/photos.py`

### 3.1 Remove processing trigger

**Before:**

```python
from services.image_processing import trigger_processing

# ... inside register_photo():
trigger_processing(request.photoId)
logger.info("Registered photo id=%s category=%s", request.photoId, effective_category)
return {"status": "ok"}
```

**After:**

```python
# no import of trigger_processing

# ... inside register_photo():
logger.info("Registered photo id=%s category=%s (pending processing)", request.photoId, effective_category)
return {"status": "ok"}
```

The photo row is created with `processing_status="pending"` (unchanged from before). The only difference is that nothing is scheduled — the worker discovers the row via its polling loop. The HTTP response time for `POST /api/photos` is now bounded only by the DB write; no thread pool submission, no I/O scheduling.

The dead `_trigger_photo_processing` stub (a no-op left over from an earlier refactor) was also deleted.

---

## Part 4 – New Background Worker

File: `backend/worker/__init__.py` *(empty package marker)*  
File: `backend/worker/image_worker.py` *(new)*

### 4.1 Configuration constants

```python
POLL_INTERVAL = 2   # seconds to sleep when the queue is empty
MAX_ATTEMPTS = 3    # a photo is permanently failed after this many errors
```

`POLL_INTERVAL = 2` means a photo registered by the API is picked up within at most 2 seconds. This is deliberately not configurable via environment variable to avoid operational complexity; change it in source if needed.

### 4.2 Startup: stuck-job recovery

```python
def _reset_stuck_jobs() -> None:
    stuck = db.query(Photo).filter(Photo.processing_status == "processing").all()
    if stuck:
        logger.warning("Found %d stuck job(s) in 'processing' state — resetting to 'pending'", len(stuck))
        for photo in stuck:
            photo.processing_status = "pending"
        db.commit()
```

On startup, any photo with `status="processing"` was claimed by a previous worker invocation that was killed mid-job (container restart, OOM, deployment). Resetting them to `pending` allows the current worker to pick them up. `processing_attempts` is intentionally **not** reset — a photo that crashed the worker 2 times will be attempted once more and then permanently failed, rather than being retried indefinitely.

### 4.3 Main loop

```python
while True:
    photo = (
        db.query(Photo)
        .filter(Photo.processing_status == "pending")
        .order_by(Photo.created_at.asc())
        .with_for_update(skip_locked=True)
        .first()
    )

    if not photo:
        db.rollback()
        time.sleep(POLL_INTERVAL)
        continue

    # Claim the job
    photo.processing_status = "processing"
    photo.processing_attempts += 1
    db.commit()

    try:
        process_photo_safe(photo_id)
        photo.processing_status = "done"
        photo.processing_error = None
        db.commit()
        logger.info("Processing success %s", photo_id)

    except Exception as exc:
        photo.processing_error = str(exc)
        if photo.processing_attempts >= MAX_ATTEMPTS:
            photo.processing_status = "failed"
            logger.error("Processing failed permanently %s after %d attempt(s): %s", ...)
        else:
            photo.processing_status = "pending"
            logger.warning("Retrying photo %s (attempt %d failed): %s", ...)
        db.commit()
```

**Step-by-step:**

1. **SELECT FOR UPDATE SKIP LOCKED** — atomically locks the first `pending` row. If two worker instances run simultaneously (e.g. during a rolling deploy), each one gets a different row. `SKIP LOCKED` means the second worker skips rows already held by the first, rather than blocking.
2. **`db.rollback()` on empty queue** — releases the `FOR UPDATE` lock immediately when no row is found. Without this, the lock stays open for the duration of the sleep.
3. **Claim with commit** — setting `status="processing"` and committing releases the row-level lock. The row is now visible as `processing` to any monitoring queries before the job completes.
4. **Re-read after `process_photo_safe`** — `process_photo_safe` opens its own `SessionLocal`, commits variant keys, and closes. The worker's session still holds the old in-memory state of the `photo` object. Re-querying with `db.query(Photo).filter(Photo.id == photo.id).first()` ensures the worker writes `status="done"` to the same row with up-to-date `processing_attempts` (relevant for the failure branch).
5. **Retry vs. permanent failure** — `photo.processing_attempts >= MAX_ATTEMPTS` after a failure permanently marks the photo as `failed`. The threshold is `>=` rather than `==` to correctly handle the case where a photo arrived with `processing_attempts` already > 0 (e.g. reset from a stuck state at startup).
6. **Outer exception handler** — any unhandled error in the loop body (e.g. a DB connection failure) is caught, logged, and the loop continues. The worker never terminates on a single error.

### 4.4 Retry schedule

| Attempt | Status after failure | Next action |
|---|---|---|
| 1 | `pending` (attempts=1) | Re-queued immediately |
| 2 | `pending` (attempts=2) | Re-queued immediately |
| 3 | `failed` (attempts=3) | Permanently failed; no more retries |

There is no exponential back-off between worker retries. Retries happen on the next poll cycle, which is within 2 seconds. This is acceptable because failures here are typically due to S3 transient errors (connection reset, 503) or image corruption — not load-based problems. Load-based back-off belongs in the frontend's `registerPhoto` retry (Phase 12), not here.

---

## Part 5 – Docker Setup

### 5.1 `docker-compose.yml` (development)

```yaml
worker:
  build: ./backend
  restart: unless-stopped
  environment:
    DATABASE_URL: postgresql://postgres:password@db:5432/hochzeit_db
    S3_ENDPOINT: ${S3_ENDPOINT}
    S3_ACCESS_KEY: ${S3_ACCESS_KEY}
    S3_SECRET_KEY: ${S3_SECRET_KEY}
    S3_BUCKET_NAME: ${S3_BUCKET_NAME}
    S3_REGION: ${S3_REGION:-eu-central}
  depends_on:
    db:
      condition: service_healthy
  volumes:
    - ./backend:/app
  command: python -m worker.image_worker
```

### 5.2 `docker-compose.prod.yml` (production)

```yaml
worker:
  build:
    context: ./backend
    dockerfile: Dockerfile
  restart: unless-stopped
  environment:
    DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-hochzeit_db}
    S3_ENDPOINT: ${S3_ENDPOINT}
    S3_ACCESS_KEY: ${S3_ACCESS_KEY}
    S3_SECRET_KEY: ${S3_SECRET_KEY}
    S3_BUCKET_NAME: ${S3_BUCKET_NAME}
    S3_REGION: ${S3_REGION:-eu-central}
  networks:
    - app-network
  depends_on:
    db:
      condition: service_healthy
  command: python -m worker.image_worker
```

**Design decisions:**

- **Same image as backend** — the worker uses the same `Dockerfile` and therefore the same Python environment, dependencies, and source tree as the backend. No separate image to maintain.
- **`GALLERY_PASSWORD` and `CORS_ORIGINS` are not needed** — the worker never handles HTTP requests, so these are omitted from its environment.
- **`restart: unless-stopped`** — Docker automatically restarts the worker on crash or OOM. Combined with startup stuck-job recovery, this guarantees no job is permanently dropped due to a worker failure.
- **No exposed ports** — the worker is not a network service.
- **`depends_on: db`** — ensures the database is ready before the worker starts polling. Without this the worker's first query could fail and the startup recovery might be skipped.
- **Run with `python -m worker.image_worker`** — using the module form ensures Python's import path includes `backend/` and all relative imports (`from database import ...`, etc.) resolve correctly.

---

## Effect on Existing Behaviour

| Scenario | Before (Phase 12) | After (Phase 13) |
|---|---|---|
| Photo registered via `POST /api/photos` | DB write → ThreadPool.submit() → returns | DB write → returns; worker picks up within 2 s |
| API CPU under 20 concurrent uploads | ThreadPool capped at 2; stable | Zero processing CPU in API process; fully isolated |
| Worker container killed mid-job | N/A (in-process; kill = lost job) | Photo stays `processing`; reset to `pending` on next worker start |
| Worker container restarted after deploy | N/A | All `pending` rows are picked up immediately on boot |
| Photo fails processing 3 times | Status: `failed` (written by API thread) | Status: `failed` (written by worker with persisted attempt count) |
| Processing status in response to `GET /api/photos` | Only `done` photos returned (unchanged) | Unchanged — `GET /api/photos` still filters `processing_status = 'done'` |
| Single photo upload, single user | Slightly deferred (processed within 2 s) | Same as before — practically instantaneous diff |

---

## Files Changed

| File | Change |
|---|---|
| `backend/models.py` | Add `processing_attempts` column to `Photo` |
| `backend/services/image_processing.py` | Remove `ThreadPoolExecutor`, `trigger_processing`, `_safe_process_photo`, `_set_status`, `_mark_failed_in_session`, `_mark_failed`; add `process_photo_safe()`; refactor `_process_photo` to raise on error and not touch `processing_status` |
| `backend/routers/photos.py` | Remove `trigger_processing` import and call; remove dead `_trigger_photo_processing` stub |
| `backend/worker/__init__.py` | New — empty package marker |
| `backend/worker/image_worker.py` | New — background worker with polling loop, startup recovery, retry logic |
| `docker-compose.yml` | Add `worker` service |
| `docker-compose.prod.yml` | Add `worker` service |

**Database migration required** for existing production databases:

```sql
ALTER TABLE photos ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;
```

No frontend changes. No new environment variables. No API contract changes.
