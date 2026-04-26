import React from "react";

/**
 * Responsive photo grid.
 * Props:
 *   photos      – array of { id, thumbnailUrl, uploadedBy, processingStatus, processingError, processingAttempts }
 *   onPhotoClick(index) – called when a done thumbnail is clicked
 *   selectionMode – whether grid should select instead of open lightbox
 *   selectedPhotoIds – Set<string> of selected photo IDs
 *   onToggleSelect(photoId) – called when user toggles photo selection
 *   isAdmin – whether to show admin delete/retry buttons
 *   onDelete(photoId) – called when admin clicks delete
 *   onRetry(photoId) – called when admin clicks retry on a failed photo
 */
export default function PhotoGrid({
  photos,
  onPhotoClick,
  selectionMode = false,
  selectedPhotoIds = new Set(),
  onToggleSelect,
  isAdmin = false,
  onDelete,
  onRetry,
  retryingPhotoIds = new Set(),
}) {
  if (!photos || photos.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 4,
      }}
    >
      {photos.map((photo, index) => {
        const isDone = !photo.processingStatus || photo.processingStatus === "done";
        const selected = isDone && selectedPhotoIds.has(photo.id);
        const isRetrying = retryingPhotoIds.has(photo.id);
        const isProcessingLike = photo.processingStatus === "pending" || photo.processingStatus === "processing";
        const isFailed = photo.processingStatus === "failed";
        const showFailedOverlay = isFailed && isAdmin;
        const failedMessage = isAdmin ? "Fehlgeschlagen" : "Fehler bei Verarbeitung";

        return (
          <button
            key={photo.id}
            onClick={() => {
              if (!isDone) return;
              if (selectionMode) {
                onToggleSelect?.(photo.id);
              } else {
                onPhotoClick(index);
              }
            }}
            aria-label={photo.uploadedBy ? `Foto von ${photo.uploadedBy}` : "Hochzeitsfoto öffnen"}
            aria-pressed={selectionMode && isDone ? selected : undefined}
            style={{
              padding: 0,
              border: "none",
              background: "#e8e0d8",
              cursor: isDone ? "pointer" : "default",
              aspectRatio: "1",
              overflow: "hidden",
              borderRadius: 2,
              display: "block",
              position: "relative",
              outline: selected ? "2px solid #8b7355" : "none",
              outlineOffset: -2,
            }}
          >
            {photo.thumbnailUrl ? (
              <img
                src={photo.thumbnailUrl}
                alt={photo.uploadedBy ? `Foto von ${photo.uploadedBy}` : "Hochzeitsfoto"}
                loading="lazy"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  transition: isDone ? "transform 0.2s ease" : "none",
                  filter: isDone ? "none" : "blur(3px) brightness(0.72)",
                }}
                onMouseEnter={e => { if (isDone) e.currentTarget.style.transform = "scale(1.04)"; }}
                onMouseLeave={e => { if (isDone) e.currentTarget.style.transform = "scale(1)"; }}
              />
            ) : (
              <div style={{ width: "100%", height: "100%", background: "#e0d8cf" }} />
            )}

            {/* Processing state overlays */}
            {isProcessingLike && (
              <div className="photo-status-overlay">
                <div
                  className="photo-loading-spinner"
                  style={{ width: 22, height: 22, borderWidth: 2 }}
                />
                <span style={{ fontSize: 10, marginTop: 4 }}>Wird verarbeitet…</span>
              </div>
            )}

            {isFailed && (
              <div className={`photo-status-overlay ${showFailedOverlay ? "photo-status-overlay--failed" : "photo-status-overlay--failed-soft"}`}>
                <span style={{ fontSize: showFailedOverlay ? 16 : 12 }}>{showFailedOverlay ? "⚠" : "i"}</span>
                <span style={{ fontSize: 10, marginTop: 2 }}>{failedMessage}</span>
              </div>
            )}

            {/* Selection checkmark — only for done photos */}
            {isDone && selectionMode && selected && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(20, 20, 20, 0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 30,
                  fontWeight: 700,
                }}
              >
                ✓
              </div>
            )}

            {/* Admin delete button — only for done photos */}
            {isAdmin && !selectionMode && isDone && (
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

            {/* Admin retry button — only for failed photos */}
            {isAdmin && photo.processingStatus === "failed" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isRetrying) return;
                  onRetry?.(photo.id);
                }}
                aria-label="Foto erneut verarbeiten"
                disabled={isRetrying}
                style={{
                  position: "absolute",
                  bottom: 6,
                  right: 6,
                  background: "rgba(0,0,0,0.65)",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  width: 28,
                  height: 28,
                  cursor: isRetrying ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 0,
                  opacity: isRetrying ? 0.7 : 1,
                }}
              >
                {isRetrying ? (
                  <span
                    className="photo-loading-spinner"
                    style={{ width: 14, height: 14, borderWidth: 2 }}
                  />
                ) : (
                  "↻"
                )}
              </button>
            )}
          </button>
        );
      })}
    </div>
  );
}
