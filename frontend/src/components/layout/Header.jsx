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
  '/distribution': 'distribution',
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
    // .hostname excludes the API port; .host would render "ip:1985:1935"
    host = new URL(config.api_url).hostname;
  } catch {
    host = config.api_url;
  }
  const port = config.rtmp_port || 1935;

  return (
    <span
      className="hidden lg:inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--secondary)] rounded-full px-2.5 py-1 font-mono"
      title={config.api_url}
    >
      <Server size={12} />
      {t('common:header.server')} {host}:{port}
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

  function handleLangChange(lang) {
    setLanguage(lang);
    setLangMenuOpen(false);
  }

  return (
    <header className="h-12 flex items-center justify-between gap-3 px-4 border-b bg-[var(--card)] shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          aria-label="menu"
          className="md:hidden p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <Menu size={18} />
        </button>
        {titleKey && (
          <span className="text-sm font-medium truncate">{t(`common:navigation.${titleKey}`)}</span>
        )}
        <ServerChip />
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setLangMenuOpen(!langMenuOpen)}
            className="flex items-center gap-1 p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            title={t('common:language.switch')}
          >
            <Globe size={16} />
            <span className="text-xs hidden sm:inline">{t('common:language.current')}</span>
            <ChevronDown size={12} />
          </button>
          {langMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setLangMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 bg-[var(--card)] border rounded-lg shadow-lg py-1 z-50 min-w-[120px]">
                <button
                  onClick={() => handleLangChange('zh-CN')}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--secondary)] ${currentLang === 'zh-CN' ? 'text-[var(--primary)] font-medium' : ''}`}
                >
                  {t('common:language.zhCN')}
                </button>
                <button
                  onClick={() => handleLangChange('en-US')}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--secondary)] ${currentLang === 'en-US' ? 'text-[var(--primary)] font-medium' : ''}`}
                >
                  {t('common:language.enUS')}
                </button>
              </div>
            </>
          )}
        </div>
        <span className="text-sm hidden sm:inline">{user?.username}</span>
        <button
          onClick={logout}
          className="p-1.5 rounded hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          title={t('common:actions.logout')}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
