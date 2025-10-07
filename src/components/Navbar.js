import React from "react";

function Navbar() {
  return (
    <header className="nav">
      <div className="nav-left">Tomke & Jan-Paul</div>
      <nav className="nav-right">
        <a href="#info">Wedding</a>
        <a href="#travel">Travel</a>
        <a href="#story">Our Story</a>
        <a href="#rsvp" className="nav-btn">R S V P</a>
      </nav>
    </header>
  );
}

export default Navbar;