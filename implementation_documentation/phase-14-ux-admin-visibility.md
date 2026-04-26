# Phase 14 Implementation – UX & Admin Visibility

**Date:** 3. April 2026  
**Phase:** 14  
**Status:** Complete  
**Builds on:** Phase 13.1 (Worker Stability, Backoff & Admin Visibility)

---

## Overview

Phase 14 makes the photo processing pipeline fully visible to both guests and admins in the UI. Before this phase, uploaded photos simply did not appear in the gallery until they were fully processed — users had no feedback about whether their upload was being handled. A burst of uploads could result in the gallery appearing empty for minutes, with no indication of progress.

This phase adds transparency at every layer:

1. **Gallery shows all photos immediately** — `pending`, `processing`, `failed`, and `done` photos all appear in the grid. Guests see status overlays instead of a blank space.
2. **Simplified processing UX** — `pending` and `processing` now share one user-facing state, displayed only as `Wird verarbeitet…`, while the backend still keeps the distinction for admin/debug logic.
3. **Light photo polling** — the gallery auto-refreshes every 7 seconds while any visible photo is not yet `done`, keeping the UI in sync without polling idle galleries.
4. **Admin retry button with loading state** — admin users see a retry button on every `failed` tile; while the retry request is in flight the button is disabled and replaced with a spinner.
5. **Admin processing stats panel** — a compact status bar above the grid (visible only to admins) shows live queue counts from `GET /api/admin/processing-stats`, auto-refreshing every 5 seconds and visually highlighting queue problems.

No breaking API changes. No changes to the worker (Phase 13.1 is unchanged). No new environment variables.

---

## Part 1 – Backend Changes

### 1.1 `GET /api/photos` — return all statuses

File: `backend/routers/photos.py`, function `list_photos`

**Before:**

```python
query = db.query(Photo).filter(Photo.processing_status == "done")
if category:
    query = query.filter(Photo.category == category)
```

**After:**

```python
query = db.query(Photo)
if category:
    query = query.filter(Photo.category == category)
```

The `processing_status == "done"` filter is removed. All photos in the requested category are returned regardless of their processing state. The sort order (`created_at DESC, id DESC`) is unchanged, so newly registered photos appear at the top of the grid immediately after upload.

### 1.2 Response fields extended

**Before:**

```json
{
  "id": "...",
  "category": "guest",
  "uploadedBy": "...",
  "createdAt": "...",
  "thumbnailUrl": "...",
  "previewUrl": "...",
  "originalUrl": "..."
}
```

**After:**

```json
{
  "id": "...",
  "category": "guest",
  "uploadedBy": "...",
  "createdAt": "...",
  "thumbnailUrl": null,
  "previewUrl": null,
  "originalUrl": null,
  "processingStatus": "pending",
  "processingError": null,
  "processingAttempts": 0
}
```

Three fields are added to every photo in the response:

| Field | Type | Notes |
|---|---|---|
| `processingStatus` | `string` | `"pending"` \| `"processing"` \| `"done"` \| `"failed"` |
| `processingError` | `string \| null` | Only populated for `failed` photos |
| `processingAttempts` | `int` | Incremented by the worker on each attempt |

For non-done photos, `thumbnailUrl`, `previewUrl`, and `originalUrl` are `null` because the worker has not yet generated the variants. The signed URL generation already handled missing keys gracefully (`if photo.thumbnail_key else None`) so no additional error handling was needed.

### 1.3 Naming consistency

The API response keeps the frontend-facing camelCase field names:

```python
"processingStatus": photo.processing_status,
"processingError": photo.processing_error,
"processingAttempts": photo.processing_attempts,
```

The backend continues reading SQLAlchemy model attributes in snake_case and explicitly maps them into the JSON response. No backend schema change was needed.

### 1.4 Docstring updated

The `list_photos` docstring was updated to describe the new behaviour.

### 1.5 No changes to download endpoints

The `POST /api/photos/download-zip` endpoint already filters `processing_status == "done"` in its own query — this is correct and unchanged. Non-done photos cannot be included in ZIPs.

---

## Part 2 – `src/services/api.js`

Two new exported functions are added at the end of the file.

### 2.1 `fetchProcessingStats()`

```js
export async function fetchProcessingStats() {
  const res = await fetch(`${API_BASE}/api/admin/processing-stats`, {
    headers: { ...getAuthHeaders() },
  });

  if (res.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}
```

Calls the existing `GET /api/admin/processing-stats` endpoint. Follows the same 401 handling pattern as all other authenticated calls.

### 2.2 `retryPhoto(photoId)`

