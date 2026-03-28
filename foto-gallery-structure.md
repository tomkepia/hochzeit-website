# Wedding Photo Sharing – Technical Sketch

## 1. Overview

This document outlines a minimal, scalable architecture for a wedding photo sharing feature integrated into an existing React + Postgres + Docker + Hetzner VPS setup.

---

## 2. System Architecture

### Components

- **Frontend (React)**
  - Entry Page (`/gallery`)
  - Upload Page
  - Gallery Page

- **Backend (API)**
  - Auth (existing + token-based, optional)
  - Upload handling (pre-signed URLs)
  - Photo metadata management
  - Image processing (async)
  - Signed URL generation
  - ZIP streaming for downloads

- **Storage**
  - Object Storage (S3-compatible, e.g. Hetzner Object Storage)

---

## 3. User Flows

### 3.1 Access

#### Option A: Logged-in User
- User logs into existing system
- Navigates to `/gallery`

#### Option B: QR Code Access
- QR Code → `https://app.com/gallery?token=XYZ`
- Token is propagated through routes
- Backend validation happens in later phase

---

### 3.2 Main Navigation

```

/gallery
├── Upload Photos (/upload)
└── View Photos (/photos)

```

---

## 4. Frontend Structure

### Routing

- `/gallery` → entry page
- `/upload` → upload flow
- `/photos` → gallery

---

### Pages

#### `/gallery`
- Two actions:
  - "Upload Photos"
  - "View Photos"
- Token propagation (`?token=...`)

---

#### `/upload`
- Multi-file upload
- Mobile-friendly file picker
- Upload progress (per file)
- Optional name field
- Direct upload to object storage

---

#### `/photos`
- Tabs:
  - Photographer Photos
  - Guest Photos
- Grid layout (thumbnails)
- Infinite scroll (offset-based)
- Lightbox view (preview images)
- Multi-select (Phase 6)
- "Download All" button (Phase 6)

---

### Image Usage

- Grid → thumbnails (~300px)
- Lightbox → previews (~1200px)
- Download → originals (full resolution)

---

## 5. Backend API Design

---

### Auth (Optional / Future)

```

POST /api/auth/token-login
body: { token }

```

---

### Upload Flow (Pre-Signed URLs)

#### Step 1: Request Upload URL

```

POST /api/storage/upload-url

````

Request:
```json
{
  "filename": "image.jpg",
  "contentType": "image/jpeg",
  "category": "guest"
}
````

Response:

```json
{
  "uploadUrl": "...",
  "photoId": "uuid",
  "key": "wedding/guest/original/{uuid}.jpg",
  "extension": "jpg"
}
```

---

#### Step 2: Upload directly to Object Storage

* Client uploads via `PUT uploadUrl`

---

#### Step 3: Register Photo

```
POST /api/photos
```

Request:

```json
{
  "photoId": "uuid",
  "key": "wedding/guest/original/{uuid}.jpg",
  "category": "guest",
  "uploadedBy": "optional"
}
```

Behavior:

* Stores metadata
* Sets:

  * `processing_status = "pending"`
* Triggers async processing

---

#### Step 4: Image Processing (Async)

* Download original from storage
* Fix EXIF rotation
* Convert to JPEG (if needed, e.g. HEIC)
* Generate:

  * preview (~1200px)
  * thumbnail (~300px)
* Upload derived variants
* Update DB:

  * `preview_url`
  * `thumbnail_url`
  * `processing_status = "done"`

---

### Fetch Photos

```
GET /api/photos?category=guest&limit=50&offset=0
```

Behavior:

* Filter:

```sql
processing_status = 'done'
```

* Return:

  * signed URLs (NOT raw storage URLs)

Response:

```json
{
  "photos": [
    {
      "id": "uuid",
      "thumbnailUrl": "...signed...",
      "previewUrl": "...signed...",
      "originalUrl": "...signed...",
      "uploadedBy": "...",
      "createdAt": "..."
    }
  ],
  "hasMore": true
}
```

---

### Download

#### Single

* Direct via signed URL (`originalUrl`)

---

#### Multi (ZIP)

```
POST /api/photos/download-zip
body: { photoIds: [] }
```

Constraints:

* Max **100 photos per request**

Implementation:

* Stream ZIP (no full memory buffer)

---

### Download All

* Button: "Download All"
* Behavior:

  * ≤100 → single ZIP
  * > 100 → multiple ZIPs (batched)

---

## 6. Database Schema

### Table: photos

```
id                UUID
original_key      TEXT
original_url      TEXT
preview_url       TEXT
thumbnail_url     TEXT
category          TEXT
created_at        TIMESTAMP
uploaded_by       TEXT
processing_status TEXT
processing_error  TEXT
```

---

### Table: access_tokens

```
id            UUID
token         TEXT
expires_at    TIMESTAMP
permissions   TEXT
```

---

## 7. Storage Strategy

### Object Storage (S3-compatible)

* Store:

  * Original images
  * Preview images
  * Thumbnails

* Access via signed URLs only

---

### Naming Convention

```
wedding/
  guest/
    original/{uuid}.{ext}
    preview/{uuid}.jpg
    thumb/{uuid}.jpg
  photographer/
    original/{uuid}.{ext}
    preview/{uuid}.jpg
    thumb/{uuid}.jpg
```

---

## 8. Frontend Libraries

### Upload

* `uppy` (optional)
* or custom implementation (current)

### Gallery

* `yet-another-react-lightbox`

---

## 9. Image Handling

### Required

* Thumbnail (~300px)
* Preview (~1200px)
* HEIC → JPEG conversion
* EXIF rotation fix

---

## 10. Performance Considerations

* Lazy loading for images
* Infinite scroll
* Direct-to-storage upload
* Backend-generated signed URLs (no per-image requests)
* No CDN required

---

## 11. Security Considerations

* Expiring QR tokens
* File type validation
* Upload size limits
* Key validation (no path traversal)

---

## 12. Deployment

### Current Setup

* Docker on VPS

### Additions

* Object Storage bucket
* Environment variables for S3

---

## 13. MVP Scope

### Included

* Upload photos
* Async image processing
* Gallery with thumbnails + previews
* Signed URL delivery
* QR-based access (structural)
* Photographer vs Guest separation

### Next (Phase 6)

* Multi-select download
* ZIP download (max 100)
* Download All

---

## 14. Suggested Implementation Order (Updated)

1. Object storage integration ✔
2. Upload flow ✔
3. Image processing ✔
4. Photo API ✔
5. Gallery UI ✔
6. Routing ✔
7. Download features (current focus)
8. UX polish

---

## 15. Possible Extensions

* Async ZIP generation
* WebP/AVIF variants
* Face recognition
* Slideshow mode
