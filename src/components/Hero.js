import React, { useState, useEffect } from "react";

function Hero() {
  const weddingDate = new Date("2026-05-09T14:00:00");
  const [timeLeft, setTimeLeft] = useState(getTimeLeft());

  function getTimeLeft() {
    const now = new Date();
    const diff = weddingDate - now;

    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  }

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <section className="hero">
        <div className="hero-overlay">
          <h1>
            <span className="tan-mon-cheri">TOMKE & JAN-PAUL</span>
          </h1>
          <p>Wir heiraten – 09. Mai 2026</p>
        </div>

        <div className="countdown-floating">
          <div className="countdown-circle">
            <span className="number">{timeLeft.days}</span>
            <span className="label">Tage</span>
          </div>
          <div className="countdown-circle">
            <span className="number">{timeLeft.hours}</span>
            <span className="label">Std</span>
          </div>
          <div className="countdown-circle">
            <span className="number">{timeLeft.minutes}</span>
            <span className="label">Min</span>
          </div>
          <div className="countdown-circle">
            <span className="number">{timeLeft.seconds}</span>
            <span className="label">Sek</span>
          </div>
        </div>
      </section>
    </>
  );
}

export default Hero;
