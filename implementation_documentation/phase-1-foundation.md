# Phase 1 Implementation – Foundation (Object Storage + Backend Setup)

**Date:** 20. März 2026  
**Phase:** 1 of 7  
**Status:** Complete

---

## Overview

Phase 1 establishes the object storage integration and backend foundation for the wedding photo sharing feature. No frontend UI was built in this phase. The goal was a clean, modular backend that is fully connected to S3-compatible storage and ready for the upload flow in Phase 2.

---

## What Was Built

### 1. Storage Service (`backend/services/storage.py`)

A dedicated, isolated service module that owns all S3 communication. The rest of the application talks to this module rather than to boto3 directly.

**Key design decisions:**
- S3 client is instantiated on each call (stateless) — avoids connection lifecycle issues in a Docker environment
- Missing environment variables raise `EnvironmentError` immediately with a clear message listing which variables are missing, rather than failing silently at call time
- SigV4 signatures are enforced explicitly (`signature_version="s3v4"`) for Hetzner Object Storage compatibility

**Public functions:**

| Function | Purpose |
|---|---|
| `generate_photo_key(category, variant, uuid)` | Builds canonical storage key: `wedding/{category}/{variant}/{uuid}.jpg` |
| `get_file_url(key)` | Returns the permanent public URL for a key (non-expiring) |
| `generate_upload_url(key, content_type)` | Pre-signed PUT URL, expires in 10 minutes |
| `generate_download_url(key)` | Pre-signed GET URL, expires in 1 hour |
| `upload_buffer(key, buffer, content_type)` | Direct server-side upload (reserved for Phase 3 image processing) |
| `check_connection()` | Probes the bucket with `head_bucket`, returns `{status, bucket}` or `{status, error}` |

**Storage key naming convention:**

```
wedding/
  guest/
    original/{uuid}.jpg
    preview/{uuid}.jpg
    thumb/{uuid}.jpg
  photographer/
    original/{uuid}.jpg
    preview/{uuid}.jpg
    thumb/{uuid}.jpg
```

---

### 2. API Router (`backend/routers/storage.py`)

A FastAPI `APIRouter` mounted at `/api/storage`. Contains three endpoints.

#### `POST /api/storage/upload-url`

Generates a pre-signed PUT URL for a client to upload directly to S3.

**Request body:**
```json
{
  "filename": "image.jpg",
  "contentType": "image/jpeg",
  "category": "guest"
}
```

**Response:**
```json
{
  "uploadUrl": "https://...",
  "photoId": "{uuid}",
  "key": "wedding/guest/original/{uuid}.jpg",
  "storageRef": "https://{endpoint}/{bucket}/wedding/guest/original/{uuid}.jpg"
}
```

> **`photoId`** — the UUID used in the storage key. Must be passed to `POST /api/photos` in Phase 2 as the photo primary key. `photoId === uuid used in key` is guaranteed.
>
> **`storageRef`** — a canonical, non-expiring path reference to the file. **Not an access URL.** The bucket is not assumed to be public. To generate an actual access URL, always call `GET /api/storage/download-url?key=...`.

**Validation:**
- `contentType` must be one of: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`
- `category` must be `guest` or `photographer`
- Returns HTTP 400 on invalid input, 503 if S3 is misconfigured, 502 on S3 connection error

**Behavior:** Generates a UUID server-side. The client never chooses the storage key. The key is always `original` variant — preview and thumbnail keys are reserved for Phase 3. The UUID is returned as `photoId` so Phase 2 can use it as the photo's database primary key.

---

#### `GET /api/storage/download-url?key=...`

Generates a pre-signed GET URL for downloading a file.

**Response:**
```json
{
  "downloadUrl": "https://..."
}
```

**Security:** Rejects keys containing `..` or starting with `/` to prevent path-traversal style abuse.

---

#### `GET /api/storage/health`

Probes S3 connectivity. Returns HTTP 200 if the bucket is reachable, HTTP 503 otherwise. Useful for Docker health checks and manual verification.

**Response (healthy):**
```json
{
  "status": "ok",
  "bucket": "wedding-photos"
}
```

---

### 3. Database Model (`backend/models.py`)

Added the `Photo` SQLAlchemy model alongside the existing `Guest` model. The table is auto-created by the existing `init_db()` call on startup.

```sql
CREATE TABLE photos (
  id            UUID        PRIMARY KEY,
  original_url  TEXT        NOT NULL,
  preview_url   TEXT,
  thumbnail_url TEXT,
  category      TEXT        NOT NULL,  -- 'guest' | 'photographer'
  created_at    TIMESTAMP   DEFAULT NOW(),
  uploaded_by   TEXT
);
```

- `preview_url` and `thumbnail_url` are nullable intentionally — they will be populated in Phase 3 (image processing)
- `id` is a server-generated UUID (not auto-increment integer), matching the S3 key naming scheme
- No foreign keys — schema is intentionally simple for MVP

---

### 4. Dependency (`backend/requirements.txt`)

Added `boto3` — the official AWS SDK, compatible with all S3-compatible object storage including Hetzner.

---

### 5. Main App Wiring (`backend/main.py`)

Registered the storage router:

```python
from routers.storage import router as storage_router
app.include_router(storage_router)
```

No other changes to existing application logic.

---

### 6. Docker Compose (`docker-compose.yml`)

The backend service now receives S3 credentials via environment variable injection from the host `.env` file:

```yaml
environment:
  DATABASE_URL: postgresql://postgres:password@db:5432/hochzeit_db
  S3_ENDPOINT: ${S3_ENDPOINT}
  S3_ACCESS_KEY: ${S3_ACCESS_KEY}
  S3_SECRET_KEY: ${S3_SECRET_KEY}
  S3_BUCKET_NAME: ${S3_BUCKET_NAME}
  S3_REGION: ${S3_REGION:-eu-central}
