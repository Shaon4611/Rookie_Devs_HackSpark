import React, { useState, useEffect } from "react";
import { products as productsApi } from "../services/api";
import "./ProductsPage.css";

export function ProductsPage() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const LIMIT = 20;

  useEffect(() => {
    fetchProducts();
  }, [selectedCategory, page]);

  const fetchProducts = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await productsApi.list(
        selectedCategory || undefined,
        page,
        LIMIT
      );

      if (response.status === 200) {
        setItems(response.data.data || []);
        setTotalPages(response.data.totalPages || 1);

        if (!categories.length && response.data.validCategories) {
          setCategories(response.data.validCategories);
        }
      } else {
        setError(response.data.message || "Failed to fetch products");
      }
    } catch (err) {
      setError(err.message || "Error fetching products");
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (e) => {
    setSelectedCategory(e.target.value);
    setPage(1);
  };

  if (loading && !items.length) {
    return (
      <div className="container">
        <div className="loading">Loading products...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="products-page">
        <h1>Browse Products</h1>

        {error && <div className="error-message">{error}</div>}

        <div className="products-controls">
          <div className="form-group">
            <label htmlFor="category">Filter by Category</label>
            <select
              id="category"
              value={selectedCategory}
              onChange={handleCategoryChange}
              disabled={loading}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="no-results">No products found</div>
        ) : (
          <div className="products-grid">
            {items.map((product) => (
              <div key={product.id} className="product-card">
                <div className="product-header">
                  <h3>{product.name}</h3>
                  <span className="category-badge">{product.category}</span>
                </div>
                <div className="product-body">
                  <p className="product-owner">Owner: {product.ownerId}</p>
                  <p className="product-price">
                    ${product.pricePerDay?.toFixed(2) || "0.00"}/day
                  </p>
                </div>
                <div className="product-footer">
                  <button className="view-btn">View Details</button>
                  <button className="availability-btn">Check Availability</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pagination">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1 || loading}
            className="pagination-btn"
          >
            Previous
          </button>
          <span className="pagination-info">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages || loading}
            className="pagination-btn"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
