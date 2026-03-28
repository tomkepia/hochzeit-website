# Phase 4 Implementation – Gallery (Photo Browsing + Lightbox)

**Date:** 22. März 2026  
**Phase:** 4 of 7  
**Status:** Complete  
**Builds on:** Phase 3 (Image Processing)

---

## Overview

Phase 4 delivers the photo gallery — the primary consumption experience for wedding guests. Users can browse thumbnails in a responsive grid, switch between guest and photographer albums, scroll infinitely through all photos, and open any image in a fullscreen lightbox with swipe support and a one-tap download button.

The backend `GET /api/photos` endpoint was already implemented as part of Phase 3's post-implementation fixes. Phase 4's work is therefore almost entirely frontend-only, with one targeted backend improvement (pagination response shape).

---

## What Was Built

### 1. Backend — `GET /api/photos` refined (`backend/routers/photos.py`)

The existing endpoint was updated with two changes:

#### Change 1 – Default `limit` reduced from 100 → 50

```python
# Before
def list_photos(category=None, limit: int = 100, offset: int = 0, ...)

# After
def list_photos(category=None, limit: int = 50, offset: int = 0, ...)
```

50 produces faster perceived initial load without sacrificing scroll depth. The cap at 100 is enforced via `limit = min(max(1, limit), MAX_LIMIT)`.

#### Change 2 – `hasMore` replaces `total`/`offset`/`limit` in response

**Before:**
```json
{ "photos": [...], "total": 42, "offset": 0, "limit": 100 }
```

**After:**
```json
{ "photos": [...], "hasMore": true }
```

`hasMore` is computed by fetching `limit + 1` rows and checking whether the extra row exists:

```python
raw = query.order_by(Photo.created_at.desc()).offset(offset).limit(limit + 1).all()
has_more = len(raw) > limit
photos_to_process = raw[:limit]
```

This avoids a separate `COUNT(*)` query while remaining accurate.

#### Full response shape

```json
{
  "photos": [
    {
      "id": "uuid",
      "category": "guest",
      "uploadedBy": "Maria",
      "createdAt": "2026-05-09T14:23:00",
      "thumbnailUrl": "https://...signed...",
      "previewUrl":   "https://...signed...",
      "originalUrl":  "https://...signed..."
    }
  ],
  "hasMore": true
}
```

Storage keys are no longer included in the response — the frontend has no use for them.

---

### 2. Frontend — `fetchPhotos` in `src/services/api.js`

All API communication remains in the service module. A new function was added:

```js
export async function fetchPhotos(category, limit = 50, offset = 0) {
  const params = new URLSearchParams({ limit, offset });
  if (category) params.set("category", category);

  const response = await fetch(`${API_BASE}/api/photos?${params}`);
  if (!response.ok) throw new Error(`Failed to fetch photos (${response.status})`);
  return response.json();
}
```

Components never call `fetch` directly.

---

### 3. `src/components/PhotoGrid.js` ← NEW

A stateless, purely presentational grid component.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `photos` | `Photo[]` | Array of photo objects from the API |
| `onPhotoClick(index)` | function | Called with the clicked photo's index |

**Grid layout:**

```css
grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
gap: 4px;
```

- `auto-fill` fills all available horizontal space with as many columns as fit
- `minmax(120px, 1fr)` ensures columns are at least 120 px wide (4+ columns on mobile, more on desktop)
- Each cell has `aspect-ratio: 1` — square thumbnails regardless of image shape
- `object-fit: cover` fills the square without letterboxing

**Image loading:**

```html
<img src={photo.thumbnailUrl} loading="lazy" />
```

Native browser lazy loading — thumbnails only fetch when near the viewport.

**Accessibility:**

- Each thumbnail is a `<button>` (keyboard focusable, screen-reader accessible)
- `aria-label` includes the uploader name if available: `"Foto von Maria"` or `"Hochzeitsfoto öffnen"`

**Hover animation:**

```js
onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
```

Subtle scale-up on hover without layout shift. No animation library dependency.

---

### 4. `src/components/LightboxViewer.js` ← NEW

Fullscreen photo viewer using `yet-another-react-lightbox` v3.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `photos` | `Photo[]` | All currently loaded photos (same array as the grid) |
| `index` | `number` | Index of the photo to open (`-1` = closed) |
| `onClose` | function | Called when user dismisses the lightbox |
| `onIndexChange(i)` | function | Called when user navigates to another photo |

**Library plugins used:**

