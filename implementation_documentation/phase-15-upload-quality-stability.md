# Phase 15 Implementation – Upload Quality & Stability

**Date:** 3. April 2026  
**Phase:** 15  
**Status:** Complete  
**Builds on:** Phase 14 (UX & Admin Visibility)

---

## Overview

Phase 15 reduces upload spikes and upload payload size before data reaches S3 and the worker pipeline. The focus is stability under burst uploads, predictable UX during preprocessing, and stricter backend enforcement.

Implemented areas:

1. Frontend concurrency control (max 2 active uploads)
2. Client-side image pre-resize before upload
3. Early size/type validation in frontend
4. Backend upload-url validation for optional file size
5. Register-time hard validation against S3 metadata (size + content type)
6. Abortable uploads and queue clear control

No breaking API changes were introduced. Existing upload flow remains the same: request upload URL -> PUT to S3 -> register photo.

---

## Part 1 – Frontend Upload Queue

File: `src/components/UploadArea.js`

### 1.1 New constants

```js
const MAX_CONCURRENT_UPLOADS = 2;
const MAX_IMAGE_DIMENSION = 2000;
const MAX_INPUT_DIMENSION = 8000;
const JPEG_QUALITY = 0.8;
```

### 1.2 Queue and worker state

```js
const [activeUploads, setActiveUploads] = useState(0);
const [isQueueRunning, setIsQueueRunning] = useState(false);
```

Each file entry now uses statuses:

- `queued`
- `processing`
- `uploading`
- `done`
- `error`

### 1.3 Queue scheduler (`useEffect`)

A processing effect starts queued items when slots are available.

```js
if (!isQueueRunning) return;
if (activeUploads >= MAX_CONCURRENT_UPLOADS) return;

const queued = fileEntries.filter((e) => e.status === "queued");
const availableSlots = MAX_CONCURRENT_UPLOADS - activeUploads;
const toStart = queued.slice(0, availableSlots);
```

For each selected entry:

- increments `activeUploads`
- runs `uploadEntry(entry)`
- decrements `activeUploads` in `finally`

This guarantees queue progress even when some uploads fail.

### 1.4 User-triggered queue start

`startUploads()` only toggles queue processing:

```js
setIsQueueRunning(true)
```

All scheduling happens in the effect, not in batch `Promise.all` loops.

### 1.5 Per-file feedback

- `queued`: shows `Wartet...`
- `processing`: shows `Optimieren...`
- `uploading`: progress bar
- `done`: success badge
- `error`: error text + retry button

Retry re-queues an item instead of directly uploading it.

### 1.6 Abort and clear queue

Upload cancellation is now supported using `AbortController`.

- Every in-flight upload gets a per-file controller.
- `uploadToS3(...)` accepts an optional `signal` and aborts the active XHR when triggered.
- A new `Warteschlange leeren` action stops scheduling, aborts active uploads, and clears non-done entries.

---

## Part 2 – Client-side Pre-Resize

File: `src/components/UploadArea.js`

### 2.1 New helper

`resizeImage(file)` was added.

Behavior:

- Uses `createImageBitmap(file, { imageOrientation: "from-image" })` when supported
- Falls back to plain `createImageBitmap(file)`
- Applies a hard dimension guard: rejects images above `8000px` on either side
- If both dimensions are <= 2000, returns original file unchanged
- Otherwise rescales proportionally to max dimension 2000
- Keeps transparent PNGs as PNG (alpha preserved)
- Converts all other resized outputs to JPEG (`quality = 0.8`)
- Replaces extension cleanly (e.g. `IMG_1234.heic` -> `IMG_1234.jpg`, not `.heic.jpg`)
- Releases memory explicitly (`imageBitmap.close()` + canvas cleanup)

### 2.2 Integrated upload flow

In `uploadEntry(entry)`:

1. `processedFile = await resizeImage(entry.file)`
2. `requestUploadUrl(processedFile.name, processedFile.type, category, processedFile.size)`
3. `uploadToS3(..., processedFile, processedFile.type, ..., abortSignal)`
4. `registerPhoto(...)`

Also tracked in UI:

- `processedSize` is stored and shown as `original -> processed` MB when resized.
- HEIC/HEIF decode fallback: if resize decode fails, upload proceeds with original file instead of hard-failing.

---

## Part 3 – Frontend Validation

File: `src/services/api.js`

### 3.1 Size limit raised to 20 MB

```js
export const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1024 * 1024;
```

`validateFile(file)` now rejects files above 20 MB.

### 3.2 Type validation remains centralized

