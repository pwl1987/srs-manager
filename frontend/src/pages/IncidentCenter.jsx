import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { usePolling } from '../lib/use-polling';
import { cn } from '../lib/utils';
import ErrorBanner from '../components/ui/ErrorBanner';
import { CardSkeleton } from '../components/ui/Skeleton';
import { btnSecondary } from '../components/ui/styles';

function tone(item) {
  if (item.severity === 'CRITICAL') return 'text-[var(--destructive)] border-[var(--destructive)]/20 bg-[var(--destructive)]/5';
  return 'text-[var(--warning)] border-[var(--warning)]/20 bg-[var(--warning)]/5';
}

export default function IncidentCenter() {
  const [rooms,setRooms] = useState([]);
  const [items,setItems] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState(null);

  async function load(silent=false) {
    if (!silent) setLoading(true);
    try {
      const payload = await api.get('/v3/rooms');
      const list = payload?.rooms || [];
      const rows = await Promise.all(list.map(async room => {
        const state = await api.get('/v3/rooms/' + room.room.id + '/incidents').catch(() => ({active:[],recent:[]}));
        return (state.active || []).map(item => ({...item,room}));
      }));
      setRooms(list);
      setItems(rows.flat());
      setError(null);
    } catch (err) { setError(err); }
    finally { if (!silent) setLoading(false); }
  }
  usePolling(() => load(Boolean(rooms.length)), 5000);

  const summary = useMemo(() => ({
    critical: items.filter(x => x.severity === 'CRITICAL').length,
    warning: items.filter(x => x.severity === 'WARNING').length,
    acknowledged: items.filter(x => x.status === 'ACKNOWLEDGED').length
  }),[items]);

  if (loading && !rooms.length) return <div className="space-y-3">{[1,2,3].map(x => <CardSkeleton key={x} className="h-24"/>)}</div>;

  return <div>
    <div className="mb-5"><div className="text-[10px] font-semibold tracking-[.16em] text-[var(--primary)]">OPERATIONS / INCIDENTS</div><h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">告警中心</h1><p className="mt-1 text-xs text-[var(--muted-foreground)]">跨直播间聚合真正需要处理的业务异常；ACK 不等于恢复。</p></div>
    <div className="mb-5 grid grid-cols-3 gap-2">{[
      ['CRITICAL',summary.critical,'text-[var(--destructive)]',ShieldAlert],
      ['WARNING',summary.warning,'text-[var(--warning)]',AlertTriangle],
      ['ACKNOWLEDGED',summary.acknowledged,'text-[var(--primary)]',CheckCircle2]
    ].map(([label,value,color,Icon]) => <div key={label} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4"><div className="flex items-center gap-2"><Icon size={15} className={color}/><span className={cn('text-2xl font-semibold tabular-nums',color)}>{value}</span></div><div className="mt-1 text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div></div>)}</div>
    {error && <ErrorBanner message={error.message || '无法读取告警'} onRetry={() => load()} />}
    <div className="space-y-2">{items.length ? items.map(item => <div key={item.id} className={cn('grid gap-3 rounded-xl border p-4 xl:grid-cols-[.9fr_1.45fr_1.2fr_auto] xl:items-center',tone(item))}>
      <div><div className="text-[9px] font-bold tracking-[.1em]">{item.severity}</div><div className="mt-1 text-xs font-semibold text-[var(--foreground)]">{item.room.room.name}</div><div className="mt-1 text-[10px] opacity-70">{item.status}</div></div>
      <div><div className="text-sm font-semibold text-[var(--foreground)]">{item.title}</div><div className="mt-1 text-[10px] leading-5 opacity-80">{item.message}</div></div>
      <div className="text-[10px] leading-5 opacity-80">影响：{item.impact?.program_affected ? 'Program / 全部输出' : (item.impact?.output_ids || []).join(', ') || '局部'}<br/>当前：{item.impact?.can_still_broadcast ? '仍可播' : '播出受影响'}<br/>建议：{item.impact?.suggested_action || '查看运行证据'}</div>
      <Link to={'/streams/' + item.room.room.legacy_stream_id} className={btnSecondary}>进入处理</Link>
    </div>) : <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-10 text-center text-sm text-[var(--muted-foreground)]">当前没有 Active Incident</div>}</div>
  </div>;
}
