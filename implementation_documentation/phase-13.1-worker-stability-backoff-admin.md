# Phase 13.1 Implementation – Worker Stability, Backoff & Admin Visibility

**Date:** 3. April 2026  
**Phase:** 13.1 of 13.1  
**Status:** Complete  
**Builds on:** Phase 13 (Background Worker & Persistent Processing Queue)

---

## Overview

Phase 13.1 is a refinement of the background processing system introduced in Phase 13. No architecture changes were made — the database-as-queue pattern, the worker container, and the API contract all remain identical. This phase hardens the existing system in five areas:

1. **Retry back-off** — failed jobs now wait before being retried, preventing rapid retry storms that could saturate S3 or CPU resources.
2. **Job prioritization** — new uploads are always processed before retried jobs, so a burst of failures never delays fresh guest photos.
3. **S3/CPU rate control** — a brief inter-batch sleep prevents the worker from hammering S3 or the CPU when many photos are queued.
4. **Batch processing** — the worker claims up to 2 jobs per loop iteration instead of 1, increasing throughput without risking CPU spikes.
5. **Admin monitoring** — a new endpoint provides visibility into the processing queue state at a glance.
6. **Manual recovery** — a new endpoint lets admins re-queue any photo (regardless of its current status) with a fully reset attempt counter.

No frontend changes were required. No new environment variables were introduced.

---

## Part 1 – Database Changes

### 1.1 New column: `next_attempt_at`

File: `backend/models.py`

**Before:**

```python
processing_attempts = Column(Integer, default=0, server_default="0", nullable=False)
processing_error = Column(Text)
```

**After:**

```python
processing_attempts = Column(Integer, default=0, server_default="0", nullable=False)
processing_error = Column(Text)
next_attempt_at = Column(DateTime, nullable=True)
```

`next_attempt_at` stores the earliest UTC time at which the worker is permitted to attempt a job again. `NULL` means the job is ready to run immediately — this is the value for all new registrations, successful jobs, and manually re-queued photos.

**Migration for existing databases:**

```sql
ALTER TABLE photos ADD COLUMN next_attempt_at TIMESTAMP NULL;
```

New databases created via `Base.metadata.create_all()` get the column automatically. Since all inserted rows have `next_attempt_at = NULL` by default, existing `pending` rows are immediately eligible on next worker poll — there is no data migration.

### 1.2 Updated field semantics

| Field | Value | Meaning |
|---|---|---|
| `processing_status = 'pending'` + `next_attempt_at = NULL` | New or retried job | Eligible immediately |
| `processing_status = 'pending'` + `next_attempt_at > utcnow()` | Failed job in back-off | Not eligible yet |
| `processing_status = 'pending'` + `next_attempt_at <= utcnow()` | Back-off expired | Eligible again |
| `processing_status = 'processing'` + `next_attempt_at = NULL` | Actively being processed | — |
| `processing_status = 'done'` + `next_attempt_at = NULL` | Completed | — |
| `processing_status = 'failed'` + `next_attempt_at = NULL` | Permanently failed | Requires manual retry |

---

## Part 2 – Worker Changes

File: `backend/worker/image_worker.py`

### 2.1 New configuration constants

**Before:**

```python
POLL_INTERVAL = 2
MAX_ATTEMPTS = 3
```

**After:**

```python
POLL_INTERVAL = 2
MAX_ATTEMPTS = 3
BATCH_SIZE = 2
BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX_SECONDS = 300
INTER_BATCH_SLEEP = 1
```

`BATCH_SIZE = 2` allows the worker to claim and process two photos per loop cycle, improving throughput when multiple photos are queued without spawning extra threads or increasing CPU exposure beyond what two sequential processing jobs require.

`BACKOFF_BASE_SECONDS = 30` and `BACKOFF_MAX_SECONDS = 300` control the back-off schedule (see §2.3).

`INTER_BATCH_SLEEP = 1` inserts a 1-second pause after each productive batch. Setting it to `0` disables the throttle (queue drains as fast as possible). See §2.7.

### 2.2 Batch query with `next_attempt_at` filter and job prioritization

**Before:**

```python
photo = (
    db.query(Photo)
    .filter(Photo.processing_status == "pending")
    .order_by(Photo.created_at.asc())
    .with_for_update(skip_locked=True)
    .first()
)

if not photo:
    ...
```