`validateFile(file)` enforces MIME type whitelist early in the client.

Supported MIME types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/heic`
- `image/heif`

`image/webp` remains allowed for backward compatibility.

### 3.3 Request payload extension

`requestUploadUrl(...)` supports optional `fileSize` and includes it when provided:

```js
const body = { filename, contentType, category, fileSize }
```

This is additive and backward-compatible.

---

## Part 4 – Backend Validation (Upload URL)

File: `backend/routers/storage.py`

### 4.1 Request model extended

```python
class UploadUrlRequest(BaseModel):
    filename: str
    contentType: str
    category: str
    fileSize: int | None = None
```

### 4.2 File-size guard

```python
MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
```

Validation in `POST /api/storage/upload-url`:

- if `fileSize < 0` -> `400 Invalid file size`
- if `fileSize > 20 MB` -> `400 File too large (max. 20 MB)`

### 4.3 Content-type validation retained

`request.contentType` remains validated against server whitelist before generating a presigned URL.

---

## Part 5 – Register-time S3 Metadata Enforcement

Files:

- `backend/services/storage.py`
- `backend/routers/photos.py`

### 5.1 Why this is needed

`/api/storage/upload-url` validation is request-time only. A presigned PUT URL can still be abused after issuance. To close that trust gap, `/api/photos` now verifies the uploaded object via S3 `head_object` before DB registration.

### 5.2 New storage helper

`storage.get_object_metadata(key)`:

```python
def get_object_metadata(key: str) -> dict:
    return client.head_object(Bucket=bucket, Key=key)
```

### 5.3 Register endpoint checks (`POST /api/photos`)

Before inserting `Photo`, backend now validates:

- object exists and is readable
- `ContentLength > 0`
- `ContentLength <= 20 MB`
- normalized `ContentType` is in allowed image MIME set

If validation fails, registration returns HTTP 400 and the photo is not inserted.

This provides hard backend enforcement even when frontend checks are bypassed.

---

## Edge-Case Behavior

- Queue continues after individual failures (no global stop)
- Queue can be cleared globally and active uploads are aborted
- Very small images are not resized
- Images over 8000px are rejected during preprocessing
- EXIF orientation is preserved where supported by browser decode path
- Transparent PNGs stay PNG during resize output
- Resize failures surface as per-file `error`
- HEIC/HEIF decode failures fall back to original-file upload
- Existing offline/network failure handling in upload steps remains unchanged

---

## Effect on Existing Behavior

| Scenario | Before | After |
|---|---|---|
| 10 selected files | Could start up to 4 at once in batches | Max 2 active uploads at any time |
| Large image upload | Original file sent to S3 | Image resized client-side first (max 2000px, PNG alpha preserved when needed, otherwise JPEG 0.8) |
| Portrait phone photos | Could rotate incorrectly after canvas rewrite | EXIF orientation respected where supported (`imageOrientation: from-image`) |
| Oversized file | Rejected at old 15 MB frontend limit | Rejected at 20 MB frontend limit + backend check when `fileSize` is provided |
| Invalid MIME type | Rejected in frontend | Rejected in frontend and backend upload-url endpoint |
| Presigned URL bypass attempt | Could still register oversized/invalid object if uploaded | Registration fails after `head_object` validation |
| Retry action | Immediate single upload call | Re-queued and processed under concurrency limit |
| User wants immediate stop | No global stop path | `Warteschlange leeren` aborts active uploads and clears queue |

---

## Files Changed

| File | Change |
|---|---|
| `src/components/UploadArea.js` | Added queue scheduler with max 2 concurrent uploads; added `resizeImage` with EXIF-aware decode, 8000px guard, PNG transparency preservation, JPEG conversion fallback, and memory cleanup; added `processing` status (`Optimieren...`); added clear-queue action with abort support; retry re-queues |
| `src/services/api.js` | Added `MAX_UPLOAD_FILE_SIZE_BYTES = 20MB`; updated `validateFile`; extended `requestUploadUrl` to include optional `fileSize`; extended `uploadToS3` with optional abort `signal` |
| `backend/routers/storage.py` | Extended `UploadUrlRequest` with optional `fileSize`; added max 20 MB server-side validation in upload-url endpoint |
| `backend/services/storage.py` | Added `get_object_metadata(key)` wrapper around `head_object` |
| `backend/routers/photos.py` | Added register-time S3 metadata validation (exists, non-empty, max 20MB, allowed content type) before DB insert |

No worker changes.  
No DB migrations.  
No docker-compose changes.  
No breaking API changes.
