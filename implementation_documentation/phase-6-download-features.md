# Phase 6 Implementation - Download Features (Multi-Select + ZIP + Download All)

**Date:** 26. Maerz 2026  
**Phase:** 6 of 7  
**Status:** Complete  
**Builds on:** Phase 5 (Routing & Entry Flow)

---

## Overview

Phase 6 adds the full download workflow for the gallery:

1. Users can enter a dedicated selection mode.
2. Users can select multiple photos and download them as one ZIP.
3. Users can download all photos in the current category, automatically batched into chunks of max 100.

The backend now creates ZIP files via streaming (chunk-by-chunk), and the frontend handles selection UX, sequential batch requests, and user feedback.

---

## What Was Built

### 1. Backend - New ZIP Endpoint (`backend/routers/photos.py`)

Added:

```http
POST /api/photos/download-zip
```

Request body:

```json
{
  "photoIds": ["uuid1", "uuid2", "..."]
}
```

#### Validation implemented

- `photoIds` must not be empty.
- `photoIds` length must be <= 100.
- Every ID must be a valid UUID.
- Duplicate IDs are normalized away while preserving order.
- All requested photos must exist and have `processing_status = "done"`.

If any IDs are missing or not ready, the endpoint returns `400` with details.

#### Core behavior

1. Load all requested photos from DB.
2. Verify all requested IDs are present in the `done` set.
3. For each photo:
   - Resolve `original_key`.
  - Derive original extension from `original_key`.
   - Generate signed download URL.
   - Stream remote file content chunk-by-chunk into ZIP entry.
4. Return ZIP as `StreamingResponse`.

Response headers:

- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="wedding-photos.zip"`

---

### 2. Backend - ZIP Streaming Strategy (`backend/routers/photos.py`)

The endpoint uses `zipstream-ng` (`import zipstream`) and `write_iter(...)` so photo bytes are never fully buffered in memory.

Core pattern:

```python
z = zipstream.ZipFile(mode="w", compression=zipstream.ZIP_DEFLATED)
z.write_iter(filename, iterator_of_chunks)
return StreamingResponse(z, media_type="application/zip")
```

Remote image streaming uses:

```python
requests.get(download_url, stream=True, timeout=30)
response.iter_content(chunk_size=65536)
```

This enforces a low-memory pipeline:

- Storage -> HTTP chunk iterator -> ZIP entry stream -> HTTP response stream

No full archive build in RAM is performed.

---

### 3. Backend - Failure Handling & Guard Rails (`backend/routers/photos.py`)

The endpoint uses a documented **best-effort mode** after initial request validation.

Validation is strict up-front (all IDs must exist and be `done`), but per-file transfer/signing failures during streaming are skipped so one transient failure does not cancel the entire archive.

#### Per-photo error handling

For each requested photo, the backend logs and skips when:

- signed URL generation fails,
- remote file download fails,
- `original_key` is missing.

If all files fail/skipped, endpoint returns `500` with:

```json
{ "detail": "Could not prepare any photos for ZIP download" }
```

#### Constraints kept explicit

- `MAX_ZIP_PHOTOS = 100`
- request-level validation via Pydantic `field_validator`

---

### 4. Backend Dependency (`backend/requirements.txt`)

Added dependency:

```text
zipstream-ng
```

This is required for streamed ZIP creation.

---

### 5. Frontend API Integration (`src/services/api.js`)

Added helper:

```js
export async function downloadZip(photoIds, filename = "wedding-photos.zip")
```

Behavior:

1. `POST /api/photos/download-zip` with `{ photoIds }`.
2. Parse response as `Blob`.
3. Create object URL.
4. Trigger browser file download with configurable filename.
5. Revoke object URL.

Errors from backend are surfaced as thrown `Error(...)` and handled by page UI.

---

### 6. Gallery Selection Mode (`src/pages/PhotosPage.js`)

Added state:

- `selectionMode: boolean`
- `selectedPhotoIds: Set<string>`
- `downloadStatus: string`

#### UX behavior implemented

Outside selection mode:

- `Auswaehlen` button enters selection mode.
- `Download All` is always visible.

Inside selection mode:

- grid click toggles select/deselect instead of opening lightbox,
- sticky toolbar shows selected count,
- actions: `Download` and `Abbrechen`,
- `Fertig` exits mode and clears selection.

Lightbox is automatically disabled while selection mode is active.

---

### 7. Selection Overlay UI (`src/components/PhotoGrid.js`)

`PhotoGrid` now supports both browse and select interaction modes.

Added props:

- `selectionMode`
- `selectedPhotoIds`
- `onToggleSelect`

Selected photo visuals:

- dark semi-transparent overlay,
- centered checkmark,
- highlighted outline.

This keeps selection clear on mobile and desktop without always-visible checkboxes.

---

### 8. Download Selected Flow (`src/pages/PhotosPage.js`)

`handleDownloadSelected()` now:

1. Validates at least one selected photo.
2. Enforces max 100 selected photos.
3. Calls `downloadZip(Array.from(selectedPhotoIds))`.
4. Resets selection mode on success.
5. Shows `Download fehlgeschlagen` on failure.

---

### 9. Download All Flow with Sequential Batching (`src/pages/PhotosPage.js`)

`handleDownloadAll()` now supports both small and large sets.

#### Important implementation detail

The function first collects all photo IDs for the current category, including pages not yet loaded in the grid.

It does this by repeatedly calling:

```js
fetchPhotos(categoryRef.current, LIMIT, off)
```

until `hasMore` is false.

This avoids a common bug where "Download All" would only include currently visible/loaded photos.

#### Batch strategy

- Split all IDs into chunks of 100.
- Process sequentially (`await` in loop), not in parallel.
- Default file names:
  - single batch: `wedding-photos.zip`
  - multi-batch: `wedding-photos-<n>-of-<total>.zip`

#### User feedback

Status text examples:

- `Fotos werden gesammelt...`
- `Mehrere Downloads werden gestartet...`
- `Downloading batch 2 of 5...`

#### Browser prompt mitigation

To reduce blocked download prompts in some browsers, a short delay is inserted between sequential batches.

Current delay:

- `450ms` between ZIP batches.

---

## File Structure After Phase 6

```text
backend/
  routers/
    photos.py                         <- MODIFIED: POST /api/photos/download-zip
  requirements.txt                    <- MODIFIED: zipstream-ng added

