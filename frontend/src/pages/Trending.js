import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

const SkeletonCard = () => (
  <div className="card" style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>
    <div style={{ height: '12px', background: 'var(--border)', borderRadius: '6px', marginBottom: '0.75rem', width: '40%' }}></div>
    <div style={{ height: '18px', background: 'var(--border)', borderRadius: '6px', marginBottom: '0.75rem', width: '80%' }}></div>
    <div style={{ height: '14px', background: 'var(--border)', borderRadius: '6px', width: '50%' }}></div>
  </div>
);

const Trending = () => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastFetched, setLastFetched] = useState('');

  const fetchTrending = useCallback(async () => {
    setLoading(true);
    setError('');
    const today = getTodayDate();
    try {
      const res = await api.get('/analytics/recommendations', {
        params: { date: today, limit: 6 }
      });
      setRecommendations(res.data.recommendations || []);
      setLastFetched(today);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load trending products. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrending();
  }, [fetchTrending]);

  const categoryColors = {
    ELECTRONICS: '#6366f1',
    OUTDOOR: '#22c55e',
    SPORTS: '#f59e0b',
    VEHICLES: '#3b82f6',
    TOOLS: '#ef4444',
    MUSIC: '#a855f7',
    CAMERAS: '#14b8a6',
    FURNITURE: '#f97316',
    OFFICE: '#64748b',
    DEFAULT: '#8b5cf6'
  };

  const getCategoryColor = (cat) => categoryColors[cat] || categoryColors.DEFAULT;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.25rem' }}>🔥 What's Trending Today?</h2>
          {lastFetched && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Seasonal recommendations for {lastFetched}
            </p>
          )}
        </div>
        <button
          id="refresh-trending-btn"
          className="btn"
          style={{ width: 'auto', padding: '0.6rem 1.5rem' }}
          onClick={fetchTrending}
          disabled={loading}
        >
          {loading ? 'Loading...' : '↺ Refresh'}
        </button>
      </div>

      {error && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 2rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>😕</div>
          <p style={{ marginBottom: '1rem' }}>{error}</p>
          <button className="btn" style={{ width: 'auto' }} onClick={fetchTrending}>Try Again</button>
        </div>
      )}

      {!error && (
        <div className="grid">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : recommendations.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📦</div>
              <p>No trending products found for today.</p>
            </div>
          ) : (
            recommendations.map((rec, idx) => (
              <div key={rec.productId || idx} className="card" style={{ position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: '700',
                  color: 'var(--text-muted)'
                }}>
                  #{idx + 1}
                </div>

                <span style={{
                  display: 'inline-block',
                  padding: '0.25rem 0.65rem',
                  borderRadius: '999px',
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  letterSpacing: '0.05em',
                  background: `${getCategoryColor(rec.category)}22`,
                  color: getCategoryColor(rec.category),
                  marginBottom: '0.75rem',
                  border: `1px solid ${getCategoryColor(rec.category)}44`
                }}>
                  {rec.category || 'UNKNOWN'}
                </span>

                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-main)', paddingRight: '2rem' }}>
                  {rec.name || `Product #${rec.productId}`}
                </h3>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {rec.productId}</span>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '999px',
                    background: 'rgba(99,102,241,0.12)',
                    color: 'var(--primary)',
                    fontSize: '0.85rem',
                    fontWeight: '600'
                  }}>
                    ⭐ {rec.score} rentals
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default Trending;
