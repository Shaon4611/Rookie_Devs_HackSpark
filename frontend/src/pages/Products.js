import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const CATEGORIES = [];

const Products = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchCategories = async () => {
    try {
      // We derive categories from a product fetch — or just use a static hint
      const res = await api.get('/rentals/products', { params: { limit: 1 } });
      // Categories are validated on backend; we'll fetch known ones from a small probe
    } catch { /* ignore */ }
  };

  const fetchProducts = useCallback(async (cat, pg) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: pg, limit: 20 };
      if (cat) params.category = cat;
      const res = await api.get('/rentals/products', { params });
      const data = res.data;
      setProducts(data.data || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts(selectedCategory, page);
  }, [selectedCategory, page, fetchProducts]);

  const knownCategories = [
    'ELECTRONICS', 'FURNITURE', 'VEHICLES', 'TOOLS', 'OUTDOOR',
    'SPORTS', 'MUSIC', 'CAMERAS', 'OFFICE', 'FASHION', 'GAMES',
    'BOOKS', 'BABY', 'APPLIANCES', 'GARDEN', 'HEALTH', 'PETS',
    'INDUSTRIAL', 'PARTY', 'LIGHTING'
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Product Catalog</h2>
        <select
          id="category-filter"
          value={selectedCategory}
          onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--text-main)',
            fontSize: '0.95rem',
            cursor: 'pointer'
          }}
        >
          <option value="">All Categories</option>
          {knownCategories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : products.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No products found.</p>
      ) : (
        <>
          <div className="grid">
            {products.map(product => (
              <div key={product.id} className="card">
                <div style={{
                  display: 'inline-block',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  background: 'rgba(99,102,241,0.15)',
                  color: 'var(--primary)',
                  marginBottom: '0.75rem',
                  fontWeight: '600'
                }}>
                  {product.category}
                </div>
                <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>{product.name}</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--primary)' }}>
                    ${(product.pricePerDay || product.price_per_day || 0).toFixed(2)}/day
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {product.id}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2rem', alignItems: 'center' }}>
            <button
              className="btn"
              style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              ← Prev
            </button>
            <span style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
            <button
              className="btn"
              style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default Products;
