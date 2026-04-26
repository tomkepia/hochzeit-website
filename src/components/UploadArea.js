import React, { useCallback, useEffect, useRef, useState } from "react";
import { requestUploadUrl, uploadToS3, registerPhoto, validateFile } from "../services/api";

const MAX_CONCURRENT_UPLOADS = 2;
const MAX_IMAGE_DIMENSION = 2000;
const MAX_INPUT_DIMENSION = 8000;
const JPEG_QUALITY = 0.8;

// Status values: "queued" | "processing" | "uploading" | "done" | "error"
function createFileEntry(file) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    status: "queued",
    progress: 0,
    error: null,
    processedSize: null,
  };
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function detectTransparency(ctx, width, height) {
  const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 256));
  const { data } = ctx.getImageData(0, 0, width, height);
  const pixelStride = 4 * sampleStep;

  for (let idx = 3; idx < data.length; idx += pixelStride) {
    if (data[idx] < 255) {
      return true;
    }
  }

  return false;
}

async function resizeImage(file) {
  let bitmap;
  let canvas;

  try {
    try {
      // Respect EXIF orientation where supported.
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(file);
    }

    const { width, height } = bitmap;
    if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
      throw new Error(`Bildauflösung zu groß (max. ${MAX_INPUT_DIMENSION}px pro Seite)`);
    }

    if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
      return file;
    }

    const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
    const nextWidth = Math.max(1, Math.round(width * scale));
    const nextHeight = Math.max(1, Math.round(height * scale));

    canvas = document.createElement("canvas");
    canvas.width = nextWidth;
    canvas.height = nextHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Resize context unavailable");
    }

    ctx.drawImage(bitmap, 0, 0, nextWidth, nextHeight);

    const inputIsPng = file.type === "image/png";
    const keepPng = inputIsPng && detectTransparency(ctx, nextWidth, nextHeight);
    const outType = keepPng ? "image/png" : "image/jpeg";

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (!result) {
            reject(new Error("Resize failed"));
            return;
          }
          resolve(result);
        },
        outType,
        keepPng ? undefined : JPEG_QUALITY
      );
    });

    const baseName = stripExtension(file.name);
    const extension = keepPng ? "png" : "jpg";
    return new File([blob], `${baseName}.${extension}`, {
      type: outType,
      lastModified: file.lastModified,
    });
  } finally {
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
    }
  }
}

