# Phase 2 Implementation – Upload Flow (Frontend + Backend Registration)

**Date:** 20. März 2026  
**Phase:** 2 of 7  
**Status:** Complete  
**Builds on:** Phase 1 (Object Storage + Backend Setup)

---

## Overview

Phase 2 delivers the complete end-to-end upload flow: a guest selects images on their phone or desktop, the frontend requests a pre-signed URL, uploads directly to S3, and then registers the photo in the backend database. No image processing happens yet (deferred to Phase 3).

The implementation is split across backend (new `POST /api/photos` endpoint and updates to the storage endpoint) and frontend (new `UploadPage`, `UploadArea` component, and `api.js` service).

---

## What Was Built

### Backend

#### 1. Extension support in `POST /api/storage/upload-url`

**File:** [backend/routers/storage.py](../backend/routers/storage.py)

**Changes:**
- Added `CONTENT_TYPE_EXTENSIONS` mapping: MIME type → canonical file extension
- Extension is derived from the `contentType` field (not from the filename, which is untrusted)
- Storage key for originals now uses the real extension: `wedding/{category}/original/{uuid}.{ext}`
- `extension` is included in the response

**Updated response:**
```json
{
  "uploadUrl": "https://...",
  "photoId": "{uuid}",
  "key": "wedding/guest/original/{uuid}.jpg",
  "extension": "jpg",
  "storageRef": "https://{endpoint}/{bucket}/wedding/guest/original/{uuid}.jpg"
}
```

**MIME → extension mapping:**

| Content-Type | Extension |
|---|---|
| `image/jpeg` | `jpg` |
| `image/png` | `png` |
| `image/webp` | `webp` |
| `image/heic` | `heic` |
| `image/heif` | `heif` |

---

#### 2. `generate_photo_key` updated to accept extension

**File:** [backend/services/storage.py](../backend/services/storage.py)

The function signature changed from:

```python
generate_photo_key(category, variant, photo_uuid)  # always .jpg
```

to:

```python
generate_photo_key(category, variant, photo_uuid, extension="jpg")
```

Default remains `"jpg"`, so preview/thumbnail calls in Phase 3 need no changes. Original uploads pass the real extension.

---

#### 3. `POST /api/photos` — Photo Registration Endpoint

**File:** [backend/routers/photos.py](../backend/routers/photos.py) ← NEW

Registers a photo that has already been uploaded directly to S3.

**Request body:**
```json
{
  "photoId": "uuid",
  "key": "wedding/guest/original/{uuid}.jpg",
  "category": "guest",
  "uploadedBy": "Maria & Jonas"
}
```

**Behavior:**
- Validates `photoId` as a proper UUID
- Validates `key` against path-traversal patterns (`..`, leading `/`)
- Validates `category` as `guest` or `photographer`
- Derives `original_url` server-side from `key` via `storage.get_file_url()` — client does not control the stored URL
- Stores `original_key = key` in the DB (see post-implementation fix below)
- Inserts into the `photos` table with `preview_url = NULL`, `thumbnail_url = NULL`
- After commit: triggers `_trigger_photo_processing(photoId)` as a FastAPI background task

Registered the new photos router:

```python
from routers.photos import router as photos_router
app.include_router(photos_router)
```

---

### Frontend

#### 5. `src/services/api.js` — API Service Module

**File:** [src/services/api.js](../src/services/api.js) ← NEW

All API communication is isolated here. Components import from this module and never call `fetch` directly.

**Exported functions:**

| Function | Purpose |
|---|---|
| `validateFile(file)` | Client-side validation before upload (type + size). Returns error string or `null`. |
| `requestUploadUrl(filename, contentType, category)` | Calls `POST /api/storage/upload-url`, returns full response object |
| `uploadToS3(uploadUrl, file, contentType, onProgress)` | Uploads raw file via `XMLHttpRequest` PUT for progress tracking. Calls `onProgress(percent)` during upload. |
| `registerPhoto(photoId, key, category, uploadedBy)` | Calls `POST /api/photos` to register the upload in the DB |