```

`S3_REGION` defaults to `eu-central` if not set.

---

### 7. Environment Variable Template (`.env.example`)

Added S3 configuration section:

```env
# Object Storage (S3-compatible – Hetzner Object Storage)
S3_ENDPOINT=https://<region>.your-objectstorage.com
S3_ACCESS_KEY=your_access_key_here
S3_SECRET_KEY=your_secret_key_here
S3_BUCKET_NAME=your_bucket_name_here
S3_REGION=eu-central
```

---

## File Structure After Phase 1

```
backend/
  services/
    __init__.py
    storage.py          ← NEW: S3 client, presigned URLs, key generation
  routers/
    __init__.py
    storage.py          ← NEW: /api/storage endpoints
  main.py               ← MODIFIED: registers storage_router
  models.py             ← MODIFIED: added Photo model
  requirements.txt      ← MODIFIED: added boto3
  database.py           (unchanged)
  Dockerfile            (unchanged)
docker-compose.yml      ← MODIFIED: S3 env vars injected into backend
.env.example            ← MODIFIED: S3 variables documented
```

---

## How to Run

### 1. Set up environment variables

Copy `.env.example` to `.env` and fill in your Hetzner Object Storage credentials:

```env
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_ACCESS_KEY=<your-key>
S3_SECRET_KEY=<your-secret>
S3_BUCKET_NAME=wedding-photos
S3_REGION=eu-central
```

### 2. Start the stack

```bash
docker-compose up --build
```

The `photos` table is created automatically on startup.

### 3. Verify the storage connection

```bash
curl http://localhost:8000/api/storage/health
```

Expected: `{"status": "ok", "bucket": "wedding-photos"}`

---

## Manual Testing Walkthrough

### Step 1 – Request an upload URL

```bash
curl -X POST http://localhost:8000/api/storage/upload-url \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.jpg", "contentType": "image/jpeg", "category": "guest"}'
```

Save the returned `uploadUrl` and `key`.

### Step 2 – Upload a file directly to S3

```bash
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/test.jpg
```

A successful upload returns HTTP 200 with an empty body.

### Step 3 – Request a download URL

```bash
curl "http://localhost:8000/api/storage/download-url?key=<key>"
```

### Step 4 – Download the file

Open the returned `downloadUrl` in a browser or with curl. The file should be served.

---

## Post-Implementation Fixes

Two gaps were identified and resolved after initial implementation:

### Fix 1 – Return `photoId` in upload-url response

**Problem:** The UUID was generated internally but not returned. Phase 2 needs this UUID as the photo primary key when calling `POST /api/photos` to register the upload.

**Fix:** `photoId` is now included in the response, with the guarantee that `photoId === uuid used in key`.

### Fix 2 – Rename `fileUrl` → `storageRef` and clarify semantics

**Problem:** `fileUrl` was constructed as `{endpoint}/{bucket}/{key}`, implying it is a usable access URL. However the system uses pre-signed URLs — the bucket is not necessarily public. Using `fileUrl` as an access URL would silently fail on private buckets.

**Fix:** Field renamed to `storageRef` to make clear it is a canonical storage path reference, not an access URL. A code comment reinforces this:

```python
# storageRef is a canonical (non-expiring) path reference — NOT an access URL.
# Always use GET /api/storage/download-url?key=... to generate an access URL.
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Python/boto3 instead of Node.js `@aws-sdk` | Backend is FastAPI — using the native AWS SDK for Python |
| Stateless S3 client (created per call) | Simpler lifecycle management in Docker; connection pooling is handled by boto3 internally |
| UUID generated server-side | Prevents key collisions; client has no influence over storage paths |
| `original` variant only at upload time | Preview and thumbnail keys follow the same UUID — populated by server-side processing in Phase 3 |
| `upload_buffer` stub in service | Clean interface prepared for Phase 3 without any implementation cost now |
| Key validation in download endpoint | Prevents path-traversal abuse (`..`, leading `/`) without requiring authentication |
| Nullable `preview_url` / `thumbnail_url` | Schema is forward-compatible — rows created in Phase 2 are valid and can be enriched in Phase 3 |
| `photoId` in upload-url response | UUID returned explicitly so Phase 2 can use it as the DB primary key without re-parsing the key string |
| `storageRef` instead of `fileUrl` | Signals clearly that the field is a path reference, not an access URL; avoids silent failures on private buckets |

---

## What Is NOT in Phase 1

The following are explicitly deferred to later phases:

- Image processing (thumbnails, previews, EXIF rotation) → **Phase 3**
- Frontend upload UI → **Phase 2**
- Photo registration in the DB after upload → **Phase 2**
- Authentication / QR token login → **Phase 4**
- Gallery browsing endpoints → **Phase 4**
- ZIP download → **Phase 6**

---

## Phase 2 Handoff Notes

Phase 2 (Upload Flow) can build directly on this foundation:

- Use `POST /api/storage/upload-url` to get a pre-signed PUT URL
- After the direct S3 upload succeeds, call `POST /api/photos` (to be built in Phase 2) with `photoId` from the response as the photo's primary key; also pass `key` and `category`
- **Do not** use `storageRef` as an access URL — always call `GET /api/storage/download-url?key=...` to get a readable URL
- `preview_url` and `thumbnail_url` can remain `NULL` until Phase 3 processes the image
