import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Radio, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { usePolling } from '../lib/use-polling';
import ErrorBanner from '../components/ui/ErrorBanner';
import { CardSkeleton } from '../components/ui/Skeleton';
import { btnSecondary } from '../components/ui/styles';

export default function RunPlans() {
  const [rooms,setRooms] = useState([]);
  const [plans,setPlans] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState(null);

  async function load(silent=false) {
    if (!silent) setLoading(true);
    try {
      const payload=await api.get('/v3/rooms');
      const list=payload?.rooms || [];
      const groups=await Promise.all(list.map(async room => {
        const data=await api.get('/v3/rooms/' + room.room.id + '/run-plans').catch(() => ({run_plans:[]}));
        return (data.run_plans || []).map(plan => ({...plan,room}));
      }));
      setRooms(list); setPlans(groups.flat()); setError(null);
    } catch(err){ setError(err); }
    finally { if(!silent) setLoading(false); }
  }
  usePolling(() => load(Boolean(rooms.length)), 15000);

  if (loading && !rooms.length) return <div className="space-y-3">{[1,2,3].map(x => <CardSkeleton key={x} className="h-32"/>)}</div>;

  return <div>
    <div className="mb-5"><div className="text-[10px] font-semibold tracking-[.16em] text-[var(--primary)]">RESOURCES / RUN PLANS</div><h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">开播方案</h1><p className="mt-1 text-xs text-[var(--muted-foreground)]">Program、Required/Optional Outputs、录制和 Failover 的可复用意图。编辑从对应直播间发起，避免脱离业务上下文。</p></div>
    {error && <ErrorBanner message={error.message || '无法读取开播方案'} onRetry={() => load()} />}
    <div className="grid gap-3 xl:grid-cols-2">{plans.length ? plans.map(plan => {
      const required=plan.outputs.filter(x => x.importance === 'REQUIRED');
      const optional=plan.outputs.filter(x => x.importance === 'OPTIONAL');
      return <article key={plan.room.room.id + ':' + plan.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
        <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><ClipboardList size={15} className="text-[var(--primary)]"/><h2 className="text-sm font-semibold">{plan.name}</h2></div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{plan.room.room.name}</div></div><span className="rounded-md bg-[var(--success-soft)] px-2 py-1 text-[9px] font-semibold text-[var(--success)]">{plan.status}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/25 p-3"><div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">REQUIRED</div><div className="mt-2 text-xs font-medium">{required.length} Outputs</div></div><div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/25 p-3"><div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">OPTIONAL</div><div className="mt-2 text-xs font-medium">{optional.length} Outputs</div></div></div>
        <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/20 p-3 text-[10px] text-[var(--muted-foreground)]"><div className="flex items-center gap-2"><Radio size={12}/>Program · {plan.program_source_id || 'Session 决定'}</div><div className="mt-1 flex items-center gap-2"><ShieldCheck size={12}/>Failover · {plan.failover_source_ids?.length || 0} candidates</div></div>
        <div className="mt-3"><Link to={'/streams/' + plan.room.room.legacy_stream_id} className={btnSecondary}>进入直播间配置</Link></div>
      </article>;
    }) : <div className="col-span-full rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-10 text-center text-sm text-[var(--muted-foreground)]">尚未创建开播方案。进入任一直播间后创建标准方案。</div>}</div>
  </div>;
}
