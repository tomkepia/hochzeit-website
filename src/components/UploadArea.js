import React, { useCallback, useRef, useState } from "react";
import { requestUploadUrl, uploadToS3, registerPhoto, validateFile } from "../services/api";

const MAX_CONCURRENT = 4;

// Status values: "pending" | "uploading" | "success" | "error"
function createFileEntry(file) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    status: "pending",
    progress: 0,
    error: null,
  };
}

export default function UploadArea({ category = "guest", uploaderName = "" }) {
  const [fileEntries, setFileEntries] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const updateEntry = useCallback((id, patch) => {
    setFileEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  }, []);

  const addFiles = useCallback((newFiles) => {
    const entries = [];
    for (const file of newFiles) {
      const error = validateFile(file);
      entries.push({ ...createFileEntry(file), error, status: error ? "error" : "pending" });
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
    updateEntry(entry.id, { status: "uploading", progress: 0, error: null });

    try {
      // Step 1: Get pre-signed upload URL
      const { uploadUrl, photoId, key } = await requestUploadUrl(
        entry.file.name,
        entry.file.type,
        category
      );

      // Step 2: Upload file directly to S3
      await uploadToS3(uploadUrl, entry.file, entry.file.type, (percent) => {
        updateEntry(entry.id, { progress: percent });
      });

      // Step 3: Register in DB only after successful S3 upload
      await registerPhoto(photoId, key, category, uploaderName);

      updateEntry(entry.id, { status: "success", progress: 100 });
    } catch (err) {
      console.error("Upload failed for", entry.file.name, err);
      updateEntry(entry.id, { status: "error", error: err.message });
    }
  }

  async function startUploads() {
    const pending = fileEntries.filter((e) => e.status === "pending");
    if (pending.length === 0) return;

    // Process in batches to cap concurrency
    for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
      const batch = pending.slice(i, i + MAX_CONCURRENT);
      await Promise.all(batch.map(uploadEntry));
    }
  }

  const hasPending = fileEntries.some((e) => e.status === "pending");
  const allDone = fileEntries.length > 0 && fileEntries.every((e) => e.status === "success");

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
        <p style={styles.dropHint}>JPEG, PNG, WebP, HEIC · max. 15 MB pro Datei</p>
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
              onRetry={() => uploadEntry(entry)}
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
            <button
              style={{ ...styles.uploadBtn, ...(hasPending ? {} : styles.uploadBtnDisabled) }}
              onClick={startUploads}
              disabled={!hasPending}
            >
              {fileEntries.some((e) => e.status === "uploading")
                ? "Wird hochgeladen…"
                : `${fileEntries.filter((e) => e.status === "pending").length} Foto(s) hochladen`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({ entry, onRemove, onRetry }) {
  const { file, status, progress, error } = entry;

  return (
    <div style={styles.fileRow}>
      <div style={styles.fileInfo}>
        <span style={styles.fileName} title={file.name}>
          {file.name}
        </span>
        <span style={styles.fileSize}>
          {(file.size / 1024 / 1024).toFixed(1)} MB
        </span>
      </div>

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
        {status === "success" && <span style={styles.successBadge}>✓ Gespeichert</span>}
        {status === "error" && (
          <button style={styles.retryBtn} onClick={onRetry}>
            Erneut versuchen
          </button>
        )}
        {(status === "pending" || status === "error") && (
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
