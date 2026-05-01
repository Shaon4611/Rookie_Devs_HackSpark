import React, { useState, useEffect } from 'react';
import api from '../services/api';

const Products = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      // Assuming GET /rentals endpoint to fetch products based on backend API gateway mapping
      const res = await api.get('/rentals');
      setProducts(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load products');
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
    <div>
      <h2 style={{ marginBottom: '2rem' }}>Available Equipment</h2>
      {products.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No products available at the moment.</p>
      ) : (
        <div className="grid">
          {products.map(product => (
            <div key={product.id} className="card">
              <h3 style={{ marginBottom: '1rem' }}>{product.title || product.name}</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                {product.description || 'No description available.'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1.25rem', color: 'var(--primary)' }}>
                  ${product.price_per_day}/day
                </span>
                <button className="btn" style={{ width: 'auto' }}>Rent Now</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Products;
