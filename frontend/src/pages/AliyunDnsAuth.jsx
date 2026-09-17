import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { getErrorCode } from '../lib/error-mapper';
import { CheckCircle, XCircle, Loader2, Cloud } from 'lucide-react';
import { cn } from '../lib/utils';

export default function AliyunDnsAuth() {
  const { t } = useTranslation(['auth', 'common']);
  const [auth, setAuth] = useState(null);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dns/auth').then(data => {
      setAuth(data.auth);
      if (data.auth) {
        setAccessKeyId(data.auth.access_key_id);
      }
    }).catch(console.error);
  }, []);

  async function handleVerify() {
    if (!accessKeyId || !accessKeySecret) {
      setError(t('common:errors.EXTERNAL_ALIYUN_AUTH_MISSING'));
      return;
    }
    setStatus('verifying');
    setError('');
    try {
      const res = await api.post('/dns/auth/verify', { access_key_id: accessKeyId, access_key_secret: accessKeySecret });
      setResult(res);
      setStatus(res.valid ? 'verified' : 'failed');
    } catch (err) {
      setError(t(`common:errors.${getErrorCode(err)}`));
      setStatus('failed');
    }
  }

  async function handleSave() {
    if (!accessKeyId || !accessKeySecret) {
      setError(t('common:errors.EXTERNAL_ALIYUN_AUTH_MISSING'));
      return;
    }
    setStatus('saving');
    setError('');
    try {
      const res = await api.post('/dns/auth', { access_key_id: accessKeyId, access_key_secret: accessKeySecret });
      setAuth({ id: res.id, access_key_id: accessKeyId, verified: true, verified_at: new Date().toISOString() });
      setStatus('verified');
      setResult(null);
      toast.success(t('common:toasts.saved'));
    } catch (err) {
      setError(t(`common:errors.${getErrorCode(err)}`));
      setStatus('failed');
    }
  }

  return (
    <div className="p-4">
      <div className="mb-6">
        <h2 className="text-xl font-bold">{t('auth:aliyunDns.title')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">{t('auth:aliyunDns.subtitle')}</p>
      </div>

      <div className="bg-[var(--card)] rounded-lg border p-6 max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <Cloud size={24} className="text-[var(--primary)]" />
          <div>
                <h3 className="font-semibold">{t('auth:aliyunDns.cardTitle')}</h3>
            {auth ? (
              <div className="flex items-center gap-1 mt-1">
                <CheckCircle size={14} className="text-[var(--success)]" />
                <span className="text-xs text-[var(--success)]">{t('auth:aliyunDns.verified')}</span>
              </div>
            ) : (
              <span className="text-xs text-[var(--muted-foreground)] mt-1 block">{t('auth:aliyunDns.notConfigured')}</span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1">{t('auth:aliyunDns.accessKeyId')}</label>
            <input
              type="text"
              value={accessKeyId}
              onChange={e => setAccessKeyId(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
              placeholder="LTAI..."
            />
          </div>
          <div>
            <label className="block text-sm mb-1">{t('auth:aliyunDns.accessKeySecret')}</label>
            <input
              type="password"
              value={accessKeySecret}
              onChange={e => setAccessKeySecret(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
              placeholder="••••••••••••••••"
            />
          </div>

          {error && <p className="text-[var(--destructive)] text-sm">{error}</p>}

          {status === 'verifying' && (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" /> {t('auth:aliyunDns.verifying')}
            </div>
          )}

          {status === 'saving' && (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" /> {t('common:status.saving')}
            </div>
          )}

          {result && !result.valid && (
            <div className="flex items-center gap-2 text-sm text-[var(--destructive)]">
              <XCircle size={16} /> {t('auth:aliyunDns.verifyFailedDetail', { detail: result.error })}
            </div>
          )}

          {result && result.valid && result.domains?.length > 0 && (
            <div className="text-sm text-[var(--success)]">
              {t('auth:aliyunDns.domainsFound', { count: result.domains.length })}: {result.domains.map(d => d.DomainName).join(', ')}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleVerify}
              disabled={status === 'verifying' || status === 'saving'}
              className="flex-1 py-2 rounded bg-[var(--secondary)] text-sm hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
            >
              {t('auth:aliyunDns.verify')}
            </button>
            <button
              onClick={handleSave}
              disabled={status === 'verifying' || status === 'saving'}
              className="flex-1 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {t('auth:aliyunDns.save')}
            </button>
          </div>
        </div>

        <p className="text-xs text-[var(--muted-foreground)] mt-6">{t('auth:aliyunDns.helperText')}</p>
      </div>
    </div>
  );
}
