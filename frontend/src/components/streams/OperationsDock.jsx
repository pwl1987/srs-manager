import React from 'react';
import { useState } from 'react';
import { Activity, AlertTriangle, Check, Cpu, History, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { btnSecondary } from '../ui/styles';

const TABS = [
  ['incidents', '告警', AlertTriangle],
  ['events', '事件', History],
  ['operations', '操作', Wrench],
  ['resources', '资源', Cpu]
];

function severityClass(value) {
  if (value === 'CRITICAL') return 'text-[var(--destructive)] border-[var(--destructive)]/20 bg-[var(--destructive)]/5';
  if (value === 'WARNING') return 'text-[var(--warning)] border-[var(--warning)]/20 bg-[var(--warning)]/5';
  return 'text-[var(--muted-foreground)] border-[var(--border-soft)] bg-[var(--background)]/20';
}

export async function acknowledgeIncident(roomId, incident, onChanged) {
  try {
    await api.post(`/v3/rooms/${roomId}/incidents/${incident.id}/ack`, {});
    toast.success('告警已确认；恢复状态仍以运行证据为准');
    await onChanged();
  } catch (error) { toast.error(error.message || '告警确认失败'); }
}

export function OperationsResources({ workers = {}, workspace }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{['pull','push','transcode','record'].map(name => {
    const worker = workers[name];
    return <div key={name} className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 p-3">
      <div className="text-[9px] font-semibold tracking-[.1em] text-[var(--text-faint)]">{name === 'pull' ? '拉流' : name === 'push' ? '推流' : name === 'transcode' ? '转码' : '录像'} 工作进程</div>
      <div className={`mt-2 text-xs font-semibold ${worker?.available ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>{worker?.available ? '可用' : '不可用'}</div>
      <div className="mt-1 truncate text-[9px] text-[var(--text-faint)]">{worker?.instance_id || '—'}</div>
    </div>;
  })}<div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 p-3">
    <div className="text-[9px] font-semibold tracking-[.1em] text-[var(--text-faint)]">录像存储</div>
    <div className="mt-2 text-xs font-semibold">{workspace?.capabilities?.runtime?.record?.storage?.low_space ? '空间不足' : '正常 / 待确认'}</div>
  </div></div>;
}

export default function OperationsDock({ roomId, workspace, incidentState, onChanged, compact = false, embedded = false, initialTab = 'incidents' }) {
  const [tab, setTab] = useState(initialTab);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const active = incidentState?.active || [];
  const recent = incidentState?.recent || [];
  const events = workspace?.timeline || [];
  const operations = workspace?.operations || [];
  const workers = workspace?.evidence?.workers || {};
  async function acknowledge(incident) {
    setBusyId(incident.id);
    try { await acknowledgeIncident(roomId, incident, onChanged); }
    finally { setBusyId(null); }
  }

  const showBody = !compact || active.length > 0 || expanded;
  return <section data-workspace-region="dock" className={embedded ? "shrink-0 border-t border-[var(--border-soft)] bg-[var(--card)]" : "rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] shadow-[var(--shadow-panel)]"}>
    <div className={compact ? "flex min-h-10 flex-wrap items-center justify-between gap-2 px-3 py-1.5" : "flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-3"}>
      <div><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">运维信息</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">{active.length ? `${active.length} 个活动告警` : '当前没有活动告警'}</div></div>
      <div className="flex gap-1 rounded-lg bg-[var(--background)]/30 p-1">{TABS.map(([id,label,Icon]) => <button key={id} onClick={() => { if (compact && tab === id && expanded && !active.length) setExpanded(false); else { setTab(id); if (compact) setExpanded(true); } }} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${tab===id ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}><Icon size={11}/>{label}{id==='incidents' && active.length ? ` ${active.length}` : ''}</button>)}</div>
    </div>
    {showBody && <div className={compact ? "max-h-[116px] overflow-y-auto border-t border-[var(--border-soft)] p-2" : "max-h-[280px] overflow-y-auto p-3"}>
      {tab === 'incidents' && <div className="space-y-2">{active.length ? active.map(item => <div key={item.id} className={`rounded-xl border p-3 ${severityClass(item.severity)}`}><div className="flex items-start gap-3"><Activity size={13} className="mt-0.5 shrink-0"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{item.title}</span><span className="text-[9px] font-bold">{item.severity}</span><span className="text-[9px] opacity-70">{item.status}</span></div><div className="mt-1 text-[10px] leading-5 opacity-80">{item.message}</div><div className="mt-1 text-[10px] opacity-70">影响：{item.impact?.program_affected ? 'Program / 全部输出' : (item.impact?.output_ids || []).join(', ') || '局部'} · {item.impact?.can_still_broadcast ? '当前仍可播' : '当前播出受影响'}</div><div className="mt-1 text-[10px] opacity-70">建议：{item.impact?.suggested_action || '查看运行证据'}</div></div>{item.status === 'OPEN' && <button className={btnSecondary} disabled={busyId===item.id} onClick={() => acknowledge(item)}><Check size={11}/>确认</button>}</div></div>) : <div className="py-7 text-center text-xs text-[var(--muted-foreground)]">当前没有活动告警</div>}{recent.filter(item => item.status === 'RECOVERED').slice(0,5).map(item => <div key={`r-${item.id}`} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-[10px] text-[var(--text-faint)]">已恢复 · {item.title}</div>)}</div>}
      {tab === 'events' && <div className="space-y-2">{events.length ? events.map((item,index) => <div key={`${item.type}-${index}`} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-[10px]"><span className="font-semibold">{item.type}</span><span className="ml-2 text-[var(--text-faint)]">{item.occurred_at || '—'}</span></div>) : <div className="py-7 text-center text-xs text-[var(--muted-foreground)]">暂无事件</div>}</div>}
      {tab === 'operations' && <div className="space-y-2">{operations.length ? operations.map(item => <div key={item.id} className="flex items-center justify-between rounded-lg border border-[var(--border-soft)] px-3 py-2 text-[10px]"><span className="font-semibold">{item.type}</span><span className="text-[var(--muted-foreground)]">{item.phase} · {item.step || '—'}</span></div>) : <div className="py-7 text-center text-xs text-[var(--muted-foreground)]">暂无活动操作</div>}</div>}
      {tab === 'resources' && <OperationsResources workers={workers} workspace={workspace} />}
    </div>}
  </section>;
}
