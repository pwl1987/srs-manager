import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ClipboardList, FileKey2, Film, Globe, PlugZap,
  Radio, Server, Settings as SettingsIcon, Sparkles
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { CURRENT_VERSION } from '../../lib/releases';

export default function Sidebar({ onNavigate, compact = false }) {
  const { t } = useTranslation(['common']);
  const navGroups = [
    { key: 'operations', label: t('common:navigationGroups.operations'), items: [
      { path: '/streams', label: t('common:navigation.streams'), icon: Radio },
      { path: '/incidents', label: t('common:navigation.incidents'), icon: AlertTriangle }
    ]},
    { key: 'resources', label: t('common:navigationGroups.resources'), items: [
      { path: '/transcode', label: t('common:navigation.mediaProfiles'), icon: Film },
      { path: '/run-plans', label: t('common:navigation.runPlans'), icon: ClipboardList }
    ]},
    { key: 'integrations', label: t('common:navigationGroups.integrations'), items: [
      { path: '/integrations', label: t('common:navigation.integrations'), icon: PlugZap },
      { path: '/dns-records', label: t('common:navigation.dnsRecords'), icon: Globe },
      { path: '/auth-keys', label: t('common:navigation.credentials'), icon: FileKey2 }
    ]},
    { key: 'system', label: t('common:navigationGroups.system'), items: [
      { path: '/system', label: t('common:navigation.systemRuntime'), icon: Server },
      { path: '/settings', label: t('common:navigation.settings'), icon: SettingsIcon },
      { path: '/releases', label: t('common:navigation.releases'), icon: Sparkles }
    ]}
  ];

  return <aside className={cn(
    'h-full flex flex-col border-r border-[var(--border-soft)] bg-[var(--sidebar)]/95 backdrop-blur-xl transition-[width] duration-150',
    compact ? 'w-[64px]' : 'w-[264px]'
  )}>
    <div className={cn('pt-4 pb-3', compact ? 'px-2' : 'px-4')}>
      <div className={cn('flex items-center rounded-xl py-2', compact ? 'justify-center px-0' : 'gap-3 px-2')}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--primary)]/24 bg-[var(--primary)]/14">
          <Radio size={20} className="text-[var(--primary)]"/>
        </div>
        {!compact && <div className="min-w-0"><h1 className="text-[15px] font-semibold leading-tight tracking-[-.01em]">SRS Manager</h1><p className="mt-1 truncate text-[10px] uppercase tracking-[.12em] text-[var(--muted-foreground)]">{t('common:brand.console')}</p></div>}
      </div>
    </div>

    <nav className={cn('flex-1 overflow-y-auto pb-4', compact ? 'px-2' : 'px-3')}>
      {navGroups.map((group,index) => <div key={group.key} className={index ? 'mt-5' : ''}>
        {!compact && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--text-faint)]">{group.label}</div>}
        <div className="space-y-0.5">{group.items.map(item => <NavLink
          key={item.path}
          to={item.path}
          title={compact ? item.label : undefined}
          onClick={onNavigate}
          className={({isActive}) => cn(
            'group flex min-h-10 items-center rounded-lg border text-sm transition-colors',
            compact ? 'justify-center px-1 py-2' : 'gap-2.5 px-2.5 py-2',
            isActive ? 'border-[var(--primary)]/20 bg-[var(--surface-active)] text-[var(--foreground)]' : 'border-transparent text-[var(--muted-foreground)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'
          )}
        >{({isActive}) => <><span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md',isActive ? 'bg-[var(--primary)]/14 text-[var(--primary)]' : '')}><item.icon size={15} strokeWidth={1.9}/></span>{!compact && <span className="truncate font-medium">{item.label}</span>}</>}</NavLink>)}</div>
      </div>)}
    </nav>

    <div className={cn('mb-3',compact ? 'mx-2' : 'mx-3')}>
      {compact ? <div className="rounded-lg border border-[var(--border-soft)] py-2 text-center font-mono text-[9px] text-[var(--text-faint)]">v{CURRENT_VERSION}</div>
        : <div className="rounded-2xl border border-[var(--primary)]/16 bg-[var(--card)] px-3.5 py-3.5"><div className="flex items-center gap-2 text-xs font-medium"><Radio size={13} className="text-[var(--primary)]"/>SRS Manager</div><div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-2.5 text-[9px]"><span className="text-[var(--text-faint)]">{t('common:brand.version')}</span><span className="rounded-md bg-[var(--primary)]/10 px-2 py-1 font-mono text-[var(--primary)]">v{CURRENT_VERSION}</span></div></div>}
    </div>
  </aside>;
}
