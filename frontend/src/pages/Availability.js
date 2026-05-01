import React, { useState, useEffect } from 'react';
import api from '../services/api';

const Availability = () => {
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAvailability();
  }, []);

  const fetchAvailability = async () => {
    try {
      // Endpoint may vary, assume /rentals/availability or similar from api gateway
      const res = await api.get('/rentals/availability');
      setAvailability(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load availability data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
      </div>
    );
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="card">
      <h2 style={{ marginBottom: '2rem' }}>Equipment Availability</h2>
      {availability.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No availability records found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: '500' }}>Equipment</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: '500' }}>Status</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)', fontWeight: '500' }}>Available From</th>
              </tr>
            </thead>
            <tbody>
              {availability.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '1rem' }}>{item.equipment_name}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      padding: '0.25rem 0.75rem', 
                      borderRadius: '999px', 
                      fontSize: '0.875rem',
                      background: item.status === 'Available' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      color: item.status === 'Available' ? '#4ade80' : '#f87171'
                    }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>{new Date(item.available_from).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Availability;
