
import React from "react";

import { AUTH_KEY, SESSION_KEY } from '../App';
import { LogOut } from "lucide-react";

function Navbar({ scrollTo, onLogout }) {
  return (
    <nav className="nav">
  <div className="nav-left"><span className="tan-mon-cheri">TOMKE & JAN-PAUL</span></div>
      <div className="nav-right">
        <button onClick={scrollTo.hero}>Start</button>
        <button onClick={scrollTo.infos}>Infos</button>
        <button onClick={scrollTo.rsvp}>Rückmeldung</button>
        <button onClick={scrollTo.photos} className="nav-btn">Fotos hochladen</button>
        <button onClick={onLogout} className="logout_button"><LogOut size={16} /></button>
      </div>
    </nav>
  );
}

export default Navbar;
