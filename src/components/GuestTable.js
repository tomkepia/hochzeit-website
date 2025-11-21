import React, { useState } from 'react';
import { Check, X, Clock, Mail, Car, Utensils, Bed, Trash2, Edit2, Save, XCircle } from 'lucide-react';

function GuestTable({ guests, searchTerm, onDeleteGuest, onUpdateGuest }) {
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const handleEditClick = (guest) => {
    setEditingId(guest.id);
    setEditData({ ...guest });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const handleSaveEdit = async () => {
    const success = await onUpdateGuest(editingId, editData);
    if (success) {
      setEditingId(null);
      setEditData({});
    }
  };

  const handleFieldChange = (field, value) => {
    setEditData({ ...editData, [field]: value });
  };

  const highlightText = (text, search) => {
    if (!search || !text) return text;
    
    const parts = text.split(new RegExp(`(${search})`, 'gi'));
    return parts.map((part, index) => 
      part.toLowerCase() === search.toLowerCase() ? 
        <span key={index} style={{ backgroundColor: '#ffeb3b', fontWeight: 'bold' }}>{part}</span> : 
        part
    );
  };

  const getStatusIcon = (dabei) => {
    if (dabei === true) return <Check size={16} style={{ color: '#28a745' }} />;
    if (dabei === false) return <X size={16} style={{ color: '#dc3545' }} />;
    return <Clock size={16} style={{ color: '#ffc107' }} />;
  };

  const getStatusText = (dabei) => {
    if (dabei === true) return 'Kommt';
    if (dabei === false) return 'Kommt nicht';
    return 'Ausstehend';
  };

  const getBooleanIcon = (value) => {
    if (value === true) return <Check size={14} style={{ color: '#28a745' }} />;
    if (value === false) return <X size={14} style={{ color: '#dc3545' }} />;
    return '-';
  };

  if (guests.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
        {searchTerm ? 'Keine Gäste gefunden für diese Suche.' : 'Noch keine Gäste angemeldet.'}
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ 
        width: '100%', 
        borderCollapse: 'collapse',
        minWidth: '800px'
      }}>
        <thead>
          <tr style={{ backgroundColor: '#f8f9fa' }}>
            <th style={{ padding: '12px 8px', textAlign: 'left', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              Name
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'center', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              Status
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'left', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              <Mail size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              E-Mail
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'left', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              <Utensils size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              Essen
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'left', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              <Car size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              Anreise
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'center', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              Fr
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'center', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              Sa
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'center', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              So
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'left', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              <Bed size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              Unterkunft
            </th>
            <th style={{ padding: '12px 8px', textAlign: 'center', borderBottom: '2px solid #dee2e6', fontWeight: '600' }}>
              Aktionen
            </th>
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => {
            const isEditing = editingId === guest.id;
            return (
              <tr key={guest.id} style={{ borderBottom: '1px solid #dee2e6', backgroundColor: isEditing ? '#f8f9fa' : 'transparent' }}>
                <td style={{ padding: '12px 8px', fontWeight: '500' }}>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.name || ''}
                      onChange={(e) => handleFieldChange('name', e.target.value)}
                      style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px' }}
                    />
                  ) : (
                    highlightText(guest.name, searchTerm)
                  )}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {isEditing ? (
                    <select
                      value={editData.dabei === null ? '' : editData.dabei}
                      onChange={(e) => handleFieldChange('dabei', e.target.value === '' ? null : e.target.value === 'true')}
                      style={{ padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '12px' }}
                    >
                      <option value="">Ausstehend</option>
                      <option value="true">Kommt</option>
                      <option value="false">Kommt nicht</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      {getStatusIcon(guest.dabei)}
                      <span style={{ fontSize: '12px' }}>{getStatusText(guest.dabei)}</span>
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                  {isEditing ? (
                    <input
                      type="email"
                      value={editData.email || ''}
                      onChange={(e) => handleFieldChange('email', e.target.value)}
                      style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '14px' }}
                    />
                  ) : (
                    guest.email ? highlightText(guest.email, searchTerm) : '-'
                  )}
                </td>
                <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                  {isEditing ? (
                    <select
                      value={editData.essenswunsch || ''}
                      onChange={(e) => handleFieldChange('essenswunsch', e.target.value)}
                      style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '14px' }}
                    >
                      <option value="">-</option>
                      <option value="Vegan">Vegan</option>
                      <option value="Vegetarisch">Vegetarisch</option>
                      <option value="Egal">Egal</option>
                    </select>
                  ) : (
                    guest.essenswunsch || '-'
                  )}
                </td>
                <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                  {isEditing ? (
                    <select
                      value={editData.anreise || ''}
                      onChange={(e) => handleFieldChange('anreise', e.target.value)}
                      style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '14px' }}
                    >
                      <option value="">-</option>
                      <option value="freitag">Freitag</option>
                      <option value="samstag">Samstag</option>
                    </select>
                  ) : (
                    guest.anreise || '-'
                  )}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {isEditing ? (
                    <input
                      type="checkbox"
                      checked={editData.essen_fr || false}
                      onChange={(e) => handleFieldChange('essen_fr', e.target.checked)}
                    />
                  ) : (
                    getBooleanIcon(guest.essen_fr)
                  )}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {isEditing ? (
                    <input
                      type="checkbox"
                      checked={editData.essen_sa || false}
                      onChange={(e) => handleFieldChange('essen_sa', e.target.checked)}
                    />
                  ) : (
                    getBooleanIcon(guest.essen_sa)
                  )}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {isEditing ? (
                    <input
                      type="checkbox"
                      checked={editData.essen_so || false}
                      onChange={(e) => handleFieldChange('essen_so', e.target.checked)}
                    />
                  ) : (
                    getBooleanIcon(guest.essen_so)
                  )}
                </td>
                <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                  {isEditing ? (
                    <select
                      value={editData.unterkunft || ''}
                      onChange={(e) => handleFieldChange('unterkunft', e.target.value)}
                      style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '14px' }}
                    >
                      <option value="">-</option>
                      <option value="hotel">Hotel</option>
                      <option value="vor_ort">Zimmer in unserer Location</option>
                      <option value="camping">Bulli oder Wohnwagen</option>
                    </select>
                  ) : (
                    guest.unterkunft || '-'
                  )}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                    {isEditing ? (
                      <>
                        <button
                          onClick={handleSaveEdit}
                          style={{
                            background: 'none',
                            border: '1px solid #28a745',
                            borderRadius: '4px',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            color: '#28a745',
                            display: 'inline-flex',
                            alignItems: 'center',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#28a745';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#28a745';
                          }}
                          title="Änderungen speichern"
                        >
                          <Save size={16} />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          style={{
                            background: 'none',
                            border: '1px solid #6c757d',
                            borderRadius: '4px',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            color: '#6c757d',
                            display: 'inline-flex',
                            alignItems: 'center',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#6c757d';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#6c757d';
                          }}
                          title="Abbrechen"
                        >
                          <XCircle size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEditClick(guest)}
                          style={{
                            background: 'none',
                            border: '1px solid #007bff',
                            borderRadius: '4px',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            color: '#007bff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#007bff';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#007bff';
                          }}
                          title="Gast bearbeiten"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => onDeleteGuest(guest.id, guest.name)}
                          style={{
                            background: 'none',
                            border: '1px solid #dc3545',
                            borderRadius: '4px',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            color: '#dc3545',
                            display: 'inline-flex',
                            alignItems: 'center',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#dc3545';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#dc3545';
                          }}
                          title="Gast löschen"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default GuestTable;