**Why `XMLHttpRequest` instead of `fetch`:**  
`fetch` does not expose upload progress events. `XHR.upload.addEventListener("progress")` is the only reliable way to track per-file upload progress in browsers, which is essential for UX.

**Concurrency:** Uploads are managed in the component; `api.js` functions are independent and stateless.

**Allowed file types (client-side validation):**
- `image/jpeg`
- `image/png`
- `image/webp`
- `image/heic`
- `image/heif`

**Max file size:** 15 MB

---

#### 6. `src/components/UploadArea.js` — Upload Component

**File:** [src/components/UploadArea.js](../src/components/UploadArea.js) ← NEW

Handles file selection, drag & drop, per-file state, concurrency, and the upload button.

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `category` | string | `"guest"` | Passed to `POST /api/storage/upload-url` |
| `uploaderName` | string | `""` | Optional name saved with registrations |

**Per-file state model:**
```js
{
  id: string,           // stable key derived from name+size+lastModified
  file: File,
  status: "pending" | "uploading" | "success" | "error",
  progress: number,     // 0–100
  error: string | null
}
```

**Upload flow per file:**
1. `requestUploadUrl(filename, contentType, category)` → get `uploadUrl`, `photoId`, `key`
2. `uploadToS3(uploadUrl, file, contentType, onProgress)` → PUT to S3 with live progress
3. `registerPhoto(photoId, key, category, uploaderName)` → only called after successful S3 upload

**Concurrency:** Files are batched into groups of `MAX_CONCURRENT = 4` and processed with `Promise.all` per batch. One failed file does not block others.

**UI features:**
- Drag & drop zone with visual feedback on hover
- File picker via hidden `<input type="file">` (mobile-friendly, accepts all allowed formats)
- Per-file row showing: filename, size, progress bar, success/error state
- "Retry" button per failed file
- "Remove" button for pending/failed files
- Upload button shows pending count and disables during active uploads
- Success message once all files complete

---

#### 7. `src/pages/UploadPage.js` — Upload Page

**File:** [src/pages/UploadPage.js](../src/pages/UploadPage.js) ← NEW

The page rendered at `/upload`. Wraps `UploadArea` and adds:
- "Your name" input field (optional, persisted to `localStorage` under key `uploaderName`)
- Page title and subtitle
- Back link to `/`

**`localStorage` persistence:** The uploader name is restored on subsequent visits so guests don't have to re-enter it.

---

#### 8. `src/App.js` — Route added

**File:** [src/App.js](../src/App.js)

Added `/upload` route:

```jsx
<Route path="/upload" element={<UploadPage />} />
```

`react-router-dom` was already installed and configured in Phase 1's codebase. No additional setup was needed.

---

## File Structure After Phase 2

```
backend/
  routers/
    storage.py      ← MODIFIED: extension in response, real ext used in key
    photos.py       ← NEW: POST /api/photos
  services/
    storage.py      ← MODIFIED: generate_photo_key() accepts extension param
  main.py           ← MODIFIED: registers photos_router

src/
  App.js            ← MODIFIED: /upload route added
  services/
    api.js          ← NEW: validateFile, requestUploadUrl, uploadToS3, registerPhoto
  components/
    UploadArea.js   ← NEW: drop zone, file list, per-file progress
  pages/
    UploadPage.js   ← NEW: /upload page with name field
```

---

## Upload Flow — End-to-End Sequence

```
User selects files
       │
       ▼
validateFile(file)           ← client-side only (type + size)
       │ valid
       ▼
POST /api/storage/upload-url ← backend issues pre-signed PUT URL
{ uploadUrl, photoId, key, extension, storageRef }
       │
       ▼
PUT {uploadUrl}              ← browser uploads directly to S3
(XHR with progress events)
       │ HTTP 200
       ▼
POST /api/photos             ← backend registers in DB
{ photoId, key, category, uploadedBy }
       │
       ▼
{ status: "ok" }
```

---

## HEIC Handling

