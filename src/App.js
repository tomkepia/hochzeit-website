import React from "react";
import "./App.css";
import { useRef } from "react";

import InfoSection from "./components/InfoSection";
import RSVPForm from "./components/RSVPForm";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import PhotoUploadSection from "./components/PhotoUploadSection";
import PasswordGate from "./components/PasswordGate";
import { LogOut} from "lucide-react";

// Logout and session logic
const AUTH_KEY = 'isAuthenticated';
const SESSION_KEY = 'sessionStart';
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

function App() {

  const heroRef = useRef(null);
  const infoRef = useRef(null);
  const photosRef = useRef(null);
  const rsvpRef = useRef(null);

  const scrollToRef = (ref) => {
    ref.current?.scrollIntoView({ behavior: "smooth" });
  };

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
      <Navbar
        scrollTo={{
          hero: () => scrollToRef(heroRef),
          infos: () => scrollToRef(infoRef),
          rsvp: () => scrollToRef(rsvpRef),
          photos: () => scrollToRef(photosRef),
          
        }}
        onLogout={handleLogout}
      />

      <div ref={heroRef}><Hero /></div>
      <div ref={infoRef}><InfoSection /></div>
      <div ref={rsvpRef}><RSVPForm /></div>
      <div ref={photosRef}><PhotoUploadSection /></div>
      

        <footer className="footer">
          <p>© 2026 Tomke & Jan-Paul</p>
        </footer>
      </div>
    </PasswordGate>
  );
}

export default App;