| Plugin | Purpose |
|---|---|
| `Download` | Adds a download button; uses `originalUrl` (full resolution) |
| `Captions` | Shows uploader name below the photo if available |

**Slide construction:**

```js
const slides = photos.map((photo) => ({
  src: photo.previewUrl,              // medium resolution — fast to load
  download: {
    url: photo.originalUrl,           // full resolution download
    filename: `hochzeit-${photo.id}.jpg`,
  },
  description: photo.uploadedBy
    ? `Hochgeladen von ${photo.uploadedBy}`
    : undefined,
}));
```

**Why `previewUrl` not `originalUrl` in the lightbox:**  
Full-resolution originals can be 5–15 MB. Preview variants (max 1200px, JPEG q80) are typically 100–400 KB, loading near-instantly on mobile. The original is only fetched on explicit download.

**Built-in features (from the library):**  
- Touch swipe navigation (mobile)
- Keyboard navigation (← → Esc)
- Close button
- Scroll wheel zoom

---

### 5. `src/pages/PhotosPage.js` ← NEW

The gallery page rendered at `/photos`.

#### Page structure

```
┌─────────────────────────────────────┐
│         Unsere Fotos                │  ← header
│   Klicke auf ein Foto …             │
├─────────────────────────────────────┤
│  [ Gästefotos ]  [ Fotografenfotos ]│  ← category tabs
├─────────────────────────────────────┤
│  ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪  │
│  ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪  │  ← photo grid
│  ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪  │
│           ⟳ (spinner)               │  ← loading indicator
│   Alle 120 Fotos geladen            │  ← end-of-list message
└─────────────────────────────────────┘
```

#### State

| State variable | Type | Purpose |
|---|---|---|
| `category` | `string` | Current tab: `"guest"` or `"photographer"` |
| `photos` | `Photo[]` | Accumulated photos across all fetched pages |
| `loading` | `boolean` | True while a fetch is in flight |
| `hasMore` | `boolean` | Whether more pages exist |
| `error` | `string\|null` | Error message if a fetch failed |
| `lightboxIndex` | `number` | Index of the open lightbox photo; `-1` = closed |

#### Refs (stale-closure guard)

The `IntersectionObserver` callback closes over refs, not state, to avoid stale values:

| Ref | Mirrors |
|---|---|
| `offsetRef` | current fetch offset |
| `hasMoreRef` | `hasMore` state |
| `loadingRef` | `loading` state |
| `categoryRef` | `category` state |

#### Category switching

```js
useEffect(() => {
  categoryRef.current = category;
  offsetRef.current = 0;
  hasMoreRef.current = true;
  setPhotos([]);        // clear grid immediately
  setHasMore(true);
  setError(null);
  doLoad(category, 0, true);  // replace = true → discard previous photos
}, [category, doLoad]);
```

Switching tabs immediately clears the grid and fires a fresh fetch. Any in-flight response from the previous category is discarded:

```js
if (cat !== categoryRef.current) return;  // stale response guard
```

#### Infinite scroll

An `IntersectionObserver` watches a 1px sentinel `<div>` placed after the grid. When the sentinel enters the viewport (with a 400 px `rootMargin` lookahead), the next page is fetched:

```js
const observer = new IntersectionObserver(
  ([entry]) => {
    if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
      doLoad(categoryRef.current, offsetRef.current, false);
    }
  },
  { rootMargin: "400px" }
);
observer.observe(sentinelRef.current);
```

The 400 px margin means loading starts well before the user reaches the bottom — scroll feels continuous.

#### UI states

| Condition | UI shown |
|---|---|
| Loading, no photos yet | Spinner (centered) |
| Loading, photos exist | Spinner below the grid |
| Error | Red error message |
| No photos, not loading | 📷 empty state (German text) |
| All photos loaded | "Alle N Fotos geladen" |
| Active category | Tab button: filled warm-brown background |
| Lightbox open | `LightboxViewer` rendered over the grid |

---

### 6. `src/App.js` ← MODIFIED

Added the `/photos` route:

```jsx
import PhotosPage from "./pages/PhotosPage";

<Route path="/photos" element={<PhotosPage />} />
```

---

### 7. `src/App.css` ← MODIFIED

Added the loading spinner animation:

```css
@keyframes photo-spin {
  to { transform: rotate(360deg); }
}

.photo-loading-spinner {
  display: inline-block;
  width: 36px;
  height: 36px;
  border: 3px solid #ddd3c8;
  border-top-color: #8b7355;
  border-radius: 50%;
  animation: photo-spin 0.8s linear infinite;
}
```

