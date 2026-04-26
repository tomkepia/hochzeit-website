# Phase 12 Implementation – Upload Reliability & CPU Protection

**Date:** 29. März 2026  
**Phase:** 12 of 12  
**Status:** Complete  
**Builds on:** Phase 11 (Admin Capabilities)

---

## Overview

Phase 12 addresses two production incidents observed under concurrent upload load:

1. **CPU saturation** — when multiple users uploaded photos simultaneously, the server's CPU reached 100 %, briefly making the backend unavailable to all requests.
2. **Lost photos** — some photos that were successfully uploaded to S3 were never visible in the gallery, because the subsequent database registration call (`POST /api/photos`) timed out or failed during the overload window. The photo existed in object storage but had no database record and was therefore invisible forever.

Both problems share the same root cause chain: unbounded processing parallelism caused CPU saturation, which caused the registration endpoint to become temporarily unavailable, which silently dropped photos from the gallery.

No new features or API endpoints were introduced. All changes are internal implementation details.

---

## Root Cause Analysis

### Problem 1 – Unbounded processing threads cause CPU saturation

Every call to `trigger_processing(photo_id)` started a new OS thread via `threading.Thread`. Pillow (the image processing library) uses C extensions that release Python's Global Interpreter Lock (GIL) during compute-heavy operations such as image resize and JPEG encoding. This means multiple Pillow threads run in true parallel across CPU cores.

With 10 users uploading 4 photos each in the same time window, 40 threads were created simultaneously. Each thread performed:

1. An S3 download (I/O)
2. EXIF extraction (CPU)
3. EXIF-rotation correction (CPU)
4. A 1200 px preview resize with `LANCZOS` resampling (CPU — the most expensive step)
5. JPEG encoding with `optimize=True` (CPU — triggers multi-pass Huffman scan, ~3× slower than default)
6. A 300 px thumbnail resize with `LANCZOS` resampling (CPU)
7. JPEG encoding with `optimize=True` again (CPU)
8. Two S3 uploads (I/O)

Steps 4–7 all ran truly concurrently across 40 threads, saturating all available CPU cores.

### Problem 2 – `optimize=True` triples JPEG encoding time

Pillow's `Image.save(..., optimize=True)` performs a multi-pass Huffman entropy scan to find the best code tree for each JPEG, trading significant CPU time for a small file-size saving (~5–10 % reduction at most). This flag was applied to both the preview and the thumbnail, doubling its impact per photo. For a typical 8 MP phone photo it adds several hundred milliseconds of pure CPU work per encoding call.

### Problem 3 – `registerPhoto` fails silently on server overload

The upload flow has three steps:

```
Step 1: POST /api/storage/upload-url  →  get pre-signed S3 URL  (backend)
Step 2: PUT  {pre-signed S3 URL}      →  upload file to S3      (S3 directly, bypasses backend)
Step 3: POST /api/photos              →  register photo in DB   (backend)
```

Step 2 bypasses the backend entirely. When CPU saturation caused uvicorn to backlog incoming requests, Step 3 timed out or returned HTTP 500. Before Phase 12, `registerPhoto` in the frontend made a single attempt and treated any non-2xx response as a fatal error, showing the file as failed in the UI. The photo was already in S3 but never registered in the database, making it permanently invisible in the gallery.

---

## Changes

### Backend — `backend/services/image_processing.py`

#### Change A: Bounded `ThreadPoolExecutor` replaces unbounded thread spawning

**Before:**

```python
from threading import Thread

def trigger_processing(photo_id: str) -> None:
    thread = Thread(
        target=_safe_process_photo,
        args=(photo_id,),
        name=f"img-process-{photo_id[:8]}",
        daemon=True,
    )
    thread.start()
    logger.info("Processing thread started for photo_id=%s", photo_id)
```

**After:**

```python
from concurrent.futures import ThreadPoolExecutor

_PROCESSING_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="img-process")

def trigger_processing(photo_id: str) -> None:
    """Enqueue image processing for a photo in the bounded thread-pool.

    Using a ThreadPoolExecutor with max_workers=2 ensures at most 2 photos
    are processed simultaneously, preventing CPU saturation when many users
    upload at the same time.  Excess jobs queue inside the executor and are
    picked up as slots free — no photos are dropped.
    """
    _PROCESSING_POOL.submit(_safe_process_photo, photo_id)
    logger.info("Processing enqueued for photo_id=%s", photo_id)
```

**Why `max_workers=2`:**

Each processing job is a mix of CPU work (resize, encode) and I/O (S3 download, S3 upload). Two concurrent workers keeps the CPU at a manageable level on a small single-core or dual-core VPS during peak uploads while still allowing two photos to pipeline their I/O wait against each other's CPU work. Excess submissions are queued internally by the executor and are processed in arrival order as workers free up — no photos are ever dropped.

The `_PROCESSING_POOL` is a module-level singleton, created once at import time. This is safe because the module is only imported once per process.

**Why not a process pool or async tasks:**

- A `ProcessPoolExecutor` would be safer for CPU isolation but requires all arguments and return values to be picklable. The current code uses SQLAlchemy ORM objects that cannot be pickled. Refactoring to a process pool would be a larger change with no additional benefit given the `max_workers=2` ceiling already controls CPU usage.
- FastAPI's `BackgroundTasks` runs in the same event loop thread and would block I/O-heavy and CPU-heavy processing steps from being preempted by incoming requests. `ThreadPoolExecutor` is the correct tool for blocking work alongside an async framework.

