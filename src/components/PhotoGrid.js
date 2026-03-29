import React from "react";

/**
 * Responsive photo grid.
 * Props:
 *   photos      – array of { id, thumbnailUrl, uploadedBy }
 *   onPhotoClick(index) – called when a thumbnail is clicked
 *   selectionMode – whether grid should select instead of open lightbox
 *   selectedPhotoIds – Set<string> of selected photo IDs
 *   onToggleSelect(photoId) – called when user toggles photo selection
 *   isAdmin – whether to show admin delete buttons
 *   onDelete(photoId) – called when admin clicks delete
 */
export default function PhotoGrid({
  photos,
  onPhotoClick,
  selectionMode = false,
  selectedPhotoIds = new Set(),
  onToggleSelect,
  isAdmin = false,
  onDelete,
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
        const selected = selectedPhotoIds.has(photo.id);

        return (
          <button
            key={photo.id}
            onClick={() => {
              if (selectionMode) {
                onToggleSelect?.(photo.id);
              } else {
                onPhotoClick(index);
              }
            }}
            aria-label={photo.uploadedBy ? `Foto von ${photo.uploadedBy}` : "Hochzeitsfoto öffnen"}
            aria-pressed={selectionMode ? selected : undefined}
            style={{
              padding: 0,
              border: "none",
              background: "#e8e0d8",
              cursor: "pointer",
              aspectRatio: "1",
              overflow: "hidden",
              borderRadius: 2,
              display: "block",
              position: "relative",
              outline: selected ? "2px solid #8b7355" : "none",
              outlineOffset: -2,
            }}
          >
            <img
              src={photo.thumbnailUrl}
              alt={photo.uploadedBy ? `Foto von ${photo.uploadedBy}` : "Hochzeitsfoto"}
              loading="lazy"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                transition: "transform 0.2s ease",
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
            />

            {selectionMode && selected && (
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
          </button>
        );
      })}
    </div>
  );
}
