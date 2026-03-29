# Phase 9 Implementation – Security & Access Control (QR Token + Session + Backend Enforcement)

**Date:** 28. März 2026  
**Phase:** 9 of 9  
**Status:** Complete  
**Builds on:** Phase 8 (Sorting + Direct Navigation)

---

## Overview

Phase 9 introduces a minimal but complete access control system to the wedding photo gallery. Before this phase the gallery was entirely public — any person with the URL could browse, upload, and download photos. After Phase 9 every API endpoint is protected by a Bearer token check enforced on the backend, and the frontend prevents users from reaching any gallery page without a valid session.

The design deliberately avoids JWT, refresh tokens, or user accounts. The only credential is a **pre-shared, time-limited random token** distributed via QR code.

---

## Architecture

### Flow

```
QR Code → /gallery?token=XYZ
        ↓
GalleryEntryPage calls POST /api/auth/token-login
        ↓
Backend validates token (DB lookup + expiry check)
        ↓
Returns { "status": "ok" }
        ↓
Frontend stores session in localStorage
  localStorage["galleryToken"]  = "XYZ"
  localStorage["galleryAccess"] = "true"
        ↓
All subsequent API calls include:
  Authorization: Bearer XYZ
        ↓
require_gallery_access dependency enforces access on every protected route
```

### Session model

There is no server-side session object. The token itself is the credential — the backend re-validates it on every request. `localStorage` acts only as a client-side cache of the token string, avoiding having to pass it through the URL on every navigation.

---

## Part 1 – Database

---

### 1.1 `AccessToken` model (`backend/models.py`)

A new SQLAlchemy model was added to `models.py`:

```python
class AccessToken(Base):
    __tablename__ = "access_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(Text, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    permissions = Column(String)  # e.g. "upload:view"
```

**Schema:**

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Auto-generated |
| `token` | TEXT | UNIQUE NOT NULL | 64-hex-character random string |
| `expires_at` | TIMESTAMP | NOT NULL | Hard cutoff enforced on every request |
| `permissions` | VARCHAR | nullable | Reserved for future use; currently `"upload:view"` |

**Migration:** `Base.metadata.create_all()` is called at startup via `init_db()`, so the table is created automatically for fresh installations. Existing databases require:

```sql
CREATE TABLE access_tokens (
  id UUID PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  permissions TEXT
);
```

**Design decisions:**
- `token = Column(Text, unique=True)` — the `UNIQUE` constraint is the primary protection against token enumeration at the DB level.
- `expires_at` is `NOT NULL` — every token must have an expiry; there are no permanent tokens.
- `permissions` is kept for future extensibility (e.g. read-only vs. upload-allowed QR codes) but is not evaluated in Phase 9.

---

### 1.2 Token provisioning

Tokens are created out-of-band (run once in a Python shell or admin script):

```python
import secrets
from datetime import datetime, timedelta
from database import SessionLocal
from models import AccessToken

db = SessionLocal()
token = secrets.token_hex(32)   # 64 hex chars = 256 bits
db.add(AccessToken(
    token=token,
    expires_at=datetime.utcnow() + timedelta(days=90),
    permissions="upload:view",
))
db.commit()

print(f"https://yourdomain.com/gallery?token={token}")
```

`secrets.token_hex(32)` produces 256 bits of cryptographically random data. This is resistant to brute-force enumeration in any realistic attack scenario.

---

## Part 2 – Backend

---

### 2.1 Auth router (`backend/routers/auth.py`) — NEW FILE

All authentication logic lives in a single new router file registered at `/api/auth`.

#### `POST /api/auth/token-login`

**Request:**
```json
{ "token": "abc123..." }
```

**Response (success):**
```json
{ "status": "ok" }
```

**Response (failure):** HTTP 401 with `detail` set to `"Invalid token"` or `"Token expired"`.

