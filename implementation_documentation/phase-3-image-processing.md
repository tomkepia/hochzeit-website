# Phase 3 Implementation – Image Processing (Thumbnails, Previews, HEIC Conversion)

**Date:** 21. März 2026  
**Phase:** 3 of 7  
**Status:** Complete  
**Builds on:** Phase 2 (Upload Flow)

---

## Overview

Phase 3 adds automatic, asynchronous image processing triggered immediately after each photo registration. When a guest uploads a photo, the backend:

1. Returns `{"status": "ok"}` to the client immediately (non-blocking)
2. Spawns a daemon thread that downloads the original, processes it, and stores derived variants in S3
3. Updates the `photos` DB row with `preview_url`, `thumbnail_url` and processing status

All input formats (JPEG, PNG, WebP, HEIC/HEIF) are handled. Preview and thumbnail variants are always stored as JPEG for universal browser compatibility.

---

## What Was Built

### 1. `backend/services/image_processing.py` ← NEW

The core processing module. Entirely isolated from the request lifecycle.

**HEIC support requires pillow-heif registration at import time:**
```python
import pillow_heif
pillow_heif.register_heif_opener()
```
This call is made at the top of the module, before any `Image.open()` call. Without it, HEIC/HEIF files raise `UnidentifiedImageError`.

---

#### Public entry point

```python
trigger_processing(photo_id: str) -> None
```

Called by `POST /api/photos` after a successful DB commit. Starts a daemon thread and returns immediately. The thread name is `img-process-{first 8 chars of UUID}` for log traceability.

```python
thread = Thread(
    target=_safe_process_photo,
    args=(photo_id,),
    name=f"img-process-{photo_id[:8]}",
    daemon=True,
)
thread.start()
```

**Why daemon threads:** Daemon threads do not prevent the process from exiting on shutdown. For a wedding app (short-lived uploads, small team), this is appropriate. Processing that is interrupted on shutdown simply leaves `processing_status = "processing"`, which a future restart or re-trigger can recover.

---

#### Processing pipeline (`_process_photo`)

| Step | Action |
|---|---|
| 1 | Fetch photo row from DB by UUID |
| 2 | Idempotency check: skip if `preview_url` + `thumbnail_url` already set, or status = `"processing"` |
| 3 | Set `processing_status = "processing"` |
| 4 | Resolve storage key via `_resolve_key()` |
| 5 | Download original with retry (`_download_with_retry()`) |
| 6 | Open image with Pillow (`Image.open()`) — HEIC handled transparently |
| 7 | Fix EXIF rotation (`ImageOps.exif_transpose()`) |
| 8 | Generate preview: `img.thumbnail((1200, 1200))`, JPEG quality 80 |
| 9 | Generate thumbnail: `img.thumbnail((300, 300))`, JPEG quality 70 |
| 10 | Convert to RGB (required for JPEG encoding of HEIC/PNG/WebP with alpha) |
| 11 | Upload both variants to S3 via `storage.upload_buffer()` |
| 12 | Update DB: `preview_url`, `thumbnail_url`, `processing_status = "done"` |

If any step fails, `processing_error` is written to the DB and `processing_status = "failed"`. The system does not crash.

---

#### Key resolution (`_resolve_key`)

Prefers `photo.original_key` (canonical, stored since Phase 2).  
Falls back to extracting the path from `photo.original_url` for legacy rows created before `original_key` existed.

```python
# Fallback: original_url = {endpoint}/{bucket}/{key}
parts = photo.original_url.split("/", 3)  # ["https:", "", "host", "bucket/path"]
return parts[3]  # "bucket/path" → actually "wedding/category/original/{uuid}.ext"
```

---

#### Download with retry (`_download_with_retry`)

- Generates a fresh pre-signed URL on each attempt (avoids stale URL issues after retries)
- `MAX_RETRIES = 2` → up to 3 total attempts
- `RETRY_DELAY_SECONDS = 3` between attempts
- `DOWNLOAD_TIMEOUT_SECONDS = 60`

---

#### Variant generation (`_generate_and_upload_variant`)

```python
copy = img.copy()
copy.thumbnail((max_px, max_px), Image.LANCZOS)   # maintains aspect ratio
if copy.mode != "RGB":
    copy = copy.convert("RGB")                      # flatten alpha for JPEG
buf = BytesIO()
copy.save(buf, format="JPEG", quality=quality, optimize=True)
storage.upload_buffer(key, buf.read(), "image/jpeg")
```

`Image.LANCZOS` is used for high-quality downsampling. `optimize=True` enables JPEG Huffman table optimization for smaller file sizes.

---

### 2. `backend/models.py` ← MODIFIED

Two new columns added to the `Photo` model:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `processing_status` | `String` | `"pending"` | Tracks lifecycle: `pending → processing → done / failed` |
| `processing_error` | `Text` | `NULL` | Error message written on failure; `NULL` on success |

```python
processing_status = Column(String, default="pending")
processing_error = Column(Text)
```