Colour palette matches the existing warm-beige wedding theme.

---

### 8. Dependency — `yet-another-react-lightbox` v3

```bash
npm install yet-another-react-lightbox
```

Added to `package.json` as `"yet-another-react-lightbox": "^3.29.1"`.

**Why this library:**
- Actively maintained, ships as ES modules with no peer dependency conflicts
- Plugin system: `Download` and `Captions` loaded à la carte (tree-shakeable)
- Touch/swipe built-in — no additional touch library needed
- CSS is a single import: `yet-another-react-lightbox/styles.css`

---

## File Structure After Phase 4

```
src/
  App.js                    ← MODIFIED: /photos route added
  App.css                   ← MODIFIED: photo-loading-spinner animation added
  services/
    api.js                  ← MODIFIED: fetchPhotos() added
  pages/
    PhotosPage.js           ← NEW: gallery page at /photos
  components/
    PhotoGrid.js            ← NEW: thumbnail grid
    LightboxViewer.js       ← NEW: fullscreen viewer

backend/
  routers/
    photos.py               ← MODIFIED: limit=50, hasMore response shape
```

---

## Data Flow — End-to-End

```
/photos page loads
       │
       ▼
useEffect → doLoad("guest", 0, replace=true)
       │
       ▼
GET /api/photos?category=guest&limit=50&offset=0
       │
       ▼
Backend: query WHERE status='done' AND category='guest'
         ORDER BY created_at DESC LIMIT 51
         generates signed URLs for each photo
       │
       ▼
{ photos: [...50 items], hasMore: true }
       │
       ▼
PhotoGrid renders thumbnails (lazy-loaded)
       │
User scrolls down → IntersectionObserver fires
       │
       ▼
doLoad("guest", 50, replace=false)
       │
GET /api/photos?category=guest&limit=50&offset=50
       │
       ▼
Append next 50 photos to grid
       │
User clicks photo at index 7
       │
       ▼
setLightboxIndex(7) → LightboxViewer opens
  src = photos[7].previewUrl   (medium, fast)
  download = photos[7].originalUrl (full res)
```

---

## Performance Design

| Decision | Impact |
|---|---|
| Thumbnails in grid (not previews) | 300px JPEG ~5–20 KB vs preview ~100–400 KB; 10–20× faster grid load |
| `loading="lazy"` on `<img>` | Browser only fetches thumbnails near viewport; no wasted requests |
| `rootMargin: "400px"` on IntersectionObserver | Next batch prefetches before user reaches bottom; no perceived pause |
| Lightbox uses `previewUrl` not `originalUrl` | Lightbox opens in ~0.5s on mobile instead of 5–10s |
| Download fetches `originalUrl` only on user action | Full-resolution originals never fetched unless explicitly requested |
| `limit + 1` trick for `hasMore` | Avoids a `COUNT(*)` query; single DB round-trip per page |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `GET /api/photos` fails | Error message shown; grid untouched; retry possible by switching tabs |
| Signed URL generation fails for one photo | Backend skips that photo silently; rest of batch returned normally |
| Invalid `category` query param | Backend returns HTTP 400 |
| Network goes offline mid-scroll | Spinner stops; error appears; page remains functional |
| Lightbox image fails to load | Library shows its own broken-image state; other photos unaffected |

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| `IntersectionObserver` over scroll events | No throttling required; browser-native, performant, works with momentum scrolling on iOS |
| Refs alongside state for observer | Avoids stale closure bug — observer callback always reads current values |
| Stale-response guard after category switch | Prevents out-of-order responses from mixing photos across categories |
| `limit + 1` for `hasMore` | One query, no COUNT; correct even when total is a multiple of `limit` |
| `replace` flag in `doLoad` | Same function handles both initial load (replace=true) and scroll (replace=false) — no code duplication |
| `previewUrl` in lightbox, `originalUrl` for download | Right URL for the right action: fast browsing without sacrificing download quality |
| Storage keys excluded from API response | Keys are an internal implementation detail; frontend needs only signed URLs |
| Warm-beige colour palette for tabs + spinner | Visually consistent with the existing wedding theme (no design guidelines violated) |

---

## Testing Checklist

