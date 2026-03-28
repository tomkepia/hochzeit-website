# Phase 11 Implementation – Admin Capabilities (Delete + Bulk Delete + Admin Upload + Token-Based Admin Access)

**Date:** 28. März 2026  
**Phase:** 11 of 11  
**Status:** Complete  
**Builds on:** Phase 10 (Password-Based Token Login)

---

## Overview

Phase 11 adds admin-only capabilities to the gallery while preserving the existing token-based security model in full. Before this phase all gallery tokens were equivalent — any valid token granted upload and view access, and no mechanism existed to delete photos or to upload into the photographer category. After Phase 11 two tiers of tokens exist: guest tokens and admin tokens. The distinction is encoded in the token's `permissions` column in the database.

In addition to single-photo deletion, admins can now perform bulk deletion from selection mode. This is implemented as a dedicated backend endpoint with the same `delete` permission guard, plus an admin-only frontend action.

No new authentication mechanism was introduced. Role enforcement is entirely token-driven: the backend reads the `permissions` column on every request and enforces the required permission before executing the action. The frontend reads the same permissions value from `localStorage` to show or hide UI elements, but the frontend is never trusted to grant permissions — it is used for UX only.

---

## Architecture

### Token roles

| Role | `permissions` column value | Capabilities |
|---|---|---|
| Guest | `upload:view` | View gallery, upload photos (as `guest` category) |
| Admin | `upload:view:delete:admin` | All guest capabilities + single delete + bulk delete + upload as `photographer` category |

Permissions are stored as colon-delimited strings. Individual permission tokens are matched by splitting on `:` and checking membership. This means `"delete"` in `"upload:view:delete:admin".split(":")` is `true`, but `"delete"` in `"upload:view"` is `false`.

### Key principle

```
Token = identity + permissions
```

The backend never trusts the frontend to declare what role the caller has. The token presented in the `Authorization: Bearer` header is looked up in the database, and the `permissions` column on that row determines what actions are permitted. The frontend checks permissions only to control visibility — not to grant access.

---

## Part 1 – Backend Changes

---

### 1.1 `require_gallery_access` — converted to dependency factory

**Before (Phase 10):**

```python
def require_gallery_access(request: Request, db: Session = Depends(get_db)):
    # ... validates token ...
    # returns nothing (used only as a guard)
```

The function was a plain FastAPI dependency. It validated the token but did not return the token object, and it had no way to enforce per-endpoint permissions. All endpoints using it were equivalent.

**After (Phase 11):**

```python
def require_gallery_access(required_permission: str = None):
    def dependency(request: Request, db: Session = Depends(get_db)):
        # ... validates token ...
        if required_permission:
      permissions_set = set((token_obj.permissions or "").split(":"))
      if required_permission not in permissions_set:
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        return token_obj
    return dependency
```

The function is now a **factory** that returns a FastAPI dependency closure. Callers pass the required permission as a string:

```python
Depends(require_gallery_access())            # any valid token accepted
Depends(require_gallery_access("delete"))   # token must include "delete" permission
```

The inner dependency returns the `AccessToken` ORM object so that endpoints can inspect the token's full permissions without a second database query.

**Why a factory instead of a parameter?**

FastAPI resolves `Depends(...)` at decoration time, before any request arrives. A plain function signature cannot accept a per-endpoint permission argument because FastAPI would interpret any parameter as a request-level dependency. The factory pattern — a function that returns a dependency — solves this: the outer call happens at decoration time (where the permission string is bound), and the inner function runs at request time.

**Permission comparison:**

```python
permissions_set = set((token_obj.permissions or "").split(":"))
if required_permission not in permissions_set:
```

String splitting on `:` is used rather than `in` on the raw string to prevent substring false-positives. For example, `"view"` is `in` the string `"upload:view:delete:admin"` as a substring, but so would `"dmin"` or `"pload"`. Splitting ensures only whole permission tokens are matched.

---

### 1.2 `token-login` — returns permissions

**Before:**
```python
return {"status": "ok"}
```

**After:**
```python
return {"status": "ok", "permissions": token_obj.permissions or ""}
```

The QR token login endpoint now returns the permissions string alongside the status. The frontend uses this to persist `galleryPermissions` in `localStorage` immediately after a QR-code scan, without needing a separate permissions-lookup call.

---

### 1.3 `password-login` — returns permissions

**Before:**
```python
return {
    "token": token_obj.token,
    "expiresAt": token_obj.expires_at.isoformat(),
}
```

**After:**
```python
return {
    "token": token_obj.token,
    "expiresAt": token_obj.expires_at.isoformat(),
    "permissions": token_obj.permissions or "",
}
```

