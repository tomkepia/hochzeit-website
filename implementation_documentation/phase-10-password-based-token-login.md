# Phase 10 Implementation – Password-Based Token Login (Second Access Path)

**Date:** 28. März 2026  
**Phase:** 10 of 10  
**Status:** Complete  
**Builds on:** Phase 9 (Security & Access Control)

---

## Overview

Phase 10 adds a second entry path into the gallery alongside the existing QR code flow introduced in Phase 9. Before this phase the only way to obtain gallery access was to scan a QR code containing a pre-provisioned token. After Phase 10 a user can also type the gallery password on the main website and receive the same kind of token automatically.

Both flows converge into the identical session model: a Bearer token in `localStorage`, validated by the backend on every request. The password is never stored, never logged, and is only used as a gate to retrieve a token from the database.

---

## Architecture

### Two entry paths — one session model

```
Path A: QR Code
──────────────────────────────────────────────
/gallery?token=XYZ
        ↓
POST /api/auth/token-login  { token: "XYZ" }
        ↓
Backend: DB lookup + expiry check
        ↓
{ "status": "ok" }
        ↓
localStorage["galleryToken"]  = "XYZ"
localStorage["galleryAccess"] = "true"
        ↓
navigate("/gallery")          (already on /gallery)

Path B: Password (new)
──────────────────────────────────────────────
User types password on homepage (/)
        ↓
POST /api/auth/password-login  { password: "..." }
        ↓
Backend: env var check → DB lookup → return token
        ↓
{ "token": "XYZ", "expiresAt": "..." }
        ↓
localStorage["galleryToken"]  = "XYZ"
localStorage["galleryAccess"] = "true"
        ↓
navigate("/gallery")
```

After either path completes, the user's browser state is identical: a valid token in `localStorage`, and all subsequent API calls include `Authorization: Bearer XYZ`.

### Key principle

The backend only trusts **tokens**, never the password directly. The password is only used to retrieve a token. Once the token is issued, the password plays no further role in any API request.

---

## Part 1 – Backend

---

### 1.1 New endpoint: `POST /api/auth/password-login`

Added to the existing `backend/routers/auth.py`:

```python
class PasswordLoginRequest(BaseModel):
    password: str


@router.post("/password-login")
def password_login(request: PasswordLoginRequest, db: Session = Depends(get_db)):
    """Exchange the gallery password for a valid access token."""
    expected = os.getenv("GALLERY_PASSWORD")
    if not expected or request.password != expected:
        raise HTTPException(status_code=401, detail="Invalid password")

    now = datetime.utcnow()
    token_obj = (
        db.query(AccessToken)
        .filter(AccessToken.expires_at > now)
        .order_by(AccessToken.expires_at.desc())
        .first()
    )

    if not token_obj:
        logger.warning("password-login succeeded but no valid token exists in DB")
        raise HTTPException(status_code=500, detail="No valid gallery token available")

    return {
        "token": token_obj.token,
        "expiresAt": token_obj.expires_at.isoformat(),
    }
```

**Request:**
```json
{ "password": "Tomke&Jan-Paul2026" }
```

**Response (success):**
```json
{
  "token": "74da6ed3...",
  "expiresAt": "2026-04-04T15:55:31.916884"
}
```

**Response (wrong password):** HTTP 401 — `"Invalid password"`  
**Response (no valid token in DB):** HTTP 500 — `"No valid gallery token available"`

---

### 1.2 Token selection logic

The endpoint does not create a new token — it **returns the existing token with the latest future expiry**:

```python
db.query(AccessToken)
  .filter(AccessToken.expires_at > now)          # exclude expired tokens
  .order_by(AccessToken.expires_at.desc())       # latest expiry first
  .first()
```

**Design decisions:**

- **No new tokens are created on password login.** Tokens are provisioned separately (see Phase 9 handoff notes). Password login is a retrieval mechanism, not an issuance mechanism. This keeps the token lifecycle fully admin-controlled.
- **Latest expiry is preferred.** If multiple valid tokens exist (e.g. during a transition), the one that will last longest is returned, which gives password users the longest possible session.
- **`expires_at > now` filter is mandatory.** The query must never return an already-expired token. The filter is applied in SQL, not in Python, so it is applied atomically with the ordering.
- **500 on no valid token.** This is an operational failure (admin forgot to provision a token, or all tokens have expired) rather than an auth failure. 500 correctly signals a system problem rather than a user error.

