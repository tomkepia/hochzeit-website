# Phase 8 Implementation – Sorting (EXIF) + Direct Navigation UX

**Date:** 28. März 2026  
**Phase:** 8 of 8  
**Status:** Complete  
**Builds on:** Phase 7 (UX Improvements & Final Polish)

---

## Overview

Phase 8 adds two independent product improvements to the completed wedding photo system:

1. **Gallery sorting by EXIF capture date** — users can switch between upload order and the date a photo was actually taken, with full backward compatibility for photos that predate this phase.
2. **Direct navigation between upload and photos pages** — users can jump between `/upload` and `/photos` without going through `/gallery`, with QR token preserved across the navigation.

No UI redesign was performed. Both improvements extend the existing UI patterns established in Phases 4–7.

---

## Part 1 – EXIF Sorting

---

### 1. Database Change (`backend/models.py`)

Added a new nullable column to the `photos` table:

```python
taken_at = Column(DateTime, nullable=True)
```

**Design decisions:**
- `NULL` is the correct default — pre-existing photos have no EXIF data and are not reprocessed.
- The column is `nullable=True` intentionally and permanently. Not all cameras embed EXIF, and HEIC originals may strip metadata on some devices.

**Manual migration required for existing databases:**

```sql
ALTER TABLE photos ADD COLUMN taken_at TIMESTAMP NULL;
```

The column is added to the SQLAlchemy model and will be auto-created for fresh installations via `Base.metadata.create_all()`. Existing databases require the ALTER above.

---

### 2. EXIF Extraction (`backend/services/image_processing.py`)

Two helper functions were added before the public entry point `trigger_processing`:

#### `parse_exif_datetime(value) -> Optional[datetime]`

Parses EXIF datetime strings of the format `YYYY:MM:DD HH:MM:SS` (the standard EXIF format, distinct from ISO 8601).

```python
def parse_exif_datetime(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None
```

Returns `None` on any parse failure — never raises. This handles malformed camera timestamps gracefully.

#### `extract_taken_at(img: Image.Image) -> Optional[datetime]`

Reads all EXIF tags from the image and extracts a capture timestamp using the following priority order:

| Priority | Tag | What it represents |
|---|---|---|
| 1 | `DateTimeOriginal` | Shutter-press time — most accurate |
| 2 | `DateTime` | Fallback for images that have been edited and lost `DateTimeOriginal` but retain the baseline timestamp |

```python
def extract_taken_at(img: Image.Image) -> Optional[datetime]:
    try:
        exif = img.getexif()
        if not exif:
            return None

        date_time_original: Optional[datetime] = None
        date_time_fallback: Optional[datetime] = None

        for tag, value in exif.items():
            tag_name = TAGS.get(tag)
            if tag_name == "DateTimeOriginal":
                date_time_original = parse_exif_datetime(value)
            elif tag_name == "DateTime" and date_time_fallback is None:
                date_time_fallback = parse_exif_datetime(value)

        return date_time_original or date_time_fallback

    except Exception:
        return None
```

