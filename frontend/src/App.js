import React, { useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, AuthContext } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Products from './pages/Products';
import Availability from './pages/Availability';
import Chat from './pages/Chat';
import Trending from './pages/Trending';
import './index.css';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);
  
  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
      </div>
    );
  }
  
  return user ? children : <Navigate to="/login" />;
};

const Navigation = () => {
  const { user, logout } = useContext(AuthContext);

  return (
    <nav className="navbar">
      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-main)', letterSpacing: '-0.5px' }}>
        <span style={{ color: 'var(--primary)' }}>Rent</span>Pi
      </div>
      <div className="nav-links">
        {user ? (
          <>
            <Link to="/products" className="nav-link">Products</Link>
            <Link to="/availability" className="nav-link">Availability</Link>
            <Link to="/trending" className="nav-link">🔥 Trending</Link>
            <Link to="/chat" className="nav-link">AI Chat</Link>
            <button 
              onClick={logout} 
              className="btn" 
              style={{ width: 'auto', padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--border)' }}
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="nav-link">Login</Link>
            <Link to="/register" className="nav-link">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
};

const AppRoutes = () => {
  const { user } = useContext(AuthContext);

  return (
    <div className="app-container">
      <Navigation />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to={user ? "/products" : "/login"} />} />
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/products" />} />
          <Route path="/register" element={!user ? <Register /> : <Navigate to="/products" />} />
          
          <Route path="/products" element={
            <PrivateRoute>
              <Products />
            </PrivateRoute>
          } />
          
          <Route path="/availability" element={
            <PrivateRoute>
              <Availability />
            </PrivateRoute>
          } />

          <Route path="/trending" element={
            <PrivateRoute>
              <Trending />
            </PrivateRoute>
          } />
          
          <Route path="/chat" element={
            <PrivateRoute>
              <Chat />
            </PrivateRoute>
          } />

          <Route path="*" element={<Navigate to={user ? "/products" : "/login"} />} />
        </Routes>
      </main>
    </div>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
};

export default App;