**Logic:**
```python
@router.post("/token-login")
def token_login(request: TokenRequest, db: Session = Depends(get_db)):
    token_obj = db.query(AccessToken).filter(AccessToken.token == request.token).first()

    if not token_obj:
        raise HTTPException(status_code=401, detail="Invalid token")

    if token_obj.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Token expired")

    return {"status": "ok"}
```

Both "not found" and "expired" return HTTP 401 rather than 403 or 404. This is intentional — revealing whether a token exists (404 vs. 401) would assist token probing attacks.

---

### 2.2 `require_gallery_access` dependency

This function is the enforcement point for all protected routes:

```python
def require_gallery_access(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization")

    parts = auth_header.split() if auth_header else []
    if len(parts) != 2 or parts[0] != "Bearer":
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = parts[1]

    token_obj = db.query(AccessToken).filter(AccessToken.token == token).first()

    if not token_obj:
        logger.warning("Access attempt with invalid token")
        raise HTTPException(status_code=401, detail="Invalid token")

    if token_obj.expires_at < datetime.utcnow():
        logger.info("Access attempt with expired token id=%s", token_obj.id)
        raise HTTPException(status_code=401, detail="Token expired")
```

**Design decisions:**
- `auth_header.split()` with an explicit `len(parts) != 2` check is stricter than `.startswith("Bearer ")`. It rejects headers like `"Bearer"` (no token), `"Bearer a b"` (two tokens), or `"Token abc"` (wrong scheme) — all of which the prefix check would handle inconsistently.
- `parts[0] != "Bearer"` is case-sensitive. The HTTP spec requires the scheme to match exactly; case-folding would silently accept `"bearer"` which some non-standard clients send.
- Expiry is re-checked on every request. Token expiry is enforced even for sessions started before the expiry date passed.
- `logger.warning` is emitted for invalid tokens (potential probing) and `logger.info` for expired ones (expected operational case).

---

### 2.3 Protected endpoints (`backend/routers/photos.py`, `backend/routers/storage.py`)

The dependency is applied declaratively via `dependencies=[Depends(require_gallery_access)]` on every endpoint that accesses photos or triggers uploads:

| Endpoint | File | Protected |
|---|---|---|
| `GET /api/photos` | `photos.py` | ✔ |
| `POST /api/photos` | `photos.py` | ✔ |
| `POST /api/photos/download-zip` | `photos.py` | ✔ |
| `POST /api/storage/upload-url` | `storage.py` | ✔ |
| `GET /api/storage/download-url` | `storage.py` | ✔ |
| `GET /api/storage/health` | `storage.py` | — (public health check) |
| `POST /api/auth/token-login` | `auth.py` | — (the login endpoint itself) |
| `POST /rsvp` | `main.py` | — (RSVP is separate from gallery) |

`GET /api/storage/health` and `POST /api/auth/token-login` are the only intentionally open endpoints. All photo and storage data paths require a valid Bearer token.

The import added to `photos.py`:
```python
from routers.auth import require_gallery_access
```

The import added to `storage.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Query
from routers.auth import require_gallery_access
```

Usage example:
```python
@router.get("", dependencies=[Depends(require_gallery_access)])
def list_photos(...):
    ...
```

---

### 2.4 Router registration (`backend/main.py`)

```python
from routers.auth import router as auth_router

app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(photos_router)
```

`auth_router` is registered first so it appears first in the OpenAPI docs and `/api/auth/token-login` is clearly distinct from data endpoints.

---

## Part 3 – Frontend

---

### 3.1 API layer changes (`src/services/api.js`)

Three additions were made to the API service module.

#### `getAuthHeaders()` — private helper

