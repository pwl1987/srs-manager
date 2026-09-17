import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { setLanguage, getLanguage } from '../../i18n';
import { LogOut, Globe, ChevronDown, Menu, Server } from 'lucide-react';

const ROUTE_TITLE_KEYS = {
  '/': 'dashboard',
  '/streams': 'streams',
  '/cdn-channels': 'cdnChannels',
  '/dns-records': 'dnsRecords',
  '/auth-keys': 'authKeys',
  '/forwarding': 'forwarding',
  '/monitor': 'monitor',
  '/transcode': 'transcode',
  '/wangsu-auth': 'wangsuAuth',
  '/aliyun-dns-auth': 'aliyunDnsAuth',
  '/settings': 'settings',
};

function ServerChip() {
  const { t } = useTranslation(['common']);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    api.get('/settings/srs-config')
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  if (!config?.api_url) return null;

  let host = '';
  try {
    host = new URL(config.api_url).hostname;
  } catch {
    host = config.api_url;
  }
  const port = config.rtmp_port || 1935;

  return (
    <span
      className="hidden lg:inline-flex items-center gap-2 min-h-8 rounded-lg border border-[var(--border-soft)] bg-[var(--card)]/55 px-2.5 text-[11px] text-[var(--muted-foreground)]"
      title={config.api_url}
    >
      <Server size={13} className="text-[var(--info)]" />
      <span className="text-[var(--text-faint)]">{t('common:header.server')}</span>
      <span className="font-mono text-[var(--foreground)]">{host}:{port}</span>
    </span>
  );
}

export default function Header({ onMenuClick }) {
  const { user, logout } = useAuth();
  const { t } = useTranslation(['common']);
  const location = useLocation();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const currentLang = getLanguage();
  const titleKey = ROUTE_TITLE_KEYS[location.pathname];
  const userInitial = (user?.username || 'A').slice(0, 1).toUpperCase();

  function handleLangChange(lang) {
    setLanguage(lang);
    setLangMenuOpen(false);
  }

  return (
    <header className="h-16 flex items-center justify-between gap-4 px-4 md:px-6 border-b border-[var(--border-soft)] bg-[var(--background)]/72 backdrop-blur-xl shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          aria-label="menu"
          className="md:hidden p-2 rounded-lg hover:bg-[var(--surface-hover)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.13em] text-[var(--text-faint)] leading-none mb-1.5">
            {t('common:header.console')}
          </div>
          {titleKey && (
            <div className="text-sm font-semibold truncate tracking-[-0.01em]">
              {t(`common:navigation.${titleKey}`)}
            </div>
          )}
        </div>
        <div className="hidden sm:block h-6 w-px bg-[var(--border-soft)] mx-1" />
        <ServerChip />
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative">
          <button
            onClick={() => setLangMenuOpen(!langMenuOpen)}
            className="flex min-h-9 items-center gap-1.5 px-2.5 rounded-lg hover:bg-[var(--surface-hover)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            title={t('common:language.switch')}
          >
            <Globe size={15} />
            <span className="text-xs hidden sm:inline">{t('common:language.current')}</span>
            <ChevronDown size={12} />
          </button>

          {langMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setLangMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 bg-[var(--elevated)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-elevated)] py-1.5 z-50 min-w-[140px] overflow-hidden">
                <button
                  onClick={() => handleLangChange('zh-CN')}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-hover)] transition-colors ${currentLang === 'zh-CN' ? 'text-[var(--primary)] font-medium' : 'text-[var(--foreground)]'}`}
                >
                  {t('common:language.zhCN')}
                </button>
                <button
                  onClick={() => handleLangChange('en-US')}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-hover)] transition-colors ${currentLang === 'en-US' ? 'text-[var(--primary)] font-medium' : 'text-[var(--foreground)]'}`}
                >
                  {t('common:language.enUS')}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-2 pl-2 ml-1 border-l border-[var(--border-soft)]">
          <div className="w-8 h-8 rounded-lg bg-[var(--secondary)] border border-[var(--border-soft)] flex items-center justify-center text-xs font-semibold text-[var(--foreground)]">
            {userInitial}
          </div>
          <span className="text-xs font-medium max-w-28 truncate">{user?.username}</span>
        </div>

        <button
          onClick={logout}
          className="p-2 rounded-lg hover:bg-[var(--destructive)]/10 text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors"
          title={t('common:actions.logout')}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
