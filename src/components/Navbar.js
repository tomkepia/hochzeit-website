import React from "react";

function Navbar() {
  return (
    <header className="nav">
      <div className="nav-left">Tomke & Jan-Paul</div>
      <nav className="nav-right">
        <a href="#info">Informationen</a>
        <a href="#Rückmeldung">Rückmeldung</a>
        <a href="#photos" className="nav-btn">Fotos</a>
      </nav>
    </header>
  );
}

export default Navbar;

