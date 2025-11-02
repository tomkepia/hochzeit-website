import React, { useState, useEffect } from 'react';

const PASSWORD = 't&j'; // Change this to your desired password
const AUTH_KEY = 'isAuthenticated';

export default function PasswordGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (localStorage.getItem(AUTH_KEY) === 'true') {
      setAuthenticated(true);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input === PASSWORD) {
      localStorage.setItem(AUTH_KEY, 'true');
      setAuthenticated(true);
      setError('');
    } else {
      setError('Falsches Passwort. Bitte versuche es erneut.');
    }
  };

  if (authenticated) {
    return children;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <h2>Bitte Passwort eingeben</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Passwort"
          style={{ padding: '8px', fontSize: '16px', marginBottom: '8px' }}
        />
        <button type="submit" style={{ padding: '8px 16px', fontSize: '16px' }}>Einloggen</button>
      </form>
      {error && <p style={{ color: 'red', marginTop: '8px' }}>{error}</p>}
    </div>
  );
}
