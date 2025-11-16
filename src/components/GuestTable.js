import React from 'react';
import { Check, X, Clock, Mail, Car, Utensils, Bed } from 'lucide-react';

function GuestTable({ guests, searchTerm }) {
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
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => (
            <tr key={guest.id} style={{ borderBottom: '1px solid #dee2e6' }}>
              <td style={{ padding: '12px 8px', fontWeight: '500' }}>
                {highlightText(guest.name, searchTerm)}
              </td>
              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  {getStatusIcon(guest.dabei)}
                  <span style={{ fontSize: '12px' }}>{getStatusText(guest.dabei)}</span>
                </div>
              </td>
              <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                {guest.email ? highlightText(guest.email, searchTerm) : '-'}
              </td>
              <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                {guest.essenswunsch || '-'}
              </td>
              <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                {guest.anreise || '-'}
              </td>
              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                {getBooleanIcon(guest.essen_fr)}
              </td>
              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                {getBooleanIcon(guest.essen_sa)}
              </td>
              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                {getBooleanIcon(guest.essen_so)}
              </td>
              <td style={{ padding: '12px 8px', fontSize: '14px' }}>
                {guest.unterkunft || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default GuestTable;