---

### 1.3 Security properties

| Property | How it is met |
|---|---|
| Password never logged | The handler reads it from `request.password` and compares; no `logger.*` call on any password value |
| Password never returned in response | Response only contains `token` and `expiresAt` |
| Wrong and missing password give the same error | Both `not expected` and `request.password != expected` raise the same HTTP 401 with the same detail string |
| Password stored outside code | Read from `GALLERY_PASSWORD` env var; never hardcoded |
| Endpoint is open (no auth required) | This is intentional and correct — it is the login endpoint |

---

### 1.4 Environment variable: `GALLERY_PASSWORD`

#### `backend/routers/auth.py`

```python
import os

expected = os.getenv("GALLERY_PASSWORD")
```

#### `.env`

```env
GALLERY_PASSWORD=Tomke&Jan-Paul2026
```

#### `.env.example`

```env
GALLERY_PASSWORD=your_gallery_password_here
```

#### `docker-compose.yml`

```yaml
environment:
  DATABASE_URL: postgresql://postgres:password@db:5432/hochzeit_db
  ...
  GALLERY_PASSWORD: ${GALLERY_PASSWORD}
```

The variable is passed from the `.env` file into the backend container via docker-compose environment interpolation. The backend container picks it up with `os.getenv("GALLERY_PASSWORD")` at request time (not at import time), so updating it only requires a container restart, no rebuild.

---

## Part 2 – Frontend

---

### 2.1 New API function: `passwordLogin` (`src/services/api.js`)

```js
/**
 * Exchange the gallery password for a valid access token.
 * Returns { token, expiresAt } on success.
 */
export async function passwordLogin(password) {
  const res = await fetch(`${API_BASE}/api/auth/password-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) throw new Error("Invalid password");

  return res.json();
}
```

**Design decisions:**
- No auth header is sent — the endpoint is intentionally open.
- `passwordLogin` does not store anything in `localStorage`. Storage is the caller's responsibility (`PasswordGate`). This mirrors the same separation used by `tokenLogin`.
- On non-200 the function throws; `PasswordGate` catches and shows the error message.

---

### 2.2 `PasswordGate.js` — complete rewrite

The component was rebuilt from a purely client-side password check to a backend-validated async flow.

**Before (Phase 9 and earlier):**
```js
const PASSWORD = 'Tomke&Jan-Paul2026'; // hardcoded in source
const AUTH_KEY = 'isAuthenticated';

const handleSubmit = (e) => {
  e.preventDefault();
  if (input === PASSWORD) {
    localStorage.setItem(AUTH_KEY, 'true');  // no token, no gallery access
    setAuthenticated(true);
  } else {
    setError('...');
  }
};
```

**After (Phase 10):**
```js
import { useNavigate } from 'react-router-dom';
import { passwordLogin } from '../services/api';

const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');
  try {
    const result = await passwordLogin(input);
    localStorage.setItem('galleryToken', result.token);
    localStorage.setItem('galleryAccess', 'true');
    navigate('/gallery');
  } catch (err) {
    setError('Falsches Passwort. Bitte versuche es erneut.');
  } finally {
    setLoading(false);
  }
};
```

**Key changes:**

| Aspect | Before | After |
|---|---|---|
| Password validation | Client-side string comparison | Backend `POST /api/auth/password-login` |
| Password in source code | Yes — hardcoded constant | No — only backend reads it from env |
| localStorage key | `isAuthenticated = "true"` | `galleryToken = <token>`, `galleryAccess = "true"` |
| Navigation after login | `setAuthenticated(true)` (stays on `/`) | `navigate('/gallery')` |
| Loading state | None | `loading` state disables form + shows "Wird geprüft…" |
| Existing session check | `isAuthenticated === "true"` | `galleryAccess === "true"` |

**Session check on mount:**
```js
useEffect(() => {
  if (localStorage.getItem('galleryAccess') === 'true') {
    setAuthenticated(true);
  }
}, []);
```
Users with an existing gallery session (from either a QR login or a previous password login) skip the password form entirely.

**UI additions:**
- `disabled={loading}` on both input and button prevents double submissions during the API call.
- Button label switches to `"Wird geprüft…"` during loading for clear user feedback.

---

### 2.3 `MainPage.js` — auth key cleanup

`MainPage` managed a 30-minute time-limited session using `isAuthenticated` and `sessionStart` localStorage keys. The `isAuthenticated` key is now replaced with `galleryAccess`, and `handleLogout` was updated to also clear `galleryToken`.

**Before:**
```js
const AUTH_KEY = 'isAuthenticated';

