import React, { useState } from 'react';
import api from '../services/api';

const Availability = () => {
  const [productId, setProductId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checkAvailability = async (e) => {
    e.preventDefault();
    if (!productId.trim() || !fromDate || !toDate) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await api.get(`/rentals/products/${encodeURIComponent(productId.trim())}/availability`, {
        params: { from: fromDate, to: toDate }
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to check availability');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '2rem' }}>Check Product Availability</h2>

      <div className="card" style={{ maxWidth: '560px', marginBottom: '2rem' }}>
        <form onSubmit={checkAvailability} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Product ID
            </label>
            <input
              id="product-id-input"
              type="text"
              placeholder="e.g. 42"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text-main)',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                From Date
              </label>
              <input
                id="from-date-input"
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text-main)',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                To Date
              </label>
              <input
                id="to-date-input"
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text-main)',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" id="check-availability-btn" className="btn" disabled={loading}>
            {loading ? 'Checking...' : 'Check Availability'}
          </button>
        </form>
      </div>

      {loading && (
        <div className="loading-spinner"><div className="spinner"></div></div>
      )}

      {result && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>Product #{result.productId}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {result.from} → {result.to}
              </p>
            </div>
            <span style={{
              padding: '0.4rem 1rem',
              borderRadius: '999px',
              fontWeight: '700',
              fontSize: '0.95rem',
              background: result.available ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: result.available ? '#4ade80' : '#f87171'
            }}>
              {result.available ? '✓ Available' : '✗ Not Available'}
            </span>
          </div>

          {result.busyPeriods && result.busyPeriods.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.75rem', color: '#f87171' }}>Busy Periods</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {result.busyPeriods.map((p, i) => (
                  <div key={i} style={{
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    fontSize: '0.9rem'
                  }}>
                    {p.from} → {p.to}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.freeWindows && result.freeWindows.length > 0 && (
            <div>
              <h4 style={{ marginBottom: '0.75rem', color: '#4ade80' }}>Free Windows</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {result.freeWindows.map((w, i) => (
                  <div key={i} style={{
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.2)',
                    fontSize: '0.9rem'
                  }}>
                    {w.from} → {w.to}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Availability;
