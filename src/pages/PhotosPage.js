import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { downloadZip, fetchPhotos } from "../services/api";
import PhotoGrid from "../components/PhotoGrid";
import LightboxViewer from "../components/LightboxViewer";

const LIMIT = 50;
const ZIP_LIMIT = 100;
const MULTI_DOWNLOAD_DELAY_MS = 500;
const REFRESH_AFTER_MS = 55 * 60 * 1000;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const TABS = [
  { key: "guest", label: "Gästefotos" },
  { key: "photographer", label: "Fotografenfotos" },
];

const SORT_MODES = [
  { key: "upload", label: "Upload-Zeit" },
  { key: "taken", label: "Aufnahme-Zeit" },
];

const floatingBarHeight = 88;

export default function PhotosPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = searchParams.get("token");
  const initialSortMode = searchParams.get("sort") === "taken" ? "taken" : "upload";

  // Route guard: redirect to homepage if no session exists
  useEffect(() => {
    if (!localStorage.getItem("galleryAccess")) {
      navigate("/");
    }
  }, [navigate]);

  const withToken = useCallback(
    (path) => (token ? `${path}?token=${encodeURIComponent(token)}` : path),
    [token]
  );

  const backLink = withToken("/gallery");
  const uploadLink = withToken("/upload");

  const [category, setCategory] = useState("guest");
  const [sortMode, setSortMode] = useState(initialSortMode);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(() => new Set());
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Refs for values that must be read inside IntersectionObserver without stale closures
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const categoryRef = useRef(category);
  const sortRef = useRef(sortMode);
  const sentinelRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const lastFetchedAtRef = useRef(0);

  const showToast = useCallback((message) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 2800);
  }, []);

  const doLoad = useCallback(async (cat, off, replace, sort) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const data = await fetchPhotos(cat, LIMIT, off, sort);
      // Discard responses that arrived after a category/sort switch.
      if (cat !== categoryRef.current || sort !== sortRef.current) return;
      const batch = data.photos || [];
      setPhotos((prev) => (replace ? batch : [...prev, ...batch]));
      hasMoreRef.current = data.hasMore;
      setHasMore(data.hasMore);
      offsetRef.current = off + batch.length;
      lastFetchedAtRef.current = Date.now();
    } catch {
      if (cat === categoryRef.current && sort === sortRef.current) {
        setError("Fotos konnten nicht geladen werden. Bitte Seite neu laden.");
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const selectedCount = selectedPhotoIds.size;

  const toggleSelectionMode = () => {
    if (isDownloading) return;

    if (selectionMode) {
      setSelectionMode(false);
      setSelectedPhotoIds(new Set());
      return;
    }

    setLightboxIndex(-1);
    setSelectionMode(true);
  };

  const cancelSelection = () => {
    if (isDownloading) return;
    setSelectedPhotoIds(new Set());
    setSelectionMode(false);
  };

  const togglePhotoSelection = useCallback((photoId) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }, []);

  const handleDownloadSelected = async () => {
    if (isDownloading) return;
    if (selectedCount === 0) return;
    if (selectedCount > ZIP_LIMIT) {
      setError(`Maximal ${ZIP_LIMIT} Fotos pro Download erlaubt.`);
      showToast("Download fehlgeschlagen");
      return;
    }

    try {
      setIsDownloading(true);
      setError(null);
      setDownloadStatus("ZIP wird vorbereitet...");
      await downloadZip(Array.from(selectedPhotoIds));
      setSelectedPhotoIds(new Set());
      setSelectionMode(false);
      showToast("Download gestartet");
    } catch (err) {
      const message = err?.message?.toLowerCase?.() || "";
      if (message.includes("network") || message.includes("failed to fetch")) {
        setError("Netzwerkfehler");
        showToast("Netzwerkfehler");
      } else {
        setError("Download fehlgeschlagen");
        showToast("Download fehlgeschlagen");
      }
    } finally {
      setDownloadStatus(null);
      setIsDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (isDownloading) return;

    try {
      setIsDownloading(true);
      setError(null);
      setDownloadStatus("Fotos werden gesammelt...");

      const allPhotoMap = new Map(photos.map((photo) => [photo.id, photo]));
      const allPhotoIds = [...allPhotoMap.keys()];

      let off = offsetRef.current;
      let more = hasMoreRef.current;

      while (more) {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchPhotos(categoryRef.current, LIMIT, off, sortRef.current);
        const batch = data.photos || [];

        for (const photo of batch) {
          if (!allPhotoMap.has(photo.id)) {
            allPhotoMap.set(photo.id, photo);
            allPhotoIds.push(photo.id);
          }
        }

        off += batch.length;
        more = data.hasMore;
      }

      setPhotos(Array.from(allPhotoMap.values()));
      offsetRef.current = allPhotoIds.length;
      hasMoreRef.current = false;
      setHasMore(false);

      if (allPhotoIds.length === 0) {
        setDownloadStatus(null);
        showToast("Keine Fotos gefunden");
        return;
      }

      const chunks = [];
      for (let i = 0; i < allPhotoIds.length; i += ZIP_LIMIT) {
        chunks.push(allPhotoIds.slice(i, i + ZIP_LIMIT));
      }

      if (chunks.length > 1) {
        const proceed = window.confirm(
          `Du lädst viele Fotos herunter (ca. ${allPhotoIds.length}).\nDies kann mehrere Downloads auslösen.\n\nFortfahren?`
        );
        if (!proceed) {
          setDownloadStatus(null);
          return;
        }

        setDownloadStatus("Mehrere Downloads werden gestartet...");
      }

      for (let index = 0; index < chunks.length; index += 1) {
        setDownloadStatus(`Downloading batch ${index + 1} of ${chunks.length}...`);
        const chunk = chunks[index];
        const filename =
          chunks.length === 1
            ? "hochzeit-fotos.zip"
            : `hochzeit-fotos-${index + 1}-von-${chunks.length}.zip`;
        // Required by scope: execute batch downloads sequentially.
        // eslint-disable-next-line no-await-in-loop
        await downloadZip(chunk, filename);

        // Small pause helps browsers reliably open sequential download prompts.
        if (index < chunks.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await delay(MULTI_DOWNLOAD_DELAY_MS);
        }
      }
      showToast("Download gestartet");
    } catch (err) {
      const message = err?.message?.toLowerCase?.() || "";
      if (message.includes("network") || message.includes("failed to fetch")) {
        setError("Netzwerkfehler");
        showToast("Netzwerkfehler");
      } else {
        setError("Download fehlgeschlagen");
        showToast("Download fehlgeschlagen");
      }
    } finally {
      setDownloadStatus(null);
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    sortRef.current = sortMode;
  }, [sortMode]);

  useEffect(() => {
    const current = searchParams.get("sort") === "taken" ? "taken" : "upload";
    if (current === sortMode) return;

    const nextParams = new URLSearchParams(searchParams);
    if (sortMode === "taken") {
      nextParams.set("sort", "taken");
    } else {
      nextParams.delete("sort");
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, sortMode]);

  // Reset state and trigger initial load when category or sort changes.
  useEffect(() => {
    categoryRef.current = category;
    sortRef.current = sortMode;
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setPhotos([]);
    setHasMore(true);
    setError(null);
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    setLightboxIndex(-1);
    doLoad(category, 0, true, sortMode);
  }, [category, doLoad, sortMode]);

  // Infinite scroll: observe a sentinel element at the bottom of the grid
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
          doLoad(categoryRef.current, offsetRef.current, false, sortRef.current);
        }
      },
      { rootMargin: "400px" } // start loading well before the user hits the bottom
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [doLoad]);

  // Optional freshness polish: refresh signed URLs when returning after long inactivity.
  useEffect(() => {
    const onFocus = () => {
      const stale = Date.now() - lastFetchedAtRef.current > REFRESH_AFTER_MS;
      if (!stale || loadingRef.current || isDownloading) return;

      offsetRef.current = 0;
      hasMoreRef.current = true;
      setHasMore(true);
      doLoad(categoryRef.current, 0, true, sortRef.current);
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [doLoad, isDownloading]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#faf9f7" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: `32px 16px ${floatingBarHeight + 24}px` }}>
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <Link
            to={backLink}
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontSize: 14,
              color: "#8a6a49",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            ← Zurück zur Übersicht
          </Link>

          <Link
            to={uploadLink}
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontSize: 14,
              color: "#8a6a49",
              textDecoration: "none",
              fontWeight: 500,
              textAlign: "right",
            }}
          >
            📸 Fotos hochladen →
          </Link>
        </div>

        {/* Page header */}
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <h1
            style={{
              fontFamily: "Georgia, 'Playfair Display', serif",
              fontSize: "clamp(24px, 5vw, 36px)",
              fontWeight: 400,
              color: "#3c3228",
              margin: "0 0 8px",
              letterSpacing: "0.01em",
            }}
          >
            Unsere Fotos
          </h1>
          <p style={{ color: "#9b8a7a", fontSize: 14, opacity: 0.8, margin: "0 0 16px" }}>
            Klicke auf ein Foto, um es zu öffnen.
          </p>
        </div>

        {/* Category tabs */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
            width: "100%",
          }}
        >
          {TABS.map((tab) => {
            const active = category === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setCategory(tab.key)}
                style={{
                  padding: "10px 24px",
                  borderRadius: 9999,
                  border: active ? "1px solid #8b7355" : "1px solid #d8cfc4",
                  background: active ? "#8b7355" : "transparent",
                  color: active ? "white" : "#6b5c4e",
                  fontWeight: active ? 600 : 400,
                  fontSize: 14,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Sorting */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            fontSize: 14,
            color: "#5c4a3c",
          }}
        >
          <span style={{ fontWeight: 500 }}>Sortieren nach:</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setSortMode("upload")}
              aria-pressed={sortMode === "upload"}
              style={{
                background: "transparent",
                border: "none",
                padding: "4px 6px",
                fontSize: 14,
                color: sortMode === "upload" ? "#5c4a3c" : "#8b7355",
                fontWeight: sortMode === "upload" ? 600 : 400,
                textDecoration: sortMode === "upload" ? "underline" : "none",
                cursor: "pointer",
              }}
            >
              {SORT_MODES[0].label}
            </button>

            <span style={{ opacity: 0.5 }}>|</span>

            <button
              onClick={() => setSortMode("taken")}
              aria-pressed={sortMode === "taken"}
              style={{
                background: "transparent",
                border: "none",
                padding: "4px 6px",
                fontSize: 14,
                color: sortMode === "taken" ? "#5c4a3c" : "#8b7355",
                fontWeight: sortMode === "taken" ? 600 : 400,
                textDecoration: sortMode === "taken" ? "underline" : "none",
                cursor: "pointer",
              }}
            >
              {SORT_MODES[1].label}
            </button>
          </div>
        </div>

        {selectionMode && (
          <div
            style={{
              position: "sticky",
              top: 8,
              zIndex: 4,
              marginBottom: 16,
              background: "#fff",
              border: "1px solid #e5dace",
              borderRadius: 14,
              boxShadow: "0 6px 18px rgba(0, 0, 0, 0.08)",
              padding: "10px 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <strong style={{ color: "#4f4337", fontSize: 14 }}>{selectedCount} ausgewählt</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleDownloadSelected}
                disabled={selectedCount === 0 || selectedCount > ZIP_LIMIT || isDownloading}
                style={{
                  border: "1px solid #8b7355",
                  background: "#8b7355",
                  color: "#fff",
                  padding: "8px 14px",
                  minHeight: 48,
                  borderRadius: 999,
                  cursor:
                    selectedCount === 0 || selectedCount > ZIP_LIMIT || isDownloading
                      ? "not-allowed"
                      : "pointer",
                  opacity: selectedCount === 0 || selectedCount > ZIP_LIMIT || isDownloading ? 0.55 : 1,
                  fontSize: 14,
                }}
              >
                Download
              </button>

              <button
                onClick={cancelSelection}
                disabled={isDownloading}
                style={{
                  border: "1px solid #d4c9bc",
                  background: "transparent",
                  color: "#6b5c4e",
                  padding: "8px 14px",
                  minHeight: 48,
                  borderRadius: 999,
                  cursor: isDownloading ? "not-allowed" : "pointer",
                  opacity: isDownloading ? 0.55 : 1,
                  fontSize: 14,
                }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {downloadStatus && (
          <p style={{ textAlign: "center", color: "#6b5c4e", fontSize: 14, marginBottom: 16 }}>
            {downloadStatus}
          </p>
        )}

        {toastMessage && (
          <div
            style={{
              position: "fixed",
              left: "50%",
              bottom: 18,
              transform: "translateX(-50%)",
              background: "rgba(35, 35, 35, 0.92)",
              color: "#fff",
              borderRadius: 999,
              padding: "10px 16px",
              fontSize: 13,
              zIndex: 40,
              maxWidth: "calc(100vw - 24px)",
              textAlign: "center",
            }}
          >
            {toastMessage}
          </div>
        )}

        {/* Error state */}
        {error && (
          <p style={{ textAlign: "center", color: "#c0392b", padding: "48px 0", fontSize: 15 }}>
            {error}
          </p>
        )}

        {/* Photo grid */}
        {!error && (
          <div style={{ marginTop: 8 }}>
            {selectionMode && (
              <p style={{ fontSize: 14, margin: "0 0 8px", opacity: 0.7, color: "#6b5c4e" }}>
                Tippe auf Fotos, um sie auszuwählen
              </p>
            )}

            <PhotoGrid
              photos={photos}
              onPhotoClick={setLightboxIndex}
              selectionMode={selectionMode}
              selectedPhotoIds={selectedPhotoIds}
              onToggleSelect={togglePhotoSelection}
            />
          </div>
        )}

        {/* Empty state (only after first load finishes) */}
        {!loading && !error && photos.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "80px 0",
              color: "#b0a090",
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>📷</div>
            <p style={{ fontSize: 16, margin: 0 }}>Noch keine Fotos vorhanden.</p>
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div style={{ textAlign: "center", padding: "36px 0" }}>
            <div className="photo-loading-spinner" />
          </div>
        )}

        {/* End-of-list indicator */}
        {!loading && !hasMore && photos.length > 0 && (
          <p
            style={{
              textAlign: "center",
              color: "#c4b8aa",
              fontSize: 13,
              marginTop: 32,
            }}
          >
            Alle {photos.length} Fotos geladen
          </p>
        )}

        {/* Infinite scroll sentinel — IntersectionObserver watches this element */}
        <div ref={sentinelRef} style={{ height: 1 }} />
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "12px 16px",
          background: "#ffffff",
          borderTop: "1px solid #e5ddd5",
          display: "flex",
          gap: 12,
          zIndex: 10,
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", width: "100%", gap: 12 }}>
          <button
            onClick={toggleSelectionMode}
            disabled={isDownloading}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 24,
              border: "1px solid #8b7355",
              background: selectionMode ? "#8b7355" : "transparent",
              color: selectionMode ? "#fff" : "#6b5c4e",
              cursor: isDownloading ? "not-allowed" : "pointer",
              opacity: isDownloading ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            {selectionMode ? "Fertig" : "Auswählen"}
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={photos.length === 0 || loading || isDownloading}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 24,
              border: "1px solid #8b7355",
              background: "#f1ede8",
              color: "#6b5c4e",
              cursor: photos.length === 0 || loading || isDownloading ? "not-allowed" : "pointer",
              opacity: photos.length === 0 || loading || isDownloading ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            Download All
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex >= 0 && !selectionMode && (
        <LightboxViewer
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