HEIC/HEIF files are fully supported for upload:
- Client-side validation accepts `image/heic` and `image/heif`
- Backend allows both content types
- Extension is preserved in the storage key (`.../{uuid}.heic`)
- Original file is stored unchanged — browser display is NOT attempted yet
- Thumbnails/previews (JPEG) will be generated in Phase 3 for browser compatibility

---

## Error Handling

### Backend

| Scenario | HTTP status |
|---|---|
| Invalid content type | 400 |
| Invalid category | 400 |
| Invalid photoId (not UUID) | 422 (Pydantic validation) |
| Invalid key (path traversal) | 422 (Pydantic validation) |
| Duplicate photoId | 409 |
| S3 misconfigured | 503 |
| S3 unreachable | 502 |
| DB error | 500 |

### Frontend

- File validation errors shown immediately before upload starts (status `"error"`, no network call made)
- S3 upload failures shown per file with "Retry" button
- Registration failures shown per file with "Retry" button
- Failed files do not block other files in the same batch
- Retry re-runs the full 3-step flow for that file (gets a new `photoId` and key)

---

## Post-Implementation Fixes

Four gaps were identified and resolved after initial implementation:

### Fix 1 – Store `original_key` in the database (Issue: key/URL ambiguity)

**Problem:** Phase 3 needs to download the original file via `generate_download_url(key)`. Without storing the key, Phase 3 would have to reconstruct or parse it from `original_url` — brittle and error-prone.

**Fix:** Added `original_key TEXT` column to the `photos` table. Both fields are now stored:

| Field | Purpose |
|---|---|
| `original_key` | Canonical S3 key — used by Phase 3 to generate signed URLs |
| `original_url` | Non-expiring path reference — convenience copy, not an access URL |

**Phase 3 usage becomes:**
```python
download_url = storage.generate_download_url(photo.original_key)  # clean
# instead of reconstructing the key from the URL string
```

**Migration note:** `original_key` is added as nullable to avoid breaking existing dev databases. All new registrations always populate it. If running a live database, apply manually:
```sql
ALTER TABLE photos ADD COLUMN original_key TEXT;
```

---

### Fix 2 – Background processing trigger (Issue: no processing hook after registration)

**Problem:** After upload + registration, nothing notified the system to process the image. Phase 3 needs a clean integration point.

**Fix:** Added `_trigger_photo_processing(photo_id)` as a FastAPI `BackgroundTask`. It is registered immediately after a successful DB commit. Phase 3 replaces the stub body with real processing logic.

```python
def _trigger_photo_processing(photo_id: str) -> None:
    """Phase 3 replaces this stub with real image processing."""
    logger.info("[Phase 3 stub] Processing triggered for photo_id=%s", photo_id)

# In register_photo():
background_tasks.add_task(_trigger_photo_processing, request.photoId)
```

**Why FastAPI `BackgroundTasks`:**
- Native to FastAPI, zero additional dependencies
- Runs after the HTTP response is sent (non-blocking for the client)
- Simple replacement path for Phase 3: just fill in the function body
- Avoids Celery/Redis complexity that would be overkill for this use case

**HTTP response:** The client receives `{"status": "ok"}` immediately; processing happens asynchronously in the background.

---

### Fix 3 – Clarify `storageRef` is not a public URL (Issue: misleading name)

**Problem:** The field name `storageRef` and its value (a full URL-shaped string) could be mistaken for a guaranteed-public download URL. The bucket may be private.

**Fix:** Enhanced the code comment at the point of construction:

```python
# storageRef is a canonical, non-expiring path reference for internal use only.
# It is NOT guaranteed to be publicly accessible — the bucket may be private.
# Always use GET /api/storage/download-url?key=... to get a real access URL.
```

The field name is retained (`storageRef` vs `fileUrl` is already an improvement from Phase 1). The frontend does not consume this field — it only uses `uploadUrl`, `photoId`, and `key`.

---

### Fix 4 – MIME type trust limitation documented