**After:**

```python
now = datetime.utcnow()

photos = (
    db.query(Photo)
    .filter(Photo.processing_status == "pending")
    .filter(
        (Photo.next_attempt_at == None) | (Photo.next_attempt_at <= now)
    )
    .order_by(Photo.next_attempt_at.asc().nullsfirst(), Photo.created_at.asc())
    .limit(BATCH_SIZE)
    .with_for_update(skip_locked=True)
    .all()
)

if not photos:
    ...

for photo in photos:
    _handle_photo(db, photo)
```

Four changes combined:

1. The `next_attempt_at` filter ensures back-off is respected. A photo that just failed with a 30-second delay will be invisible to the worker for those 30 seconds.
2. `.order_by(Photo.next_attempt_at.asc().nullsfirst(), Photo.created_at.asc())` — two-level sort that ensures new uploads are always processed before retried jobs (see §2.6).
3. `.limit(BATCH_SIZE)` claims up to 2 rows per loop, processed sequentially in `_handle_photo`.
4. `.first()` → `.all()` to support multiple results.

The `# noqa: E711` comment on the `== None` comparison is required because SQLAlchemy's `IS NULL` is expressed as `== None` in Python — standard linters flag this as suspicious, but it is correct here.

### 2.3 Back-off on failure

**Before:**

```python
photo.processing_status = "pending"
logger.warning("Retrying photo %s (attempt %d failed): %s", ...)
```

**After:**

```python
delay = _backoff_seconds(photo.processing_attempts)
photo.processing_status = "pending"
photo.next_attempt_at = datetime.utcnow() + timedelta(seconds=delay)
logger.warning(
    "Retry scheduled for %s in %ds (attempt %d failed): %s",
    photo_id, delay, photo.processing_attempts, exc,
)
```

The back-off delay is calculated by `_backoff_seconds()`:

```python
def _backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_BASE_SECONDS * attempts, BACKOFF_MAX_SECONDS)
```

**Back-off schedule:**

| Attempt that failed | `processing_attempts` at failure | Delay before retry |
|---|---|---|
| 1st | 1 | 30 s |
| 2nd | 2 | 60 s |
| 3rd | 3 | `≥ MAX_ATTEMPTS` → permanently `failed`, no retry |

The cap of 5 minutes (`BACKOFF_MAX_SECONDS = 300`) ensures that a pathological photo never waits more than 5 minutes if the attempt count grows beyond 3 due to manual retries resetting the counter (see §3.2).

**Why linear back-off instead of exponential:**

Exponential back-off is appropriate for thundering-herd problems where many clients are retrying the same contested resource. Here, the resource is a single S3-hosted image, and the worker processes one photo at a time. Linear back-off keeps the schedule predictable and the code simple. The cap at 5 minutes prevents excessively long waits if `processing_attempts` somehow grows large.

### 2.4 Clear `next_attempt_at` on claim and on success

```python
# On claim:
photo.next_attempt_at = None

# On success:
photo.processing_status = "done"
photo.processing_error = None
photo.next_attempt_at = None
```

Clearing `next_attempt_at` on claim is defensive: it prevents a stale future timestamp from appearing on the row while it is in `processing` state. Clearing on success removes any residual timestamp from a previous attempt.

### 2.5 Startup recovery clears `next_attempt_at`

**Before:**

```python
for photo in stuck:
    photo.processing_status = "pending"
```

**After:**

```python
for photo in stuck:
    photo.processing_status = "pending"
    photo.next_attempt_at = None
```

A photo stuck in `processing` has already waited however long it was being processed. Resetting its `next_attempt_at` to `NULL` makes it immediately eligible rather than leaving a stale future timestamp in place.

### 2.6 Job prioritization: new uploads before retries

A photo stuck in `processing` has already waited however long it was being processed. Resetting its `next_attempt_at` to `NULL` makes it immediately eligible rather than leaving a stale future timestamp in place.

### 2.6 Job prioritization: new uploads before retries

**Before:**

```python
.order_by(Photo.created_at.asc())
```

**After:**

```python
.order_by(Photo.next_attempt_at.asc().nullsfirst(), Photo.created_at.asc())
```