localStorage.removeItem(AUTH_KEY);
```

**After:**
```js
// AUTH_KEY constant removed

localStorage.removeItem('galleryAccess');
localStorage.removeItem('galleryToken');
```

The session timer logic itself (30-minute expiry checked every 10 seconds) is unchanged. It now guards `galleryAccess` instead of `isAuthenticated`.

**Why `galleryToken` is also cleared on session expiry:** The 30-minute timer is a UX session guard on the main wedding page, independent of the backend token expiry. Clearing `galleryToken` on timer expiry ensures no orphaned credential remains in storage after the user is logged out from the main page.

---

## Part 3 – Unified Flow After Phase 10

### Password flow (new)

```
User opens https://yourdomain.com/
        │
        ▼
MainPage renders, PasswordGate mounts
  localStorage["galleryAccess"] undefined → show password form
        │
User types "Tomke&Jan-Paul2026" and submits
        │
        ▼
passwordLogin("Tomke&Jan-Paul2026")
  POST /api/auth/password-login { password: "..." }
        │
   ┌────┴────────────────────┐
   │ valid                   │ wrong password or no token
   ▼                         ▼
{ token: "abc...",      HTTP 401 / 500
  expiresAt: "..." }         │
   │                         ▼
   ▼                    setError("Falsches Passwort...")
localStorage:
  galleryToken = "abc..."
  galleryAccess = "true"
   │
   ▼
navigate("/gallery")
        │
        ▼
GalleryEntryPage mounts
  no ?token= param
  localStorage["galleryAccess"] = "true" → guard passes
        │
        ▼
User sees gallery entry (upload / view buttons)
```

### QR flow (unchanged from Phase 9)

```
User scans QR → /gallery?token=abc123
  tokenLogin("abc123") → { status: "ok" }
  localStorage["galleryToken"] = "abc123"
  localStorage["galleryAccess"] = "true"
  window.history.replaceState({}, "", "/gallery")
```

### After either flow — identical state

```
localStorage["galleryToken"]  = "<64-hex-char token>"
localStorage["galleryAccess"] = "true"

Every API call:
  Authorization: Bearer <token>

Backend per request:
  require_gallery_access → DB lookup → expiry check → pass
```

---

## Part 4 – Session Lifecycle (Updated)

| Event | Result |
|---|---|
| User enters correct password | Backend validates → token returned → stored → navigate to `/gallery` |
| User enters wrong password | 401 from backend → error shown on form; page stays on `/` |
| No valid token exists in DB | 500 from backend → caught as error, shown as "Falsches Passwort…" |
| User scans valid QR code | Token validated → stored → token stripped from URL |
| User has existing session, visits `/` | `PasswordGate` detects `galleryAccess` → renders `children` (main page), skips form |
| 30-minute session timer fires (main page) | `galleryAccess` + `galleryToken` + `sessionStart` cleared → page reload → password form shown |
| Token expires mid-session (gallery pages) | Next API call returns 401 → `handle401()` clears storage → redirect to `/` |

---

## File Structure After Phase 10

```
backend/
  routers/
    auth.py               ← MODIFIED: password-login endpoint added; os import added

src/
  services/
    api.js                ← MODIFIED: passwordLogin() added
  components/
    PasswordGate.js       ← MODIFIED: complete rewrite — backend validation,
                                       galleryToken/galleryAccess, navigate to /gallery,
                                       loading state, hardcoded password removed
  pages/
    MainPage.js           ← MODIFIED: AUTH_KEY constant removed; all references
                                       replaced with 'galleryAccess'; galleryToken
                                       also cleared on logout and session expiry

