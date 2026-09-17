import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import './i18n';
import { useAuth } from './lib/auth.jsx';
import { btnPrimary } from './components/ui/styles';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import EmptyState from './components/ui/EmptyState';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Streams = lazy(() => import('./pages/Streams'));
const StreamWorkspace = lazy(() => import('./pages/StreamWorkspace'));
const CdnChannels = lazy(() => import('./pages/CdnChannels'));
const AuthKeys = lazy(() => import('./pages/AuthKeys'));
const Forwarding = lazy(() => import('./pages/Forwarding'));
const Monitor = lazy(() => import('./pages/Monitor'));
const TranscodeTemplates = lazy(() => import('./pages/TranscodeTemplates'));
const WangsuAuth = lazy(() => import('./pages/WangsuAuth'));
const AliyunDnsAuth = lazy(() => import('./pages/AliyunDnsAuth'));
const DnsRecords = lazy(() => import('./pages/DnsRecords'));
const Settings = lazy(() => import('./pages/Settings'));
const ReleaseNotes = lazy(() => import('./pages/ReleaseNotes'));
const DesignLab = lazy(() => import('./design-lab/DesignLab'));

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
      <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 size={24} className="animate-spin text-[var(--primary)]" /></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/design-lab/*" element={import.meta.env.DEV ? <DesignLab /> : <ProtectedRoute><DesignLab /></ProtectedRoute>} />
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
          <Route path="releases" element={<ReleaseNotes />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