Uses `img.getexif()` (Pillow's unified EXIF interface, available in Pillow ≥ 6.0) rather than the deprecated `img._getexif()`. The single-pass loop populates both candidates and returns the preferred one at the end — no second pass required. Returns `None` when neither tag is present or parseable (PNG, WebP without metadata, etc.).

**Why `DateTime` as fallback:** Many photo editing apps (Lightroom, Google Photos exports, iOS edits) write back the file without preserving `DateTimeOriginal`. These images only carry `DateTime`, which reflects the last-modification time rather than the shutter time but is still far more meaningful than `NULL` for sorting purposes.

#### Integration into `_process_photo`

EXIF extraction happens **before** `ImageOps.exif_transpose()` because that call can strip or alter the raw EXIF data:

```python
img = Image.open(BytesIO(image_data))
taken_at = extract_taken_at(img)          # ← must happen before rotation fix
img = ImageOps.exif_transpose(img)        # ← may discard EXIF metadata
```

`taken_at` is then persisted together with the processing result:

```python
photo.preview_key = preview_key
photo.preview_url = preview_url
photo.thumbnail_key = thumb_key
photo.thumbnail_url = thumb_url
photo.taken_at = taken_at                 # ← NULL if EXIF absent or unparseable
photo.processing_status = "done"
photo.processing_error = None
db.commit()
```

#### Imports added

```python
from datetime import datetime
from PIL.ExifTags import TAGS
```

---

### 3. API Sort Parameter (`backend/routers/photos.py`)

The `GET /api/photos` endpoint accepts a new optional query parameter:

```python
sort: str = "upload"
```

**Validation and fallback:**

```python
sort_mode = sort if sort in {"upload", "taken"} else "upload"
```

Unknown values silently fall back to `"upload"` rather than returning a 400. This is intentional: the sort mode is a display preference, not a critical constraint, and future sort modes can be added without breaking old clients.

**Ordering logic:**

```python
if sort_mode == "taken":
    query = query.order_by(
        Photo.taken_at.desc().nullslast(),
        Photo.created_at.desc(),
        Photo.id.desc()
    )
else:
    query = query.order_by(Photo.created_at.desc(), Photo.id.desc())
```

Key design points:
- `nullslast()` is mandatory for backward compatibility. Photos uploaded before Phase 8 have `taken_at = NULL`. Without this, SQLAlchemy/PostgreSQL would sort NULLs before non-NULLs in descending order, making old photos appear first — the opposite of useful behavior.
- The three-level sort key (`taken_at DESC NULLS LAST, created_at DESC, id DESC`) ensures fully deterministic pagination even when timestamps collide.
- The `"upload"` branch is unchanged — existing clients calling the endpoint without the `sort` parameter continue to get upload-time ordering, exactly as before.

**No response shape changes.** The API returns the same JSON structure regardless of sort mode:

```json
{
  "photos": [
    {
      "id": "uuid",
      "category": "guest",
      "uploadedBy": "...",
      "createdAt": "...",
      "thumbnailUrl": "...signed...",
      "previewUrl": "...signed...",
      "originalUrl": "...signed..."
    }
  ],
  "hasMore": true
}
```

`taken_at` is intentionally not included in the response — it is a backend sort key, not a display field. Adding it would be a meaningful UX change (showing capture dates in the gallery) and is out of scope for this phase.

---

### 4. Frontend API Helper (`src/services/api.js`)

`fetchPhotos` gained a fourth parameter:

```js
export async function fetchPhotos(category, limit = 50, offset = 0, sortMode = "upload") {
  const params = new URLSearchParams({ limit, offset });
  if (category) params.set("category", category);
  params.set("sort", sortMode === "taken" ? "taken" : "upload");
  ...
}
```

- Default remains `"upload"` — all existing callers work unchanged.
- The whitelist `sortMode === "taken" ? "taken" : "upload"` ensures only valid values reach the backend, even if something in the UI malfunctions.

---

### 5. Frontend Sorting UI (`src/pages/PhotosPage.js`)

#### Sort state

```js
const initialSortMode = searchParams.get("sort") === "taken" ? "taken" : "upload";
const [sortMode, setSortMode] = useState(initialSortMode);
const sortRef = useRef(sortMode);
```

`initialSortMode` reads the URL on first render, allowing the sort mode to survive page refreshes and direct links (`/photos?sort=taken`).

`sortRef` mirrors `sortMode` for use inside the IntersectionObserver callback and the download-all collection loop, both of which cannot read state without stale-closure issues.

#### URL synchronization

```js
useEffect(() => {
  const current = searchParams.get("sort") === "taken" ? "taken" : "upload";
  if (current === sortMode) return;

  const nextParams = new URLSearchParams(searchParams);
  if (sortMode === "taken") {
    nextParams.set("sort", "taken");
  } else {
    nextParams.delete("sort");
  }
  setSearchParams(nextParams, { replace: true });
}, [searchParams, setSearchParams, sortMode]);
```

The URL silently reflects the active sort without polluting the browser history: `{ replace: true }` updates the URL bar but adds no new history entry. The default `upload` mode keeps the URL clean by removing the param rather than adding `?sort=upload`.

#### Reset and reload behavior

When `sortMode` changes, the category/sort reset `useEffect` fires and issues a full replacement load:

```js
useEffect(() => {
  categoryRef.current = category;
  sortRef.current = sortMode;
  offsetRef.current = 0;
  hasMoreRef.current = true;
  setPhotos([]);
  setHasMore(true);
  setError(null);
  setSelectionMode(false);
  setSelectedPhotoIds(new Set());
  setLightboxIndex(-1);
  doLoad(category, 0, true, sortMode);
}, [category, doLoad, sortMode]);
```

Switching either the category tab or the sort control both take this path. Selection mode is explicitly cleared to avoid stale selections from a previous sort view.

#### Stale-response guard

`doLoad` discards responses that arrive after a sort (or category) switch:

```js
if (cat !== categoryRef.current || sort !== sortRef.current) return;
```

This prevents a slow "upload"-sorted response from overwriting a fast "taken"-sorted grid when the user taps quickly.

#### Segmented sort control (UI)

```jsx
const SORT_MODES = [
  { key: "upload", label: "Upload" },
  { key: "taken", label: "Aufnahme" },
];

<div style={{ display: "inline-flex", border: "1.5px solid #d4c9bc", borderRadius: 999, overflow: "hidden", background: "#fff" }}>
  {SORT_MODES.map((mode) => {
    const active = sortMode === mode.key;
    return (
      <button
        key={mode.key}
        onClick={() => setSortMode(mode.key)}
        style={{
          border: "none",
          minHeight: 46,
          minWidth: 110,
          padding: "10px 16px",
          background: active ? "#8b7355" : "transparent",
          color: active ? "#fff" : "#6b5c4e",
          fontSize: 14,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
        }}
      >
        {mode.label}
      </button>
    );
  })}
</div>
```

Design decisions:
- Segmented pill control (single `<div>` with two `<button>`s sharing a border) avoids the dropdown interaction cost and fits naturally next to the category tabs below it.
- Active segment uses the existing warm-brown theme color (`#8b7355`), consistent with other active controls on the page.
- `minHeight: 46` (just above the 44 px iOS tap target minimum) ensures comfortable mobile tapping.
- `minWidth: 110` gives both labels enough room on small screens.

The sort control is placed **above the category tabs** so it is visible without scrolling on all mobile viewports.

#### sortMode propagation into download-all collection

The download-all flow collects every photo in the current category before creating ZIPs. It now passes `sortRef.current` to the collection fetches:

```js
const data = await fetchPhotos(categoryRef.current, LIMIT, off, sortRef.current);
```

This keeps the download order consistent with the visible sort. Without this, the ZIP would be assembled in upload order even when the user is viewing by Aufnahme order.

---

## Part 2 – Direct Navigation

---

### Overview

Before Phase 8, users navigating from `/upload` to `/photos` (or vice versa) had to return to `/gallery` first. Phase 8 adds a top-right navigation link on each page pointing directly to the other, with QR token preserved.

---

### 1. Upload Page → Photos (`src/pages/UploadPage.js`)

#### withToken helper

```js
const withToken = (path) =>
  token ? `${path}?token=${encodeURIComponent(token)}` : path;
const photosLink = withToken("/photos");
```

`withToken` was introduced as a local function (matching the pattern already used in `GalleryEntryPage.js` and the updated `PhotosPage.js`) to keep token handling explicit and easy to trace.

#### Top bar layout change

`topNav` was updated from a single left-aligned element to a flex row that distributes space between the back link (left) and the new forward link (right):

```js
topNav: {
  maxWidth: 1200,
  margin: "0 auto 16px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
},
```

#### New forward link

```jsx
<Link to={photosLink} style={styles.forwardLinkTop}>
  🖼 Fotos ansehen →
</Link>
```

```js
forwardLinkTop: {
  fontFamily: "'Montserrat', sans-serif",
  fontSize: 14,
  color: "#8a6a49",
  textDecoration: "none",
  fontWeight: 500,
  textAlign: "right",
},
```

The style is identical to `backLinkTop` except for `textAlign: "right"`, keeping visual weight symmetrical in the top bar.

---

### 2. Photos Page → Upload (`src/pages/PhotosPage.js`)

#### withToken helper

```js
const withToken = useCallback(
  (path) => (token ? `${path}?token=${encodeURIComponent(token)}` : path),
  [token]
);
const uploadLink = withToken("/upload");
```

`useCallback` is used here because `withToken` is called during render (not in an effect), and `PhotosPage` already wraps several functions in `useCallback` for consistency.

`setSearchParams` was also added to the `useSearchParams` destructure (needed for URL sort synchronization), making the hook call:

```js
const [searchParams, setSearchParams] = useSearchParams();
```

#### Top bar layout change

The existing back link `<div>` was extended to a flex row:

```jsx
<div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", gap: 12 }}>
  <Link to={backLink} ...>← Zurück zur Übersicht</Link>
  <Link to={uploadLink} ...>📸 Fotos hochladen →</Link>
</div>
```

No existing styling was changed. The `marginBottom` was increased from 18 to 24 to give the two-item nav row slightly more breathing room.

---

### 3. Token Propagation

Both pages use the same pattern:

```js
const token = searchParams.get("token");
const withToken = (path) => token ? `${path}?token=${encodeURIComponent(token)}` : path;
```

| Navigation path | Token handled? |
|---|---|
| `/gallery?token=XYZ` → `/upload?token=XYZ` | ✔ (pre-existing, Phase 5) |
| `/gallery?token=XYZ` → `/photos?token=XYZ` | ✔ (pre-existing, Phase 5) |
| `/upload?token=XYZ` → `/gallery?token=XYZ` | ✔ (pre-existing, Phase 5) |
| `/photos?token=XYZ` → `/gallery?token=XYZ` | ✔ (pre-existing, Phase 5) |
| `/upload?token=XYZ` → `/photos?token=XYZ` | ✔ **new in Phase 8** |
| `/photos?token=XYZ` → `/upload?token=XYZ` | ✔ **new in Phase 8** |

`encodeURIComponent` is applied to the token in both directions to handle any special characters safely.

---

## File Structure After Phase 8

```
backend/
  models.py                      ← MODIFIED: taken_at column added
  services/
    image_processing.py          ← MODIFIED: parse_exif_datetime, extract_taken_at added;
                                              taken_at extracted and persisted in _process_photo
  routers/
    photos.py                    ← MODIFIED: sort query param added; conditional ORDER BY

src/
  services/
    api.js                       ← MODIFIED: fetchPhotos() gains sortMode parameter
  pages/
    PhotosPage.js                ← MODIFIED: sort state, ref, URL sync, segmented control UI,
                                              top-right upload link, sort passed to all fetches
    UploadPage.js                ← MODIFIED: top-right photos link, topNav flex layout,
                                              forwardLinkTop style added
```

---

## End-to-End Data Flow (Sorting)

```
User taps "Aufnahme"
       │
       ▼
setSortMode("taken")
       │
       ├─→ URL: /photos?sort=taken  (replace history entry)
       │
       ▼
useEffect [category, sortMode] fires
  setPhotos([]) + doLoad(category, 0, true, "taken")
       │
       ▼
GET /api/photos?category=guest&limit=50&offset=0&sort=taken
       │
       ▼
Backend: WHERE processing_status='done' AND category='guest'
         ORDER BY taken_at DESC NULLS LAST, created_at DESC, id DESC
       │
       ▼
Photos sorted by EXIF capture date
  (photos without EXIF appear at end, sorted by upload date among themselves)
       │
       ▼
Grid re-renders with new order
```

---

## End-to-End Navigation Flow (Direct Links)

```
/upload?token=XYZ
    ┌────────────────┬─────────────────────────────┐
    │ ← Übersicht   │    🖼 Fotos ansehen →         │  ← top nav bar
    └──────┬─────────┴──────────────┬──────────────┘
           │                        │
           ▼                        ▼
  /gallery?token=XYZ        /photos?token=XYZ

/photos?token=XYZ
    ┌────────────────┬─────────────────────────────┐
    │ ← Übersicht   │    📸 Fotos hochladen →       │  ← top nav bar
    └──────┬─────────┴──────────────┬──────────────┘
           │                        │
           ▼                        ▼
  /gallery?token=XYZ        /upload?token=XYZ
```

---

## Backward Compatibility

| Concern | How handled |
|---|---|
| Existing photos have `taken_at = NULL` | Column is nullable; DB migration is additive only |
| Sorting by `taken` with NULLs | `ORDER BY taken_at DESC NULLS LAST` — NULLs sort after all non-NULL rows |
| Clients not sending `?sort=` | Default `"upload"` — identical behavior to pre-Phase-8 |
| `?sort=` with unknown value | Sanitized to `"upload"` silently |
| Photos uploaded before Phase 8 (no EXIF in DB) | Fully visible in both sort modes; appear at end in `taken` mode |
| Infinite scroll with new sort | `sortRef.current` is always passed to load calls; stale responses discarded by guard |

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Extract EXIF before `exif_transpose()` | `ImageOps.exif_transpose()` may strip EXIF data from the image object; reading it first is the only safe approach |
| `DateTimeOriginal` preferred over `DateTime` | `DateTimeOriginal` is the shutter-press time; `DateTime` is last-modification time and used only as fallback for edited images |
| Single-pass tag collection | Both candidates are collected in one loop iteration; no second pass, no early return |
| Use `TAGS.get(tag) == "DateTimeOriginal"` | Avoids hardcoding integer tag IDs; readable and Pillow-version-safe |
| `taken_at = NULL` for images without EXIF | No error state, no processing failure, no UX noise — just a transparent fallback |
| `NULLS LAST` on `taken_at DESC` | Old photos naturally appear after dated photos; users find new-to-old EXIF content at the top |
| `taken_at` NOT returned in API response | Capture dates in the gallery UI are a separate feature decision; keeping the response stable avoids frontend rework |
| Fallback to `"upload"` for unknown `sort` values | Sort is a UX preference; silent fallback is better than an error for an unrecognised string |
| URL sync with `{ replace: true }` | Sort changes should not pollute back-navigation history; back-button still returns to the previous page, not the previous sort |
| `useCallback` for `withToken` in `PhotosPage` | Consistent with the rest of the component; avoids accidental re-renders if `token` is stable |
| Segmented pill control over dropdown | Lower interaction cost on mobile; state is immediately visible; matches existing tab style language |
| Forward link placed top-right | Visually paired with the left-aligned back link; no scrolling required; aligned with mobile navigation conventions |

---

## Testing Checklist

```
[ ] Upload new photo with EXIF → taken_at stored correctly in DB
[ ] Upload image without EXIF (pure PNG) → taken_at = NULL in DB
[ ] Upload edited image with DateTime but no DateTimeOriginal → taken_at populated from DateTime fallback
[ ] Upload image with both DateTimeOriginal and DateTime → DateTimeOriginal takes precedence
[ ] Sorting "Upload" → photos ordered by created_at DESC (same as before Phase 8)
[ ] Sorting "Aufnahme" → photos ordered by EXIF date, newest first
[ ] Photos without EXIF appear at end when sorting by Aufnahme
[ ] Switching sort mode clears the grid and loads fresh data
[ ] Infinite scroll continues correctly under the active sort mode
[ ] Switching category also fires fresh load with current sort mode preserved
[ ] URL reflects ?sort=taken when Aufnahme is selected; absent for Upload
[ ] Refreshing the page on /photos?sort=taken restores Aufnahme sort correctly
[ ] Download All collects photos in the active sort order
[ ] Upload page has top-right link "🖼 Fotos ansehen →"
[ ] Photos page has top-right link "📸 Fotos hochladen →"
[ ] Both cross-links preserve ?token=... parameter
[ ] Cross-link navigation works when no token is present
[ ] Top nav bar on both pages is not clipped on 375px mobile width
[ ] Back links still navigate to /gallery (unchanged)
[ ] Existing photos (taken_at = NULL) are not broken by the DB migration
```

---

## Non-Goals

- No timezone normalization for EXIF dates (cameras store local time; normalizing is complex and out of scope)
- No display of capture dates in the gallery grid or lightbox
- No reprocessing tool for existing photos (manual `UPDATE` can set `taken_at` if needed)
- No additional sort modes (e.g. uploader name, alphabetical)
- No UI redesign of any existing components

---

## Phase 8 Handoff Notes

The system is now feature-complete for the wedding event. If any post-event work is needed:

- **Reprocess existing photos for EXIF:** Set `processing_status = 'pending'` and `preview_key = NULL`, `thumbnail_key = NULL` on rows that should be reprocessed. The idempotency guard in `_process_photo` checks for `preview_key` presence. `taken_at` will be populated on the reprocess run.
- **Future sort mode:** Add a new key to `SORT_MODES` in `PhotosPage.js` and the corresponding `ORDER BY` branch in `photos.py`. The frontend infrastructure (URL sync, reset, stale-response guard) already handles arbitrary sort modes.
- **Show capture date in gallery:** Add `takenAt` to the API response shape and render it in `PhotoGrid` or `LightboxViewer`.