**Problem:** The backend validates `contentType` against an allowlist, and S3 enforces that the `PUT` request `Content-Type` header matches the presigned URL. However, a client could send `contentType: "image/jpeg"` with a file that is actually a PDF, executable, or other non-image data.

**Mitigations in place:**
- S3 rejects `PUT` requests whose `Content-Type` header doesn't match the presigned URL — so the *declared* type is enforced at the transport layer
- Phase 3 image processing (Pillow) will fail to open non-image files, preventing them from ever producing thumbnails/previews and making the data unusable in the gallery

**Accepted residual risk:** A malicious or buggy client could store a non-image file with an image MIME type. The file would exist in S3 and have a DB record, but would produce a processing error in Phase 3 and never appear in the gallery. This is acceptable for a closed-audience wedding app with no public registration.

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Extension from `contentType`, not `filename` | Filename is user-controlled and unreliable; MIME type is validated against allowlist |
| `original_url` derived server-side | Prevents client from registering arbitrary URLs in the DB |
| `original_key` stored in DB | Phase 3 can call `generate_download_url(photo.original_key)` without re-parsing the URL |
| `XMLHttpRequest` for S3 uploads | Only way to get upload progress events in browsers; `fetch` does not support this |
| FastAPI `BackgroundTasks` for processing trigger | Native, zero-dependency, non-blocking; Phase 3 fills in the function body |
| Concurrency cap of 4 | Avoids overwhelming mobile connections; high enough to feel fast on Wi-Fi |
| Per-file retry | Batch retrying all failed files at once is poor UX; each file retries independently |
| `uploaderName` in `localStorage` | Guests typically upload once; persisting the name avoids frustration on page reload |
| UUID validated with `uuid.UUID()` | Rejects malformed IDs early; prevents DB-level errors |
| `MAX_CONCURRENT = 4` lives in `UploadArea` | Not in `api.js` — concurrency is a UI concern, not an API concern |

---

## What Is NOT in Phase 2

The following are explicitly deferred:

- Image processing (thumbnails, previews, EXIF, HEIC conversion) → **Phase 3**
- Gallery browsing UI → **Phase 4**
- React Router `/gallery` and `/photos` pages → **Phase 4/5**
- Download features → **Phase 6**
- Authentication / QR login → **Phase 4**

---

## Manual Testing Checklist

```
[ ] Upload a single JPEG → file appears in S3, row created in DB
[ ] Upload a PNG → extension .png in storage key
[ ] Upload a HEIC file → extension .heic in storage key, no conversion
[ ] Upload 5+ files simultaneously → all complete, no errors
[ ] Upload a file >15 MB → rejected immediately, no network call
[ ] Upload an unsupported type → rejected immediately
[ ] Enter uploader name → stored in localStorage, persisted on reload
[ ] Simulate S3 failure → per-file error shown, retry button visible
[ ] Click retry → new photoId generated, re-upload works
[ ] Navigate to /upload → page renders correctly on mobile
```

---

## Phase 3 Handoff Notes

Phase 3 (Image Processing) has a clean integration path:

- Replace `_trigger_photo_processing(photo_id)` body in `routers/photos.py` with real processing
- Retrieve the original from S3 using:
  ```python
  download_url = storage.generate_download_url(photo.original_key)  # no key reconstruction
  ```
- For HEIC originals (`photo.original_key.endswith(".heic")` or `.heif`): convert to JPEG using `pillow-heif` before resizing
- Generate thumbnail (~300px JPEG) and preview (~1200px JPEG) using Pillow
- Fix EXIF rotation before resizing
- Store derived variants using `storage.upload_buffer(key, buffer, "image/jpeg")`
- Key format for derived variants uses same UUID: `wedding/{category}/preview/{uuid}.jpg`, `wedding/{category}/thumb/{uuid}.jpg`
- Update `preview_url`, `thumbnail_url` (and optionally `preview_key`, `thumbnail_key`) in DB
- If processing fails (e.g. non-image data), log the error and leave `preview_url`/`thumbnail_url` as NULL; the gallery will handle missing variants gracefully
