const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

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
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`;
  }
  return null;
}

/**
 * Step 1: Request a pre-signed upload URL from the backend.
 * Returns { uploadUrl, photoId, key, extension, storageRef }
 */
export async function requestUploadUrl(filename, contentType, category, fileSize) {
  const body = { filename, contentType, category };
  if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize >= 0) {
    body.fileSize = Math.round(fileSize);
  }

  const response = await fetch(`${API_BASE}/api/storage/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
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
export function uploadToS3(uploadUrl, file, contentType, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const onAbortSignal = () => {
      xhr.abort();
    };

    if (signal) {
      if (signal.aborted) {
        reject(new Error("Upload was aborted"));
        return;
      }
      signal.addEventListener("abort", onAbortSignal, { once: true });
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      if (signal) {
        signal.removeEventListener("abort", onAbortSignal);
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      if (signal) {
        signal.removeEventListener("abort", onAbortSignal);
      }
      reject(new Error("Network error during S3 upload"));
    });

    xhr.addEventListener("abort", () => {
      if (signal) {
        signal.removeEventListener("abort", onAbortSignal);
      }
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
 *
 * Retries up to 3 times with exponential back-off so that a temporary
 * server overload (CPU spike during concurrent uploads) does not silently
 * lose a photo that was already successfully uploaded to S3.
 */
export async function registerPhoto(photoId, key, category, uploadedBy) {
  const body = { photoId, key, category };
  if (uploadedBy && uploadedBy.trim()) {
    body.uploadedBy = uploadedBy.trim();
  }

  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 1500;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${API_BASE}/api/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      handle401();
      throw new Error("Session expired");
    }

    // 409 means photo already registered (duplicate) — treat as success.
    if (response.status === 409) {
      return { status: "ok" };
    }

    if (response.ok) {
      return response.json();
    }

    // 5xx errors are transient (server overloaded); retry with back-off.
    // 4xx errors (except 401/409) are permanent — fail immediately.
    const isTransient = response.status >= 500;
    if (!isTransient || attempt === MAX_ATTEMPTS) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || `Registration failed (${response.status})`);
    }

    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1.5s, 3s, 6s
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
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

/**
 * Fetch processing queue stats (admin only).
 * Returns { pending, processing, failed, done, oldestPendingSeconds }
 */
export async function fetchProcessingStats() {
  const res = await fetch(`${API_BASE}/api/admin/processing-stats`, {
    headers: { ...getAuthHeaders() },
  });

  if (res.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

/**
 * Trigger a retry for a photo (admin only).
 * Resets processing_attempts and next_attempt_at so the worker picks it up immediately.
 */
export async function retryPhoto(photoId) {
  const res = await fetch(
    `${API_BASE}/api/admin/retry-photo/${encodeURIComponent(photoId)}`,
    {
      method: "POST",
      headers: { ...getAuthHeaders() },
    }
  );

  if (res.status === 401) {
    handle401();
    throw new Error("Session expired");
  }

  if (!res.ok) throw new Error("Retry failed");
  return res.json();
}