Password login returns the same `permissions` field as token login. The endpoint now explicitly selects guest-tier tokens only (`permissions == "upload:view"`), so password login cannot return an admin token even if an admin token has a longer expiry. The endpoint does not create or modify permissions; it surfaces the selected token's permissions.

**Why `password-login` is not the admin entry path:**

The admin token value (`upload:view:delete:admin`) lives in the database and is attached to a specific token row. Password login now filters to `permissions == "upload:view"`, so it cannot return an admin token by design. Admin access remains QR/direct-token based (`/gallery?token=ADMIN_TOKEN`), while password login remains guest-tier.

---

### 1.4 `POST /api/photos` — category enforcement

**Before:**
```python
@router.post("", dependencies=[Depends(require_gallery_access)])
def register_photo(request: PhotoRegisterRequest, db: Session = Depends(get_db)):
    photo.category = request.category
```

**After:**
```python
@router.post("")
def register_photo(
    request: PhotoRegisterRequest,
    db: Session = Depends(get_db),
    token_obj=Depends(require_gallery_access()),
):
    permissions_set = set((token_obj.permissions or "").split(":"))
    effective_category = request.category if "admin" in permissions_set else "guest"
    photo.category = effective_category
```

The endpoint now injects `token_obj` (returned by the factory dependency) as a named parameter rather than using `dependencies=[...]`. This allows the handler body to read the token's permissions. The category that the client sends in the request body is used only if the token has `"admin"` permission; otherwise `"guest"` is always stored regardless of what the client sent.

This means:
- A guest that modifies their request to send `category: "photographer"` will have it silently overridden to `"guest"`.
- Logging uses `effective_category` (the value actually stored) rather than `request.category` (what the client claimed).
- The `Pydantic` validator on `PhotoRegisterRequest.category` still runs and still rejects any value outside `{"guest", "photographer"}` — the category enforcement adds a second, token-based gate on top of the existing input validation.

---

### 1.5 New endpoint: `DELETE /api/photos/{photo_id}`

```python
@router.delete("/{photo_id}", dependencies=[Depends(require_gallery_access("delete"))])
def delete_photo(photo_id: str, db: Session = Depends(get_db)):
    try:
        photo_uuid = uuid_lib.UUID(photo_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid photo ID")

    photo = db.query(Photo).filter(Photo.id == photo_uuid).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    for key in [photo.original_key, photo.preview_key, photo.thumbnail_key]:
        if key:
            try:
                storage.delete_file(key)
            except Exception:
                logger.exception("Failed to delete key=%s from storage", key)

    db.delete(photo)
    db.commit()

    return {"status": "deleted"}
```

**Design decisions:**

- **Permission guard via factory:** `Depends(require_gallery_access("delete"))` uses the factory to enforce the `"delete"` permission at the framework level, before the handler body runs. A guest token results in HTTP 403 before any database query is made.
- **UUID parsing before DB query:** The `photo_id` path parameter arrives as a plain string. Parsing it with `uuid_lib.UUID()` before querying prevents invalid UUIDs from reaching the database and returns a clean 400 rather than a SQLAlchemy error.
- **Best-effort S3 deletion:** All three S3 keys are attempted independently. If deletion of one variant fails (e.g. the thumbnail was never generated because processing failed), the exception is logged but does not abort the others or the database row deletion. Partial S3 failures result in orphaned objects in the bucket — this is acceptable because the DB row (the authoritative source of truth for the gallery) is gone, so the orphaned objects will never be served.
- **Order: S3 first, then DB:** S3 deletion is attempted before the database row is deleted. If S3 deletion fails entirely and an exception is raised (rather than caught), the database row remains intact and the photo stays visible in the gallery. This is the safer failure mode: a visible photo with broken storage is preferable to a broken reference in the database.
- **`"delete"` permission is scoped.** Only tokens explicitly granted the `"delete"` permission can call this endpoint. Having `"admin"` permission alone is not sufficient — the `"delete"` string must appear in the permissions. Admin tokens as provisioned in the database are expected to include both (`"upload:view:delete:admin"`).
- **No soft delete.** Photos are permanently removed from both S3 and the database. No recycle bin or undo mechanism was added.

---

### 1.6 New endpoint: `POST /api/photos/bulk-delete`

```python
@router.post("/bulk-delete", dependencies=[Depends(require_gallery_access("delete"))])
def bulk_delete_photos(request: BulkDeleteRequest, db: Session = Depends(get_db)):
  photo_ids = [uuid_lib.UUID(photo_id) for photo_id in request.photoIds]

  photos = db.query(Photo).filter(Photo.id.in_(photo_ids)).all()
  found_ids = {str(photo.id) for photo in photos}
  missing_ids = [photo_id for photo_id in request.photoIds if photo_id not in found_ids]

  for photo in photos:
    _delete_photo_assets(photo)
    db.delete(photo)

  db.commit()

  return {
    "status": "deleted",
    "deletedCount": len(photos),
    "missingPhotoIds": missing_ids,
  }
```