export default function UploadArea({ category = "guest", uploaderName = "" }) {
  const [fileEntries, setFileEntries] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeUploads, setActiveUploads] = useState(0);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const fileInputRef = useRef(null);
  const abortControllersRef = useRef(new Map());

  const updateEntry = useCallback((id, patch) => {
    setFileEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  }, []);

  const addFiles = useCallback((newFiles) => {
    const entries = [];
    for (const file of newFiles) {
      const error = validateFile(file);
      entries.push({ ...createFileEntry(file), error, status: error ? "error" : "queued" });
    }
    setFileEntries((prev) => [...prev, ...entries]);
  }, []);

  const handleFileInput = (e) => {
    addFiles(Array.from(e.target.files || []));
    // Reset input so the same file can be re-selected after removal
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(Array.from(e.dataTransfer.files || []));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const removeEntry = (id) => {
    setFileEntries((prev) => prev.filter((e) => e.id !== id));
  };

  async function uploadEntry(entry) {
    updateEntry(entry.id, { status: "processing", progress: 0, error: null });

    try {
      let processedFile;
      try {
        processedFile = await resizeImage(entry.file);
      } catch (resizeErr) {
        // Some browsers cannot decode HEIC/HEIF via createImageBitmap; fallback to original upload.
        if (entry.file.type === "image/heic" || entry.file.type === "image/heif") {
          processedFile = entry.file;
        } else {
          throw resizeErr;
        }
      }

      const controller = new AbortController();
      abortControllersRef.current.set(entry.id, controller);
      updateEntry(entry.id, { status: "uploading", progress: 0, error: null });

      // Step 1: Get pre-signed upload URL
      const { uploadUrl, photoId, key } = await requestUploadUrl(
        processedFile.name,
        processedFile.type,
        category,
        processedFile.size
      );

      // Step 2: Upload file directly to S3
      await uploadToS3(
        uploadUrl,
        processedFile,
        processedFile.type,
        (percent) => {
          updateEntry(entry.id, { progress: percent });
        },
        controller.signal
      );

      // Step 3: Register in DB only after successful S3 upload
      await registerPhoto(photoId, key, category, uploaderName);

      updateEntry(entry.id, {
        status: "done",
        progress: 100,
        processedSize: processedFile.size,
      });
    } catch (err) {
      console.error("Upload failed for", entry.file.name, err);
      updateEntry(entry.id, { status: "error", error: err.message });
    } finally {
      abortControllersRef.current.delete(entry.id);
      setActiveUploads((prev) => Math.max(0, prev - 1));
    }
  }

  useEffect(() => {
    if (!isQueueRunning) return;
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) return;

    const queued = fileEntries.filter((e) => e.status === "queued");
    if (queued.length === 0) {
      if (activeUploads === 0) {
        setIsQueueRunning(false);
      }
      return;
    }

    const availableSlots = MAX_CONCURRENT_UPLOADS - activeUploads;
    const toStart = queued.slice(0, availableSlots);

    if (toStart.length === 0) return;

    setActiveUploads((prev) => prev + toStart.length);
    toStart.forEach((entry) => {
      uploadEntry(entry);
    });
  }, [activeUploads, fileEntries, isQueueRunning]);

  function startUploads() {
    const queuedCount = fileEntries.filter((e) => e.status === "queued").length;
    if (queuedCount === 0) return;
    setIsQueueRunning(true);
  }

  const clearQueue = useCallback(() => {
    setIsQueueRunning(false);
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    setActiveUploads(0);
    setFileEntries((prev) => prev.filter((e) => e.status === "done"));
  }, []);

  const hasQueued = fileEntries.some((e) => e.status === "queued");
  const allDone = fileEntries.length > 0 && fileEntries.every((e) => e.status === "done");

  return (
    <div style={styles.container}>
      {/* Drop zone */}
      <div
        style={{
          ...styles.dropZone,
          ...(isDragOver ? styles.dropZoneActive : {}),
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        aria-label="Bilder auswählen oder hier ablegen"
      >
        <span style={styles.dropIcon}>📷</span>
        <p style={styles.dropText}>
          Bilder hier ablegen oder <u>auswählen</u>
        </p>
        <p style={styles.dropHint}>JPEG, PNG, WebP, HEIC · max. 20 MB pro Datei</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInput}
        />
      </div>

      {/* File list */}
      {fileEntries.length > 0 && (
        <div style={styles.fileList}>
          {fileEntries.map((entry) => (
            <FileRow
              key={entry.id}
              entry={entry}
              onRemove={() => removeEntry(entry.id)}
              onRetry={() => {
                updateEntry(entry.id, { status: "queued", error: null, progress: 0 });
                setIsQueueRunning(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      {fileEntries.length > 0 && (
        <div style={styles.actions}>
          {allDone ? (
            <p style={styles.successMessage}>✓ Alle Fotos wurden hochgeladen!</p>
          ) : (
            <div style={styles.actionButtons}>
              <button
                style={{ ...styles.uploadBtn, ...(hasQueued ? {} : styles.uploadBtnDisabled) }}
                onClick={startUploads}
                disabled={!hasQueued}
              >
                {activeUploads > 0
                  ? "Wird hochgeladen…"
                  : `${fileEntries.filter((e) => e.status === "queued").length} Foto(s) hochladen`}
              </button>
              <button
                style={styles.clearBtn}
                onClick={clearQueue}
                disabled={fileEntries.length === 0}
              >
                Warteschlange leeren
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({ entry, onRemove, onRetry }) {
  const { file, status, progress, error, processedSize } = entry;

  return (
    <div style={styles.fileRow}>
      <div style={styles.fileInfo}>
        <span style={styles.fileName} title={file.name}>
          {file.name}
        </span>
        <span style={styles.fileSize}>
          {(file.size / 1024 / 1024).toFixed(1)} MB
          {processedSize ? ` → ${(processedSize / 1024 / 1024).toFixed(1)} MB` : ""}
        </span>
      </div>

      {status === "queued" && <p style={styles.queuedText}>Wartet…</p>}

      {status === "processing" && <p style={styles.queuedText}>Optimieren…</p>}

      {status === "uploading" && (
        <div style={styles.progressBar}>
          <div
            style={{ ...styles.progressFill, width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}

      {status === "error" && (
        <p style={styles.errorText}>✗ {error}</p>
      )}

      <div style={styles.rowActions}>
        {status === "done" && <span style={styles.successBadge}>✓ Gespeichert</span>}
        {status === "error" && (
          <button style={styles.retryBtn} onClick={onRetry}>
            Erneut versuchen
          </button>
        )}
        {(status === "queued" || status === "error") && (
          <button style={styles.removeBtn} onClick={onRemove} aria-label="Entfernen">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "'Montserrat', sans-serif",
    maxWidth: 600,
    margin: "0 auto",
    padding: "0 16px",
  },
  dropZone: {
    border: "2px dashed #c9b99a",
    borderRadius: 12,
    padding: "40px 24px",
    textAlign: "center",
    cursor: "pointer",
    backgroundColor: "#faf7f4",
    transition: "background-color 0.2s, border-color 0.2s",
    userSelect: "none",
  },
  dropZoneActive: {
    backgroundColor: "#f0e8df",
    borderColor: "#a07850",
  },
  dropIcon: {
    fontSize: 40,
    display: "block",
    marginBottom: 8,
  },
  dropText: {
    margin: "0 0 4px",
    fontSize: 16,
    color: "#555",
  },
  dropHint: {
    margin: 0,
    fontSize: 12,
    color: "#999",
  },
  fileList: {
    marginTop: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  fileRow: {
    background: "#fff",
    borderRadius: 8,
    padding: "10px 14px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
  },
  fileInfo: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 500,
    color: "#333",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "75%",
  },
  fileSize: {
    fontSize: 12,
    color: "#999",
    flexShrink: 0,
    marginLeft: 8,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e8e0d8",
    overflow: "hidden",
    margin: "6px 0",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#a07850",
    borderRadius: 3,
    transition: "width 0.2s ease",
  },
  errorText: {
    margin: "4px 0",
    fontSize: 12,
    color: "#c0392b",
  },
  queuedText: {
    margin: "4px 0",
    fontSize: 12,
    color: "#7a6a5c",
  },
  rowActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    justifyContent: "flex-end",
  },
  successBadge: {
    fontSize: 12,
    color: "#27ae60",
    fontWeight: 500,
  },
  retryBtn: {
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid #c0392b",
    background: "none",
    color: "#c0392b",
    cursor: "pointer",
  },
  removeBtn: {
    fontSize: 12,
    padding: "3px 8px",
    borderRadius: 4,
    border: "1px solid #ccc",
    background: "none",
    color: "#888",
    cursor: "pointer",
  },
  actions: {
    marginTop: 16,
    textAlign: "center",
  },
  actionButtons: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  uploadBtn: {
    padding: "12px 28px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    backgroundColor: "#a07850",
    color: "#fff",
    cursor: "pointer",
    width: "100%",
    maxWidth: 340,
    transition: "background-color 0.2s",
  },
  clearBtn: {
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 8,
    border: "1px solid #d2c2b1",
    backgroundColor: "#fff",
    color: "#7a6755",
    cursor: "pointer",
  },
  uploadBtnDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed",
  },
  successMessage: {
    fontSize: 16,
    color: "#27ae60",
    fontWeight: 600,
  },
};
