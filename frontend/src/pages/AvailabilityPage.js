import React, { useState } from "react";
import { products as productsApi } from "../services/api";
import "./AvailabilityPage.css";

export function AvailabilityPage() {
  const [productId, setProductId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setSearched(true);

    if (!productId || !fromDate || !toDate) {
      setError("Please fill in all fields");
      setLoading(false);
      return;
    }

    try {
      const response = await productsApi.getAvailability(productId, fromDate, toDate);
      if (response.status === 200) {
        setAvailability(response.data);
      } else {
        setError(response.data.message || "Failed to check availability");
        setAvailability(null);
      }
    } catch (err) {
      setError(err.message || "Error checking availability");
      setAvailability(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="availability-page">
        <h1>Check Product Availability</h1>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="availability-form">
          <div className="form-group">
            <label htmlFor="product-id">Product ID</label>
            <input
              id="product-id"
              type="number"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Enter product ID"
              disabled={loading}
              required
            />
          </div>

          <div className="date-row">
            <div className="form-group">
              <label htmlFor="from-date">From Date</label>
              <input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="to-date">To Date</label>
              <input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? "Checking..." : "Check Availability"}
          </button>
        </form>

        {loading && <div className="loading">Checking availability...</div>}

        {searched && availability && (
          <div className="availability-results">
            <div className="result-header">
              <h2>Product {availability.productId}</h2>
              <span className={`availability-status ${availability.available ? 'available' : 'unavailable'}`}>
                {availability.available ? "AVAILABLE" : "NOT AVAILABLE"}
              </span>
            </div>

            <div className="result-dates">
              <p><strong>Period:</strong> {availability.from} to {availability.to}</p>
            </div>

            {!availability.available && availability.busyPeriods?.length > 0 && (
              <div className="busy-periods">
                <h3>Busy Periods</h3>
                <ul>
                  {availability.busyPeriods.map((period, idx) => (
                    <li key={idx}>
                      {period.from} to {period.to}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {availability.freeWindows?.length > 0 && (
              <div className="free-windows">
                <h3>Free Windows</h3>
                <ul>
                  {availability.freeWindows.map((window, idx) => (
                    <li key={idx}>
                      {window.from} to {window.to}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
