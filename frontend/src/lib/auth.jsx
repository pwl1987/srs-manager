import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      setToken(token);
      api.get('/auth/me')
        .then(setUser)
        .catch(() => localStorage.removeItem('access_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function login(username, password) {
    const data = await api.login({ username, password });
    setToken(data.access_token);
    localStorage.setItem('access_token', data.access_token);
    setUser(data.user);
  }

  async function logout() {
    try { await api.logout(); } catch {}
    setToken(null);
    localStorage.removeItem('access_token');
    setUser(null);
    window.location.href = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
