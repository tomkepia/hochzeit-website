import React, { useState, useEffect } from 'react';

// Admin password from environment or fallback
const ADMIN_PASSWORD = process.env.REACT_APP_ADMIN_PASSWORD || 'admin2025';
const ADMIN_AUTH_KEY = 'adminAuthenticated';
const ADMIN_SESSION_KEY = 'adminSessionStart';
const ADMIN_SESSION_DURATION = 60 * 60 * 1000; // 60 minutes (longer than regular users)

export default function AdminPasswordGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (localStorage.getItem(ADMIN_AUTH_KEY) === 'true') {
      const start = localStorage.getItem(ADMIN_SESSION_KEY);
      if (!start) {
        localStorage.setItem(ADMIN_SESSION_KEY, Date.now().toString());
        setAuthenticated(true);
      } else {
        const now = Date.now();
        if (now - parseInt(start, 10) > ADMIN_SESSION_DURATION) {
          localStorage.removeItem(ADMIN_AUTH_KEY);
          localStorage.removeItem(ADMIN_SESSION_KEY);
          setAuthenticated(false);
        } else {
          setAuthenticated(true);
        }
      }
    }

    // Set up interval to check session expiration
    const interval = setInterval(() => {
      const start = localStorage.getItem(ADMIN_SESSION_KEY);
      if (localStorage.getItem(ADMIN_AUTH_KEY) === 'true' && start) {
        const now = Date.now();
        if (now - parseInt(start, 10) > ADMIN_SESSION_DURATION) {
          localStorage.removeItem(ADMIN_AUTH_KEY);
          localStorage.removeItem(ADMIN_SESSION_KEY);
          setAuthenticated(false);
        }
      }
    }, 30000); // check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input === ADMIN_PASSWORD) {
      localStorage.setItem(ADMIN_AUTH_KEY, 'true');
      localStorage.setItem(ADMIN_SESSION_KEY, Date.now().toString());
      setAuthenticated(true);
      setError('');
    } else {
      setError('Falsches Admin-Passwort. Bitte versuche es erneut.');
    }
  };

  if (authenticated) {
    return children;
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        maxWidth: '400px',
        width: '100%'
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', color: '#333' }}>
          Admin-Zugang
        </h2>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '20px' }}>
          Bitte Admin-Passwort eingeben
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Admin-Passwort"
            style={{ 
              padding: '12px', 
              fontSize: '16px', 
              marginBottom: '16px',
              border: '1px solid #ddd',
              borderRadius: '4px'
            }}
          />
          <button 
            type="submit" 
            style={{ 
              padding: '12px 16px', 
              fontSize: '16px',
              backgroundColor: '#007cba',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Admin-Login
          </button>
        </form>
        {error && <p style={{ color: 'red', marginTop: '16px', textAlign: 'center' }}>{error}</p>}
      </div>
    </div>
  );
}