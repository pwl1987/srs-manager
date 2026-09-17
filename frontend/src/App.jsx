import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import './i18n';
import { useAuth } from './lib/auth.jsx';
import { btnPrimary } from './components/ui/styles';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Streams from './pages/Streams';
import StreamWorkspace from './pages/StreamWorkspace';
import CdnChannels from './pages/CdnChannels';
import AuthKeys from './pages/AuthKeys';
import Forwarding from './pages/Forwarding';
import Monitor from './pages/Monitor';
import TranscodeTemplates from './pages/TranscodeTemplates';
import WangsuAuth from './pages/WangsuAuth';
import AliyunDnsAuth from './pages/AliyunDnsAuth';
import DnsRecords from './pages/DnsRecords';
import Settings from './pages/Settings';
import EmptyState from './components/ui/EmptyState';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation(['common']);
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-screen">
        <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
        <span className="text-sm text-[var(--muted-foreground)]">{t('common:status.loading')}</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function NotFound() {
  const { t } = useTranslation(['common']);
  return (
    <EmptyState
      title={t('common:notFound.title')}
      description={t('common:notFound.description')}
      action={<Link to="/" className={btnPrimary}>{t('common:notFound.back')}</Link>}
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors theme="dark" />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="streams" element={<Streams />} />
          <Route path="streams/:id" element={<StreamWorkspace />} />
          <Route path="cdn-channels" element={<CdnChannels />} />
          <Route path="dns-records" element={<DnsRecords />} />
          <Route path="auth-keys" element={<AuthKeys />} />
          <Route path="forwarding" element={<Forwarding />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="transcode" element={<TranscodeTemplates />} />
          <Route path="wangsu-auth" element={<WangsuAuth />} />
          <Route path="aliyun-dns-auth" element={<AliyunDnsAuth />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
