import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Radio, Satellite, Key, FileText,
  ArrowLeftRight, Monitor, Film, Settings as SettingsIcon,
  Cloud, Globe, Server
} from 'lucide-react';
import { cn } from '../../lib/utils';

export default function Sidebar({ onNavigate }) {
  const { t } = useTranslation(['common']);

  const navItems = [
    { path: '/', label: t('common:navigation.dashboard'), icon: LayoutDashboard },
    { path: '/streams', label: t('common:navigation.streams'), icon: Radio },
    { path: '/cdn-channels', label: t('common:navigation.cdnChannels'), icon: Satellite },
    { path: '/dns-records', label: t('common:navigation.dnsRecords'), icon: Globe },
    { path: '/auth-keys', label: t('common:navigation.authKeys'), icon: Key },
    { path: '/distribution', label: t('common:navigation.distribution'), icon: FileText },
    { path: '/forwarding', label: t('common:navigation.forwarding'), icon: ArrowLeftRight },
    { path: '/monitor', label: t('common:navigation.monitor'), icon: Monitor },
    { path: '/transcode', label: t('common:navigation.transcode'), icon: Film },
    { path: '/wangsu-auth', label: t('common:navigation.wangsuAuth'), icon: Cloud },
    { path: '/aliyun-dns-auth', label: t('common:navigation.aliyunDnsAuth'), icon: Server },
    { path: '/settings', label: t('common:navigation.settings'), icon: SettingsIcon },
  ];

  return (
    <aside className="w-56 h-full flex flex-col border-r bg-[var(--card)]">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold">SRS Manager</h1>
        <p className="text-xs text-[var(--muted-foreground)]">{t('common:brand.subtitle')}</p>
      </div>
      <nav className="flex-1 p-2 overflow-y-auto">
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onNavigate}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors',
              isActive
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]'
            )}
          >
            <item.icon size={18} className="shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
