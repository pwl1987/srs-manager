import { ArrowRight, GitBranch, Radio, Server } from 'lucide-react';
import { cn } from '../../lib/utils';

function Node({ children, tone = 'muted' }) {
  const cls = tone === 'healthy' ? 'border-[var(--success)]/20 text-[var(--success)]'
    : tone === 'warning' ? 'border-[var(--warning)]/20 text-[var(--warning)]'
      : tone === 'danger' ? 'border-[var(--destructive)]/20 text-[var(--destructive)]'
        : tone === 'blue' ? 'border-[var(--primary)]/20 text-[var(--primary)]'
          : 'border-[var(--border-soft)] text-[var(--muted-foreground)]';
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-[var(--background)]/24 px-2 py-1 text-[9px] font-semibold', cls)}>{children}</span>;
}

export default function WorkspaceSignalRouteV3({ workspace }) {
  const source = (workspace?.sources || []).find(item => item.id === workspace?.program?.source_id);
  const renditions = (workspace?.renditions || []).filter(item => item.kind === 'TRANSCODE');
  const outputs = workspace?.outputs || [];
  const programTone = workspace?.program?.state === 'LIVE' ? 'healthy' : workspace?.program?.state === 'NO_PROGRAM' ? 'danger' : 'warning';

  return <section data-workspace-region="route" className="flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-y border-[var(--border-soft)] bg-[var(--panel)]/65 px-3 py-2">
    <div className="mr-1 flex shrink-0 items-center gap-1.5 text-[8px] font-semibold tracking-[.14em] text-[var(--text-faint)]"><GitBranch size={11}/>信号路径</div>
    <Node tone={source ? 'healthy' : 'muted'}><Radio size={10}/>{source?.name || '无输入来源'}</Node>
    <ArrowRight size={11} className="shrink-0 text-[var(--text-faint)]"/>
    <Node tone={programTone}><Server size={10}/>节目</Node>
    {renditions.length ? renditions.map(r => {
      const dependents = outputs.filter(o => o.media_ref === r.id);
      const tone = r.runtime_state === 'FAILED' ? 'danger' : r.observed?.online === true ? 'healthy' : r.desired_state === 'RUNNING' ? 'warning' : 'muted';
      return <span key={r.id} className="contents"><ArrowRight size={11} className="shrink-0 text-[var(--text-faint)]"/><Node tone={tone}>{r.media_profile_id?.replace('media-profile:','媒体规格 ') || '共享媒体规格'} · {dependents.length}</Node></span>;
    }) : <><ArrowRight size={11} className="shrink-0 text-[var(--text-faint)]"/><Node tone="blue">原始码流</Node></>}
    <ArrowRight size={11} className="shrink-0 text-[var(--text-faint)]"/>
    <div className="flex min-w-0 items-center gap-1.5">{outputs.slice(0,8).map(o => {
      const state=String(o.runtime_state || '').toUpperCase();
      const tone=['FAILED','STALLED'].includes(state)?'danger':['RUNNING','AVAILABLE','RECORDING','COMPLETE'].includes(state)?'healthy':['STARTING','RETRYING','FINALIZING'].includes(state)?'warning':'muted';
      return <Node key={o.id} tone={tone}>{o.name}</Node>;
    })}{outputs.length > 8 && <Node>+{outputs.length-8}</Node>}</div>
  </section>;
}
