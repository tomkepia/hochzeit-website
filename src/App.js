import React from "react";
import "./App.css";

import InfoSection from "./components/InfoSection";
import RSVPForm from "./components/RSVPForm";
import PhotoUploadSection from "./components/PhotoUploadSection";

function App() {
  return (
    <div className="App">
      <header className="header">
        <h1>Tomke & Jan-Paul ❤️</h1>
        <p>Hochzeit: 09. Mai 2026</p>
      </header>

      <nav className="nav">
        <a href="#info">Informationen</a>
        <a href="#rsvp">Antwort</a>
        <a href="#photos">Fotos</a>
      </nav>

      <main>
        <InfoSection id="info" />
        <RSVPForm id="rsvp" />
        <PhotoUploadSection id="photos" />
      </main>

      <footer className="footer">
        <p>© 2026 Tomke & Jan-Paul</p>
      </footer>
    </div>
  );
}

export default App;