```js
export async function retryPhoto(photoId) {
  const res = await fetch(
    `${API_BASE}/api/admin/retry-photo/${encodeURIComponent(photoId)}`,
    {
      method: "POST",
      headers: { ...getAuthHeaders() },
    }
  );

  if (res.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!res.ok) throw new Error("Retry failed");
  return res.json();
}
```

Calls the existing `POST /api/admin/retry-photo/{id}` endpoint. `photoId` is URL-encoded to handle UUIDs with special characters safely (UUIDs contain only alphanumeric characters and hyphens, so this is purely defensive).

---

## Part 3 – `src/components/PhotoGrid.js`

The component is rewritten to add status-aware rendering and the new `onRetry` prop. All existing functionality (selection mode, delete button, ARIA labels) is preserved and extended.

### 3.1 New prop: `onRetry`

```js
export default function PhotoGrid({
  photos,
  onPhotoClick,
  selectionMode = false,
  selectedPhotoIds = new Set(),
  onToggleSelect,
  isAdmin = false,
  onDelete,
  onRetry,        // NEW
}) {
```

### 3.2 `isDone` derived flag

```js
const isDone = !photo.processingStatus || photo.processingStatus === "done";
```

The `!photo.processingStatus` guard ensures backward compatibility with any photo object that doesn't carry the new fields (e.g. unit test fixtures). In production all photos returned from the API will have `processingStatus`.

### 3.3 Interaction gating for non-done photos

```js
onClick={() => {
  if (!isDone) return;
  if (selectionMode) { onToggleSelect?.(photo.id); }
  else { onPhotoClick(index); }
}}
style={{ cursor: isDone ? "pointer" : "default" }}
```

Non-done photos:
- Do not open the lightbox
- Cannot be selected
- Cursor is `default` rather than `pointer`
- Hover zoom is disabled on the `<img>` element

### 3.4 Image vs placeholder

```jsx
{photo.thumbnailUrl ? (
  <img ... style={{ filter: isDone ? "none" : "blur(3px) brightness(0.7)" }} />
) : (
  <div style={{ width: "100%", height: "100%", background: "#e0d8cf" }} />
)}
```

If `thumbnailUrl` is null (photo not yet processed), a plain grey placeholder fills the tile. If a thumbnail exists but the photo is in a non-done state (e.g. re-processing), the image is shown blurred and darkened.

### 3.5 Status overlays

Processing is deliberately simplified for guests and normal gallery use. Internally the backend still returns `pending` and `processing`, but both now render identically:

| `processingStatus` | Overlay | Content |
|---|---|---|
| `"processing"` | 60% dark, semi-transparent | Spinner + "Wird verarbeitet…" |
| `"pending"` | 60% dark, semi-transparent | Spinner + "Wird verarbeitet…" |
| `"failed"` (guest) | soft neutral overlay | `Fehler bei Verarbeitung` |
| `"failed"` (admin) | 72% dark red | ⚠ + `Fehlgeschlagen` |

The `photo-loading-spinner` class (existing in `App.css`) is reused for the processing overlay spinner, overriding its size with inline style (`width: 22, height: 22, borderWidth: 2`).

All overlay `<div>` elements carry `pointer-events: none` via the CSS class so they do not intercept the click event on the parent `<button>`.

### 3.6 Admin controls

**Delete button** — restricted to `isDone` photos only. Non-done photos cannot be deleted from the grid (an admin should wait for processing to complete or manually retry). This prevents accidentally deleting a photo whose S3 original is still being worked on.

**Retry button** — shown only when `isAdmin && photo.processingStatus === "failed"`:

```jsx
{isAdmin && photo.processingStatus === "failed" && (
  <button
    onClick={(e) => { e.stopPropagation(); onRetry?.(photo.id); }}
    aria-label="Foto erneut verarbeiten"
    style={{ position: "absolute", bottom: 6, right: 6, ... }}
  >
    ↻
  </button>
)}
```

The button is positioned at the bottom-right corner of the tile to avoid overlapping the red failure overlay. `e.stopPropagation()` prevents the tile's own (disabled) click handler from firing.

### 3.7 Per-photo retry loading state

`retryingPhotoIds` is passed in from `PhotosPage` as a `Set<string>`. While a retry request is active for a given photo:

- The retry button is disabled
- Cursor changes to `not-allowed`
- Opacity is reduced
- The `↻` icon is replaced with a small spinner

---

## Part 4 – `src/App.css`

Three new CSS rules added after the existing `.photo-loading-spinner` block:

```css
/* Photo tile processing state overlays */
.photo-status-overlay {
  position: absolute;
  inset: 0;
  background: rgba(30, 24, 20, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  gap: 2px;
  pointer-events: none;
}
.photo-status-overlay--pending {
  background: rgba(30, 24, 20, 0.4);
}
.photo-status-overlay--failed {
  background: rgba(140, 28, 18, 0.72);
}
.photo-status-overlay--failed-soft {
  background: rgba(116, 98, 78, 0.5);
}
```

