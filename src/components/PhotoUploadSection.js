
import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

function PhotoUploadSection() {
  return (
    <section className="rsvp-section" id="photo-upload" style={{ marginTop: '4rem' }}>
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        Fotos hochladen
      </motion.h2>
{/*       <form className="rsvp-form" style={{ marginTop: '2rem' }}>
        <fieldset className="form-box">
          <legend>Fotos auswählen</legend>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <input type="file" multiple style={{ marginTop: '0.5rem' }} />
          </label>
          <button type="button" className="submit-btn" disabled>
            Hochladen (bald verfügbar)
          </button>
        </fieldset>
      </form> */}
      <p style={{ color: '#6b5a45', marginTop: '2rem' }}>
        Schaut euch alle Fotos von der Hochzeit an oder ladet eure eigenen hoch!
      </p>
      <Link to="/gallery" className="submit-btn" style={{ display: 'inline-block', marginTop: '1.5rem', textDecoration: 'none' }}>
        Zur Foto Gallery
      </Link>
    </section>
  );
}

export default PhotoUploadSection;