**Bulk request validation (`BulkDeleteRequest`):**

- `photoIds` must be non-empty.
- Maximum batch size is `MAX_BULK_DELETE_PHOTOS = 200`.
- IDs are UUID-validated, normalized, deduplicated in-order.

**Design decisions:**

- **Dedicated endpoint instead of N single DELETE requests:** reduces client-server round trips and keeps batch deletion atomic at DB commit level.
- **Same permission guard as single delete:** `require_gallery_access("delete")` ensures policy parity for both single and bulk deletion.
- **Missing IDs are reported, not fatal:** the endpoint deletes everything it can and returns `missingPhotoIds` for observability; this avoids failing the entire batch when some IDs were already removed.
- **Shared delete helper:** both single and bulk deletion use `_delete_photo_assets(photo)` so S3 cleanup behavior stays consistent.

---

### 1.7 New `storage.delete_file` function

```python
def delete_file(key: str) -> None:
    """Delete a file from S3 by its key."""
    client = _get_s3_client()
    bucket = _get_bucket()
    client.delete_object(Bucket=bucket, Key=key)
    logger.info("Deleted file s3://%s/%s", bucket, key)
```

Added to `backend/services/storage.py`. Uses `delete_object` from the existing boto3 client. Note that S3's `delete_object` is idempotent: calling it on a key that does not exist returns success rather than an error. This means attempting to delete a variant that was never written (e.g. thumbnail for a failed processing job) will not raise an exception.

---

### 1.8 `require_gallery_access` call sites updated

All existing endpoints that used `Depends(require_gallery_access)` (the old direct-function form) were updated to `Depends(require_gallery_access())` (the new factory-invocation form):

| Router | Endpoint | Before | After |
|---|---|---|---|
| `photos.py` | `GET /api/photos` | `Depends(require_gallery_access)` | `Depends(require_gallery_access())` |
| `photos.py` | `POST /api/photos/download-zip` | `Depends(require_gallery_access)` | `Depends(require_gallery_access())` |
| `photos.py` | `POST /api/photos` | `dependencies=[Depends(require_gallery_access)]` | injected as `token_obj` parameter |
| `photos.py` | `POST /api/photos/bulk-delete` | n/a | `Depends(require_gallery_access("delete"))` |
| `storage.py` | `POST /api/storage/upload-url` | `Depends(require_gallery_access)` | `Depends(require_gallery_access())` |

---

## Part 2 – Frontend Changes

---

### 2.1 `galleryPermissions` — new localStorage key

A new key `galleryPermissions` is stored in `localStorage` alongside the existing `galleryToken` and `galleryAccess` keys. Its value is the colon-delimited permissions string received from the backend at login time.

**Admin detection pattern (used in every component that needs it):**

```js
const permissions = localStorage.getItem("galleryPermissions") || ""
const isAdmin = permissions.split(":").includes("admin")
```

The same split-based comparison used in the backend is mirrored in the frontend to avoid substring false-positives.

**`isAdmin` is used for UI only.** It controls whether admin-only elements (category toggle, delete buttons) are rendered. The backend enforces all actual permissions independently.

---

### 2.2 `api.js` — four changes

**`handle401` — clears `galleryPermissions`:**

```js
function handle401() {
  localStorage.removeItem("galleryAccess");
  localStorage.removeItem("galleryToken");
  localStorage.removeItem("galleryPermissions");   // ← new
  window.location.href = "/";
}
```

Permissions are cleared alongside the token on session expiry. Without this, stale permissions from a previous admin session could persist in `localStorage` and incorrectly show admin UI elements to the next user on the same browser.

**`tokenLogin` — returns full JSON:**

```js
// Before
export async function tokenLogin(token) {
  // ...
  return true;
}

// After
export async function tokenLogin(token) {
  // ...
  return res.json();  // { status: "ok", permissions: "..." }
}
```

Previously the function only returned `true` on success. Now it returns the full response body so the caller can extract and store `permissions`.

**New `deletePhoto` function:**

