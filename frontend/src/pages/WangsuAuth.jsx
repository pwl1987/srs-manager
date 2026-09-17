import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { getErrorCode } from '../lib/error-mapper';
import PageHeader from '../components/ui/PageHeader';
import { inputClass, labelClass, btnPrimary, btnSecondary } from '../components/ui/styles';
import { Cloud, Check, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function WangsuAuth() {
  const { t } = useTranslation(['auth', 'common']);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [authMethod, setAuthMethod] = useState('AKSK');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    api.get('/cdn/auth-config')
      .then(data => {
        const auth = data?.auth || data;
        if (auth) {
          setAccessKeyId(auth.access_key_id || '');
          setAccessKeySecret(auth.access_key_secret || '');
          setAuthMethod(auth.auth_method || 'AKSK');
          setVerified(Boolean(auth.verified));
        }
      })
      .catch(console.error);
  }, []);

  async function handleVerify() {
    setVerifying(true);
    setError('');
    try {
      await api.post('/cdn/auth-config/verify', { access_key_id: accessKeyId, access_key_secret: accessKeySecret });
      setVerified(true);
    } catch (err) {
      setError(t(`common:errors.${getErrorCode(err)}`));
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    setError('');
    try {
      await api.post('/cdn/auth-config', { access_key_id: accessKeyId, access_key_secret: accessKeySecret, auth_method: authMethod });
      setVerified(true);
      toast.success(t('common:toasts.saved'));
    } catch (err) {
      setError(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  return (
    <div>
      <PageHeader title={t('auth:wangsu.title')} subtitle={t('auth:wangsu.subtitle')} />

      <div className="bg-[var(--card)] rounded-lg border p-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Cloud size={20} className="text-[var(--primary)]" />
          <span className="text-sm font-medium">{t('auth:wangsu.accessKeyId')} / {t('auth:wangsu.accessKeySecret')}</span>
          {verified && (
            <span className="flex items-center gap-1 text-[var(--success)] text-xs ml-auto">
              <Check size={14} /> {t('auth:wangsu.verified')}
            </span>
          )}
        </div>

        <div className="mb-4">
          <label className={labelClass}>{t('auth:wangsu.accessKeyId')}</label>
          <input
            type="text"
            value={accessKeyId}
            onChange={e => setAccessKeyId(e.target.value)}
            className={inputClass}
            placeholder="ws-xxxxxxx"
          />
        </div>

        <div className="mb-4">
          <label className={labelClass}>{t('auth:wangsu.accessKeySecret')}</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={accessKeySecret}
              onChange={e => setAccessKeySecret(e.target.value)}
              className={`${inputClass} pr-10`}
              placeholder="••••••••••••••••"
            />
            <button
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-2.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label="toggle secret"
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className={labelClass}>{t('auth:wangsu.authMethod')}</label>
          <select value={authMethod} onChange={e => setAuthMethod(e.target.value)} className={inputClass}>
            <option value="AKSK">AKSK (HMAC-SHA256)</option>
          </select>
        </div>

        {error && <p className="text-[var(--destructive)] text-sm mb-4">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={handleVerify}
            disabled={verifying || !accessKeyId || !accessKeySecret}
            className={btnSecondary}
          >
            {verifying && <Loader2 size={14} className="animate-spin" />}
            {verifying ? t('auth:wangsu.verifying') : t('auth:wangsu.verify')}
          </button>
          <button onClick={handleSave} disabled={!accessKeyId || !accessKeySecret} className={btnPrimary}>
            {t('auth:wangsu.save')}
          </button>
        </div>
      </div>

      <div className="mt-6 bg-[var(--card)] rounded-lg border p-4 text-sm text-[var(--muted-foreground)] max-w-2xl">
        <p><strong className="text-[var(--foreground)]">{t('auth:wangsu.helperTitle')}:</strong> {t('auth:wangsu.helperContent')}</p>
        <p className="mt-1"><strong className="text-[var(--foreground)]">{t('auth:wangsu.note')}:</strong> {t('auth:wangsu.helperNote')}</p>
      </div>
    </div>
  );
}