src/
  services/
    api.js                            <- MODIFIED: downloadZip(photoIds, filename)
  pages/
    PhotosPage.js                     <- MODIFIED: selection mode + download flows
  components/
    PhotoGrid.js                      <- MODIFIED: selection overlay + toggle behavior
```

---

## End-to-End Flow

```text
User opens /photos
   |
   +--> [Auswaehlen] -> enters selection mode
   |         |
   |         +--> tap photos -> selected IDs in Set
   |         +--> [Download] -> POST /api/photos/download-zip -> browser download
   |
   +--> [Download All]
             |
             +--> fetch all pages for current category
             +--> split IDs into chunks of 100
             +--> sequential ZIP requests
             +--> N ZIP downloads in browser
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Backend-side ZIP generation | Keeps storage keys and signing logic on server; no direct storage exposure in frontend |
| `zipstream-ng` + `write_iter` | True streaming archive generation; avoids full in-memory ZIP builds |
| Hard max of 100 per request | Protects backend from oversized ZIP requests and long blocking responses |
| Sequential batch downloads for "Download All" | Reduces backend/storage load spikes compared to parallel batch requests |
| Selection mode toggle UX | Cleaner gallery by default; explicit multi-select intent when needed |
| Deduplicating `photoIds` in request validator | Prevents duplicate files in ZIP due to repeated IDs |
| Signed URLs generated per file at request time | Keeps download links short-lived and storage private |

---

## Testing Checklist

```text
[ ] Select 1 photo -> ZIP download works
[ ] Select multiple photos -> ZIP contains all selected
[ ] Select exactly 100 photos -> request accepted and works
[ ] Select >100 photos -> frontend blocks or backend returns 400
[ ] Download All with <=100 photos -> one ZIP
[ ] Download All with >100 photos -> multiple ZIP downloads in sequence
[ ] Download All includes photos not yet scrolled into view
[ ] ZIP filenames preserve original extension from storage key
[ ] ZIP response is streamed (no backend memory spike)
[ ] Invalid UUID in request -> backend validation error
[ ] Non-done photo ID in request -> 400 with missingPhotoIds
[ ] Signed URL failure for one file -> request still succeeds if at least one file is valid
[ ] All files fail -> backend returns 500 with clear error
[ ] Mobile selection mode usable (tap targets, clear selected state)
[ ] Lightbox does not open while selection mode is active
```

---

## Known Limitations / Follow-Ups

Current behavior intentionally keeps Phase 6 scope focused and simple:

- "Download All" currently operates on the active category tab, not both categories together.
- No per-file progress inside a single ZIP stream (only batch-level status in UI).
- No async/background ZIP job queue (request-response streaming only).

These are acceptable for current MVP constraints and can be improved in later phases.

---

## Phase 7 Handoff Notes

Phase 7 (UX Improvements) can build directly on this implementation:

1. Improve status/toast UX for long multi-batch downloads.
2. Add confirmation dialog for very large "Download All" actions.
3. Add category-scoped "Download All" labels to reduce ambiguity.
4. Optional: preserve original file extension in ZIP entry filenames.
5. Optional: add a cancel mechanism for long-running batch downloads.
