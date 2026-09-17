import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Radio,
  Satellite,
  Key,
  ArrowLeftRight,
  Monitor,
  Film,
  Settings as SettingsIcon,
  Cloud,
  Globe,
  Server,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { CURRENT_VERSION } from '../../lib/releases';

export default function Sidebar({ onNavigate }) {
  const { t } = useTranslation(['common']);

  const navGroups = [
    {
      key: 'operations',
      items: [
        { path: '/', label: t('common:navigation.dashboard'), icon: LayoutDashboard },
        { path: '/monitor', label: t('common:navigation.monitor'), icon: Monitor },
        { path: '/releases', label: t('common:navigation.releases'), icon: Sparkles },
      ],
    },
    {
      key: 'streaming',
      items: [
        { path: '/streams', label: t('common:navigation.streams'), icon: Radio },
        { path: '/forwarding', label: t('common:navigation.forwarding'), icon: ArrowLeftRight },
      ],
    },
    {
      key: 'resources',
      items: [
        { path: '/cdn-channels', label: t('common:navigation.cdnChannels'), icon: Satellite },
        { path: '/dns-records', label: t('common:navigation.dnsRecords'), icon: Globe },
        { path: '/transcode', label: t('common:navigation.transcode'), icon: Film },
      ],
    },
    {
      key: 'system',
      items: [
        { path: '/auth-keys', label: t('common:navigation.authKeys'), icon: Key },
        { path: '/wangsu-auth', label: t('common:navigation.wangsuAuth'), icon: Cloud },
        { path: '/aliyun-dns-auth', label: t('common:navigation.aliyunDnsAuth'), icon: Server },
        { path: '/settings', label: t('common:navigation.settings'), icon: SettingsIcon },
      ],
    },
  ];

  return (
    <aside className="w-[264px] h-full flex flex-col border-r border-[var(--border-soft)] bg-[var(--sidebar)]/95 backdrop-blur-xl">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/14 border border-[var(--primary)]/24 flex items-center justify-center shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
            <Radio size={20} className="text-[var(--primary)]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] leading-tight font-semibold tracking-[-0.01em]">SRS Manager</h1>
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-foreground)] mt-1 truncate">
              {t('common:brand.console')}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 pb-4 overflow-y-auto">
        {navGroups.map((group, groupIndex) => (
          <div key={group.key} className={groupIndex === 0 ? '' : 'mt-5'}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
              {t(`common:navigationGroups.${group.key}`)}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'group flex items-center gap-2.5 min-h-10 px-2.5 py-2 rounded-lg border text-sm transition-[background-color,border-color,color] duration-150',
                    isActive
                      ? 'bg-[var(--surface-active)] border-[var(--primary)]/20 text-[var(--foreground)]'
                      : 'border-transparent text-[var(--muted-foreground)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn(
                        'w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                        isActive
                          ? 'bg-[var(--primary)]/14 text-[var(--primary)]'
                          : 'text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]'
                      )}>
                        <item.icon size={15} strokeWidth={1.9} />
                      </span>
                      <span className="truncate font-medium">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mx-3 mb-3 rounded-2xl border border-[var(--primary)]/16 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card),transparent_4%),color-mix(in_oklab,var(--primary),transparent_94%))] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.035)]">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Radio size={13} className="text-[var(--primary)]" />
          SRS Manager
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)] mt-1.5">
          {t('common:brand.subtitle')}
        </p>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-2.5 text-[9px] font-medium">
          <span className="text-[var(--text-faint)]">{t('common:brand.version')}</span>
          <span className="rounded-md bg-[var(--primary)]/10 px-2 py-1 font-mono text-[var(--primary)]">v{CURRENT_VERSION} · MVP</span>
        </div>
      </div>
    </aside>
  );
}