**Migration note:** For existing databases, apply manually:
```sql
ALTER TABLE photos ADD COLUMN processing_status TEXT DEFAULT 'pending';
ALTER TABLE photos ADD COLUMN processing_error TEXT;
```

---

### 3. `backend/routers/photos.py` ← MODIFIED

**Import added:**
```python
from services.image_processing import trigger_processing
```

**Registration now sets initial status:**
```python
photo = Photo(
    ...
    processing_status="pending",
)
```

**Processing triggered after commit:**
```python
trigger_processing(request.photoId)
```

`BackgroundTasks` removed — daemon threads are used directly, which do not require FastAPI to manage their lifecycle.

---

### 4. `backend/requirements.txt` ← MODIFIED

Added:
```
Pillow
pillow-heif
requests
```

---

## File Structure After Phase 3

```
backend/
  services/
    image_processing.py   ← NEW: full processing pipeline
    storage.py            (unchanged)
  models.py               ← MODIFIED: processing_status, processing_error columns
  routers/
    photos.py             ← MODIFIED: trigger_processing wired in
  requirements.txt        ← MODIFIED: Pillow, pillow-heif, requests added
```

---

## Processing Flow — Full Sequence

```
POST /api/photos (guest uploads)
       │
       ▼
DB insert: processing_status = "pending"
       │
       ├─→ HTTP 200 { status: "ok" }   ← client receives this immediately
       │
       ▼
trigger_processing(photo_id)           ← daemon thread started
       │
       ▼
_process_photo(photo_id)
  │
  ├─ Idempotency check (skip if done)
  ├─ Set status = "processing"
  ├─ Resolve original_key
  ├─ Download original (with retry)
  ├─ Image.open() + exif_transpose()
  ├─ Generate preview (1200px, q=80)
  ├─ Generate thumbnail (300px, q=70)
  ├─ Upload both to S3
  └─ Update DB: preview_url, thumbnail_url, status = "done"
```

---

## HEIC Handling

HEIC/HEIF images require no special code path:

- `pillow_heif.register_heif_opener()` registers a Pillow plugin at import time
- `Image.open(BytesIO(data))` works identically for HEIC, JPEG, PNG, WebP
- Output is always JPEG (`.jpg`)
- The original HEIC file remains untouched in S3

**Storage keys for a HEIC upload:**
```
wedding/guest/original/{uuid}.heic   ← original (preserved)
wedding/guest/preview/{uuid}.jpg     ← generated by Phase 3
wedding/guest/thumb/{uuid}.jpg       ← generated by Phase 3
```

---

## Processing Status Lifecycle

| Status | Meaning |
|---|---|
| `pending` | Registered, processing not started yet |
| `processing` | Thread is actively processing |
| `done` | `preview_url` and `thumbnail_url` are set |
| `failed` | Processing errored; `processing_error` contains the reason |

**Idempotency:** If `preview_url` and `thumbnail_url` are already non-null, or `processing_status == "processing"`, the function returns early without re-processing.

**Retry mechanism:** Failed photos can be re-triggered by resetting `processing_status = "pending"` in the DB and calling `trigger_processing(photo_id)` again. Phase 4/5 can expose an admin endpoint for this if needed.

---

## Error Handling

| Failure scenario | Behavior |
|---|---|
| Photo not found in DB | Log error, return silently |
| S3 download fails (all retries) | `processing_status = "failed"`, `processing_error` set |
| Pillow cannot open file | `processing_status = "failed"`, `processing_error` set |
| HEIC decoding error | Same as above — Pillow error surfaced cleanly |
| Variant upload to S3 fails | `processing_status = "failed"`, no DB update |
| Any unhandled exception | `_safe_process_photo` catches it, marks failed, logs stack trace |
| DB update fails | Logged; original data unchanged (preview_url/thumbnail_url remain NULL) |

In all failure cases: the server keeps running, other requests are unaffected, and the photo remains with `preview_url = NULL` / `thumbnail_url = NULL` (gallery will handle this gracefully in Phase 4).

---

## Post-Implementation Fixes

Three gaps were identified and resolved after initial Phase 3 implementation:

### Fix 1 – Add `preview_key` and `thumbnail_key` to DB

**Problem:** `preview_url` and `thumbnail_url` stored non-expiring path references (not access URLs). Phase 4 needed to derive keys from those strings to generate signed URLs — brittle string parsing.

**Fix:** Added two new columns to the `Photo` model:

| Column | Purpose |
|---|---|
| `preview_key` | Canonical S3 key for preview variant |
| `thumbnail_key` | Canonical S3 key for thumbnail variant |

`image_processing.py` now stores both key and url on every successful processing run.

**Migration note:** For existing databases:
```sql
ALTER TABLE photos ADD COLUMN preview_key TEXT;
ALTER TABLE photos ADD COLUMN thumbnail_key TEXT;
```

**Idempotency check updated** to use keys instead of URLs:
```python
# Before
if photo.preview_url and photo.thumbnail_url:

# After
if photo.preview_key and photo.thumbnail_key:
```

---

### Fix 2 – Backend returns signed URLs directly (Signed URL Strategy)

