import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { tokenLogin } from "../services/api";

export default function GalleryEntryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [tokenError, setTokenError] = useState(null);

  // Validate QR token on mount, or enforce existing session
  useEffect(() => {
    if (token) {
      tokenLogin(token)
        .then(() => {
          localStorage.setItem("galleryToken", token);
          localStorage.setItem("galleryAccess", "true");
          window.history.replaceState({}, "", "/gallery");
        })
        .catch(() => {
          setTokenError("Zugang abgelaufen oder ungültig.");
        });
    } else if (!localStorage.getItem("galleryAccess")) {
      navigate("/");
    }
  }, [token, navigate]);

  const withToken = (path) => (token ? `${path}?token=${encodeURIComponent(token)}` : path);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Unsere Hochzeitsfotos</h1>
        <p style={styles.subtitle}>
          Teile deine schönsten Momente oder schaue dir alle Bilder an.
        </p>

        {tokenError && (
          <p style={styles.errorMessage}>{tokenError}</p>
        )}

        <button
          type="button"
          style={{ ...styles.button, ...styles.uploadButton }}
          onClick={() => navigate(withToken("/upload"))}
        >
          📸 Fotos hochladen
        </button>

        <button
          type="button"
          style={{ ...styles.button, ...styles.viewButton }}
          onClick={() => navigate(withToken("/photos"))}
        >
          🖼 Fotos ansehen
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 16px",
    background: "linear-gradient(180deg, #f9f5f0 0%, #efe5d8 100%)",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fffaf4",
    border: "1px solid #e4d6c3",
    borderRadius: 16,
    padding: "28px 18px",
    boxShadow: "0 10px 30px rgba(75, 52, 31, 0.08)",
    textAlign: "center",
  },
  title: {
    margin: "0 0 10px",
    fontFamily: "'Playfair Display', serif",
    fontSize: "clamp(28px, 6vw, 40px)",
    color: "#4f3a2b",
  },
  subtitle: {
    margin: "0 0 24px",
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 15,
    lineHeight: 1.5,
    color: "#7c6957",
  },
  button: {
    width: "100%",
    minHeight: 58,
    borderRadius: 12,
    border: "1px solid transparent",
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 12,
    transition: "transform 0.12s ease, box-shadow 0.12s ease",
  },
  uploadButton: {
    backgroundColor: "#8b7355",
    color: "#fff",
    boxShadow: "0 5px 14px rgba(139, 115, 85, 0.25)",
  },
  viewButton: {
    backgroundColor: "#f3eadf",
    color: "#5f4a36",
    border: "1px solid #d2c0ab",
  },
  errorMessage: {
    margin: "0 0 16px",
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 14,
    color: "#c0392b",
  },
};