```js
export async function deletePhoto(photoId) {
  const response = await fetch(
    `${API_BASE}/api/photos/${encodeURIComponent(photoId)}`,
    {
      method: "DELETE",
      headers: { ...getAuthHeaders() },
    }
  );

  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Delete failed (${response.status})`);
  }

  return response.json();
}
```

The function uses `encodeURIComponent` on the photo ID to prevent path traversal via a crafted UUID. It follows the same 401-handling pattern as all other API functions.

**New `bulkDeletePhotos` function:**

```js
export async function bulkDeletePhotos(photoIds) {
  const response = await fetch(`${API_BASE}/api/photos/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ photoIds }),
  });

  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Bulk delete failed (${response.status})`);
  }

  return response.json();
}
```

This mirrors the single-delete error/session handling and returns `{ status, deletedCount, missingPhotoIds }`.

---

### 2.3 `GalleryEntryPage.js` — stores permissions on QR login

**Before:**
```js
tokenLogin(token)
  .then(() => {
    localStorage.setItem("galleryToken", token);
    localStorage.setItem("galleryAccess", "true");
    window.history.replaceState({}, "", "/gallery");
  })
```

**After:**
```js
tokenLogin(token)
  .then((data) => {
    localStorage.setItem("galleryToken", token);
    localStorage.setItem("galleryAccess", "true");
    localStorage.setItem("galleryPermissions", data.permissions || "");
    window.history.replaceState({}, "", "/gallery");
  })
```

`tokenLogin` now returns the full response object from which `data.permissions` is extracted. If the backend returns an empty string or the field is absent, an empty string is stored — which means `isAdmin` will be `false` in all consuming components.

---

### 2.4 `PasswordGate.js` — stores permissions on password login

**Before:**
```js
const result = await passwordLogin(input);
localStorage.setItem('galleryToken', result.token);
localStorage.setItem('galleryAccess', 'true');
navigate('/gallery');
```

**After:**
```js
const result = await passwordLogin(input);
localStorage.setItem('galleryToken', result.token);
localStorage.setItem('galleryAccess', 'true');
localStorage.setItem('galleryPermissions', result.permissions || '');  // ← new
navigate('/gallery');
```

The `passwordLogin` API function already returned `result.permissions` from the backend response — storing it required only adding one `localStorage.setItem` call.

---

### 2.5 `UploadPage.js` — admin category toggle

**New state and admin detection:**

```js
const permissions = localStorage.getItem("galleryPermissions") || "";
const isAdmin = permissions.split(":").includes("admin");

