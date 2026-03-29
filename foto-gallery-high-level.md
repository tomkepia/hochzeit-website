# Wedding Photo Sharing – High-Level Implementation Plan

## 1. Objective

Build a simple, robust, and mobile-friendly photo sharing feature for a wedding website that allows:

- Guests to upload photos easily (via login or QR access)
- Guests to browse and download photos
- Separation between guest and photographer images
- Efficient handling of large image volumes (performance-first)

---

## 2. Guiding Principles

- **Simplicity over overengineering** (short-lived system)
- **Mobile-first UX**
- **Performance via image derivations (thumbnails + previews)**
- **Direct-to-storage uploads (avoid backend bottlenecks)**
- **Clear separation of concerns (frontend, backend, storage)**
- **Format compatibility over purity (HEIC supported, but converted for display)**
- **Backend-driven access (signed URLs, no direct storage exposure)**

---

## 3. System Overview

### Core Components

- **Frontend (React)**
  - Upload flow
  - Gallery browsing
  - Download interactions

- **Backend (API)**
  - Auth (existing + QR token)
  - Upload orchestration
  - Metadata management
  - Image processing (conversion + resizing)
  - Signed URL generation
  - ZIP streaming

- **Storage (Object Storage)**
  - Stores all image variants
  - Accessed via signed URLs only (no public access assumption)

---

## 4. Core Features (MVP)

### 4.1 Access & Authentication

- Existing login support
- QR-based access via token:
  - Auto-login (future phase)
  - Scoped permissions (upload/view)
  - Expiry support
- Token propagation across routes (`/gallery → /upload → /photos`)

---

### 4.2 Photo Upload

- Multi-file upload (mobile optimized)
- Direct upload to object storage (pre-signed URLs)
- Backend registers uploaded files

#### Image Processing (critical)

- Generate:
  - Thumbnail (~300px, JPEG)
  - Preview (~1200px, JPEG)
- Fix EXIF rotation
- Apply compression

#### HEIC Handling (important)

- Users can upload HEIC/HEIF images
- Original file is stored unchanged
- Backend converts HEIC → JPEG for:
  - Preview
  - Thumbnail

👉 Ensures:
- Full browser compatibility
- High-quality original preserved for download

---

### 4.3 Gallery Browsing

- Two categories:
  - Guest photos
  - Photographer photos

- UI behavior:
  - Grid view → thumbnails (JPEG)
  - Lightbox → preview images (JPEG)
  - Infinite scroll (offset-based pagination)

#### Visibility Rules

- Only show:
```text
processing_status = "done"
````

* Hide:

  * pending
  * processing
  * failed

---

### 4.4 Download

#### Single Download

* Direct via signed URL (original format)

#### Multi Download

* Select multiple images
* Limit: **max 100 images per request**

#### Download All (required)

* If ≤100 images → single ZIP
* If >100 images → batched downloads

#### Backend Behavior

* Stream ZIP files (no full in-memory build)
* No async job system (MVP scope)

---

## 5. Data Model (Conceptual)

### Photo Entity

* ID (UUID)
* original_key (canonical reference)
* original_url (derived, optional)
* preview_url (JPEG)
* thumbnail_url (JPEG)
* category (guest / photographer)
* created_at
* uploaded_by (optional)
* processing_status (`pending | processing | done | failed`)
* processing_error (optional)

### Access Token

* token
* permissions
* expiry

---

## 6. Storage Strategy

* Use S3-compatible Object Storage (Hetzner)

### Stored Variants

* **Original**

  * Format: original upload (HEIC/JPEG/PNG)
  * Used for: download

* **Preview**

  * Format: JPEG
  * Used for: lightbox

* **Thumbnail**

  * Format: JPEG
  * Used for: gallery grid

### Key Format

```
wedding/{category}/{variant}/{uuid}.{ext}
```

Where:

* original → keeps original extension
* preview → `.jpg`
* thumb → `.jpg`

---

## 7. Performance Strategy

* Use thumbnails in grid view
* Load previews only when needed
* Lazy loading + infinite scroll
* Backend returns signed URLs (no client-side fetch per image)
* No CDN required (Germany-only audience)

---

## 8. Frontend Architecture

* Routing (`react-router-dom`)

  * `/gallery` (entry point)
  * `/upload`
  * `/photos`

* State handling:

  * Upload state (progress, errors)
  * Gallery pagination (offset + hasMore)
  * Selection state for downloads (Phase 6)

---

## 9. Backend Responsibilities

* Token validation (future phase)
* Generate pre-signed upload URLs
* Generate signed download URLs (for gallery)
* Register photos in DB
* Process images (resize + HEIC → JPEG conversion)
* Filter processed images for gallery
* Handle ZIP streaming for downloads
* Enforce limits (e.g. max 100 images per ZIP)

---

## 10. Implementation Phases

### Phase 1: Foundation ✔

* Object storage integration
* Backend S3 client setup
* Basic DB schema

---

### Phase 2: Upload Flow ✔

* Pre-signed upload URLs
* Frontend upload UI
* Backend photo registration
* Extension-aware storage keys

---

### Phase 3: Image Processing ✔

* Pillow + pillow-heif integration
* HEIC → JPEG conversion
* Thumbnail + preview generation
* Async processing with background threads
* Processing status tracking

---

### Phase 4: Gallery ✔

* Backend photo listing (filtered + paginated)
* Signed URLs returned directly
* Grid + lightbox UI
* Infinite scroll

---

### Phase 5: Routing ✔

* `/gallery` entry page
* Navigation between upload and gallery
* Back navigation
* QR token propagation

---

### Phase 6: Download Features (NEXT)

* Multi-select in gallery UI
* Selection UX (toggle/select mode)
* `POST /api/photos/download-zip`
* ZIP streaming with max 100 images
* "Download All" logic (batched)

---

### Phase 7: UX Improvements

* Loading states
* Error handling polish
* Mobile optimization
* Optional signed URL refresh on long sessions

---

## 11. Risks & Trade-offs

### Accepted Trade-offs

* No CDN (simpler setup)
* No async ZIP generation (MVP simplicity)
* No AI features initially
* No background job system (threads instead)

### Potential Risks

* HEIC processing requires system dependencies (libheif)
* Many concurrent uploads → multiple threads
* Large ZIP downloads → mitigated via limits

---

## 12. Out of Scope (for now)

* Face recognition
* Moderation pipelines
* Social features (likes/comments)
* Multi-region scaling

---

## 13. Success Criteria

* Guests can upload photos within seconds (including HEIC)
* Gallery loads quickly on mobile
* Images display correctly across all browsers
* Downloads work reliably (single + batch)
* System remains stable during peak usage (event day)

---

## 14. Key Architectural Decisions

* Object storage over VPS storage
* Thumbnails + previews required
* Pre-signed uploads (no backend file handling)
* Signed URLs generated in backend (no client-side fetching)
* HEIC supported but converted for display
* Async image processing via threads
* ZIP streaming (not in-memory)
* Download limits enforced (100 images)

---

## 15. Future Extensions (Optional)

* Async ZIP generation for large sets
* WebP/AVIF image variants
* CDN integration if usage grows
* Face recognition search

