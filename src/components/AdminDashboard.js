import React, { useState, useEffect } from 'react';
import { LogOut, Users, Search, X, Download } from 'lucide-react';
import GuestTable from './GuestTable';

const ADMIN_AUTH_KEY = 'adminAuthenticated';
const ADMIN_SESSION_KEY = 'adminSessionStart';

function AdminDashboard() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGuest, setNewGuest] = useState({
    name: '',
    essenswunsch: '',
    dabei: null,
    email: '',
    anreise: '',
    essen_fr: false,
    essen_sa: false,
    essen_so: false,
    unterkunft: '',
  });
  const [addError, setAddError] = useState('');
  const [guests, setGuests] = useState([]);
  const [filteredGuests, setFilteredGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchGuests();
  }, []);

  useEffect(() => {
    // Filter guests based on search term
    if (searchTerm.trim() === '') {
      setFilteredGuests(guests);
    } else {
      const filtered = guests.filter(guest => 
        guest.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (guest.email && guest.email.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      setFilteredGuests(filtered);
    }
  }, [searchTerm, guests]);

  const fetchGuests = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/guests');
      if (!response.ok) {
        throw new Error('Fehler beim Laden der Gästedaten');
      }
      const data = await response.json();
      setGuests(data);
      setFilteredGuests(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGuest = async (guestId, guestName) => {
    const confirmed = window.confirm(
      `Möchten Sie den Gast "${guestName}" wirklich löschen?\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`
    );
    
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/guests/${guestId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Fehler beim Löschen des Gastes');
      }
      
      const result = await response.json();
      
      if (result.success) {
        // Refresh the guest list
        await fetchGuests();
      } else {
        throw new Error(result.error || 'Fehler beim Löschen des Gastes');
      }
    } catch (err) {
      alert(`Fehler: ${err.message}`);
    }
  };

  const handleUpdateGuest = async (guestId, updatedData) => {
    try {
      const response = await fetch(`/api/admin/guests/${guestId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedData),
      });
      
      if (!response.ok) {
        throw new Error('Fehler beim Aktualisieren des Gastes');
      }
      
      const result = await response.json();
      
      if (result.success) {
        // Refresh the guest list
        await fetchGuests();
        return true;
      } else {
        throw new Error(result.error || 'Fehler beim Aktualisieren des Gastes');
      }
    } catch (err) {
      alert(`Fehler: ${err.message}`);
      return false;
    }
  };

  const handleDownloadExcel = async () => {
    try {
      const response = await fetch('/api/admin/guests/export');
      if (!response.ok) {
        throw new Error('Fehler beim Exportieren der Daten');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gaeste.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(`Fehler: ${err.message}`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_AUTH_KEY);
    localStorage.removeItem(ADMIN_SESSION_KEY);
    window.location.reload();
  };

  const clearSearch = () => {
    setSearchTerm('');
  };

  const attendingCount = guests.filter(guest => guest.dabei === true).length;
  const notAttendingCount = guests.filter(guest => guest.dabei === false).length;


  // Anreise KPIs
  const arrivalFriday = guests.filter(g => g.anreise === 'freitag').length;
  const arrivalSaturday = guests.filter(g => g.anreise === 'samstag').length;
  const sleepVorOrt = guests.filter(g => g.unterkunft === 'vor_ort').length;
  const sleepHotel = guests.filter(g => g.unterkunft === 'hotel').length;
  const sleepWohnwagen = guests.filter(g => g.unterkunft === 'camping').length;

  // Food Participation KPIs
  const foodFriday = guests.filter(g => g.essen_fr === true).length;
  const foodSaturday = guests.filter(g => g.essen_sa === true).length;
  const foodSunday = guests.filter(g => g.essen_so === true).length;

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f8f9fa',
      padding: '20px'
    }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{ margin: '0', color: '#333', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={28} />
            Admin Dashboard
          </h1>
          <p style={{ margin: '5px 0 0 0', color: '#666' }}>
            Hochzeit Tomke & Jan-Paul - Gästeübersicht
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#007cba',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            + Neuen Gast hinzufügen
          </button>
      {/* Add Guest Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 24, minWidth: 320, maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
            <h2>Neuen Gast hinzufügen</h2>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setAddError('');
              try {
                const response = await fetch('/api/rsvp', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(newGuest),
                });
                if (!response.ok) throw new Error('Fehler beim Hinzufügen');
                setShowAddModal(false);
                setNewGuest({ name: '', essenswunsch: '', dabei: null, email: '', anreise: '', essen_fr: false, essen_sa: false, essen_so: false, unterkunft: '' });
                await fetchGuests();
              } catch (err) {
                setAddError(err.message);
              }
            }}>
              <div style={{ marginBottom: 12 }}>
                <label>Name:<br/>
                  <input required type="text" value={newGuest.name} onChange={e => setNewGuest({ ...newGuest, name: e.target.value })} style={{ width: '100%' }} />
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Essenswunsch:<br/>
                  <select required value={newGuest.essenswunsch} onChange={e => setNewGuest({ ...newGuest, essenswunsch: e.target.value })} style={{ width: '100%' }}>
                    <option value="">Bitte wählen</option>
                    <option value="Vegan">Vegan</option>
                    <option value="Vegetarisch">Vegetarisch</option>
                    <option value="Egal">Egal</option>
                  </select>
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Status:<br/>
                  <select required value={newGuest.dabei === null ? '' : newGuest.dabei ? 'ja' : 'nein'} onChange={e => setNewGuest({ ...newGuest, dabei: e.target.value === '' ? null : e.target.value === 'ja' })} style={{ width: '100%' }}>
                    <option value="">Ausstehend</option>
                    <option value="ja">Kommt</option>
                    <option value="nein">Kommt nicht</option>
                  </select>
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Email:<br/>
                  <input required type="email" value={newGuest.email} onChange={e => setNewGuest({ ...newGuest, email: e.target.value })} style={{ width: '100%' }} />
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Anreise:<br/>
                  <select required value={newGuest.anreise} onChange={e => setNewGuest({ ...newGuest, anreise: e.target.value })} style={{ width: '100%' }}>
                    <option value="">Bitte wählen</option>
                    <option value="freitag">Freitag</option>
                    <option value="samstag">Samstag</option>
                  </select>
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Verpflegung:<br/>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label><input type="checkbox" checked={newGuest.essen_fr} onChange={e => setNewGuest({ ...newGuest, essen_fr: e.target.checked })} /> Freitag Abendessen</label>
                    <label><input type="checkbox" checked={newGuest.essen_sa} onChange={e => setNewGuest({ ...newGuest, essen_sa: e.target.checked })} /> Samstag Frühstück</label>
                    <label><input type="checkbox" checked={newGuest.essen_so} onChange={e => setNewGuest({ ...newGuest, essen_so: e.target.checked })} /> Sonntag Frühstück</label>
                  </div>
                </label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Unterkunft:<br/>
                  <select required value={newGuest.unterkunft} onChange={e => setNewGuest({ ...newGuest, unterkunft: e.target.value })} style={{ width: '100%' }}>
                    <option value="">Bitte wählen</option>
                    <option value="hotel">Hotel</option>
                    <option value="vor_ort">Zimmer in unserer Location</option>
                    <option value="camping">Bulli oder Wohnwagen</option>
                  </select>
                </label>
              </div>
              {addError && <div style={{ color: 'red', marginBottom: 8 }}>{addError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setShowAddModal(false)} style={{ background: '#eee', border: 'none', borderRadius: 4, padding: '8px 16px', cursor: 'pointer' }}>Abbrechen</button>
                <button type="submit" style={{ background: '#28a745', color: 'white', border: 'none', borderRadius: 4, padding: '8px 16px', cursor: 'pointer' }}>Speichern</button>
              </div>
            </form>
          </div>
        </div>
      )}
          <button
            onClick={handleDownloadExcel}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <Download size={16} />
            Excel Download
          </button>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div
        className="kpi-scroll-container"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '20px',
          marginBottom: '20px',
        }}
      >

        {/* Attendance KPIs */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#28a745' }}>Zusagen</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#28a745' }}>{attendingCount}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#dc3545' }}>Absagen</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#dc3545' }}>{notAttendingCount}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#007cba' }}>Gesamt</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#007cba' }}>{guests.length}</p>
        </div>

        {/* Anreise KPIs */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#007cba' }}>Anreise Freitag</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#007cba' }}>{arrivalFriday}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#007cba' }}>Anreise Samstag</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#007cba' }}>{arrivalSaturday}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#795548' }}>Schlafen vor Ort</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#795548' }}>{sleepVorOrt}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#607d8b' }}>Hotel</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#607d8b' }}>{sleepHotel}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#388e3c' }}>Wohnwagen</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#388e3c' }}>{sleepWohnwagen}</p>
        </div>

        {/* Food Participation KPIs */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#ff9800' }}>Essen Freitag</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#ff9800' }}>{foodFriday}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#ff9800' }}>Essen Samstag</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#ff9800' }}>{foodSaturday}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#ff9800' }}>Essen Sonntag</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#ff9800' }}>{foodSunday}</p>
        </div>
      </div>

      {/* Search and Table */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Search Bar */}
        <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
          <div style={{ position: 'relative', maxWidth: '400px' }}>
            <Search 
              size={20} 
              style={{ 
                position: 'absolute', 
                left: '12px', 
                top: '50%', 
                transform: 'translateY(-50%)', 
                color: '#666' 
              }} 
            />
            <input
              type="text"
              placeholder="Nach Name oder E-Mail suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 40px 10px 40px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            {searchTerm && (
              <button
                onClick={clearSearch}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#666'
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p>Lade Gästedaten...</p>
            </div>
          )}

          {error && (
            <div style={{ 
              backgroundColor: '#f8d7da', 
              color: '#721c24', 
              padding: '12px', 
              borderRadius: '4px',
              marginBottom: '20px'
            }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <GuestTable 
              guests={filteredGuests} 
              searchTerm={searchTerm}
              onDeleteGuest={handleDeleteGuest}
              onUpdateGuest={handleUpdateGuest}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;