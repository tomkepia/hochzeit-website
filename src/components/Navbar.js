import React, { useState } from "react";
import { LogOut } from "lucide-react";

function Navbar({ scrollTo, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => setMenuOpen(!menuOpen);
  const handleClick = (callback) => {
    if (callback) callback();    // z.B. scrollTo-Funktion oder logout
    setMenuOpen(false);           // Menü schließen
  };

  return (
    <nav className="nav">
      {/* Logo / Branding */}
      <div className="nav-left">
        <span className="tan-mon-cheri">TOMKE & JAN-PAUL</span>
      </div>

      {/* Burger Button für mobile */}
      <button className="burger-btn" onClick={toggleMenu}>
        ☰
      </button>

      {/* Navigation Buttons */}
      <div className={`nav-right ${menuOpen ? "open" : ""}`}>
        <button onClick={() => handleClick(scrollTo.hero)}>Start</button>
        <button onClick={() => handleClick(scrollTo.infos)}>Infos</button>
        <button onClick={() => handleClick(scrollTo.rsvp)}>Rückmeldung</button>
        <button onClick={() => handleClick(scrollTo.photos)} className="nav-btn">
          Fotos hochladen
        </button>
        <button onClick={() => handleClick(onLogout)} className="logout_button">
          <LogOut size={16} />
        </button>
      </div>
    </nav>
  );
}

export default Navbar;
