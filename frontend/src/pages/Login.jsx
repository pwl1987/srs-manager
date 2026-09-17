import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth.jsx';
import { getErrorCode } from '../lib/error-mapper';
import { setLanguage, getLanguage } from '../i18n';
import { inputClass, labelClass, btnPrimary } from '../components/ui/styles';
import { Radio, Globe, Loader2 } from 'lucide-react';

export default function Login() {
  const { t, i18n } = useTranslation(['login', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  function toggleLanguage() {
    setLanguage(getLanguage().startsWith('zh') ? 'en-US' : 'zh-CN');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError({ code: getErrorCode(err), message: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen p-4">
      <div className="w-full max-w-sm bg-[var(--card)] rounded-xl p-8 border">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Radio size={28} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-bold">SRS Manager</h1>
              <p className="text-xs text-[var(--muted-foreground)]">{t('common:brand.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1 p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            title={t('common:language.switch')}
          >
            <Globe size={16} />
            <span className="text-xs">{i18n.language.startsWith('zh') ? 'EN' : '中文'}</span>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className={labelClass}>{t('login:username')}</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={inputClass}
              placeholder="admin"
              autoComplete="username"
              required
            />
          </div>
          <div className="mb-4">
            <label className={labelClass}>{t('login:password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p className="text-[var(--destructive)] text-sm mb-4">
              {t(`common:errors.${error.code}`, { default: error.message })}
            </p>
          )}
          <button type="submit" disabled={loading} className={`${btnPrimary} w-full`}>
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? t('common:status.loading') : t('login:login')}
          </button>
        </form>
      </div>
    </div>
  );
}
