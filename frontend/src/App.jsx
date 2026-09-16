import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Streams from './pages/Streams';
import CdnChannels from './pages/CdnChannels';
import AuthKeys from './pages/AuthKeys';
import Distribution from './pages/Distribution';
import Forwarding from './pages/Forwarding';
import Monitor from './pages/Monitor';
import TranscodeTemplates from './pages/TranscodeTemplates';
import WangsuAuth from './pages/WangsuAuth';
import Settings from './pages/Settings';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="streams" element={<Streams />} />
          <Route path="cdn-channels" element={<CdnChannels />} />
          <Route path="auth-keys" element={<AuthKeys />} />
          <Route path="distribution" element={<Distribution />} />
          <Route path="forwarding" element={<Forwarding />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="transcode" element={<TranscodeTemplates />} />
          <Route path="wangsu-auth" element={<WangsuAuth />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
