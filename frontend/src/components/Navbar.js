import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Navbar.css";

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  if (!user) {
    return null;
  }

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand">RentPi</div>
        <div className="navbar-menu">
          <a href="/products" className="navbar-link">
            Products
          </a>
          <a href="/availability" className="navbar-link">
            Availability
          </a>
          <a href="/chat" className="navbar-link">
            Chat
          </a>
          <div className="navbar-user">
            <span className="user-name">{user.name}</span>
            <button onClick={handleLogout} className="logout-btn">
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
