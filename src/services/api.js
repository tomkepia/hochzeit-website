const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Returns Authorization header object if a token is present in localStorage. */
function getAuthHeaders() {
  const token = localStorage.getItem("galleryToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Handle a 401 by clearing session and redirecting to homepage. */
function handle401() {
  localStorage.removeItem("galleryAccess");
  localStorage.removeItem("galleryToken");
  localStorage.removeItem("galleryPermissions");
  window.location.href = "/";
}

/**
 * Validate a QR access token with the backend.
 * On success returns { status, permissions }.
 */
export async function tokenLogin(token) {
  const res = await fetch(`${API_BASE}/api/auth/token-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) throw new Error("Invalid token");

  return res.json();
}

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

/**
 * Validates a file before upload.
 * Returns an error string or null if valid.
 */
export function validateFile(file) {
  if (!ALLOWED_TYPES.has(file.type)) {
    return `Unsupported file type: ${file.type || "unknown"}. Allowed: JPEG, PNG, WebP, HEIC.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 15 MB.`;
  }
  return null;
}

/**
 * Step 1: Request a pre-signed upload URL from the backend.
 * Returns { uploadUrl, photoId, key, extension, storageRef }
 */
export async function requestUploadUrl(filename, contentType, category) {
  const response = await fetch(`${API_BASE}/api/storage/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ filename, contentType, category }),
  });

  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to get upload URL (${response.status})`);
  }

  return response.json();
}

/**
 * Step 2: Upload the raw file directly to S3 using the pre-signed PUT URL.
 * onProgress(percent) is called with 0-100 as the upload progresses.
 */
export function uploadToS3(uploadUrl, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during S3 upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload was aborted"));
    });

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);
  });
}

/**
 * Step 3: Register the uploaded photo in the backend database.
 * Should only be called after a successful S3 upload.
 */
export async function registerPhoto(photoId, key, category, uploadedBy) {
  const body = { photoId, key, category };
  if (uploadedBy && uploadedBy.trim()) {
    body.uploadedBy = uploadedBy.trim();
  }

  const response = await fetch(`${API_BASE}/api/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Registration failed (${response.status})`);
  }

  return response.json();
}

/**
 * Fetch processed photos from the gallery.
 * Returns { photos: [...], hasMore: boolean }
 */
export async function fetchPhotos(category, limit = 50, offset = 0, sortMode = "upload") {
  const params = new URLSearchParams({ limit, offset });
  if (category) params.set("category", category);
  params.set("sort", sortMode === "taken" ? "taken" : "upload");

  const response = await fetch(`${API_BASE}/api/photos?${params}`, {
    headers: { ...getAuthHeaders() },
  });
  if (response.status === 401) {
    handle401();
    throw new Error("Session expired");
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch photos (${response.status})`);
  }
  return response.json();
}

/**
 * Request a ZIP for selected photo IDs and trigger browser download.
 */
export async function downloadZip(photoIds, filename = "wedding-photos.zip") {
  const response = await fetch(`${API_BASE}/api/photos/download-zip`, {
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
    throw new Error(data.detail?.message || data.detail || "Download failed");
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(url);
}

/**
 * Delete a photo by ID. Requires admin token (delete permission).
 */
export async function deletePhoto(photoId) {
  const response = await fetch(`${API_BASE}/api/photos/${encodeURIComponent(photoId)}`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
  });

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

/**
 * Bulk delete photos by IDs. Requires admin token (delete permission).
 */
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
