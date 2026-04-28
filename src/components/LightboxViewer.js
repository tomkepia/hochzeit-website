import React from "react";
import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";

/**
 * Fullscreen lightbox for browsing photos.
 * Props:
 *   photos         – array of { id, previewUrl, originalUrl, uploadedBy }
 *   index          – currently open index (>= 0)
 *   onClose        – called when lightbox is dismissed
 *   onIndexChange  – called with new index when user swipes/navigates
 */
export default function LightboxViewer({ photos, index, onClose, onIndexChange }) {
  const slides = photos.map((photo) => ({
    src: photo.previewUrl,
    // Download plugin: full-resolution original
    download: {
      url: photo.originalUrl,
      filename: `hochzeit-${photo.id}.jpg`,
    },
    // Captions plugin: show uploader name if available
    description: photo.uploadedBy ? `Hochgeladen von ${photo.uploadedBy}` : undefined,
  }));

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Download, Captions, Zoom]}
      on={{ view: ({ index: i }) => onIndexChange(i) }}
      // Preload 2 slides on each side of the current slide (library default, made explicit).
      // This means the adjacent 4 previews are fetched in the background while the user
      // views the current photo, making swipe navigation feel instant.
      carousel={{ preload: 2 }}
      styles={{
        container: { backgroundColor: "rgba(0, 0, 0, 0.92)" },
      }}
      captions={{ descriptionTextAlign: "center" }}
    />
  );
}
