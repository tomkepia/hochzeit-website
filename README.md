# Hochzeit Website — Tomke & Jan-Paul 2026

A wedding website for Tomke & Jan-Paul's wedding (09. Mai 2026). Guests can RSVP, view event information, upload photos directly from their phones, and browse or download the full photo gallery as ZIP archives. An admin panel lets the couple manage all RSVPs.

Built with a React frontend, FastAPI backend, PostgreSQL database, S3-compatible photo storage, and an Nginx reverse proxy — all containerized with Docker.

---

## Table of Contents

- [General Architecture](#general-architecture)
- [Project Structure](#project-structure)
- [Frontend](#frontend)
  - [Pages & Routes](#pages--routes)
  - [Authentication](#authentication)
  - [Components](#components)
- [Backend](#backend)
  - [API Endpoints](#api-endpoints)
  - [Storage API](#storage-api)
- [Database](#database)
  - [DB Schemas](#db-schemas)
- [Infrastructure & Deployment](#infrastructure--deployment)
  - [Docker Services](#docker-services)
  - [Nginx Routing](#nginx-routing)
  - [Environment Variables](#environment-variables)
- [Local Development](#local-development)

---

## General Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                           │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────────────┐
│              Nginx Reverse Proxy (:80/:443)              │
│  /          → frontend (React SPA)                       │
│  /api/*     → backend FastAPI (:8000)                    │
└──────────┬──────────────────────┬───────────────────────┘
           │                      │
┌──────────▼──────────┐  ┌────────▼────────────────────────┐
│  Frontend (nginx)   │  │  Backend (FastAPI / uvicorn)     │
│  React 19 SPA       │  │  Python 3.11                     │
│  served as static   │  │  SQLAlchemy ORM                  │
│  files              │  │  boto3 (S3 client)               │
└─────────────────────┘  └────────┬────────────────────────┘
                                  │
              ┌───────────────────┴────────────────┐
              │                                    │
   ┌──────────▼──────────┐           ┌─────────────▼──────────┐
   │  PostgreSQL 15       │           │  S3-compatible Storage  │
   │  guest table         │           │  (photo uploads)        │
   │  photos table        │           │                         │
   │  access_tokens table │           │                         │
   └─────────────────────┘           └────────────────────────┘
```

**Tech Stack**

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router v6, Framer Motion, lucide-react, yet-another-react-lightbox |
| Backend | FastAPI, SQLAlchemy, Pydantic, uvicorn, requests, zipstream-ng |
| Database | PostgreSQL 15 |
| Object storage | S3-compatible (Hetzner / AWS / MinIO) via boto3 |
| Proxy | Nginx (reverse proxy + SSL termination) |
| Containerization | Docker, Docker Compose |

---

## Project Structure

```
hochzeit-website/
├── Dockerfile                  # Frontend multi-stage build (React → nginx)
├── nginx-frontend.conf         # nginx config for serving the React SPA
├── docker-compose.yml          # Local development compose file
├── docker-compose.prod.yml     # Production compose file (with nginx + certbot)
├── package.json                # Frontend dependencies & scripts
├── public/                     # Static HTML shell for React
├── src/                        # React source code
│   ├── App.js                  # Root component, client-side routing
│   ├── services/
│   │   └── api.js              # API communication (upload flow with retry, gallery list, ZIP downloads)
│   ├── pages/
│   │   ├── MainPage.js         # Guest-facing page (password-gated)
│   │   ├── AdminPage.js        # Admin dashboard (admin-password-gated)
│   │   ├── UploadPage.js       # Photo upload page (/upload)
│   │   ├── GalleryEntryPage.js # Photo-flow entry point (/gallery)
│   │   └── PhotosPage.js       # Photo gallery with infinite scroll + selection downloads (/photos)
│   └── components/
│       ├── PasswordGate.js     # Guest login gate (localStorage-based)
│       ├── AdminPasswordGate.js# Admin login gate (localStorage-based)
│       ├── Navbar.js           # Navigation bar with scroll links
│       ├── Hero.js             # Wedding countdown hero section
│       ├── InfoSection.js      # Event info (dates, location, schedule)
│       ├── RSVPForm.js         # Multi-person RSVP submission form
│       ├── UploadArea.js       # Drag & drop upload UI with progress tracking
│       ├── PhotoGrid.js        # Responsive thumbnail grid (browse + selection overlay)
│       ├── LightboxViewer.js   # Fullscreen photo viewer (swipe, download, captions)
│       ├── AdminDashboard.js   # Full guest management UI
│       └── GuestTable.js       # Sortable/editable guest table
├── backend/
│   ├── Dockerfile              # Python 3.11 slim container
│   ├── requirements.txt        # Python dependencies
│   ├── main.py                 # FastAPI app, core RSVP + admin endpoints
│   ├── database.py             # SQLAlchemy engine & session factory
│   ├── models.py               # ORM models (Guest, Photo, AccessToken)
│   ├── routers/
│   │   ├── auth.py             # /api/auth/* endpoints (token-login, password-login)
│   │   ├── storage.py          # /api/storage/* endpoints
│   │   └── photos.py           # /api/photos endpoints (register, list, ZIP download)
│   └── services/
│       ├── storage.py          # S3 client logic (presigned URLs, upload)
│       └── image_processing.py # Async thumbnail/preview generation (Pillow + HEIC)
└── nginx/
    ├── nginx.conf              # Main nginx config (gzip, rate limits, headers)
    └── conf.d/
        └── default.conf        # Virtual host: HTTP→HTTPS redirect + proxy rules
```

---

## Frontend

### Pages & Routes

Client-side routing is handled by **React Router v6** in [src/App.js](src/App.js).

| Path | Component | Description |
|---|---|---|
| `/` | `MainPage` | Public wedding site (password-gated) |
| `/admin` | `AdminPage` | Admin dashboard (separate admin password) |
| `/upload` | `UploadPage` | Photo upload page (drag & drop, multi-file, progress) |
| `/gallery` | `GalleryEntryPage` | Photo-flow entry point — routes guests to `/upload` or `/photos` |
| `/photos` | `PhotosPage` | Photo gallery with infinite scroll, category tabs, sort control (by upload time or EXIF capture date), lightbox viewer, multi-select mode, and batched ZIP downloads |

#### Main Page (`/`)

Renders sections in order on a single scrollable page:
1. **Hero** — wedding names, date, live countdown timer
2. **InfoSection** — event dates, location, schedule, accommodation details
3. **RSVPForm** — multi-person RSVP form
4. **Footer**

#### Admin Page (`/admin`)

Renders the `AdminDashboard` component inside an `AdminPasswordGate`. Provides full CRUD over guest records plus Excel export.

---

### Authentication

The application uses **two separate authentication systems**: a backend-validated token system for the photo gallery, and a client-side gate for the main wedding page and admin panel.

#### Gallery Authentication (Backend-Enforced)

All photo gallery API endpoints (`/api/photos/*`, `/api/storage/upload-url`, `/api/storage/download-url`) require a valid Bearer token. The token is validated against the `access_tokens` database table on every request.

**Two entry paths — identical session model:**

| Path | How it works |
|---|---|
| **QR Code** | Scanning a QR code opens `/gallery?token=XYZ`. The frontend calls `POST /api/auth/token-login`, and on success stores the token in `localStorage`. |
| **Password** | Typing the gallery password on `/` calls `POST /api/auth/password-login`. The backend validates the password via the `GALLERY_PASSWORD` env var and returns the active DB token. The frontend stores it in `localStorage`. |

After either flow the browser state is identical: a validated token in `localStorage`, and all subsequent API calls include `Authorization: Bearer <token>`.

**localStorage keys used by the gallery:**

| Key | Value | Purpose |
|---|---|---|
| `galleryToken` | `<64-hex-char token>` | Sent as Bearer token on all gallery API calls |
| `galleryAccess` | `"true"` | Route guard flag checked on page load |
| `sessionStart` | timestamp | 30-minute UX session timer on the main page |

**Session lifecycle:**

| Event | Result |
|---|---|
| User scans valid QR code | Token validated → stored → gallery accessible |
| User types correct password | Backend validates → token returned → stored → navigate to `/gallery` |
| User scans expired / invalid QR code | 401 from backend → error shown on `/gallery` page |
| User types wrong password | 401 from backend → error shown on form |
| Token expires mid-session | Next API call returns 401 → `localStorage` cleared → redirect to `/` |
| 30-minute session timer fires | `galleryAccess` + `galleryToken` cleared → redirect to password form |

#### Guest Password Gate (`PasswordGate`)

Shown on the main wedding page (`/`). Validates the gallery password via the backend (no password in source code).

| Detail | Value |
|---|---|
| Password source | `GALLERY_PASSWORD` env var (backend only) |
| Session duration | 30 minutes (UX timer, independent of token expiry) |
| Check interval | Every 10 seconds |

#### Admin Password Gate (`AdminPasswordGate`)

Purely client-side gate for the admin dashboard (`/admin`). No changes from the original implementation.

| Detail | Value |
|---|---|
| Password source | `process.env.REACT_APP_ADMIN_PASSWORD` (fallback: `admin2025`) |
| Storage keys | `adminAuthenticated`, `adminSessionStart` |
| Session duration | 60 minutes |
| Check interval | Every 30 seconds |

> **Security note**: The gallery password is validated server-side only — it is not present in the JS bundle. Admin routes should still be protected at the nginx level (IP allowlist) in production.

---

### Components

| Component | Key Responsibilities |
|---|---|
| `Hero` | Shows couple's names, wedding date, and a live `setInterval`-driven countdown |
| `InfoSection` | Static event information (dates, address, schedule, accommodation) |
| `RSVPForm` | Manages an array of person entries; POSTs one `/api/rsvp` request per person |
| `UploadArea` | Drag & drop upload zone; per-file progress bars; concurrency (4 parallel); retry on failure |
| `PhotoGrid` | Responsive `auto-fill` thumbnail grid; square cells with `object-fit: cover`; lazy loading; selection overlay mode with checkmark indicator and amber outline |
| `LightboxViewer` | Fullscreen viewer (yet-another-react-lightbox); swipe/keyboard nav; one-tap original download; uploader caption; 2-slide preload |
| `Navbar` | Scroll-based navigation; calls `ref.scrollIntoView()` on section refs passed from `MainPage` |
| `AdminDashboard` | Fetches all guests via `/api/admin/guests`; supports search, add, edit, delete, export |
| `GuestTable` | Renders the guest list in a table with inline editing |
| `PasswordGate` | Wraps children; validates gallery password via backend API; stores token in `localStorage` on success; skips form if session already active |
| `AdminPasswordGate` | Same client-side gate as before with admin-specific key and longer session |

---

## Backend

The backend is a **FastAPI** application running under **uvicorn**. It is structured as:

- `main.py` — app setup, CORS, direct RSVP & admin endpoints
- `routers/auth.py` — token login and password login endpoints mounted at `/api/auth`
- `routers/storage.py` — photo storage endpoints mounted at `/api/storage`
- `routers/photos.py` — photo registration, listing, and ZIP download endpoints mounted at `/api/photos`
- `services/storage.py` — S3 client helpers (presigned URL generation, upload)
- `services/image_processing.py` — async image processing (thumbnails, previews, HEIC conversion, EXIF extraction); jobs are queued through a bounded `ThreadPoolExecutor(max_workers=2)` to prevent CPU saturation under concurrent load

### API Endpoints

All paths prefixed with `/api` as seen by the client (nginx strips the prefix before forwarding to the backend).

#### Core Endpoints

| Method | Backend path | Client path | Description |
|---|---|---|---|
| `GET` | `/` | `/api/` | Returns service status and version |
| `GET` | `/health` | `/api/health` | Health check (`{"status": "healthy"}`) |
| `POST` | `/rsvp` | `/api/rsvp` | Submit an RSVP for a single person |
| `GET` | `/admin/guests` | `/api/admin/guests` | List all guests, ordered by `id DESC` |
| `PUT` | `/admin/guests/{id}` | `/api/admin/guests/{id}` | Update a guest record |
| `DELETE` | `/admin/guests/{id}` | `/api/admin/guests/{id}` | Delete a guest record |
| `GET` | `/admin/guests/export` | `/api/admin/guests/export` | Download all guests as an `.xlsx` file |

---

### Auth API

Mounted at `/api/auth` via the router in `routers/auth.py`. These endpoints are intentionally open (no Bearer token required).

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/token-login` | Validate a QR code token |
| `POST` | `/api/auth/password-login` | Exchange the gallery password for a valid token |

#### `POST /api/auth/token-login` — QR Token Validation

Called by `GalleryEntryPage` when a `?token=` URL param is present.

Request body:
```json
{ "token": "abc123..." }
```

Response (success — HTTP 200):
```json
{ "status": "ok" }
```

Response (failure — HTTP 401): `"Invalid token"` or `"Token expired"`.

Both failure cases return 401 to prevent callers from distinguishing existing from non-existing tokens.

#### `POST /api/auth/password-login` — Password to Token Exchange

Called by `PasswordGate` when the user submits the gallery password form.

Request body:
```json
{ "password": "..." }
```

Response (success — HTTP 200):
```json
{
  "token": "74da6ed3...",
  "expiresAt": "2026-04-04T15:55:31"
}
```

Response (wrong password — HTTP 401): `"Invalid password"`  
Response (no valid token in DB — HTTP 500): `"No valid gallery token available"`

The endpoint retrieves the existing DB token with the latest future expiry — it does not create new tokens. Token provisioning is done out-of-band by an admin.

#### `POST /rsvp` — Submit RSVP

Request body (`application/json`):

```json
{
  "name": "string (required)",
  "essenswunsch": "string | null",
  "dabei": "boolean | null",
  "email": "string | null",
  "anreise": "string | null",
  "essen_fr": "boolean | null",
  "essen_sa": "boolean | null",
  "essen_so": "boolean | null",
  "unterkunft": "string | null"
}
```

Response:

```json
{ "success": true, "id": 42 }
```

The RSVPForm submits one request per person in the form (multiple guests can RSVP together, sharing email/accommodation fields).

#### `GET /admin/guests` — List All Guests

Response: array of `Guest` objects (see [DB Schema](#db-schemas)).

#### `PUT /admin/guests/{id}` — Update Guest

Same request body as `POST /rsvp`. Returns `{"success": true, "guest": {...}}`.

#### `DELETE /admin/guests/{id}` — Delete Guest

Returns `{"success": true, "message": "Guest deleted successfully"}` or `{"success": false, "error": "Guest not found"}`.

#### `GET /admin/guests/export` — Excel Export

Returns a streaming `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` response with all guest data in a formatted `.xlsx` workbook. Column headers: `ID, Name, Essenswunsch, Dabei, Email, Anreise, Essen Fr, Essen Sa, Essen So, Unterkunft`.

---

### Storage API

Mounted at `/api/storage` via the router in `routers/storage.py`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/storage/upload-url` | Generate a pre-signed S3 PUT URL for direct client upload |
| `GET` | `/api/storage/download-url?key=...` | Generate a pre-signed S3 GET URL |
| `GET` | `/api/storage/health` | Verify S3 bucket connectivity |

#### `POST /api/storage/upload-url`

Request body:

```json
{
  "filename": "my-photo.jpg",
  "contentType": "image/jpeg",
  "category": "guest"
}
```

- `contentType` must be one of: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`
- `category` must be one of: `guest`, `photographer`

Response:

```json
{
  "uploadUrl": "https://s3.example.com/...",
  "photoId": "<uuid>",
  "key": "wedding/guest/original/<uuid>.jpg",
  "extension": "jpg",
  "storageRef": "https://s3.example.com/bucket/wedding/guest/original/<uuid>.jpg"
}
```

- `photoId` — the UUID used in the key; pass this to `POST /api/photos` as the photo's primary key
- `storageRef` — canonical path reference, **not** an access URL (bucket may be private)
- Extension is derived from `contentType`, not the filename

The client uploads the file directly to `uploadUrl` (PUT request). Pre-signed URL expires after **10 minutes**.

**Storage key format**: `wedding/{category}/{variant}/{uuid}.{ext}` (e.g. `.jpg`, `.heic`)

#### `GET /api/storage/download-url?key=...`

Returns a pre-signed GET URL expiring after **1 hour**. The `key` parameter is validated to reject path-traversal attempts (no `..` or leading `/`).

---

### Photos API

Mounted at `/api/photos` via the router in `routers/photos.py`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/photos` | Register a photo after a successful S3 upload |
| `GET` | `/api/photos` | List processed photos with signed download URLs |
| `POST` | `/api/photos/download-zip` | Stream a ZIP archive for selected photo IDs (max 100 per request) |

#### `POST /api/photos` — Register Photo

Call this after the direct S3 upload succeeds. Stores metadata and triggers async image processing.

Request body:

```json
{
  "photoId": "<uuid from upload-url response>",
  "key": "wedding/guest/original/<uuid>.jpg",
  "category": "guest",
  "uploadedBy": "Maria & Jonas"
}
```

Response: `{"status": "ok", "photoId": "<uuid>"}`

Image processing (thumbnail + preview generation) starts automatically in the background. The endpoint returns immediately. Processing jobs are queued in a bounded pool (max 2 concurrent) to prevent CPU saturation under concurrent upload load. The frontend retries this endpoint up to 3 times with exponential back-off (1.5 s, 3 s, 6 s) on 5xx responses, so transient server overload does not permanently lose a photo that was already uploaded to S3.

#### `GET /api/photos` — List Photos

Returns only fully processed photos (`processing_status = 'done'`). Signed URLs are generated server-side — the frontend can use them directly with no additional requests.

Query parameters: `category` (optional: `guest` or `photographer`), `limit` (default 50, max 100), `offset` (default 0), `sort` (optional: `upload` or `taken`, default `upload`)

- `sort=upload` — orders by upload timestamp descending (default, backward-compatible)
- `sort=taken` — orders by EXIF capture date descending, with photos that have no EXIF data placed last (ordered by upload time among themselves)

Response:

```json
{
  "photos": [{
    "id": "<uuid>",
    "category": "guest",
    "uploadedBy": "Maria",
    "createdAt": "2026-03-21T10:00:00",
    "thumbnailUrl": "https://...signed...",
    "previewUrl": "https://...signed...",
    "originalUrl": "https://...signed..."
  }],
  "hasMore": true
}
```

`hasMore` is computed server-side by fetching `limit + 1` rows. No separate `COUNT(*)` query is issued.

Signed URLs expire after 1 hour.

#### `POST /api/photos/download-zip` — Download Selected Photos as ZIP

Creates a streamed ZIP archive for selected photos. The archive is generated server-side and streamed to the client without building the full ZIP in memory.

Request body:

```json
{
  "photoIds": ["<uuid>", "<uuid>"]
}
```

Validation rules:

- `photoIds` must not be empty
- maximum `100` photo IDs per request
- each ID must be a valid UUID
- all requested photos must exist and have `processing_status = 'done'`

Behavior details:

- duplicate IDs are normalized while preserving request order
- each file is streamed from storage in 64 KB chunks and written into the ZIP stream without buffering the full archive in memory
- file extensions are preserved from the original S3 key (e.g. `.jpg`, `.heic`, `.png`)
- per-file signing/download errors are skipped (best-effort); the request only fails with `500` if no file can be added at all

Response:

- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="wedding-photos.zip"`

**Frontend batching**: The client sends at most 100 IDs per request. When "Download All" targets more than 100 photos the frontend splits them into sequential batches (500 ms apart) and names them `hochzeit-fotos.zip`, `hochzeit-fotos-2-von-3.zip`, etc. A confirmation dialog is shown before starting a multi-batch download. All download controls are disabled while a download is in progress, and a toast notification confirms completion or reports errors.

---

## Database

PostgreSQL 15 managed by SQLAlchemy. The schema is auto-migrated on startup via `Base.metadata.create_all()` in `database.py`.

Connection string from environment: `DATABASE_URL` (default: `postgresql://postgres:password@localhost:5432/hochzeit_db`).

### DB Schemas

#### `guest` table

Stores one row per RSVP submission per person.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `INTEGER` | PK, autoincrement | Internal ID |
| `name` | `VARCHAR` | NOT NULL | Guest name |
| `essenswunsch` | `VARCHAR` | nullable | Meal preference |
| `dabei` | `BOOLEAN` | nullable | Attending? `true`/`false`/`null` (pending) |
| `email` | `VARCHAR` | nullable | Contact email |
| `anreise` | `VARCHAR` | nullable | Arrival details / transport |
| `essen_fr` | `BOOLEAN` | nullable | Attending Friday dinner |
| `essen_sa` | `BOOLEAN` | nullable | Attending Saturday dinner |
| `essen_so` | `BOOLEAN` | nullable | Attending Sunday breakfast |
| `unterkunft` | `VARCHAR` | nullable | Accommodation preference |

#### `photos` table

Stores metadata for uploaded photos. File data lives in S3.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, default `uuid4` | Photo identifier |
| `original_key` | `TEXT` | nullable | S3 key for the original file (used for signed URL generation) |
| `original_url` | `TEXT` | NOT NULL | Non-expiring path reference for the original file |
| `preview_key` | `TEXT` | nullable | S3 key for the preview variant (set after processing) |
| `preview_url` | `TEXT` | nullable | Non-expiring path reference for the preview |
| `thumbnail_key` | `TEXT` | nullable | S3 key for the thumbnail variant (set after processing) |
| `thumbnail_url` | `TEXT` | nullable | Non-expiring path reference for the thumbnail |
| `category` | `VARCHAR` | NOT NULL | `"guest"` or `"photographer"` |
| `created_at` | `DATETIME` | server default `now()` | Upload timestamp |
| `uploaded_by` | `VARCHAR` | nullable | Uploader name |
| `processing_status` | `TEXT` | default `"pending"` | `pending` → `processing` → `done` / `failed` |
| `processing_error` | `TEXT` | nullable | Error message if processing failed; `NULL` on success |
| `taken_at` | `DATETIME` | nullable | EXIF capture timestamp extracted during processing; `NULL` if no EXIF data present |

> **Note:** `*_key` columns are the canonical S3 keys used to generate signed URLs. `*_url` columns are non-expiring path references for internal use only — never use them as access URLs.

> **Migration note:** `taken_at` was added in Phase 8. Existing databases require: `ALTER TABLE photos ADD COLUMN taken_at TIMESTAMP NULL;`

---

#### `access_tokens` table

Stores pre-provisioned gallery access tokens. Tokens are created out-of-band by an admin; this table is never written to by regular user actions.

| Column | Type | Constraints | Description |
|---|---|---|---------|
| `id` | `UUID` | PK | Auto-generated |
| `token` | `TEXT` | UNIQUE NOT NULL | 64-hex-character cryptographically random string |
| `expires_at` | `DATETIME` | NOT NULL | Hard expiry enforced on every API request |
| `permissions` | `VARCHAR` | nullable | Reserved for future use; currently `"upload:view"` |

---

## Infrastructure & Deployment

### Docker Services

#### Development (`docker-compose.yml`)

| Service | Image / Build | Port | Notes |
|---|---|---|---|
| `db` | `postgres:15-alpine` | `5432` | Healthcheck enabled; data persisted in `postgres_data` volume |
| `backend` | `./backend/Dockerfile` | `8000` | Mounts `./backend` for hot-reload; uvicorn `--reload` |
| `frontend` | `./Dockerfile` | `3000→80` | Multi-stage build; `REACT_APP_API_URL=http://localhost:8000` |

#### Production (`docker-compose.prod.yml`)

Adds Nginx and Certbot, removes exposed ports on backend/frontend (internal network only).

| Service | Notes |
|---|---|
| `db` | Same postgres image; credentials from `.env` |
| `backend` | No host port binding; `ENVIRONMENT=production` |
| `frontend` | No host port binding; `REACT_APP_API_URL` from `.env` |
| `nginx` | Ports `80:80` and `443:443`; reloads every 6 hours to pick up renewed certs |
| `certbot` | Auto-renews Let's Encrypt certificates |

### Nginx Routing

In production, all traffic enters through nginx:

```
GET  /            → frontend static files (React SPA)
GET  /static/*    → frontend static files
GET  /api/*       → rewrite: strip /api prefix → forward to backend:8000
POST /api/rsvp    → backend:8000/rsvp  (stricter rate limit: 1 req/s)
*    /api/admin/* → backend:8000/admin/* (separately configurable, e.g. IP allowlist)
```

Rate limiting (defined in `nginx.conf`):
- `api` zone: **10 req/s** with burst of 20
- `login` zone: **1 req/s** with burst of 5 (applied to `/api/rsvp`)

Security headers set globally: `X-Frame-Options`, `X-XSS-Protection`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy`, `Strict-Transport-Security` (HTTPS only).

### Environment Variables

#### Backend

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:password@localhost:5432/hochzeit_db` | PostgreSQL connection string |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `ENVIRONMENT` | `development` | Shown in health check response |
| `GALLERY_PASSWORD` | — | Gallery password for `POST /api/auth/password-login`; never stored client-side |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL |
| `S3_ACCESS_KEY` | — | S3 access key |
| `S3_SECRET_KEY` | — | S3 secret key |
| `S3_BUCKET_NAME` | — | Target S3 bucket name |
| `S3_REGION` | `eu-central` | S3 region |

#### Frontend (build-time)

| Variable | Default | Description |
|---|---|---|
| `REACT_APP_API_URL` | `/api` | API base URL (baked into the JS bundle at build time) |
| `REACT_APP_ADMIN_PASSWORD` | `admin2025` | Admin panel password |

---

## Local Development

### Prerequisites

- Docker Desktop (latest)
- Git

### Start

```bash
git clone https://github.com/tomkepia/hochzeit-website.git
cd hochzeit-website

# Start all services (builds images on first run)
docker-compose up --build
```

Access:
- Wedding site: http://localhost:3000
- API docs (Swagger UI): http://localhost:8000/docs
- Health check: http://localhost:8000/health

### Common Commands

```bash
# Rebuild and restart a single service
docker-compose up --build backend -d

# View logs
docker-compose logs -f backend

# Access the database
docker-compose exec db psql -U postgres -d hochzeit_db

# Stop everything
docker-compose down

# Stop and wipe database volume
docker-compose down -v
```

### Running Without Docker (backend)

```bash
cd backend
pip install -r requirements.txt

# Requires a running PostgreSQL instance
export DATABASE_URL=postgresql://postgres:password@localhost:5432/hochzeit_db
uvicorn main:app --reload --port 8000
```

### Running Without Docker (frontend)

```bash
npm install
REACT_APP_API_URL=http://localhost:8000 npm start
```

The `package.json` proxy (`"proxy": "http://localhost:8000"`) covers the case where `REACT_APP_API_URL` is not set in development.

---

*© 2026 Tomke & Jan-Paul*

## 👥 Authors

- **JP Briem** - Initial work and Docker configuration

---

**Note**: This is a wedding website template. Customize the content, styling, and functionality according to your needs.
