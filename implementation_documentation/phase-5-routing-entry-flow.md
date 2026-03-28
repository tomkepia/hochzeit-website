# Phase 5 Implementation – Routing & Entry Flow (Navigation Integration)

**Date:** 26. März 2026  
**Phase:** 5 of 7  
**Status:** Complete  
**Builds on:** Phase 4 (Gallery)

---

## Overview

Phase 5 connects the already-built upload and gallery experiences into a clear, mobile-first user flow.

Before this phase:
- `/upload` worked (Phase 2)
- `/photos` worked (Phase 4)
- there was no dedicated entry page connecting both actions

After this phase:
- `/gallery` is the photo feature entry point
- users get exactly two clear choices:
  - upload photos
  - view photos
- `/upload` and `/photos` both include back navigation to `/gallery`

---

## What Was Built

### 1. New Entry Page: `/gallery`

**File:** [src/pages/GalleryEntryPage.js](src/pages/GalleryEntryPage.js)

A new standalone page was added as the photo-flow entry point.

#### Purpose

Provide a zero-confusion decision screen with only two actions:
1. `📸 Fotos hochladen` → `/upload`
2. `🖼 Fotos ansehen` → `/photos`

#### Layout and UX

- Centered card with warm wedding theme colors
- Mobile-first vertical layout
- Full-width buttons with large tap targets (`minHeight: 58`)
- No additional complexity (no filters, no extra nav)

#### Token compatibility (QR strategy support)

The page reads `?token=...` and forwards it when navigating:

```js
const token = searchParams.get("token");
const withToken = (path) => (token ? `${path}?token=${encodeURIComponent(token)}` : path);
```

This keeps the page compatible with a QR target like:

```text
/gallery?token=XYZ
```

No auth logic is implemented in Phase 5 (intentionally).

---

### 2. Routing Integration

**File:** [src/App.js](src/App.js)

Added the new route:

```jsx
<Route path="/gallery" element={<GalleryEntryPage />} />
```

Also added import:

```jsx
import GalleryEntryPage from "./pages/GalleryEntryPage";
```

#### Routing decision used

The phase prompt suggested two options for `/`:
- Option A: redirect `/` → `/gallery`
- Option B: keep existing homepage and add `/gallery`

Implemented choice: **Option B**.

Rationale:
- Existing wedding homepage flow remains intact
- Photo flow is now available via dedicated `/gallery`
- No regression risk to the established main site entry path

---

### 3. Back Navigation on `/upload`

**File:** [src/pages/UploadPage.js](src/pages/UploadPage.js)

Added a top-left back link above page content:

```text
← Zurück zur Übersicht
```

Target:

```text
/gallery?token=XYZ (if token exists), otherwise /gallery
```

Additional update:
- Footer back link was also updated from `/` to `/gallery` for consistency
- Both back links preserve `?token=` when present

Implementation uses router-native navigation (`Link`) instead of plain `<a>`.

---

### 4. Back Navigation on `/photos`

**File:** [src/pages/PhotosPage.js](src/pages/PhotosPage.js)

Added a top-left back link above the page header:

```text
← Zurück zur Übersicht
```

Target:

```text
/gallery?token=XYZ (if token exists), otherwise /gallery
```

This removes dead-end navigation and aligns with the intended flow:

```text
/gallery -> /photos -> /gallery
```

---

## Final Navigation Structure

```text
/gallery
  ├── /upload
  └── /photos
```

Implemented routes now relevant to photo flow:
- `/gallery` (new entry page)
- `/upload` (existing upload flow)
- `/photos` (existing gallery flow)

---

## File Structure After Phase 5

```text
src/
  App.js                        ← MODIFIED: /gallery route added
  pages/
    GalleryEntryPage.js         ← NEW: entry page for upload/view split
    UploadPage.js               ← MODIFIED: back links now target /gallery
    PhotosPage.js               ← MODIFIED: top-left back link to /gallery
```

---

## User Flow — End-to-End

```text
User scans QR or opens /gallery
        │
        ▼
GalleryEntryPage
  ├─ "📸 Fotos hochladen" → /upload
  │      └─ back: /gallery
  │
  └─ "🖼 Fotos ansehen"  → /photos
         └─ back: /gallery
```

If QR token is present:

```text
/gallery?token=XYZ
   ├─ upload button -> /upload?token=XYZ
   └─ view button   -> /photos?token=XYZ
```

---

## Accessibility & Mobile Notes

- Entry actions are semantic `<button>` elements (keyboard-accessible)
- Buttons are full-width on mobile
- Tap targets are large (`minHeight >= 56px` requirement satisfied)
- Vertical spacing and centered layout improve one-hand phone use

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Dedicated `/gallery` entry page | Creates a single, obvious starting point for all photo actions |
| Exactly two CTAs | Enforces zero-confusion UX and avoids feature clutter |
| Keep `/` unchanged (Option B) | Preserves existing wedding homepage behavior; reduces regression risk |
| Add back links on both `/upload` and `/photos` | Eliminates dead ends and keeps navigation reversible |
| Forward `?token=` to child routes | Makes QR strategy future-proof without adding auth coupling in this phase |
| Preserve `?token=` in back links | Keeps QR token context intact when users return from `/upload` or `/photos` |
| Use `Link` / `navigate` instead of `<a>` | Keeps SPA navigation fast and avoids full page reloads |

---

## Definition of Done Check

- [x] `/gallery` exists and loads
- [x] Entry page has two clear actions (upload + view)
- [x] `/gallery -> /upload` navigation works
- [x] `/gallery -> /photos` navigation works
- [x] `/upload` has back navigation to `/gallery`
- [x] `/photos` has back navigation to `/gallery`
- [x] Layout is mobile-first and tap-friendly
- [x] QR-compatible entry route (`/gallery?token=...`) works structurally
- [x] No backend changes required

---

## Testing Checklist

```text
[ ] Open /gallery directly -> page renders correctly
[ ] Tap "📸 Fotos hochladen" -> navigates to /upload
[ ] Tap "🖼 Fotos ansehen" -> navigates to /photos
[ ] In /upload, click top back link -> returns to /gallery
[ ] In /photos, click top back link -> returns to /gallery
[ ] In /upload, footer back link -> returns to /gallery
[ ] Mobile viewport (e.g. 390x844): buttons are full-width and easy to tap
[ ] Open /gallery?token=XYZ -> navigation preserves token to /upload or /photos
[ ] No dead-end routes in photo flow
```

---

## Non-Goals (unchanged)

Not implemented in Phase 5:
- Authentication logic or token validation
- New backend endpoints
- ZIP download features (Phase 6)
- Visual redesign of existing upload/gallery components

---

## Phase 6 Handoff Notes

Phase 6 (Download Features) can now build on a complete navigation flow:

- users can reliably reach `/photos` through `/gallery`
- users can return to `/gallery` from all photo pages
- token path continuity exists at route level (`/gallery?token=...` forwarding)

Recommended Phase 6 focus:
1. Single image download UX polish in lightbox (already functional)
2. Multi-select state in `/photos`
3. `POST /api/photos/download-zip` with max 100 photos enforcement
4. "Download All" behavior with batching when >100 photos
