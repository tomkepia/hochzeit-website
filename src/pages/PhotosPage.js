import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchPhotos, fetchUploaders, deletePhoto, bulkDeletePhotos, retryPhoto, fetchProcessingStats, createDownloadJob, listDownloadJobs, getDownloadJobUrl, createDownloadAllPlan, triggerDownloadFromUrl } from "../services/api";
import PhotoGrid from "../components/PhotoGrid";
import LightboxViewer from "../components/LightboxViewer";

const LIMIT = 50;
const REFRESH_AFTER_MS = 55 * 60 * 1000;
const PHOTO_POLL_INTERVAL_MS = 7000;
const JOB_POLL_INTERVAL_MS = 4000; // how often to poll pending download jobs
const STATS_WARNING_SECONDS = 30;

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

  const permissions = localStorage.getItem("galleryPermissions") || "";
  const isAdmin = permissions.split(":").includes("admin");

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
  const [downloadJobs, setDownloadJobs] = useState([]); // async download jobs
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [processingStats, setProcessingStats] = useState(null);
  const [retryingPhotoIds, setRetryingPhotoIds] = useState(() => new Set());
  const [uploadedBy, setUploadedBy] = useState(null);   // null = no filter (committed)
  const [uploaderInput, setUploaderInput] = useState(""); // live text field value
  const [uploaderOptions, setUploaderOptions] = useState([]);

  // Refs for values that must be read inside IntersectionObserver without stale closures
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const categoryRef = useRef(category);
  const sortRef = useRef(sortMode);
  const uploadedByRef = useRef(uploadedBy);
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

  const startArchiveDownloads = useCallback((archives) => {
    archives.forEach((archive, index) => {
      window.setTimeout(() => {
        if (archive?.downloadUrl) {
          triggerDownloadFromUrl(archive.downloadUrl, archive.fileName);
        }
      }, index * 250);
    });
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchProcessingStats();
      setProcessingStats(data);
    } catch { /* silently ignore — admin only endpoint */ }
  }, []);

  // Auto-refresh processing stats every 5 s for admins.
  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [isAdmin, loadStats]);

  const doLoad = useCallback(async (cat, off, replace, sort, uploader) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const data = await fetchPhotos(cat, LIMIT, off, sort, uploader);
      // Discard responses that arrived after a category/sort/filter switch.
      if (cat !== categoryRef.current || sort !== sortRef.current || uploader !== uploadedByRef.current) return;
      const batch = data.photos || [];
      setPhotos((prev) => (replace ? batch : [...prev, ...batch]));
      hasMoreRef.current = data.hasMore;
      setHasMore(data.hasMore);
      offsetRef.current = off + batch.length;
      lastFetchedAtRef.current = Date.now();
    } catch {
      if (cat === categoryRef.current && sort === sortRef.current && uploader === uploadedByRef.current) {
        setError("Fotos konnten nicht geladen werden. Bitte Seite neu laden.");
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const refreshVisiblePhotos = useCallback(async () => {
    if (loadingRef.current) return;

    const targetCount = Math.max(offsetRef.current, photos.length, LIMIT);
    const refreshed = [];
    let nextOffset = 0;
    let nextHasMore = false;

    try {
      do {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchPhotos(categoryRef.current, LIMIT, nextOffset, sortRef.current, uploadedByRef.current);
        const batch = data.photos || [];

        if (
          categoryRef.current !== category ||
          sortRef.current !== sortMode ||
          uploadedByRef.current !== uploadedBy
        ) {
          return;
        }

        refreshed.push(...batch);
        nextOffset += batch.length;
        nextHasMore = data.hasMore;
      } while (nextHasMore && refreshed.length < targetCount);

      setPhotos(refreshed);
      offsetRef.current = refreshed.length;
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
      lastFetchedAtRef.current = Date.now();
    } catch {
      // Silent by design: background polling should not replace current UI with an error state.
    }
  }, [category, photos.length, sortMode, uploadedBy]);

  // Photos that have finished processing — used to drive the lightbox.
  const donePhotos = useMemo(
    () => photos.filter((p) => !p.processingStatus || p.processingStatus === "done"),
    [photos]
  );

  const hasNonDonePhotos = useMemo(
    () => photos.some((p) => p.processingStatus && p.processingStatus !== "done"),
    [photos]
  );

  const allVisiblePhotosAreProcessing = useMemo(
    () => photos.length > 0 && photos.every((p) => p.processingStatus && p.processingStatus !== "done"),
    [photos]
  );

  // Map a grid index (into photos[]) to a lightbox index (into donePhotos[]).
  const handlePhotoClick = useCallback(
    (gridIndex) => {
      const photo = photos[gridIndex];
      if (!photo) return;
      const lbIndex = donePhotos.findIndex((p) => p.id === photo.id);
      if (lbIndex >= 0) setLightboxIndex(lbIndex);
    },
    [photos, donePhotos]
  );

  const selectedCount = selectedPhotoIds.size;

  const toggleSelectionMode = () => {
    if (isDownloading || isBulkDeleting) return;

    if (selectionMode) {
      setSelectionMode(false);
      setSelectedPhotoIds(new Set());
      return;
    }

    setLightboxIndex(-1);
    setSelectionMode(true);
  };

  const cancelSelection = () => {
    if (isDownloading || isBulkDeleting) return;
    setSelectedPhotoIds(new Set());
    setSelectionMode(false);
  };

  const handleRetry = useCallback(async (photoId) => {
    if (retryingPhotoIds.has(photoId)) return;

    setRetryingPhotoIds((prev) => {
      const next = new Set(prev);
      next.add(photoId);
      return next;
    });

    try {
      await retryPhoto(photoId);
      showToast("Foto wird erneut verarbeitet");
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? { ...p, processingStatus: "pending", processingAttempts: 0, processingError: null }
            : p
        )
      );
      loadStats();
    } catch {
      showToast("Retry fehlgeschlagen");
    } finally {
      setRetryingPhotoIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  }, [loadStats, retryingPhotoIds, showToast]);

  const handleDelete = useCallback(async (photoId) => {
    if (isDownloading || isBulkDeleting) return;
    const confirmed = window.confirm("Foto wirklich löschen?");
    if (!confirmed) return;

    try {
      await deletePhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      showToast("Foto gelöscht");
    } catch {
      showToast("Löschen fehlgeschlagen");
    }
  }, [isBulkDeleting, isDownloading, showToast]);

  const handleBulkDeleteSelected = async () => {
    if (!isAdmin || isDownloading || isBulkDeleting) return;
    if (selectedCount === 0) return;

    const confirmed = window.confirm(`${selectedCount} Foto(s) wirklich löschen?`);
    if (!confirmed) return;

    const idsToDelete = Array.from(selectedPhotoIds);
    try {
      setIsBulkDeleting(true);
      setError(null);
      const result = await bulkDeletePhotos(idsToDelete);
      const deletedSet = new Set(idsToDelete);
      setPhotos((prev) => prev.filter((photo) => !deletedSet.has(photo.id)));
      setSelectedPhotoIds(new Set());
      setSelectionMode(false);

      if ((result?.missingPhotoIds || []).length > 0) {
        showToast(`Gelöscht (${result.deletedCount}), einige fehlten bereits`);
      } else {
        showToast(`${result.deletedCount} Foto(s) gelöscht`);
      }
    } catch (err) {
      const message = err?.message?.toLowerCase?.() || "";
      if (message.includes("network") || message.includes("failed to fetch")) {
        setError("Netzwerkfehler");
        showToast("Netzwerkfehler");
      } else {
        showToast("Bulk-Löschen fehlgeschlagen");
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!isAdmin || isDownloading || isBulkDeleting) return;

    // Collect all photo IDs matching the current category + uploader filter.
    const allIds = [];
    let off = 0;
    let more = true;
    try {
      while (more) {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchPhotos(categoryRef.current, 100, off, sortRef.current, uploadedByRef.current);
        const batch = data.photos || [];
        for (const p of batch) allIds.push(p.id);
        off += batch.length;
        more = data.hasMore;
      }
    } catch {
      showToast("Fehler beim Laden der Foto-IDs");
      return;
    }

    if (allIds.length === 0) {
      showToast("Keine Fotos vorhanden");
      return;
    }

    const filterLabel = uploadedByRef.current ? ` von „${uploadedByRef.current}"` : "";
    const confirmed = window.confirm(
      `Alle ${allIds.length} Foto(s)${filterLabel} wirklich unwiderruflich löschen?`
    );
    if (!confirmed) return;

    try {
      setIsBulkDeleting(true);
      setError(null);
      // Delete in chunks of 200 (API limit).
      const CHUNK = 200;
      let totalDeleted = 0;
      for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const result = await bulkDeletePhotos(chunk);
        totalDeleted += result.deletedCount ?? chunk.length;
      }
      setPhotos([]);
      setSelectedPhotoIds(new Set());
      setSelectionMode(false);
      offsetRef.current = 0;
      hasMoreRef.current = false;
      setHasMore(false);
      showToast(`${totalDeleted} Foto(s) gelöscht`);
    } catch (err) {
      const message = err?.message?.toLowerCase?.() || "";
      if (message.includes("network") || message.includes("failed to fetch")) {
        setError("Netzwerkfehler");
        showToast("Netzwerkfehler");
      } else {
        showToast("Löschen fehlgeschlagen");
      }
    } finally {
      setIsBulkDeleting(false);
    }
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

    try {
      setIsDownloading(true);
      setError(null);
      setDownloadStatus("Download-Auftrag wird erstellt...");
      const { jobId } = await createDownloadJob(Array.from(selectedPhotoIds), categoryRef.current);
      setDownloadJobs((prev) => [{ jobId, status: "queued", photoCount: selectedCount }, ...prev]);
      setSelectedPhotoIds(new Set());
      setSelectionMode(false);
      showToast("Download-Auftrag erstellt – ZIP wird vorbereitet");
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
      setDownloadStatus("Download-Paket wird vorbereitet...");

      // Archive planning only supports full category downloads. Filtered downloads
      // still fall back to a dedicated user job because fixed archives are built
      // for the category as a whole.
      if (!uploadedByRef.current) {
        const plan = await createDownloadAllPlan(categoryRef.current);
        const readyArchives = plan.archives || [];
        const pendingJob = plan.pendingJob;

        const archiveJobItems = readyArchives.map((a) => ({
          jobId: a.jobId,
          status: "ready",
          photoCount: a.photoCount,
          fileName: a.fileName,
          downloadUrl: a.downloadUrl,
        }));

        const allNewJobs = pendingJob
          ? [...archiveJobItems, pendingJob]
          : archiveJobItems;

        if (allNewJobs.length > 0) {
          setDownloadJobs((prev) => {
            const existingIds = new Set(allNewJobs.map((j) => j.jobId));
            return [...allNewJobs, ...prev.filter((j) => !existingIds.has(j.jobId))];
          });
        }

        if (readyArchives.length > 0 && pendingJob) {
          showToast(`${readyArchives.length} ZIP(s) bereit zum Herunterladen, der Rest wird vorbereitet`);
          return;
        }

        if (readyArchives.length > 0) {
          showToast(`${readyArchives.length} ZIP(s) bereit – unten auf Herunterladen klicken`);
          return;
        }

        if (pendingJob) {
          showToast("Aktuelle Fotos werden als neues ZIP vorbereitet");
          return;
        }

        showToast("Keine Fotos gefunden");
        return;
      }

      const allPhotoMap = new Map(photos.map((photo) => [photo.id, photo]));
      const allPhotoIds = [...allPhotoMap.keys()];

      let off = offsetRef.current;
      let more = hasMoreRef.current;

      while (more) {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchPhotos(categoryRef.current, LIMIT, off, sortRef.current, uploadedByRef.current);
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

      const downloadableIds = allPhotoIds.filter((id) => {
        const photo = allPhotoMap.get(id);
        return !photo?.processingStatus || photo.processingStatus === "done";
      });

      if (downloadableIds.length === 0) {
        showToast("Keine Fotos gefunden");
        return;
      }

      const { jobId } = await createDownloadJob(downloadableIds, categoryRef.current);
      setDownloadJobs((prev) => [{ jobId, status: "queued", photoCount: downloadableIds.length }, ...prev]);
      showToast(`Download-Auftrag erstellt – ${downloadableIds.length} Fotos werden verpackt`);
    } catch (err) {
      if (err?.name === "AbortError") return;
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

  // Load existing download jobs on mount so returning users see their pending/ready jobs.
  useEffect(() => {
    listDownloadJobs()
      .then((jobs) => setDownloadJobs(jobs))
      .catch(() => {}); // silent — not critical
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for download-job status updates while there are queued/processing jobs.
  useEffect(() => {
    const hasPending = downloadJobs.some(
      (j) => j.status === "queued" || j.status === "processing"
    );
    if (!hasPending) return;

    const interval = setInterval(() => {
      listDownloadJobs()
        .then((jobs) => setDownloadJobs(jobs))
        .catch(() => {});
    }, JOB_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [downloadJobs]);

  const handleDownloadJobFile = useCallback(async (jobId, fileName, photoCount, downloadUrl) => {
    try {
      // Archive jobs include a pre-signed URL directly; user jobs need a fresh URL from the server.
      const url = downloadUrl || (await getDownloadJobUrl(jobId)).url;
      triggerDownloadFromUrl(url, fileName || `hochzeit-fotos-${photoCount}-bilder.zip`);
    } catch {
      showToast("Download-Link konnte nicht abgerufen werden");
    }
  }, [showToast]);

  const dismissDownloadJob = useCallback((jobId) => {
    setDownloadJobs((prev) => prev.filter((j) => j.jobId !== jobId));
  }, []);

  // Reload available uploader names whenever the category changes.
  useEffect(() => {
    fetchUploaders(category)
      .then((data) => setUploaderOptions(data.uploaders || []))
      .catch(() => setUploaderOptions([]));
  }, [category]);

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

  // Reset state and trigger initial load when category, sort, or uploader filter changes.
  useEffect(() => {
    categoryRef.current = category;
    sortRef.current = sortMode;
    uploadedByRef.current = uploadedBy;
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setPhotos([]);
    setHasMore(true);
    setError(null);
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    setLightboxIndex(-1);
    doLoad(category, 0, true, sortMode, uploadedBy);
  }, [category, doLoad, sortMode, uploadedBy]);

  // Infinite scroll: observe a sentinel element at the bottom of the grid
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
          doLoad(categoryRef.current, offsetRef.current, false, sortRef.current, uploadedByRef.current);
        }
      },
      { rootMargin: "400px" } // start loading well before the user hits the bottom
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [doLoad]);

  // Safari fallback: IntersectionObserver is unreliable in Safari/iOS (address bar
  // collapse changes viewport height, initial intersection events can be missed).
  // A passive scroll listener catches what the observer misses.
  useEffect(() => {
    const handleScroll = () => {
      if (!hasMoreRef.current || loadingRef.current) return;
      const scrollBottom = window.scrollY + window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      if (scrollBottom >= docHeight - 600) {
        doLoad(categoryRef.current, offsetRef.current, false, sortRef.current, uploadedByRef.current);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [doLoad]);

  // Optional freshness polish: refresh signed URLs when returning after long inactivity.
  useEffect(() => {
    const onFocus = () => {
      const stale = Date.now() - lastFetchedAtRef.current > REFRESH_AFTER_MS;
      if (!stale || loadingRef.current || isDownloading) return;

      offsetRef.current = 0;
      hasMoreRef.current = true;
      setHasMore(true);
      doLoad(categoryRef.current, 0, true, sortRef.current, uploadedByRef.current);
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [doLoad, isDownloading]);

  useEffect(() => {
    if (!hasNonDonePhotos) return;

    const interval = setInterval(() => {
      if (loadingRef.current || isDownloading || isBulkDeleting) return;
      refreshVisiblePhotos();
    }, PHOTO_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasNonDonePhotos, isBulkDeleting, isDownloading, refreshVisiblePhotos]);

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
                onClick={() => { setCategory(tab.key); setUploadedBy(null); setUploaderInput(""); }}
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

        {/* Uploader filter */}
        {uploaderOptions.length > 0 && (
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
            <label
              htmlFor="uploaderFilter"
              style={{ fontWeight: 500, whiteSpace: "nowrap" }}
            >
              Person:
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                id="uploaderFilter"
                list="uploaderSuggestions"
                type="search"
                placeholder="Name eingeben…"
                value={uploaderInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setUploaderInput(val);
                  // Commit immediately when the value exactly matches a known name
                  // (user picked from the datalist) or is empty (cleared).
                  if (val === "" ) {
                    setUploadedBy(null);
                  } else if (uploaderOptions.includes(val)) {
                    setUploadedBy(val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = uploaderInput.trim();
                    setUploadedBy(trimmed || null);
                    e.target.blur();
                  }
                  if (e.key === "Escape") {
                    setUploaderInput("");
                    setUploadedBy(null);
                    e.target.blur();
                  }
                }}
                style={{
                  padding: "6px 28px 6px 10px",
                  fontSize: 14,
                  fontFamily: "'Montserrat', sans-serif",
                  border: uploadedBy ? "1px solid #8b7355" : "1px solid #d5c8b8",
                  borderRadius: 9999,
                  background: uploadedBy ? "#f5f0ea" : "#fff",
                  color: "#3c3228",
                  outline: "none",
                  width: 180,
                  boxSizing: "border-box",
                }}
              />
              <datalist id="uploaderSuggestions">
                {uploaderOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {uploaderInput && (
                <button
                  onClick={() => { setUploaderInput(""); setUploadedBy(null); }}
                  aria-label="Filter zurücksetzen"
                  style={{
                    position: "absolute",
                    right: 8,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#a0907e",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            {uploadedBy && (
              <span style={{ fontSize: 12, color: "#8b7355", whiteSpace: "nowrap" }}>
                gefiltert
              </span>
            )}
          </div>
        )}

        {/* Admin processing stats panel */}
        {isAdmin && processingStats && (
          <div
            style={{
              margin: "12px 0",
              padding: "10px 16px",
              background:
                processingStats.failed > 0
                  ? "#f9ece9"
                  : processingStats.oldestPendingSeconds > STATS_WARNING_SECONDS
                    ? "#fbf3e6"
                    : "#f5f1ec",
              border:
                processingStats.failed > 0
                  ? "1px solid #e0afa8"
                  : processingStats.oldestPendingSeconds > STATS_WARNING_SECONDS
                    ? "1px solid #e6c79f"
                    : "1px solid #e0d5c8",
              borderRadius: 10,
              fontSize: 13,
              color: "#5c4a3c",
              display: "flex",
              flexWrap: "wrap",
              gap: "6px 20px",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, marginRight: 4 }}>Verarbeitung:</span>
            {processingStats.pending > 0 && (
              <span>Wartend: <strong>{processingStats.pending}</strong></span>
            )}
            {processingStats.processing > 0 && (
              <span>Aktiv: <strong>{processingStats.processing}</strong></span>
            )}
            {processingStats.failed > 0 && (
              <span style={{ color: "#b3473b" }}>Fehlgeschlagen: <strong>{processingStats.failed}</strong></span>
            )}
            <span style={{ opacity: 0.7 }}>Fertig: <strong>{processingStats.done}</strong></span>
            {processingStats.oldestPendingSeconds > 0 && (
              <span
                style={{
                  color: processingStats.oldestPendingSeconds > STATS_WARNING_SECONDS ? "#9a6424" : undefined,
                  fontWeight: processingStats.oldestPendingSeconds > STATS_WARNING_SECONDS ? 600 : 400,
                  opacity: processingStats.oldestPendingSeconds > STATS_WARNING_SECONDS ? 1 : 0.6,
                }}
              >
                Ältestes: {processingStats.oldestPendingSeconds}s
              </span>
            )}
          </div>
        )}

        {!error && allVisiblePhotosAreProcessing && (
          <div
            style={{
              margin: "8px 0 14px",
              padding: "10px 14px",
              background: "#f4efe8",
              border: "1px solid #e2d6c8",
              borderRadius: 10,
              color: "#6b5c4e",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            Fotos werden gerade verarbeitet…
          </div>
        )}

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
                disabled={selectedCount === 0 || isDownloading || isBulkDeleting}
                style={{
                  border: "1px solid #8b7355",
                  background: "#8b7355",
                  color: "#fff",
                  padding: "8px 14px",
                  minHeight: 48,
                  borderRadius: 999,
                  cursor:
                    selectedCount === 0 || isDownloading || isBulkDeleting
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    selectedCount === 0 || isDownloading || isBulkDeleting
                      ? 0.55
                      : 1,
                  fontSize: 14,
                }}
              >
                Download
              </button>

              {isAdmin && (
                <button
                  onClick={handleBulkDeleteSelected}
                  disabled={selectedCount === 0 || isDownloading || isBulkDeleting}
                  style={{
                    border: "1px solid #b3473b",
                    background: "#b3473b",
                    color: "#fff",
                    padding: "8px 14px",
                    minHeight: 48,
                    borderRadius: 999,
                    cursor: selectedCount === 0 || isDownloading || isBulkDeleting ? "not-allowed" : "pointer",
                    opacity: selectedCount === 0 || isDownloading || isBulkDeleting ? 0.55 : 1,
                    fontSize: 14,
                  }}
                >
                  Löschen
                </button>
              )}

              <button
                onClick={cancelSelection}
                disabled={isDownloading || isBulkDeleting}
                style={{
                  border: "1px solid #d4c9bc",
                  background: "transparent",
                  color: "#6b5c4e",
                  padding: "8px 14px",
                  minHeight: 48,
                  borderRadius: 999,
                  cursor: isDownloading || isBulkDeleting ? "not-allowed" : "pointer",
                  opacity: isDownloading || isBulkDeleting ? 0.55 : 1,
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

        {/* Download jobs panel */}
        {downloadJobs.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {downloadJobs.map((job) => {
              const isPending = job.status === "queued" || job.status === "processing";
              const isReady = job.status === "ready";
              const isFailed = job.status === "failed";

              return (
                <div
                  key={job.jobId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    marginBottom: 8,
                    borderRadius: 10,
                    border: isReady
                      ? "1px solid #b8d4a8"
                      : isFailed
                        ? "1px solid #e0afa8"
                        : "1px solid #e2d6c8",
                    background: isReady ? "#f2f9ee" : isFailed ? "#fdf3f2" : "#faf7f4",
                    fontSize: 13,
                    color: "#5c4a3c",
                  }}
                >
                  {isPending && (
                    <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 16 }}>⏳</span>
                  )}
                  {isReady && <span style={{ fontSize: 16 }}>✅</span>}
                  {isFailed && <span style={{ fontSize: 16 }}>❌</span>}

                  <span style={{ flex: 1 }}>
                    {isPending && `ZIP wird erstellt… (${job.photoCount} Fotos)`}
                    {isReady && `ZIP bereit (${job.photoCount} Fotos)`}
                    {isFailed && `ZIP-Erstellung fehlgeschlagen`}
                  </span>

                  {isReady && (
                    <button
                      onClick={() => handleDownloadJobFile(job.jobId, job.fileName, job.photoCount, job.downloadUrl)}
                      style={{
                        background: "#8b7355",
                        color: "#fff",
                        border: "none",
                        borderRadius: 999,
                        padding: "6px 14px",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Herunterladen
                    </button>
                  )}

                  <button
                    onClick={() => dismissDownloadJob(job.jobId)}
                    title="Schließen"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#9b8a7a",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 1,
                      padding: "2px 4px",
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
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
              onPhotoClick={handlePhotoClick}
              selectionMode={selectionMode}
              selectedPhotoIds={selectedPhotoIds}
              onToggleSelect={togglePhotoSelection}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onRetry={handleRetry}
              retryingPhotoIds={retryingPhotoIds}
              sortMode={sortMode}
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
            disabled={isDownloading || isBulkDeleting}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 24,
              border: "1px solid #8b7355",
              background: selectionMode ? "#8b7355" : "transparent",
              color: selectionMode ? "#fff" : "#6b5c4e",
              cursor: isDownloading || isBulkDeleting ? "not-allowed" : "pointer",
              opacity: isDownloading || isBulkDeleting ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            {selectionMode ? "Fertig" : "Auswählen"}
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={photos.length === 0 || loading || isDownloading || isBulkDeleting}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 24,
              border: "1px solid #8b7355",
              background: "#f1ede8",
              color: "#6b5c4e",
              cursor:
                photos.length === 0 || loading || isDownloading || isBulkDeleting
                  ? "not-allowed"
                  : "pointer",
              opacity: photos.length === 0 || loading || isDownloading || isBulkDeleting ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            Download All
          </button>

          {isAdmin && (
            <button
              onClick={handleDeleteAll}
              disabled={photos.length === 0 || loading || isDownloading || isBulkDeleting}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: 24,
                border: "1px solid #c0392b",
                background: "#fdf0ef",
                color: "#c0392b",
                cursor:
                  photos.length === 0 || loading || isDownloading || isBulkDeleting
                    ? "not-allowed"
                    : "pointer",
                opacity: photos.length === 0 || loading || isDownloading || isBulkDeleting ? 0.5 : 1,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {isBulkDeleting ? "Wird gelöscht…" : "Alle löschen"}
            </button>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex >= 0 && !selectionMode && (
        <LightboxViewer
          photos={donePhotos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
