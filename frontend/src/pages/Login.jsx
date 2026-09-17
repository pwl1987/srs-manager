import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth.jsx';
import { getErrorCode } from '../lib/error-mapper';
import { setLanguage, getLanguage } from '../i18n';
import { inputClass, labelClass, btnPrimary } from '../components/ui/styles';
import { Radio, Globe, Loader2, Sparkles } from 'lucide-react';
import { CURRENT_VERSION } from '../lib/releases';

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
    <div className="min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="lux-panel w-full max-w-5xl min-h-[610px] grid lg:grid-cols-[1.05fr_0.95fr] overflow-hidden rounded-[28px]">
        <section className="hidden lg:flex relative overflow-hidden flex-col justify-between p-10 border-r border-[var(--border-soft)] bg-[var(--panel)]/72">
          <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[var(--primary)]/10 blur-3xl pointer-events-none" />
          <div className="absolute bottom-6 -left-20 w-64 h-64 rounded-full bg-[var(--info)]/8 blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-[var(--primary)]/14 border border-[var(--primary)]/22 flex items-center justify-center mb-7">
              <Radio size={23} className="text-[var(--primary)]" />
            </div>
            <p className="text-[10px] tracking-[0.18em] uppercase text-[var(--primary)] font-semibold mb-3">
              {t('common:brand.console')}
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.04em]">SRS Manager</h1>
            <p className="text-sm leading-7 text-[var(--muted-foreground)] mt-4 max-w-sm">
              {t('common:brand.subtitle')}
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/20 bg-[var(--primary)]/9 px-3 py-1.5 text-[10px] font-semibold text-[var(--primary)]">
              <Sparkles size={12} />v{CURRENT_VERSION} · {t('common:brand.stable')}
            </div>
          </div>

          <div className="relative">
            <div className="grid grid-cols-2 gap-2.5 max-w-sm">
              {['IN · PUSH', 'IN · PULL', 'OUT · PUSH', 'OUT · PULL'].map((label) => (
                <div key={label} className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/25 px-3.5 py-3">
                  <div className="text-[10px] tracking-[0.12em] font-semibold text-[var(--muted-foreground)]">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-5">SRS · CDN · DNS · DISTRIBUTION · ROUTING</p>
          </div>
        </section>

        <section className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
          <div className="flex lg:hidden items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/14 border border-[var(--primary)]/22 flex items-center justify-center">
              <Radio size={20} className="text-[var(--primary)]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">SRS Manager</h1>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{t('common:brand.console')}</p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-faint)] mb-2">SECURE ACCESS</p>
              <h2 className="text-2xl font-semibold tracking-[-0.025em]">{t('login:login')}</h2>
            </div>
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 min-h-9 px-2.5 rounded-lg border border-[var(--border-soft)] hover:bg-[var(--surface-hover)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              title={t('common:language.switch')}
            >
              <Globe size={15} />
              <span className="text-xs">{i18n.language.startsWith('zh') ? 'EN' : '中文'}</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
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
            <div>
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
              <div className="rounded-xl border border-[var(--destructive)]/22 bg-[var(--destructive)]/8 px-3.5 py-3">
                <p className="text-[var(--destructive)] text-sm leading-relaxed">
                  {t(`common:errors.${error.code}`, { default: error.message })}
                </p>
              </div>
            )}

            <button type="submit" disabled={loading} className={`${btnPrimary} w-full min-h-11 mt-1`}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? t('common:status.loading') : t('login:login')}
            </button>
          </form>

          <div className="mt-8 pt-5 border-t border-[var(--border-soft)] text-[10px] tracking-[0.1em] uppercase text-[var(--text-faint)]">
            Streaming Operations Console
          </div>
        </section>
      </div>
    </div>
  );
}