`pointer-events: none` on the overlay ensures that the parent `<button>` still receives the click regardless of whether the overlay covers the tile.

---

## Part 5 – `src/pages/PhotosPage.js`

### 5.1 New imports

```js
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ..., retryPhoto, fetchProcessingStats } from "../services/api";
```

`useMemo` is added to the React import for `donePhotos` (§5.4).

### 5.2 New state: `processingStats` and `retryingPhotoIds`

```js
const [processingStats, setProcessingStats] = useState(null);
const [retryingPhotoIds, setRetryingPhotoIds] = useState(() => new Set());
```

`processingStats` is initially `null`; set by `loadStats` to the object returned from `fetchProcessingStats()`. The admin panel is only rendered when this is non-null, so there is no flash of empty stats on load.

`retryingPhotoIds` tracks which failed photos currently have an in-flight retry request.

### 5.3 `loadStats` + auto-refresh effect

```js
const loadStats = useCallback(async () => {
  try {
    const data = await fetchProcessingStats();
    setProcessingStats(data);
  } catch { /* silently ignore — admin only endpoint */ }
}, []);

useEffect(() => {
  if (!isAdmin) return;
  loadStats();
  const interval = setInterval(loadStats, 5000);
  return () => clearInterval(interval);
}, [isAdmin, loadStats]);
```

The interval is cleared on unmount (the `return () => clearInterval(interval)` cleanup). Stats are never fetched for non-admins. Errors are silently swallowed — a network blip should not disrupt the admin's gallery experience.

### 5.4 Conditional photo polling

The first version of Phase 14 made the admin stats panel live but left the photo grid stale until manual refresh or another explicit load. That created a gap after retries and after worker completion: the tile state could remain outdated even though the backend had moved on.

To fix this, `PhotosPage` now derives:

```js
const hasNonDonePhotos = useMemo(
  () => photos.some((p) => p.processingStatus && p.processingStatus !== "done"),
  [photos]
);
```

When `hasNonDonePhotos` is true, the page starts a 7-second interval that silently refreshes the currently visible photo range. When all visible photos are `done`, the polling stops automatically.

This keeps the UI current without adding steady-state load to idle galleries.

### 5.5 `donePhotos` memo + `handlePhotoClick`

```js
const donePhotos = useMemo(
  () => photos.filter((p) => !p.processingStatus || p.processingStatus === "done"),
  [photos]
);

const handlePhotoClick = useCallback(
  (gridIndex) => {
    const photo = photos[gridIndex];
    if (!photo) return;
    const lbIndex = donePhotos.findIndex((p) => p.id === photo.id);
    if (lbIndex >= 0) setLightboxIndex(lbIndex);
  },
  [photos, donePhotos]
);
```

The `photos` state array now contains photos of all statuses. The lightbox can only show fully processed photos (because non-done photos have `null` `previewUrl` which would cause the lightbox library to crash). `donePhotos` is a memoized filtered subset used exclusively as the lightbox slide source.

`handlePhotoClick` maps a grid index (index in the full `photos` array) to a lightbox index (index in `donePhotos`). This is safe because:
- PhotoGrid will only call `onPhotoClick` for `isDone` photos 
- Every done photo in `photos` is guaranteed to be in `donePhotos`
- The `findIndex` will always succeed for done photos

`LightboxViewer` is updated to receive `donePhotos` and `lightboxIndex`, which now refers to a position within `donePhotos`:

```jsx
<LightboxViewer
  photos={donePhotos}
  index={lightboxIndex}
  onClose={() => setLightboxIndex(-1)}
  onIndexChange={setLightboxIndex}
/>
```

### 5.6 `handleRetry`

```js
const handleRetry = useCallback(async (photoId) => {
  try {
    await retryPhoto(photoId);
    showToast("Foto wird erneut verarbeitet");
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId
          ? { ...p, processingStatus: "pending", processingAttempts: 0, processingError: null }
          : p
      )
    );
  } catch {
    showToast("Retry fehlgeschlagen");
  }
}, [showToast]);
```

On success, the photo is **optimistically updated** in local state to `pending`. This immediately moves it from the red `failed` overlay to the lighter `pending` overlay, giving instant feedback before the next `fetchPhotos` poll. The `processingAttempts` counter is reset to `0` to match what the backend sets. On failure, a toast is shown.

The revised version also adds a `finally` block that removes the photo ID from `retryingPhotoIds`, ensuring the retry button always re-enables.

### 5.7 `handleDownloadAll` — filter to done photos only

