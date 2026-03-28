import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import UploadArea from "../components/UploadArea";

const UPLOADER_NAME_KEY = "uploaderName";

export default function UploadPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const withToken = (path) =>
    token ? `${path}?token=${encodeURIComponent(token)}` : path;
  const backLink = withToken("/gallery");
  const photosLink = withToken("/photos");

  // Route guard: redirect to homepage if no session exists
  useEffect(() => {
    if (!localStorage.getItem("galleryAccess")) {
      navigate("/");
    }
  }, [navigate]);

  const [uploaderName, setUploaderName] = useState(
    () => localStorage.getItem(UPLOADER_NAME_KEY) || ""
  );

  const handleNameChange = (e) => {
    const name = e.target.value;
    setUploaderName(name);
    localStorage.setItem(UPLOADER_NAME_KEY, name);
  };

  return (
    <div style={styles.page}>
      <div style={styles.topNav}>
        <Link to={backLink} style={styles.backLinkTop}>
          ← Zurück zur Übersicht
        </Link>
        <Link to={photosLink} style={styles.forwardLinkTop}>
          🖼 Fotos ansehen →
        </Link>
      </div>

      <div style={styles.header}>
        <h1 style={styles.title}>Fotos hochladen</h1>
        <p style={styles.subtitle}>
          Teile deine Erinnerungen – wir freuen uns über jeden Moment!
        </p>
      </div>

      <div style={styles.nameSection}>
        <label style={styles.label} htmlFor="uploaderName">
          Dein Name (optional)
        </label>
        <input
          id="uploaderName"
          type="text"
          placeholder="z. B. Maria & Jonas"
          value={uploaderName}
          onChange={handleNameChange}
          style={styles.nameInput}
          maxLength={80}
        />
      </div>

      <UploadArea category="guest" uploaderName={uploaderName} />

      <div style={styles.footer}>
        <Link to={backLink} style={styles.backLink}>
          ← Zurück zur Übersicht
        </Link>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f9f5f2",
    padding: "40px 16px 60px",
    boxSizing: "border-box",
  },
  topNav: {
    maxWidth: 1200,
    margin: "0 auto 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  backLinkTop: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 14,
    color: "#8a6a49",
    textDecoration: "none",
    fontWeight: 500,
  },
  forwardLinkTop: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 14,
    color: "#8a6a49",
    textDecoration: "none",
    fontWeight: 500,
    textAlign: "right",
  },
  header: {
    textAlign: "center",
    marginBottom: 28,
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: "clamp(24px, 6vw, 36px)",
    color: "#3b2f2f",
    margin: "0 0 8px",
  },
  subtitle: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 15,
    color: "#777",
    margin: 0,
  },
  nameSection: {
    maxWidth: 600,
    margin: "0 auto 24px",
    padding: "0 16px",
  },
  label: {
    display: "block",
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    color: "#555",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  nameInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 14px",
    fontSize: 15,
    fontFamily: "'Montserrat', sans-serif",
    border: "1px solid #d5c8b8",
    borderRadius: 8,
    backgroundColor: "#fff",
    color: "#333",
    outline: "none",
  },
  footer: {
    textAlign: "center",
    marginTop: 40,
  },
  backLink: {
    fontFamily: "'Montserrat', sans-serif",
    fontSize: 14,
    color: "#a07850",
    textDecoration: "none",
  },
};