The previous ordering processed jobs strictly by upload time. This is correct in the common case but has a subtle problem during a failure burst: if a batch of photos repeatedly fails and keeps getting re-queued as `pending`, they occupy the front of the `created_at` queue because they were uploaded earlier. New guest photos uploaded after the failure burst would wait behind the retrying photos.

The new two-level sort fixes this:

| Sort key | Value for new job | Value for retried job | Effect |
|---|---|---|---|
| `next_attempt_at NULLS FIRST` | `NULL` | timestamp in the past | New jobs (NULL) sort before retried jobs |
| `created_at ASC` | upload time | upload time | FIFO tiebreaker within each tier |

A new upload with `next_attempt_at = NULL` will always be claimed before a retried photo with `next_attempt_at = <some past time>`, regardless of upload order. Within the new-jobs tier (all NULLs), FIFO is preserved. Within the retried-jobs tier, the photo whose back-off expired earliest is processed first.

This is observable only when the queue contains a mix of new and retried photos simultaneously. Under normal operation (all jobs succeed on the first attempt) the ordering is identical to `created_at ASC`.

### 2.7 Inter-batch sleep (S3 and CPU rate control)

**Before:** After processing a batch the loop immediately opens a new DB session and fetches the next batch.

**After:**

```python
if INTER_BATCH_SLEEP > 0:
    time.sleep(INTER_BATCH_SLEEP)
```

Added at the end of each productive batch iteration (only when `photos` was non-empty). When the queue is empty the loop already sleeps `POLL_INTERVAL` seconds, so this sleep is not added in that branch.

**Why this matters:**

Each batch makes up to 4 S3 requests per photo (1 download + 1 preview upload + 1 thumbnail upload + signed URL generation) and runs CPU-heavy Pillow operations. With `BATCH_SIZE = 2` and no inter-batch sleep, back-to-back batches could sustain 4–8 concurrent S3 operations over a short window. For a VPS with a single public IP, this can approach S3's per-IP request-rate soft limits and saturate the NIC.

A 1-second pause between batches:
- Limits sustained S3 throughput to ~4 requests/s on average (2 photos × 2 uploads / 1 s)
- Gives the CPU a moment between Pillow resize sessions, flattening the CPU time-series
- Has no perceptible effect on user experience — photos are expected to appear in the gallery within seconds, not milliseconds

Setting `INTER_BATCH_SLEEP = 0` disables the throttle entirely, which is appropriate for a large server or when draining a backlog quickly (e.g. after a worker outage).

### 2.8 Extracted `_handle_photo()` helper

The per-photo processing logic (claim → process → update) is extracted into `_handle_photo(db, photo)`. This keeps the main loop clean and avoids deeply nested code when iterating over a batch.

```python
def _handle_photo(db, photo: Photo) -> None:
    """Claim, process, and persist the outcome for a single photo."""
    ...
```

The function modifies `photo` in place using the session passed from the main loop. Any unhandled exception inside `_handle_photo` propagates to the main loop's outer `except Exception` handler, which rolls back and continues the loop.

---

## Part 3 – New Admin Router

File: `backend/routers/admin.py` *(new)*  
Registered in `backend/main.py` at prefix `/api/admin`.

All endpoints require an admin-tier token (`require_gallery_access("admin")`). A guest token returns HTTP 403. The check uses the same factory-based permission system introduced in Phase 11.

### 3.1 `GET /api/admin/processing-stats`

Returns a snapshot of the processing queue state.

**Response:**

```json
{
  "pending": 3,
  "processing": 1,
  "failed": 0,
  "done": 142,
  "oldestPendingSeconds": 7
}
```

| Field | Type | Description |
|---|---|---|
| `pending` | int | Photos waiting to be processed (including those in back-off) |
| `processing` | int | Photos currently being processed by the worker |
| `failed` | int | Photos that have exhausted all retry attempts |
| `done` | int | Photos successfully processed and visible in the gallery |
| `oldestPendingSeconds` | int | Age in seconds of the oldest `pending` photo; `0` if queue is empty |

`oldestPendingSeconds` is useful for alerting: if this value grows large, the worker may be stuck or overwhelmed. It counts the oldest photo regardless of its `next_attempt_at` — a photo in back-off still contributes to the age counter.

**Implementation:**

Four `COUNT(*)` queries (one per status) plus one `ORDER BY created_at ASC LIMIT 1`. This is five lightweight queries against an indexed column; no joins or full table scans.