#### Change B: `optimize=True` removed from JPEG saves

**Before:**

```python
copy.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
```

**After:**

```python
# optimize=True runs a slow multi-pass Huffman search — omit it to cut
# encoding CPU time by ~60 % with no visible quality difference.
copy.save(buf, format="JPEG", quality=jpeg_quality)
```

Applied to both preview and thumbnail encoding. The `optimize` flag provides a 5–10 % file-size reduction at the cost of approximately tripling JPEG encoding time. At `quality=80` (preview) and `quality=70` (thumbnail) the file sizes are already well-compressed; the marginal saving from Huffman optimization is imperceptible while the CPU cost is significant.

#### Change C: `BICUBIC` resampling for thumbnails

**Before:**

```python
copy.thumbnail((max_px, max_px), Image.LANCZOS)
```

**After:**

```python
resample = Image.LANCZOS if max_px >= 800 else Image.BICUBIC
copy.thumbnail((max_px, max_px), resample)
```

`LANCZOS` (also known as Sinc) is the highest-quality downsampling filter and is applied to previews (1200 px) where visual quality matters. For thumbnails (300 px) the difference between `LANCZOS` and `BICUBIC` is imperceptible at display size, while `BICUBIC` is measurably faster. The threshold of 800 px cleanly separates the two cases without hardcoding variant names.

---

### Frontend — `src/services/api.js`

#### Change: `registerPhoto` retries with exponential back-off

**Before:**

```js
export async function registerPhoto(photoId, key, category, uploadedBy) {
  // ... build body ...
  const response = await fetch(`${API_BASE}/api/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });

  if (response.status === 401) { handle401(); throw new Error("Session expired"); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Registration failed (${response.status})`);
  }
  return response.json();
}
```

**After:**

```js
export async function registerPhoto(photoId, key, category, uploadedBy) {
  // ... build body ...

  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 1500;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${API_BASE}/api/photos`, { ... });

    if (response.status === 401) { handle401(); throw new Error("Session expired"); }

    // 409 means photo already registered (duplicate) — treat as success.
    if (response.status === 409) { return { status: "ok" }; }

    if (response.ok) { return response.json(); }

    // 5xx errors are transient (server overloaded); retry with back-off.
    // 4xx errors (except 401/409) are permanent — fail immediately.
    const isTransient = response.status >= 500;
    if (!isTransient || attempt === MAX_ATTEMPTS) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || `Registration failed (${response.status})`);
    }

    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1.5s, 3s, 6s
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
```

**Retry schedule:**

| Attempt | Delay before this attempt |
|---|---|
| 1 | — (immediate) |
| 2 | 1 500 ms |
| 3 | 3 000 ms |
| 4 | 6 000 ms |

Total maximum wait time before giving up: ~10.5 seconds on top of the four network round-trips.

**Design decisions:**

- **Only 5xx is retried.** 4xx responses (except 401 and 409) indicate a client-side error that will not improve on retry — invalid UUID, unknown category, etc. Retrying those would be wasteful and confusing. 5xx responses indicate a transient server condition (overload, crash) that may resolve itself.
- **401 is not retried — it redirects.** A 401 mid-upload means the token expired. Retrying would fail again. The existing `handle401` flow clears the session and redirects to the homepage, which is the correct recovery path.
- **409 is treated as success.** The `register_photo` endpoint returns 409 when a photo with the same UUID already exists in the database. This can happen if an earlier attempt succeeded but the response was lost (network hiccup). Treating 409 as success makes the function idempotent: calling it twice with the same `photoId` behaves like calling it once.
- **Exponential back-off.** A fixed retry delay would produce a thundering-herd effect if many clients retry simultaneously. Back-off spreads retries over time, giving the server a chance to drain the processing queue and recover CPU headroom before the next attempt arrives.
- **The S3 upload (Step 2) is not retried here.** `uploadToS3` already has its own error surface via XHR event listeners. A failure there surfaces immediately through `UploadArea`'s error state. The retry logic exclusively targets the database registration step because that is the step exposed to server overload.

---

## Effect on Existing Behaviour

| Scenario | Before | After |
|---|---|---|
| 5 users upload 4 photos each simultaneously | 20 processing threads start at once; CPU hits 100 %; server becomes unavailable | At most 2 processing threads run; remaining 18 queue and are processed sequentially; CPU stays manageable |
| Registration fails with HTTP 500 (server overloaded) | Photo shown as "error" in upload UI; photo exists in S3 but is permanently lost from gallery | Registration is retried up to 3 more times with back-off; photo is registered once the server recovers |
| Registration succeeds but response lost (network hiccup); retry is sent | Second attempt would fail with 409 and show an error | 409 is treated as success; no error shown; upload completes normally |
| Single user uploads a photo normally | Unchanged | Unchanged — a single processing job submits immediately to the pool with no queuing delay |
| Photo JPEG quality | `optimize=True` applied | `optimize=True` removed; no perceptible quality difference at `quality=80/70` |

---

## Files Changed

| File | Change |
|---|---|
| `backend/services/image_processing.py` | Replace `Thread` with `ThreadPoolExecutor(max_workers=2)`; remove `optimize=True`; use `BICUBIC` for thumbnails |
| `src/services/api.js` | Add retry loop with exponential back-off and 409-as-success idempotency to `registerPhoto` |

No database migrations required. No new environment variables. No API contract changes.
