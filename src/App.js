import React from "react";
import "./App.css";

import InfoSection from "./components/InfoSection";
import RSVPForm from "./components/RSVPForm";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import PhotoUploadSection from "./components/PhotoUploadSection";
import PasswordGate from "./components/PasswordGate";

function App() {
  // Logout and session logic
  const AUTH_KEY = 'isAuthenticated';
  const SESSION_KEY = 'sessionStart';
  const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

  React.useEffect(() => {
    if (localStorage.getItem(AUTH_KEY) === 'true') {
      const start = localStorage.getItem(SESSION_KEY);
      if (!start) {
        localStorage.setItem(SESSION_KEY, Date.now().toString());
      } else {
        const now = Date.now();
        if (now - parseInt(start, 10) > SESSION_DURATION) {
          localStorage.removeItem(AUTH_KEY);
          localStorage.removeItem(SESSION_KEY);
          window.location.reload();
        }
      }
    }
    // Set up interval to check session expiration
    const interval = setInterval(() => {
      const start = localStorage.getItem(SESSION_KEY);
      if (localStorage.getItem(AUTH_KEY) === 'true' && start) {
        const now = Date.now();
        if (now - parseInt(start, 10) > SESSION_DURATION) {
          localStorage.removeItem(AUTH_KEY);
          localStorage.removeItem(SESSION_KEY);
          window.location.reload();
        }
      }
    }, 10000); // check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(SESSION_KEY);
    window.location.reload();
  };

  return (
    <PasswordGate>
      <div className="App">

        <main>
          <Navbar id="navbar" />
          <Hero id="hero" />
          <InfoSection id="info" />
          <RSVPForm id="rsvp" />
          <PhotoUploadSection id="photos" />
          
          
        </main>

        <button onClick={handleLogout} style={{position: 'fixed', top: 10, right: 10, zIndex: 1000}}>Logout</button>

        <footer className="footer">
          <p>© 2026 Tomke & Jan-Paul</p>
        </footer>
      </div>
    </PasswordGate>
  );
}

export default App;