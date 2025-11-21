import React, { useState, useEffect } from 'react';
import { LogOut, Users, Search, X, Download } from 'lucide-react';
import GuestTable from './GuestTable';

const ADMIN_AUTH_KEY = 'adminAuthenticated';
const ADMIN_SESSION_KEY = 'adminSessionStart';

function AdminDashboard() {
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
  const pendingCount = guests.filter(guest => guest.dabei === null || guest.dabei === undefined).length;

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
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '20px',
        marginBottom: '20px'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#28a745' }}>Zusagen</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#28a745' }}>
            {attendingCount}
          </p>
        </div>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#dc3545' }}>Absagen</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#dc3545' }}>
            {notAttendingCount}
          </p>
        </div>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#ffc107' }}>Ausstehend</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#ffc107' }}>
            {pendingCount}
          </p>
        </div>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#007cba' }}>Gesamt</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0', color: '#007cba' }}>
            {guests.length}
          </p>
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