```js
function getAuthHeaders() {
  const token = localStorage.getItem("galleryToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

Returns an object that can be spread into any `fetch` `headers` map. Returns an empty object when no token is stored, which causes the backend to return 401 — triggering the auto-logout path.

#### `handle401()` — private helper

```js
function handle401() {
  localStorage.removeItem("galleryAccess");
  localStorage.removeItem("galleryToken");
  window.location.href = "/";
}
```

Called whenever any protected API call receives a 401 response. Clears local storage and performs a hard redirect to the homepage (password gate). Using `window.location.href` instead of `navigate()` ensures a full page load, which flushes all in-memory React state for a clean slate.

#### `tokenLogin(token)` — public export

```js
export async function tokenLogin(token) {
  const res = await fetch(`${API_BASE}/api/auth/token-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) throw new Error("Invalid token");

  return true;
}
```

Does not store the token itself — that responsibility belongs to the caller (`GalleryEntryPage`). This keeps storage side-effects out of the API layer.

#### Modified API functions

Every function that calls a protected endpoint was updated to spread `getAuthHeaders()` and check for 401:

| Function | Change |
|---|---|
| `requestUploadUrl` | Added `...getAuthHeaders()` to headers; added 401 guard |
| `registerPhoto` | Added `...getAuthHeaders()` to headers; added 401 guard |
| `fetchPhotos` | Added `headers: { ...getAuthHeaders() }`; added 401 guard |
| `downloadZip` | Added `...getAuthHeaders()` to headers; added 401 guard |
| `uploadToS3` | Unchanged — PUT goes directly to S3, not the backend |

`uploadToS3` is exempt because the pre-signed S3 PUT URL is a time-limited, content-type-locked credential generated by the backend after a successful `requestUploadUrl` call. Access control to S3 is enforced at URL-generation time (which is now protected).

---

### 3.2 `GalleryEntryPage.js` — Token validation + route guard

`GalleryEntryPage` is the first page a user reaches from a QR code (`/gallery?token=XYZ`) and the central entry point for the gallery. It now performs two jobs on mount:

1. **Token path:** If a `?token=` param is present, validate it with the backend, then store the session on success or display an inline error on failure.
2. **Session path:** If no token param is present and no existing session exists, redirect to `/` (the main password-gate page).

```js
useEffect(() => {
  if (token) {
    tokenLogin(token)
      .then(() => {
        localStorage.setItem("galleryToken", token);
        localStorage.setItem("galleryAccess", "true");
        window.history.replaceState({}, "", "/gallery");
      })
      .catch(() => {
        setTokenError("Zugang abgelaufen oder ungültig.");
      });
  } else if (!localStorage.getItem("galleryAccess")) {
    navigate("/");
  }
}, [token, navigate]);
```

**Design decisions:**
- The `else if` ensures the session check only fires when no token is present. A user who navigates to `/gallery` (no token) with an existing session is allowed through — they've already authenticated before.
- `window.history.replaceState({}, "", "/gallery")` is called immediately after a successful login to strip the token from the URL. This removes it from browser history, prevents it appearing in screenshots or shared links, and prevents analytics tools from capturing it. `replaceState` does not trigger a page reload or a React re-render — it only updates the URL bar.
- On token validation failure the page does **not** redirect — it stays on `/gallery` and shows an error message. This gives the user context rather than silently dropping them at the homepage.
- The error message is in German (`"Zugang abgelaufen oder ungültig."`) consistent with the rest of the UI.

**Error display:**

```jsx
{tokenError && (
  <p style={styles.errorMessage}>{tokenError}</p>
)}
```

```js
errorMessage: {
  margin: "0 0 16px",
  fontFamily: "'Montserrat', sans-serif",
  fontSize: 14,
  color: "#c0392b",
},
```

---

### 3.3 `PhotosPage.js` — Route guard

```js
useEffect(() => {
  if (!localStorage.getItem("galleryAccess")) {
    navigate("/");
  }
}, [navigate]);
```

Added `useNavigate` to the import and `navigate` initialized at the top of the component. The guard fires on mount. If the user has cleared their localStorage or the browser has evicted it they are redirected before any photo-fetch attempts are made.

---

### 3.4 `UploadPage.js` — Route guard

Identical pattern to `PhotosPage.js`:

```js
import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

export default function UploadPage() {
  const navigate = useNavigate();
  // ...
  useEffect(() => {
    if (!localStorage.getItem("galleryAccess")) {
      navigate("/");
    }
  }, [navigate]);
```

---

## Part 4 – Session Lifecycle

| Event | Result |
|---|---|
| User scans valid QR code | Token validated → stored → user enters gallery |
| User scans expired QR code | 401 from backend → error message shown on `/gallery` |
| User scans invalid/tampered QR code | 401 from backend → error message shown on `/gallery` |
| User navigates to `/gallery`, `/upload`, `/photos` without a session | Redirected to `/` |
| User has a valid session, navigates freely between pages | Passes route guard; auth header attached to all API calls |
| Token expires while user has an open session | Next API call returns 401 → `handle401()` clears storage → redirect to `/` |
| User manually clears localStorage | Next page load / API call triggers redirect to `/` |

---

## File Structure After Phase 9

```
backend/
  models.py                    ← MODIFIED: AccessToken model added
  main.py                      ← MODIFIED: auth_router registered
  routers/
    auth.py                    ← NEW: token-login endpoint + require_gallery_access dependency
    photos.py                  ← MODIFIED: require_gallery_access applied to all 3 endpoints
    storage.py                 ← MODIFIED: require_gallery_access applied to upload-url

src/
  services/
    api.js                     ← MODIFIED: tokenLogin, getAuthHeaders, handle401 added;
                                            auth headers + 401 handling applied to all API calls
  pages/
    GalleryEntryPage.js        ← MODIFIED: token validation on mount, session guard, error display
    PhotosPage.js              ← MODIFIED: useNavigate imported; route guard added
    UploadPage.js              ← MODIFIED: useNavigate imported; route guard added
```

---

## End-to-End Access Flow

```
First visit (QR scan)
─────────────────────

Browser opens /gallery?token=abc123
        │
        ▼
GalleryEntryPage mounts
  token = searchParams.get("token")  → "abc123"
        │
        ▼
tokenLogin("abc123")
  POST /api/auth/token-login { token: "abc123" }
        │
   ┌────┴────┐
   │ valid   │ invalid/expired
   ▼         ▼
{ status: "ok" }   HTTP 401
   │                  │
   ▼                  ▼
localStorage:     setTokenError(...)
  galleryToken = "abc123"   → error shown on page
  galleryAccess = "true"
   │
   ▼
User clicks "Fotos ansehen"
  navigate("/photos?token=abc123")

Subsequent visit (existing session)
────────────────────────────────────

Browser opens /photos
  PhotosPage mounts
  localStorage["galleryAccess"] = "true"  → guard passes
  fetchPhotos(...)
    GET /api/photos?...
    Authorization: Bearer abc123
        │
        ▼
    require_gallery_access:
      DB lookup → valid, not expired
        │
        ▼
    { photos: [...], hasMore: ... }

Token expiry during active session
──────────────────────────────────

User is on /photos, session was started 3 days ago, token expired
        │
        ▼
fetchPhotos() → GET /api/photos
  Authorization: Bearer abc123
        │
        ▼
require_gallery_access:
  token_obj.expires_at < datetime.utcnow()  → True
  raise HTTPException(401)
        │
        ▼
Frontend: response.status === 401
  handle401():
    localStorage.removeItem("galleryAccess")
    localStorage.removeItem("galleryToken")
    window.location.href = "/"
        │
        ▼
User lands on homepage — must use a new (valid) QR code
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Stateless backend validation | Every request re-validates the token from the DB. No server-side session store needed. Token revocation works immediately by deleting the DB row. |
| Both "not found" and "expired" return 401 | Returning different codes would let an attacker distinguish existing from non-existing tokens during probing. |
| `localStorage` vs. cookies | Cookies would require `SameSite`/`Secure` configuration and CORS credential handling. `localStorage` is simpler and sufficient for a single-origin SPA without SSR. |
| `window.location.href` for 401 logout | Hard redirect flushes all React state. `navigate()` would preserve in-memory state that might be inconsistent with an unauthenticated session. |
| `window.history.replaceState` after login | Strips the token from the URL immediately after it is stored in `localStorage`. Prevents leakage via browser history, screenshots, shared links, and analytics. Does not reload the page. |
| `getAuthHeaders()` returns `{}` on missing token | Allows fetch calls to proceed without branching; backend returns 401 which triggers `handle401()` cleanly. |
| Inline error on `/gallery` for bad token | Silent redirect would confuse users who receive a stale QR code. An explicit error ("Zugang abgelaufen") tells them what happened and who to contact. |
| `GET /api/storage/download-url` protected | An attacker with a guessed or leaked storage key could generate a fresh signed URL without auth. Protecting the endpoint closes this gap at zero cost. |
| `Authorization` parsed with `.split()` | Rejects edge cases like `"Bearer"` (no token), `"Bearer a b"` (two tokens), and wrong schemes. Stricter than the `.startsWith("Bearer ")` approach. |
| `permissions` column not evaluated | Kept for future extensibility (e.g. read-only QR for non-uploaders). Skipping evaluation in Phase 9 keeps the dependency simple — one fewer DB column check per request. |
| `secrets.token_hex(32)` for provisioning | 256 bits of entropy. Brute-force probability against a system that makes one DB lookup per guess is negligible. |

---

## Testing Checklist

```
[ ] Valid token → POST /api/auth/token-login returns { "status": "ok" }
[ ] Expired token → POST /api/auth/token-login returns HTTP 401
[ ] Invalid token → POST /api/auth/token-login returns HTTP 401
[ ] Valid QR scan → galleryToken and galleryAccess set in localStorage
[ ] Invalid QR scan → error message shown on /gallery; no redirect
[ ] /gallery with no token and no session → redirect to /
[ ] /photos with no session → redirect to /
[ ] /upload with no session → redirect to /
[ ] GET /api/photos without Authorization → HTTP 401
[ ] GET /api/photos with valid Bearer token → photos returned
[ ] POST /api/photos without Authorization → HTTP 401
[ ] POST /api/photos/download-zip without Authorization → HTTP 401
[ ] POST /api/storage/upload-url without Authorization → HTTP 401
[ ] Upload photo with valid token → succeeds end-to-end
[ ] Download ZIP with valid token → succeeds end-to-end
[ ] Simulate token expiry (manually update expires_at in DB) → next API call returns 401 + logout
[ ] GET /api/storage/health → accessible without Authorization (health check)
[ ] POST /rsvp → accessible without Authorization (RSVP is separate)
```

---

## Non-Goals

- No JWT — tokens are opaque random strings; all validation is DB-backed
- No refresh tokens — tokens are long-lived enough that refresh is unnecessary
- No user accounts or per-user identity
- No roles system (permissions column reserved but unevaluated)
- No rate limiting on the token-login endpoint (out of scope; mitigated by token entropy)
- No audit log beyond standard Python logger output

---

## Phase 9 Handoff Notes

**To issue a new QR code** (e.g. after a token expires or is compromised):

```python
import secrets
from datetime import datetime, timedelta
from database import SessionLocal
from models import AccessToken

db = SessionLocal()
token = secrets.token_hex(32)
db.add(AccessToken(token=token, expires_at=datetime.utcnow() + timedelta(days=90), permissions="upload:view"))
db.commit()
print(f"https://yourdomain.com/gallery?token={token}")
```

**To revoke a token immediately:**

```sql
DELETE FROM access_tokens WHERE token = 'abc123...';
```

Any user holding that token will be logged out on their next API call.

**To extend a token's expiry:**

```sql
UPDATE access_tokens SET expires_at = '2026-12-31' WHERE token = 'abc123...';
```