const [category, setCategory] = useState("guest");
```

`isAdmin` is derived once at render time (not in a `useEffect`) because `localStorage` is synchronous and does not change during a page session. `category` defaults to `"guest"` — the toggle only overrides this for admin users.

**Category toggle UI (admin-only):**

```jsx
{isAdmin && (
  <div style={styles.categorySection}>
    <p style={styles.label}>Kategorie</p>
    <div style={styles.categoryToggle}>
      <button
        type="button"
        onClick={() => setCategory("guest")}
        style={category === "guest" ? styles.categoryActive : styles.categoryInactive}
      >
        Gästefotos
      </button>
      <button
        type="button"
        onClick={() => setCategory("photographer")}
        style={category === "photographer" ? styles.categoryActive : styles.categoryInactive}
      >
        Fotografenfotos
      </button>
    </div>
  </div>
)}
```

The pills reuse the same visual style as the category tabs on `PhotosPage` — same border, background, and font weight logic. They are rendered only when `isAdmin` is `true`; guests see the upload area with no category controls.

**`UploadArea` receives effective category:**

```jsx
<UploadArea category={isAdmin ? category : "guest"} uploaderName={uploaderName} />
```

Even if a guest manipulates the DOM to call `setCategory("photographer")`, the prop passed to `UploadArea` clamps it back to `"guest"`. This is a redundant frontend guard — the backend enforces the same rule independently.

**Styling** uses pill-shaped buttons matching the gallery tab style:

```js
categoryActive: {
  padding: "10px 24px",
  borderRadius: 9999,
  border: "1px solid #8b7355",
  background: "#8b7355",
  color: "white",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "'Montserrat', sans-serif",
},
categoryInactive: {
  padding: "10px 24px",
  borderRadius: 9999,
  border: "1px solid #d8cfc4",
  background: "transparent",
  color: "#6b5c4e",
  fontWeight: 400,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "'Montserrat', sans-serif",
},
```

---

### 2.6 `PhotoGrid.js` — delete button per photo

**New props:**

```js
export default function PhotoGrid({
  photos,
  onPhotoClick,
  selectionMode = false,
  selectedPhotoIds = new Set(),
  onToggleSelect,
  isAdmin = false,   // ← new
  onDelete,          // ← new
}) {
```

**Delete button overlay:**

```jsx
{isAdmin && !selectionMode && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onDelete?.(photo.id);
    }}
    aria-label="Foto löschen"
    style={{
      position: "absolute",
      top: 6,
      right: 6,
      background: "rgba(0,0,0,0.6)",
      color: "white",
      border: "none",
      borderRadius: "50%",
      width: 28,
      height: 28,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 14,
      lineHeight: 1,
      padding: 0,
    }}
  >
    ✕
  </button>
)}
```

**Design decisions:**

- **`!selectionMode` guard:** The delete button is hidden when selection mode is active. Selection mode activates multi-photo download. Showing delete buttons simultaneously with selection checkmarks would create a confusing and risky UI — a misclick could delete instead of select.
- **`e.stopPropagation()`:** The delete button sits inside a `<button>` element (the photo tile). Without stop propagation, clicking the delete button would also fire the tile's `onClick`, which would open the lightbox. Stopping propagation keeps the two interactions separate.
- **`onDelete?.()` optional chaining:** Guards against the case where `isAdmin` is `true` but `onDelete` was not passed (e.g., a future consumer of `PhotoGrid` that doesn't need delete). The button renders but the click is a no-op rather than a crash.
- **`aria-label="Foto löschen"`:** The `✕` character alone has no semantic meaning to screen readers. The `aria-label` provides the accessible name.
- **Position:** `top: 6, right: 6` places the button in the top-right corner of the photo tile, consistent with the convention for close/dismiss controls.

---

### 2.7 `PhotosPage.js` — admin detection and delete handler

**Admin detection:**

```js
const permissions = localStorage.getItem("galleryPermissions") || "";
const isAdmin = permissions.split(":").includes("admin");
```

Added directly after `backLink`/`uploadLink` derivation. `isAdmin` is used in two places: the `handleDelete` callback definition and the `PhotoGrid` props.

**`handleDelete`:**

```js
const handleDelete = useCallback(async (photoId) => {
  const confirmed = window.confirm("Foto wirklich löschen?");
  if (!confirmed) return;

  try {
    await deletePhoto(photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    showToast("Foto gelöscht");
  } catch {
    showToast("Löschen fehlgeschlagen");
  }
}, [showToast]);
```

- **`window.confirm`:** A native browser confirmation dialog prevents accidental deletion. It is synchronous, blocking the handler until the user responds. No custom modal was introduced to keep the implementation minimal.
- **Optimistic removal:** On success the photo is immediately removed from `photos` state without waiting for a full gallery refresh. This gives instant feedback. If the next data load finds the photo gone from the backend, the state is consistent. If the user refreshes, the photo will no longer appear.
- **`useCallback` with `[showToast]` dependency:** The handler is memoized to prevent PhotoGrid from receiving a new function reference on every render, which would cause unnecessary re-renders of photo tiles.
- **Error handling:** Any exception from `deletePhoto` (network error, 403, 404) is caught and shown as a toast. The error is not re-thrown. The UI remains functional; the photo stays visible because the `filter` only runs on success.

**`PhotoGrid` with new props:**

```jsx
<PhotoGrid
  photos={photos}
  onPhotoClick={setLightboxIndex}
  selectionMode={selectionMode}
  selectedPhotoIds={selectedPhotoIds}
  onToggleSelect={togglePhotoSelection}
  isAdmin={isAdmin}       // ← new
  onDelete={handleDelete} // ← new
/>
```

### 2.8 `PhotosPage.js` — bulk delete in selection mode (admin only)

Admins now see a `Löschen` action in the selection toolbar.

**Bulk delete handler:**

```js
const handleBulkDeleteSelected = async () => {
  if (!isAdmin || isDownloading || isBulkDeleting) return;
  if (selectedCount === 0) return;

  const confirmed = window.confirm(`${selectedCount} Foto(s) wirklich löschen?`);
  if (!confirmed) return;

  const idsToDelete = Array.from(selectedPhotoIds);
  const result = await bulkDeletePhotos(idsToDelete);
  const deletedSet = new Set(idsToDelete);
  setPhotos((prev) => prev.filter((photo) => !deletedSet.has(photo.id)));
  setSelectedPhotoIds(new Set());
  setSelectionMode(false);
  // toast based on result.deletedCount / result.missingPhotoIds
};
```

**UI behavior:**

- `Löschen` button appears only when `isAdmin && selectionMode`.
- Controls are disabled while `isBulkDeleting` to avoid mixed actions (download + delete at once).
- Confirmation is mandatory before deleting selected photos.
- On success the UI removes deleted items immediately and exits selection mode.
- If some IDs are missing on the backend, user still sees partial success messaging.

---

## Part 3 – Unified Permission Flow

### QR token login with admin token

```
User opens /gallery?token=ADMIN_TOKEN
        ↓
GalleryEntryPage mounts, calls tokenLogin("ADMIN_TOKEN")
  POST /api/auth/token-login { token: "ADMIN_TOKEN" }
        ↓
Backend: DB lookup → token found, not expired
  token_obj.permissions = "upload:view:delete:admin"
        ↓
{ "status": "ok", "permissions": "upload:view:delete:admin" }
        ↓
localStorage:
  galleryToken       = "ADMIN_TOKEN"
  galleryAccess      = "true"
  galleryPermissions = "upload:view:delete:admin"
        ↓
window.history.replaceState({}, "", "/gallery")
        ↓
isAdmin = true (in all consuming components)
```

### Guest QR token login

```
User opens /gallery?token=GUEST_TOKEN
        ↓
POST /api/auth/token-login { token: "GUEST_TOKEN" }
        ↓
{ "status": "ok", "permissions": "upload:view" }
        ↓
localStorage:
  galleryPermissions = "upload:view"
        ↓
isAdmin = false → no delete buttons, no category toggle
```

### Admin attempts to upload photographer photo

```
Admin selects "Fotografenfotos" toggle on UploadPage
  category state = "photographer"
        ↓
UploadArea receives category = "photographer"
  requestUploadUrl(filename, contentType, "photographer")
        ↓
POST /api/storage/upload-url  { category: "photographer" }
  Authorization: Bearer ADMIN_TOKEN
        ↓
Backend: require_gallery_access() → token valid → no permission restriction
  Key generated: wedding/photographer/original/<uuid>.jpg
        ↓
S3 upload (client-side, to presigned URL)
        ↓
POST /api/photos  { category: "photographer", ... }
  Authorization: Bearer ADMIN_TOKEN
        ↓
Backend: require_gallery_access() → token_obj.permissions = "upload:view:delete:admin"
  "admin" in ["upload", "view", "delete", "admin"] → True
  effective_category = "photographer"
        ↓
Photo stored in DB with category = "photographer"
```

### Guest attempts to spoof category

```
Guest manually crafts request:
POST /api/photos  { category: "photographer", ... }
  Authorization: Bearer GUEST_TOKEN
        ↓
Backend: token_obj.permissions = "upload:view"
  "admin" in ["upload", "view"] → False
  effective_category = "guest"
        ↓
Photo stored with category = "guest" regardless of request
```

### Admin deletes a photo

```
Admin clicks ✕ on a photo tile
        ↓
window.confirm("Foto wirklich löschen?") → user clicks OK
        ↓
deletePhoto(photoId)
  DELETE /api/photos/<uuid>
  Authorization: Bearer ADMIN_TOKEN
        ↓
Backend: require_gallery_access("delete")
  "delete" in ["upload", "view", "delete", "admin"] → True → proceed
        ↓
DB lookup → photo found
S3 delete: original_key, preview_key, thumbnail_key (best-effort)
DB delete photo row
DB commit
        ↓
{ "status": "deleted" }
        ↓
setPhotos(prev => prev.filter(p => p.id !== photoId))
showToast("Foto gelöscht")
```

### Guest attempts to delete a photo

```
Guest crafts DELETE /api/photos/<uuid>
  Authorization: Bearer GUEST_TOKEN
        ↓
Backend: require_gallery_access("delete")
  token_obj.permissions = "upload:view"
  "delete" in ["upload", "view"] → False
        ↓
HTTP 403 Forbidden  { "detail": "Insufficient permissions" }
```

### Admin bulk deletes selected photos

```
Admin enters selection mode, selects multiple photos
  ↓
Clicks "Löschen"
  ↓
window.confirm("N Foto(s) wirklich löschen?")
  ↓
bulkDeletePhotos(photoIds)
  POST /api/photos/bulk-delete
  Authorization: Bearer ADMIN_TOKEN
  ↓
Backend: require_gallery_access("delete")
  "delete" in ["upload", "view", "delete", "admin"] → True
  ↓
All found photos: delete S3 assets + DB rows
DB commit once
  ↓
{ "status": "deleted", "deletedCount": N, "missingPhotoIds": [...] }
  ↓
Frontend removes deleted IDs from state,
clears selection, shows success/partial-success toast
```

---

## Part 4 – Security Properties

| Property | How it is met |
|---|---|
| Category spoofing impossible | Backend overwrites `category` with `"guest"` if token lacks `"admin"` permission, regardless of request body |
| Delete requires backend token permission | `require_gallery_access("delete")` enforces at the framework level; handler body never runs for unauthorized tokens |
| Bulk delete also requires backend token permission | `POST /api/photos/bulk-delete` uses the same `require_gallery_access("delete")` guard as single delete |
| Frontend admin flags are UX only | `isAdmin` in all components derives from `localStorage` but the backend re-validates independently on every request |
| Stale permissions cleared on 401 | `handle401()` removes `galleryPermissions` alongside `galleryToken` and `galleryAccess` |
| No new auth mechanism | All permission checks are based on the existing `AccessToken.permissions` column; no new tables, endpoints, or auth flows were introduced |
| No frontend-trusted category | The `UploadArea` prop clamps category to `"guest"` for non-admin users as a redundant UI safeguard; the backend is the authoritative enforcement point |
| Path traversal on delete prevented | `encodeURIComponent` on photo ID in frontend; UUID parse validation on backend before any DB/S3 access |

---

## Part 5 – Session Lifecycle (Updated)

| Event | `galleryPermissions` change |
|---|---|
| QR admin token login | Set to `"upload:view:delete:admin"` |
| QR guest token login | Set to `"upload:view"` |
| Password login (guest token retrieved) | Set to `"upload:view"` or whichever permissions the returned token has |
| `handle401` fires (expired token) | Cleared to `undefined` |
| 30-minute session timer on MainPage | Clears `galleryPermissions` together with `galleryAccess` and `galleryToken` |

---

## File Structure After Phase 11

```
backend/
  services/
    storage.py              ← MODIFIED: delete_file() added
  routers/
    auth.py                 ← MODIFIED: require_gallery_access converted to factory;
                                         token-login returns permissions;
                                         password-login returns permissions
    photos.py               ← MODIFIED: all Depends() updated to factory form;
                                         register_photo enforces category;
                                         DELETE /{photo_id} and POST /bulk-delete
                                         endpoints added
    storage.py              ← MODIFIED: Depends(require_gallery_access()) factory form

src/
  services/
    api.js                  ← MODIFIED: handle401 clears galleryPermissions;
                                         tokenLogin returns full JSON;
                                         deletePhoto() + bulkDeletePhotos() added
  pages/
    GalleryEntryPage.js     ← MODIFIED: stores galleryPermissions from tokenLogin
    UploadPage.js           ← MODIFIED: isAdmin detection; category state;
                                         category toggle UI; category prop to UploadArea
    PhotosPage.js           ← MODIFIED: isAdmin detection; handleDelete; passes
                                         isAdmin and onDelete to PhotoGrid;
                                         selection-mode bulk delete action
  components/
    PasswordGate.js         ← MODIFIED: stores galleryPermissions from passwordLogin
    PhotoGrid.js            ← MODIFIED: isAdmin and onDelete props; delete button overlay
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Factory pattern for `require_gallery_access` | FastAPI resolves `Depends()` at decoration time. A factory allows per-endpoint permission strings to be bound at decoration time while the actual enforcement runs at request time. |
| Permission check uses `split(":")` not `in` | Substring `in` would match partial strings (e.g. `"dmin" in "admin"`). Splitting on `:` ensures only complete permission tokens are matched. |
| Token object returned from dependency | Returning `token_obj` from the dependency avoids a second DB query in endpoints that need to inspect permissions (e.g., `register_photo`). The dependency already fetched the object; it is reused. |
| Category enforcement in `register_photo`, not validation | The Pydantic validator already ensures `category` is one of `{"guest", "photographer"}`. The permission-based enforcement is a second gate that silently overrides the value rather than rejecting the request. Guests are not told their category was changed — they receive `{"status": "ok"}` and the photo is stored as `"guest"`. Rejecting would be equally correct but more disruptive to the upload flow. |
| `DELETE` uses `dependencies=[...]` not injected token | The delete handler does not need to inspect the token's permissions beyond what `require_gallery_access("delete")` already checked. Using `dependencies=[...]` is cleaner when no token data is needed in the body. |
| Bulk delete uses one commit per batch | Deleting selected rows in one endpoint and committing once gives consistent batch semantics and lower overhead than issuing one HTTP request per photo. |
| S3 deletion is best-effort, DB deletion is mandatory | If S3 deletion fails, orphaned objects accumulate in the bucket but are never served (no DB row). If DB deletion is skipped after S3 success, the gallery shows a photo with broken URLs. The chosen order (S3 then DB) minimizes visible breakage. |
| No soft delete / recycle bin | Kept out of scope to honour the "minimal implementation" requirement. A recycle bin would require a new DB column, an API for restoration, and UI changes. |
| Delete button hidden in selection mode | Selection mode and deletion are mutually exclusive UI interactions. Overlapping them would create an ambiguous and risky experience — a single tap could either select or delete depending on target precision. |
| `window.confirm` for delete confirmation | A native dialog is synchronous, requires no state management, and is universally understood. A custom modal dialog would be more stylistically consistent but was not implemented to keep scope minimal. |
| `galleryPermissions` cleared on 401 | A 401 means the token is invalid or expired. Stale permissions in storage after session expiry could result in admin UI elements being shown to the next user of the same browser without them being able to exercise the corresponding backend permissions. Clearing permissions ensures visual consistency with the actual auth state. |

---

## Testing Checklist

### Backend

```
[ ] DELETE /api/photos/<id> with admin token → 200 { "status": "deleted" }
[ ] DELETE /api/photos/<id> with guest token → 403 Insufficient permissions
[ ] DELETE /api/photos/<id> with invalid UUID → 400 Invalid photo ID
[ ] DELETE /api/photos/<nonexistent-id> with admin token → 404
[ ] POST /api/photos/bulk-delete with admin token → 200 + deletedCount
[ ] POST /api/photos/bulk-delete with guest token → 403 Insufficient permissions
[ ] POST /api/photos/bulk-delete with >200 IDs → 422 validation error
[ ] POST /api/photos/bulk-delete with mixed existing/missing IDs → 200 + missingPhotoIds
[ ] POST /api/photos with admin token and category=photographer → stored as photographer
[ ] POST /api/photos with guest token and category=photographer → stored as guest
[ ] POST /api/auth/token-login → response includes "permissions" field
[ ] POST /api/auth/password-login → response includes "permissions" field
[ ] GET /api/photos still works with guest token (no regression)
[ ] GET /api/storage/upload-url still works with guest token (no regression)
[ ] POST /api/photos/download-zip still works with guest token (no regression)
```

### Frontend — Admin

```
[ ] Log in via admin QR token → galleryPermissions = "upload:view:delete:admin"
[ ] ✕ button visible on each photo tile (PhotosPage)
[ ] Delete button NOT shown when selection mode is active
[ ] Clicking ✕ → confirm dialog appears
[ ] Confirming → photo disappears from grid, "Foto gelöscht" toast shown
[ ] Cancelling confirm → no action taken, photo remains
[ ] In selection mode, admin sees "Löschen" button
[ ] Bulk delete confirm appears with selected count
[ ] Confirming bulk delete removes all selected photos and exits selection mode
[ ] While bulk delete runs, download/select controls are disabled
[ ] Category toggle visible on UploadPage
[ ] Selecting "Fotografenfotos" → UploadArea receives category="photographer"
[ ] Upload as photographer → photo appears in Fotografenfotos tab
```

### Frontend — Guest

```
[ ] Log in via guest QR token → galleryPermissions = "upload:view"
[ ] ✕ buttons NOT visible on any photo tile
[ ] Category toggle NOT visible on UploadPage
[ ] upload request uses category="guest" (inspect network requests)
[ ] Manual DELETE request from browser → 403 response
[ ] Manual POST /api/photos/bulk-delete from browser → 403 response
```

### Session / Auth

```
[ ] 401 response from any API call → galleryPermissions cleared from localStorage
[ ] After 401 redirect to / → login again → correct permissions written
[ ] Password login → galleryPermissions stored from response
[ ] Permissions survive page reload (read from localStorage on mount)
[ ] No regression: QR guest flow, password login flow, download, lightbox
```

---

## Phase 11 Handoff Notes

**To provision an admin token:**

```sql
-- Example: insert an admin token valid for 365 days
INSERT INTO access_tokens (id, token, expires_at, permissions)
VALUES (
  gen_random_uuid(),
  encode(gen_random_bytes(32), 'hex'),
  NOW() + INTERVAL '365 days',
  'upload:view:delete:admin'
);
```

After inserting, query the `token` value and share it as a QR code or direct link:
```
https://yourdomain.com/gallery?token=<admin-token-value>
```

**To provision a guest token:**

```sql
INSERT INTO access_tokens (id, token, expires_at, permissions)
VALUES (
  gen_random_uuid(),
  encode(gen_random_bytes(32), 'hex'),
  NOW() + INTERVAL '30 days',
  'upload:view'
);
```

**To verify DELETE works without a frontend:**

```bash
# List photos, grab an ID
curl -sS "http://localhost:8000/api/photos" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" | python3 -m json.tool

# Delete a photo
curl -sS -X DELETE "http://localhost:8000/api/photos/<PHOTO_UUID>" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# Confirm guest token gets 403
curl -sS -X DELETE "http://localhost:8000/api/photos/<PHOTO_UUID>" \
  -H "Authorization: Bearer <GUEST_TOKEN>"

# Bulk delete photos
curl -sS -X POST "http://localhost:8000/api/photos/bulk-delete" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"photoIds":["<PHOTO_UUID_1>","<PHOTO_UUID_2>"]}'
```

**To verify category enforcement:**

```bash
# Guest token: send photographer category — backend stores as guest
curl -sS -X POST "http://localhost:8000/api/photos" \
  -H "Authorization: Bearer <GUEST_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"photoId":"<UUID>","key":"some/key","category":"photographer"}'
# Check DB: category should be "guest"
```