```js
const downloadableIds = allPhotoIds.filter((id) => {
  const p = allPhotoMap.get(id);
  return !p?.processingStatus || p.processingStatus === "done";
});
```

Since `fetchPhotos` now returns photos of all statuses, `allPhotoIds` may contain non-done photo IDs. Passing those to `downloadZip` would cause a 400 error from the backend (the download-zip endpoint requires `processing_status == "done"`). This filter prevents that.

### 5.8 Processing-only banner

When all currently visible photos are non-done, the grid would otherwise look like a wall of grey placeholders with no explanation. `PhotosPage` now shows a compact banner above the grid:

```jsx
{!error && allVisiblePhotosAreProcessing && (
  <div ...>
    Fotos werden gerade verarbeitet…
  </div>
)}
```

This appears only when:

- `photos.length > 0`
- every visible photo is not yet `done`

### 5.9 PhotoGrid: new props

```jsx
<PhotoGrid
  photos={photos}
  onPhotoClick={handlePhotoClick}
  ...
  onRetry={handleRetry}
/>
```

`setLightboxIndex` is replaced with `handlePhotoClick`.

### 5.10 Admin stats panel JSX

Placed between the sort controls and the selection bar (above the photo grid):

```jsx
{isAdmin && processingStats && (
  <div style={{ ... }}>
    <span style={{ fontWeight: 600 }}>Verarbeitung:</span>
    {processingStats.pending > 0 && <span>Wartend: <strong>{...}</strong></span>}
    {processingStats.processing > 0 && <span>Aktiv: <strong>{...}</strong></span>}
    {processingStats.failed > 0 && <span style={{ color: "#b3473b" }}>Fehlgeschlagen: <strong>{...}</strong></span>}
    <span>Fertig: <strong>{processingStats.done}</strong></span>
    {processingStats.oldestPendingSeconds > 0 && <span>Ältestes: {processingStats.oldestPendingSeconds}s</span>}
  </div>
)}
```

Zero-value pending/processing/oldestPendingSeconds fields are hidden to keep the panel compact during normal operation (everything done). Failed count is shown in red when non-zero. If `oldestPendingSeconds > 30`, the age indicator switches to a warning color and heavier weight. The panel background/border also changes when failures or queue age suggest an operational problem.

---

## Effect on Existing Behaviour

| Scenario | Before (Phase 13.1) | After (Phase 14) |
|---|---|---|
| Photo immediately after upload | Not in gallery until processing done | Appears instantly with "Wird verarbeitet…" overlay |
| Photo being processed by worker | Not visible | Shown with spinner and "Wird verarbeitet…" |
| Photo list after retry/worker completion | Could stay stale until manual reload | Auto-refreshes every 7 s while any visible photo is non-done |
| Photo failed processing (guest) | Not visible in gallery | Shown with soft `Fehler bei Verarbeitung` overlay |
| Photo failed processing (admin) | Not visible in gallery | Shown with red `Fehlgeschlagen` badge + retry action |
| Admin sees failed photo | Only via `GET /api/admin/processing-stats` count | Can see it in the grid and retry with one click |
| Lightbox includes non-done photos | N/A | No — lightbox only shows `done` photos |
| Download All includes non-done photos | No — filter was done by backend | No — frontend also filters before sending IDs |
| Retry interaction | No UI feedback while request is in flight | Retry button disables and shows spinner |
| Processing stats for admin | Only via direct API call | Live panel in the gallery, auto-refreshes every 5 s and highlights issues |
| Guest experience | No change | No change — overlays are visible but no extra controls shown |

---

## Files Changed

| File | Change |
|---|---|
| `backend/routers/photos.py` | Remove `processing_status == "done"` filter from `list_photos`; add `processingStatus`, `processingError`, `processingAttempts` to response |
| `src/services/api.js` | Add `fetchProcessingStats()` and `retryPhoto(photoId)` |
| `src/components/PhotoGrid.js` | Add `onRetry` and `retryingPhotoIds` props; merge `pending` and `processing` into one processing overlay; soften failed state for guests; keep red failed state for admins; add retry-button spinner/disabled state |
| `src/App.css` | Add `.photo-status-overlay`, `.photo-status-overlay--pending`, `.photo-status-overlay--failed`, `.photo-status-overlay--failed-soft` CSS classes |
| `src/pages/PhotosPage.js` | Add `retryingPhotoIds` state; add conditional photo polling while visible photos are non-done; add processing-only banner; add per-photo retry loading state; refine admin stats warning emphasis; keep `donePhotos` lightbox isolation and done-only ZIP filtering |

**No database migrations required.**  
**No docker-compose changes.**  
**No new environment variables.**  
**No changes to the worker.**  
**No changes to backend admin endpoints (they were already implemented in Phase 13.1).**
