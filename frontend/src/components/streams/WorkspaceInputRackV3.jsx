import { Eye, Plus, Radio, ShieldCheck } from 'lucide-react';
import { btnGhost, btnSecondary } from '../ui/styles';
import { cn } from '../../lib/utils';

const GROUP_LABELS = {
  PROGRAM: '当前节目',
  STANDBY: '备用来源',
  CANDIDATE: '候选来源',
  OFFLINE: '已离线'
};

function meta(source) {
  const state = String(source.availability || 'UNKNOWN').toUpperCase();
  if (source.role === 'PROGRAM') return { dot:'bg-[var(--success)]', text:'text-[var(--success)]', label: '当前节目源' };
  if (state === 'ONLINE') return { dot:'bg-[var(--success)]', text:'text-[var(--success)]', label: '在线' };
  if (state === 'READY') return { dot:'bg-[var(--primary)]', text:'text-[var(--primary)]', label: '可切换' };
  if (state === 'UNKNOWN') return { dot:'bg-[var(--warning)]', text:'text-[var(--warning)]', label: '待确认' };
  if (state === 'OFFLINE') return { dot:'bg-[var(--text-faint)]', text:'text-[var(--muted-foreground)]', label: '离线' };
  return { dot:'bg-[var(--warning)]', text:'text-[var(--warning)]', label: state };
}

function SourceRow({ source, previewing, onPreview }) {
  const m=meta(source);
  const canPreview=source.kind === 'IN_PULL' && source.compatibility?.enabled !== false;
  return <div className={cn('rounded-lg border px-3 py-2.5',source.role === 'PROGRAM' ? 'border-[var(--primary)]/28 bg-[var(--primary)]/6' : 'border-[var(--border-soft)] bg-[var(--background)]/20')}>
    <div className="flex items-center gap-2"><span className={cn('h-2 w-2 shrink-0 rounded-full',m.dot)}/><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{source.name}</div><div className="mt-1 truncate text-[9px] text-[var(--muted-foreground)]">{source.kind} · {source.protocol || source.compatibility?.kind || 'configured'}</div></div><span className={cn('text-[9px] font-semibold',m.text)}>{m.label}</span>{canPreview && source.role !== 'PROGRAM' && <button className={btnGhost} onClick={() => onPreview(source)}><Eye size={11}/>{previewing ? '预监中' : '预监'}</button>}</div>
  </div>;
}

export default function WorkspaceInputRackV3({ workspace, previewingSourceId, onPreview, onManage }) {
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
      <div><div className="text-[9px] font-semibold tracking-[.14em] text-[var(--text-faint)]">输入来源</div><div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]"><ShieldCheck size={11} className={standby ? 'text-[var(--success)]' : 'text-[var(--warning)]'}/>{standby ? standby + ' 个已验证备用源' : '没有已验证备用源'}{pending > 0 && <span className="text-[var(--warning)]">· {pending} 个待确认</span>}</div></div>
      <button className={btnSecondary} onClick={onManage}><Plus size={12}/>来源</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{groups.map(([name,items]) => items.length ? <div key={name} className="mb-3 last:mb-0"><div className="mb-1.5 text-[8px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{GROUP_LABELS[name] || name}</div><div className="space-y-1.5">{items.map(source => <SourceRow key={source.id} source={source} previewing={previewingSourceId===source.id} onPreview={onPreview}/>)}</div></div> : null)}
      {!sources.length && <div className="rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-[10px] text-[var(--muted-foreground)]"><Radio size={16} className="mx-auto mb-2 text-[var(--text-faint)]"/>尚未配置来源</div>}
    </div>
  </section>;
}