### 3.2 `POST /api/admin/retry-photo/{photo_id}`

Re-queues any photo for processing, resetting all retry state.

**Response (success):**

```json
{ "status": "requeued", "photoId": "<uuid>" }
```

**Response (not found — HTTP 404):**

```json
{ "detail": "Photo not found" }
```

**What it resets:**

| Field | Set to |
|---|---|
| `processing_status` | `"pending"` |
| `processing_attempts` | `0` |
| `processing_error` | `None` |
| `next_attempt_at` | `None` |

`processing_attempts` is reset to `0`, not decremented. This is intentional: the purpose of the endpoint is manual recovery, which explicitly overrides the automatic retry cap. An admin who calls this endpoint understands they are granting the photo a fresh start.

`next_attempt_at = None` makes the photo eligible immediately on the next poll cycle (within 2 seconds).

**Valid for any status.** The endpoint does not restrict which `processing_status` values it accepts. An admin can re-queue `pending`, `processing`, `done`, or `failed` photos. This is intentional: it allows re-processing already-completed photos (e.g. if a new processing variant is needed) without requiring a separate endpoint.

---

## Part 4 – `main.py` Registration

File: `backend/main.py`

**Before:**

```python
from routers.storage import router as storage_router
from routers.photos import router as photos_router
from routers.auth import router as auth_router

# Routers
app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(photos_router)
```

**After:**

```python
from routers.storage import router as storage_router
from routers.photos import router as photos_router
from routers.auth import router as auth_router
from routers.admin import router as admin_router

# Routers
app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(photos_router)
app.include_router(admin_router, prefix="/api/admin")
```

The `prefix="/api/admin"` is applied at registration rather than in the router definition. This keeps the admin router self-contained (the route paths inside it are short: `/processing-stats`, `/retry-photo/{photo_id}`) and consistent with the project convention of applying the `/api/` namespace in the registration call (as done with `auth_router` at `/api/auth`, etc.).

---

## Effect on Existing Behaviour

| Scenario | Before (Phase 13) | After (Phase 13.1) |
|---|---|---|
| Photo fails processing | Re-queued immediately | Re-queued with 30 s / 60 s back-off |
| Photos fail repeatedly in a burst | Worker retries every 2 s (POLL_INTERVAL) | Worker skips back-off photos; retries only when window expires |
| New upload queued behind retried photos | Yes, if retried photos were created earlier | No — `next_attempt_at NULLS FIRST` always promotes new jobs |
| Sustained S3 request rate during a queue drain | Unbounded — batches fire back-to-back | ~4 requests/s average due to 1 s inter-batch sleep |
| Worker loop iteration | Claims 1 photo per cycle | Claims up to 2 photos per cycle |
| A `failed` photo | Stays `failed`; no recovery path | Admin can call `POST /api/admin/retry-photo/{id}` to re-queue |
| Processing queue state | Only observable via DB query | `GET /api/admin/processing-stats` returns live counts |
| Startup with stuck `processing` photos | Reset to `pending` (was eligible immediately anyway) | Reset to `pending` + `next_attempt_at = None` (explicit eligibility) |

---

## Files Changed

| File | Change |
|---|---|
| `backend/models.py` | Add `next_attempt_at` column to `Photo` |
| `backend/worker/image_worker.py` | Add `BATCH_SIZE`, `BACKOFF_BASE_SECONDS`, `BACKOFF_MAX_SECONDS`, `INTER_BATCH_SLEEP`; add `next_attempt_at` filter; change `ORDER BY` to `next_attempt_at NULLS FIRST, created_at`; add `.limit(BATCH_SIZE)` + batch loop; add inter-batch sleep; add `_backoff_seconds()` helper; extract `_handle_photo()`; set `next_attempt_at` on failure and clear on claim/success/startup recovery |
| `backend/routers/admin.py` | New file — `GET /processing-stats` and `POST /retry-photo/{photo_id}` |
| `backend/main.py` | Import and register `admin_router` at `/api/admin` |

**Database migration required** for existing production databases:

```sql
ALTER TABLE photos ADD COLUMN next_attempt_at TIMESTAMP NULL;
```

No docker-compose changes. No frontend changes. No new environment variables. No API contract changes to existing endpoints.