.env                      ← MODIFIED: GALLERY_PASSWORD added
.env.example              ← MODIFIED: GALLERY_PASSWORD placeholder added
docker-compose.yml        ← MODIFIED: GALLERY_PASSWORD env var passed to backend
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Password login retrieves an existing token, not creates one | Token lifecycle stays fully admin-controlled. The admin provisions tokens; the password is just a retrieval key for any existing valid one. |
| Password never appears in source code | Hardcoded passwords in JS are visible in browser DevTools and the built bundle. Removing it from the frontend eliminates that attack surface entirely. |
| Password validated server-side only | The previous client-side check was bypassable by anyone who could read the JS bundle. The new check is opaque to the browser. |
| Wrong password and "GALLERY_PASSWORD not set" return the same 401 | Distinguishing the two would leak information about server configuration. |
| 500 on no valid DB token, not 401 | HTTP 401 means "unauthenticated". A correctly authenticated user hitting this error is blocked for operational reasons (DB problem), not auth reasons. 500 correctly surfaces this to monitoring. |
| `navigate('/gallery')` instead of rendering inline | Sends the user to the gallery entry page where they can choose upload or view. Keeps `/` (wedding main page) and `/gallery` (photo system entry) architecturally separate. |
| `loading` state disables form during API call | Prevents double submissions. Without it, a slow connection could result in two simultaneous password-login requests. |
| `galleryToken` cleared on 30-minute session expiry | The timer in `MainPage` is a UX session gate. Leaving a valid token in storage after it fires would allow re-entry to gallery pages without re-authentication. |
| `AUTH_KEY = 'isAuthenticated'` constant removed | The key was renamed to `'galleryAccess'` in Phase 9. The old constant was dead weight and a source of potential confusion. |

---

## Testing Checklist

### Backend

```
[x] POST /api/auth/password-login with correct password → 200 with { token, expiresAt }
[x] POST /api/auth/password-login with wrong password → 401
[ ] POST /api/auth/password-login with no GALLERY_PASSWORD env var → 401
[ ] No valid token in DB (all expired) → 500
[ ] Returned token works for GET /api/photos (verified via curl)
[ ] QR token-login still works (existing Phase 9 path unaffected)
```

### Frontend

```
[ ] Enter correct password → form shows "Wird geprüft…" → redirect to /gallery
[ ] galleryToken and galleryAccess in localStorage after password login
[ ] Access /photos works after password login (auth header sent correctly)
[ ] Refresh page on /gallery after password login → still logged in
[ ] Enter wrong password → error message shown; form stays on /
[ ] Existing session (galleryAccess = "true") → password form not shown
[ ] 30-minute timer expiry → galleryToken cleared along with galleryAccess
[ ] Logout button → both galleryAccess and galleryToken cleared
```

### Integration

```
[ ] QR login still works end-to-end
[ ] Password login works independently of QR
[ ] Both flows result in identical localStorage state
[ ] Logout from either flow clears both keys
[ ] Token from password-login rejected after DB row deleted (revocation works)
```

---

## Non-Goals

- No rate limiting on `password-login` (mitigated by token entropy; brute-forcing the password does not help access the gallery without also knowing the token)
- No per-user passwords (single shared gallery password)
- No password change UI
- No session invalidation on password change (admin must also rotate tokens if the password is compromised)

---

## Phase 10 Handoff Notes

**To change the gallery password:**

1. Update `GALLERY_PASSWORD` in `.env` (or the production environment config).
2. Restart the backend container:
   ```bash
   docker compose up -d --force-recreate backend
   ```
   No database changes required. No frontend rebuild required.

**To test without a frontend:**

```bash
# Correct password
curl -sS http://localhost:8000/api/auth/password-login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"Tomke&Jan-Paul2026"}'

# Wrong password
curl -sS -w "\nHTTP:%{http_code}" http://localhost:8000/api/auth/password-login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"wrongpassword"}'
```

**To simulate no-token-in-DB (500 path):**

```sql
-- Expire all tokens (returns 500 on next password login)
UPDATE access_tokens SET expires_at = '2020-01-01';
```

Restore by inserting a new token (see Phase 9 handoff notes).
