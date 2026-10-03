import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Plus, Radio, ShieldCheck } from 'lucide-react';
import { btnGhost, btnSecondary } from '../ui/styles';
import { cn } from '../../lib/utils';
import { directionIdFromSourceKind, getDirection } from '../../lib/directions';

function meta(source, t) {
  const state = String(source.availability || 'UNKNOWN').toUpperCase();
  if (source.role === 'PROGRAM') return { dot:'bg-[var(--success)]', text:'text-[var(--success)]', label: t('streams:inputRack.meta.program') };
  if (state === 'ONLINE') return { dot:'bg-[var(--success)]', text:'text-[var(--success)]', label: t('streams:inputRack.meta.online') };
  if (state === 'READY') return { dot:'bg-[var(--primary)]', text:'text-[var(--primary)]', label: t('streams:inputRack.meta.switchable') };
  if (state === 'UNKNOWN') return { dot:'bg-[var(--warning)]', text:'text-[var(--warning)]', label: t('streams:inputRack.meta.unknown') };
  if (state === 'OFFLINE') return { dot:'bg-[var(--text-faint)]', text:'text-[var(--muted-foreground)]', label: t('streams:inputRack.meta.offline') };
  return { dot:'bg-[var(--warning)]', text:'text-[var(--warning)]', label: state };
}

export function sourceKindLabelKey(kind) {
  const direction = getDirection(directionIdFromSourceKind(kind));
  return direction ? direction.labelKey : null;
}

export function SourceRow({ source, previewing, onPreview }) {
  const { t } = useTranslation('streams');
  const m=meta(source, t);
  const canPreview=source.kind === 'IN_PULL' && source.compatibility?.enabled !== false;
  const kindLabelKey = sourceKindLabelKey(source.kind);
  const kindLabel = kindLabelKey ? t(kindLabelKey) : (source.kind || t('streams:inputRack.sourceKindFallback'));
  return <div className={cn('rounded-lg border px-3 py-2.5',source.role === 'PROGRAM' ? 'border-[var(--primary)]/28 bg-[var(--primary)]/6' : 'border-[var(--border-soft)] bg-[var(--background)]/20')}>
    <div className="flex items-center gap-2"><span className={cn('h-2 w-2 shrink-0 rounded-full',m.dot)}/><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{source.name}</div><div className="mt-1 truncate text-[9px] text-[var(--muted-foreground)]">{kindLabel} · {source.protocol || source.compatibility?.kind || t('streams:inputRack.protocolUnknown')}</div></div><span className={cn('text-[9px] font-semibold',m.text)}>{m.label}</span>{canPreview && source.role !== 'PROGRAM' && <button className={btnGhost} onClick={() => onPreview(source)}><Eye size={11}/>{previewing ? t('streams:inputRack.previewing') : t('streams:inputRack.preview')}</button>}</div>
  </div>;
}

export default function WorkspaceInputRackV3({ workspace, previewingSourceId, onPreview, onManage }) {
  const { t } = useTranslation('streams');
  const sources=workspace?.sources || [];
  const programId=workspace?.program?.source_id;
  const normalized=sources.map(source => ({...source,role: source.id === programId ? 'PROGRAM' : source.role}));
  const groups=[
    ['PROGRAM',normalized.filter(x => x.role === 'PROGRAM')],
    ['STANDBY',normalized.filter(x => x.role === 'STANDBY' && String(x.availability || '').toUpperCase() !== 'OFFLINE')],
    ['CANDIDATE',normalized.filter(x => x.role === 'CANDIDATE' && String(x.availability || '').toUpperCase() !== 'OFFLINE')],
    ['OFFLINE',normalized.filter(x => x.role === 'OFFLINE' || x.availability === 'OFFLINE')]
  ];
  const standby=normalized.filter(x => x.role === 'STANDBY' && ['READY','ONLINE'].includes(String(x.availability || '').toUpperCase())).length;
  const pending=normalized.filter(x => x.role === 'STANDBY' && String(x.availability || 'UNKNOWN').toUpperCase() === 'UNKNOWN').length;

  return <section className="flex h-full min-h-0 flex-col border-r border-[var(--border-soft)] bg-[var(--card)]/72">
    <div className="flex items-start justify-between gap-2 border-b border-[var(--border-soft)] p-3">
      <div><div className="text-[9px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{t('streams:inputRack.rackTitle')}</div><div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]"><ShieldCheck size={11} className={standby ? 'text-[var(--success)]' : 'text-[var(--warning)]'}/>{standby ? t('streams:inputRack.standbyVerified', { count: standby }) : t('streams:inputRack.standbyNone')}{pending > 0 && <span className="text-[var(--warning)]"> {t('streams:inputRack.pendingSuffix', { count: pending })}</span>}</div></div>
      <button className={btnSecondary} onClick={onManage}><Plus size={12}/>{t('streams:inputRack.manage')}</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{groups.map(([name,items]) => items.length ? <div key={name} className="mb-3 last:mb-0"><div className="mb-1.5 text-[8px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{t(`streams:inputRack.groups.${name}`)}</div><div className="space-y-1.5">{items.map(source => <SourceRow key={source.id} source={source} previewing={previewingSourceId===source.id} onPreview={onPreview}/>)}</div></div> : null)}
      {!sources.length && <div className="rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-[10px] text-[var(--muted-foreground)]"><Radio size={16} className="mx-auto mb-2 text-[var(--text-faint)]"/>{t('streams:inputRack.empty')}</div>}
    </div>
  </section>;
}
