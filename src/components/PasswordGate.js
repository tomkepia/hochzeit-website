import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { passwordLogin } from '../services/api';

export default function PasswordGate({ children }) {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('galleryAccess') === 'true') {
      setAuthenticated(true);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await passwordLogin(input);
      localStorage.setItem('galleryToken', result.token);
      localStorage.setItem('galleryAccess', 'true');
      navigate('/gallery');
    } catch (err) {
      setError('Falsches Passwort. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
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
          disabled={loading}
        />
        <button type="submit" style={{ padding: '8px 16px', fontSize: '16px' }} disabled={loading}>
          {loading ? 'Wird geprüft…' : 'Einloggen'}
        </button>
      </form>
      {error && <p style={{ color: 'red', marginTop: '8px' }}>{error}</p>}
    </div>
  );
}