**Problem:** The Phase 3 handoff notes suggested the gallery API should call `generate_download_url(key)` per image. But leaving this to Phase 4's design risked Option B (frontend calling `/api/storage/download-url?key=...` per image), which would produce N extra requests per page load.

**Fix:** `GET /api/photos` returns signed URLs directly in the response — Option A.

For each returned photo:
```json
{
  "thumbnailUrl": "https://...signed...",
  "previewUrl":   "https://...signed...",
  "originalUrl":  "https://...signed..."
}
```

Frontend uses URLs directly with no additional requests.

**Signed URL expiry:** 1 hour (matches `DOWNLOAD_URL_EXPIRY` in the storage service).

**Error resilience:** If signing fails for an individual photo (e.g. transient S3 error), that photo is skipped and the rest of the response is returned normally.

---

### Fix 3 – Processing status filtering in backend

**Problem:** Phase 4's gallery would need to decide which photos to show based on `processing_status`. Pushing this logic to the frontend risks showing broken/unprocessed images.

**Fix:** `GET /api/photos` filters server-side:
```sql
WHERE processing_status = 'done'
```

| Status | Gallery behavior |
|---|---|
| `pending` | hidden (filtered out) |
| `processing` | hidden (filtered out) |
| `done` | shown |
| `failed` | hidden (filtered out) |

Frontend receives only ready-to-display photos. No status logic needed in the gallery component.

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Daemon threads over FastAPI BackgroundTasks | BackgroundTasks runs in the same thread pool as requests; daemon threads are fully independent and don't consume uvicorn workers |
| Fresh pre-signed URL per download attempt | Pre-signed URLs have a TTL; generating a new one per retry avoids 403 errors after delay |
| `_safe_process_photo` wrapper | Guarantees no exception escapes the thread, even if `_process_photo` has an unhandled bug |
| `Image.LANCZOS` for downsampling | Highest quality downsampling filter in Pillow; appropriate since this only runs once per image |
| `optimize=True` in JPEG save | Reduces file size ~5–15% with no quality trade-off |
| RGB conversion before JPEG encode | JPEG does not support transparency; converting HEIC/PNG/WebP to RGB prevents `OSError: cannot write mode RGBA as JPEG` |
| `img.thumbnail()` not `img.resize()` | `thumbnail()` preserves aspect ratio and only shrinks (never enlarges); `resize()` would require manual aspect ratio math |
| Idempotency on `preview_key + thumbnail_key` | Safe to call `trigger_processing` multiple times without duplicating work |
| `processing_status` + `processing_error` in DB | Enables observability and future admin tooling without a separate queue/monitoring system |
| `preview_key` + `thumbnail_key` stored in DB | Phase 4 calls `generate_download_url(key)` directly — no URL parsing or string reconstruction |
| Signed URLs generated server-side in `GET /api/photos` | One batch request returns all signed URLs; frontend uses them directly (Option A) |
| `processing_status = 'done'` filter in backend | Gallery never receives unprocessed or broken photos; no status logic needed in React |

---

## Testing Checklist

```
[ ] Upload JPEG → preview + thumbnail created in S3, DB updated
[ ] Upload PNG with alpha channel → converts to RGB correctly, no JPEG error
[ ] Upload WebP → processed correctly
[ ] Upload HEIC → converted to JPEG preview + thumbnail, original preserved
[ ] Portrait photo with EXIF rotation → displayed upright (exif_transpose applied)
[ ] Preview max dimension ≤ 1200px, aspect ratio preserved
[ ] Thumbnail max dimension ≤ 300px, aspect ratio preserved
[ ] DB processing_status = "done" after successful processing
[ ] Upload non-image file → processing_status = "failed", error message in DB, server continues running
[ ] S3 download fails → retries 3x, then marks failed, no crash
[ ] Upload same photoId twice → second registration returns 409, processing not re-triggered
[ ] Re-trigger processing on failed photo (reset status to pending) → processes cleanly
[ ] Server handles 10 concurrent uploads → threads process independently without interference
```

---

## Phase 4 Handoff Notes

Phase 4 (Gallery) builds directly on Phase 3's foundation:

**Backend `GET /api/photos` is already implemented** (in `routers/photos.py`) and provides:
- Filtering by `category` (`guest` | `photographer`)
- Pagination via `limit` + `offset`
- Only `processing_status = 'done'` photos returned
- Signed `thumbnailUrl`, `previewUrl`, `originalUrl` ready to use in `<img src>`

**Frontend gallery usage:**
```js
// No signed-URL fetching needed — URLs are in the response
const { photos } = await fetch('/api/photos?category=guest').then(r => r.json());
// photos[i].thumbnailUrl  → use in grid <img>
// photos[i].previewUrl    → use in lightbox
// photos[i].originalUrl   → use for download link
```

**Pagination:** Use `offset` + `limit` for infinite scroll. The response includes `total` (count of returned items in the current page) and `offset`.

**Signed URL freshness:** Signed URLs expire in 1 hour. The gallery should re-fetch or refresh if a user keeps the page open longer than that.