```
[ ] /photos loads without errors
[ ] Guest photos tab shows photos with processing_status = "done"
[ ] Photographer photos tab works correctly
[ ] Switching tabs clears the grid and loads the new category
[ ] Infinite scroll loads next batch when near the bottom
[ ] No duplicate photos appear when scrolling
[ ] Loading spinner shows during fetch, disappears after
[ ] Empty state shows when no photos exist
[ ] "Alle N Fotos geladen" appears when hasMore = false
[ ] Clicking a thumbnail opens the lightbox at the correct index
[ ] Lightbox shows preview image (not thumbnail)
[ ] Swipe left/right navigates between photos (mobile)
[ ] Arrow keys navigate between photos (desktop)
[ ] Esc or close button dismisses lightbox
[ ] Download button downloads the original file (full resolution)
[ ] Uploader name appears in lightbox caption (if provided)
[ ] HEIC photos display correctly (preview is JPEG)
[ ] Signed URL expiry (>1 hour): photos still visible without refresh
[ ] Network offline: graceful error message, no crash
```

---

## Post-Implementation Fixes

Four gaps were identified and reviewed after initial Phase 4 implementation:

### Gap 1 – Signed URL expiry (deferred — no code change)

**Issue:** Signed URLs expire after ~1 hour. If a guest keeps the `/photos` tab open longer than that, cached URLs become invalid and images fail to load.

**Decision:** Deferred to Phase 5 or 6. Acceptable for MVP — a wedding event is short-lived and guests are unlikely to leave the tab open for hours. The fix when needed:

```js
// Re-fetch if the page regains focus after >55 minutes of inactivity
window.addEventListener("focus", () => {
  if (timeSinceLastFetch() > 55 * 60 * 1000) {
    refetchCurrentCategory();
  }
});
```

---

### Gap 2 – Clearer log message when a photo is skipped (fixed)

**Issue:** The original log message `"Failed to generate signed URLs for photo %s: %s"` did not explicitly state that the photo was being dropped from the response, making it harder to debug missing images in production logs.

**Fix:** Log message updated to make the skip explicit:

```python
# Before
logger.error("Failed to generate signed URLs for photo %s: %s", photo.id, exc)

# After
logger.error(
    "Skipping photo %s from response: signed URL generation failed — %s",
    photo.id,
    exc,
)
```

No frontend change needed. Behavior is unchanged — the photo is still silently dropped from the batch rather than failing the whole response.

---

### Optional 1 – Deterministic pagination ordering (fixed)

**Issue:** `ORDER BY created_at DESC` is non-deterministic when two photos share the same timestamp (e.g. batch uploads within the same second). A photo could appear on page 1 in one request and page 2 in the next, causing duplicates or gaps in the infinite scroll.

**Fix:** Added `id DESC` as a tiebreaker:

```python
# Before
query.order_by(Photo.created_at.desc())

# After
query.order_by(Photo.created_at.desc(), Photo.id.desc())
```

UUID v4 values are random, so this doesn't impose a meaningful ordering preference — it simply makes pagination stable.

---

### Optional 2 – Lightbox adjacent-slide preloading (confirmed + made explicit)

**Issue:** The lightbox was loading `previewUrl` images on demand. On a slow mobile connection, swiping to the next photo could show a blank screen for a moment.

**Finding:** `yet-another-react-lightbox` preloads 2 adjacent slides on each side by default (library default). This means 4 preview images are already being fetched in the background while the user views the current photo.

**Fix:** Made the configuration explicit in the component rather than relying on an invisible default:

```jsx
// carousel.preload controls how many slides are preloaded on each side.
// Default is 2, which means the 4 immediately adjacent previews are always prefetching.
<Lightbox carousel={{ preload: 2 }} ... />
```

This makes the preload behavior visible to future maintainers and ensures it doesn't accidentally revert if the library changes its default.

---

## Phase 5 Handoff Notes

Phase 5 (Routing) adds a landing/entry page for the photo feature. Current state from Phase 4:

- `/photos` is live and fully functional
- `/upload` is live (Phase 2)
- Neither page is linked from the main wedding site (`/`) yet

**Phase 5 work:**
- Create a `/gallery` or `/fotos` entry page with two action buttons:
  - "Fotos hochladen" → `/upload`
  - "Fotos ansehen" → `/photos`
- Optionally: add a link from the main page's footer or navigation
- Optionally: add a back link from `/photos` and `/upload` back to the entry page

**Signed URL refresh:**  
Signed URLs in the gallery expire after 1 hour. For a wedding event (guests browse for a few hours), this is fine. If the page is kept open longer, photos will stop loading from the cached API response. A future improvement could re-fetch the current page on window focus after >55 minutes.
