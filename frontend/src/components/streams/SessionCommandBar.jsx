import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Play, Plus, RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { btnDangerGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';
import ConfirmDialog from '../ui/ConfirmDialog';

function opKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stateTone(state) {
  if (state === 'ON_AIR') return 'text-[var(--success)]';
  if (state === 'READY') return 'text-[var(--primary)]';
  if (state === 'PREP' || state === 'CLOSING') return 'text-[var(--warning)]';
  return 'text-[var(--muted-foreground)]';
}

function outputHealthy(output) {
  if (!output) return false;
  if (output.mode === 'SERVE') return output.runtime_state === 'AVAILABLE';
  if (output.mode === 'RECORD') return ['RECORDING', 'COMPLETE'].includes(output.runtime_state);
  return output.runtime_state === 'RUNNING';
}
export default function SessionCommandBar({ roomId, workspace, onChanged }) {
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [showQuickPlan, setShowQuickPlan] = useState(false);
  const [quickName, setQuickName] = useState('标准开播方案');
  const [selectedOutputs, setSelectedOutputs] = useState({});
  const [optionalOutputs, setOptionalOutputs] = useState({});
  const [confirmClose, setConfirmClose] = useState(false);
  const session = workspace?.session || null;
  const outputs = workspace?.outputs || [];
  const sourceId = workspace?.program?.source_id || null;

  async function loadPlans() {
    try {
      const data = await api.get(`/v3/rooms/${roomId}/run-plans`);
      const next = data?.run_plans || [];
      setPlans(next);
      if (!planId && next[0]) setPlanId(String(next[0].id));
    } catch (error) { toast.error(error.message || '读取开播方案失败'); }
  }

  useEffect(() => { loadPlans(); }, [roomId]);

  const requiredSummary = useMemo(() => {
    if (!session) return { total: 0, healthy: 0 };
    const required = (session.outputs || []).filter(item => item.importance === 'REQUIRED');
    return {
      total: required.length,
      healthy: required.filter(item => outputHealthy(outputs.find(output => output.id === item.output_ref))).length
    };
  }, [session, outputs]);
  async function createSession() {
    if (!planId) return toast.error('请选择开播方案');
    setBusy(true);
    try {
      await api.post(`/v3/rooms/${roomId}/sessions`, {
        run_plan_id: Number(planId),
        title: title.trim() || plans.find(plan => String(plan.id) === String(planId))?.name || 'Live Session'
      });
      toast.success('本场直播已创建');
      await onChanged();
    } catch (error) { toast.error(error.message || '创建本场直播失败'); }
    finally { setBusy(false); }
  }

  async function createQuickPlan() {
    const chosen = outputs.filter(output => selectedOutputs[output.id]);
    if (!quickName.trim()) return toast.error('请填写方案名称');
    if (!chosen.length) return toast.error('至少选择一个 Output');
    setBusy(true);
    try {
      const result = await api.post(`/v3/rooms/${roomId}/run-plans`, {
        name: quickName.trim(),
        program_source_id: sourceId,
        outputs: chosen.map((output, index) => ({
          output_ref: output.id,
          importance: optionalOutputs[output.id] ? 'OPTIONAL' : 'REQUIRED',
          auto_start: true,
          sort_order: (index + 1) * 10
        }))
      });
      const created = result?.run_plan;
      await loadPlans();
      if (created?.id) setPlanId(String(created.id));
      setShowQuickPlan(false);
      toast.success('开播方案已保存');
    } catch (error) { toast.error(error.message || '创建开播方案失败'); }
    finally { setBusy(false); }
  }
  async function runPreflight() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await api.post(`/v3/sessions/${session.legacy_session_id}/preflight`, { mark_ready: true });
      if (result.status === 'BLOCKED') toast.error('Preflight 存在阻断项');
      else if (result.status === 'WARNING') toast.warning('Preflight 通过，但存在警告');
      else toast.success('Preflight 通过，Session 已 READY');
      await onChanged();
    } catch (error) { toast.error(error.message || 'Preflight 失败'); }
    finally { setBusy(false); }
  }

  async function startSession() {
    if (!session) return;
    setBusy(true);
    try {
      const op = await api.post(`/v3/sessions/${session.legacy_session_id}/start`, {}, {
        headers: { 'Idempotency-Key': opKey(`session-start-${session.legacy_session_id}`) }
      });
      toast.success(op?.phase === 'SUCCEEDED' ? '本场直播已进入 ON AIR' : '已提交开播操作');
      await onChanged();
    } catch (error) { toast.error(error.message || '启动本场直播失败'); }
    finally { setBusy(false); }
  }


  async function pollClose(operation) {
    let op = operation;
    for (let i = 0; i < 75 && op && !['SUCCEEDED','FAILED','CANCELLED'].includes(op.phase); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      op = await api.get(`/v3/operations/${encodeURIComponent(op.id)}`);
      if (i % 2 === 0) await onChanged();
    }
    return op;
  }

  async function closeSession() {
    if (!session) return;
    setConfirmClose(false);
    setBusy(true);
    try {
      let op;
      try {
        op = await api.post(`/v3/sessions/${session.legacy_session_id}/close`, {}, { headers: { 'Idempotency-Key': opKey(`session-close-${session.legacy_session_id}`) } });
      } catch (error) {
        if (error.status === 409 && error.detail?.id) op = error.detail;
        else throw error;
      }
      op = await pollClose(op);
      if (op?.phase === 'SUCCEEDED') toast.success('本场直播已结束');
      else if (op?.phase === 'FAILED') toast.error(op.error || '收播存在未清理残留，Session 保持 CLOSING');
      else toast.warning('收播仍在进行，请稍后继续检查');
      await onChanged();
    } catch (error) { toast.error(error.message || '结束本场直播失败'); }
    finally { setBusy(false); }
  }

  if (!session) return <section className="mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1"><label className={labelClass}>开播方案</label><select className={inputClass} value={planId} onChange={event => setPlanId(event.target.value)}><option value="">选择 Run Plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
      <div className="min-w-[220px] flex-1"><label className={labelClass}>本场标题</label><input className={inputClass} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：晚间新闻直播" /></div>
      <button className={btnSecondary} onClick={() => setShowQuickPlan(value => !value)}><Plus size={13}/>快速建方案</button>
      <button className={btnPrimary} disabled={busy || !planId} onClick={createSession}>创建本场直播</button>
    </div>
    {showQuickPlan && <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
      <div className="mb-3 grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]"><div><label className={labelClass}>方案名称</label><input className={inputClass} value={quickName} onChange={event => setQuickName(event.target.value)} /></div><div className="text-[10px] leading-5 text-[var(--muted-foreground)]">当前 Program 来源会保存为计划意图。Output 只保存引用，不复制 Runtime；以后修改长期方案也不会改写已经创建的 Session。</div></div>
      <div className="space-y-2">{outputs.map(output => <label key={output.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 px-3 py-2 text-xs"><input type="checkbox" checked={Boolean(selectedOutputs[output.id])} onChange={event => setSelectedOutputs(current => ({ ...current, [output.id]: event.target.checked }))}/><span className="min-w-0 flex-1 truncate">{output.name}</span><span className="text-[10px] text-[var(--text-faint)]">{output.mode}</span><select className="rounded-md border border-[var(--border-soft)] bg-[var(--background)] px-2 py-1 text-[10px]" disabled={!selectedOutputs[output.id]} value={optionalOutputs[output.id] ? 'OPTIONAL' : 'REQUIRED'} onChange={event => setOptionalOutputs(current => ({ ...current, [output.id]: event.target.value === 'OPTIONAL' }))}><option value="REQUIRED">Required</option><option value="OPTIONAL">Optional</option></select></label>)}</div>
      <div className="mt-3 flex justify-end"><button className={btnPrimary} disabled={busy} onClick={createQuickPlan}>保存方案</button></div>
    </div>}
  </section>;

  const plan = plans.find(item => Number(item.id) === Number(session.run_plan_id));
  const sessionSeconds = session.started_at ? Math.max(0, Math.floor((Date.now() - Date.parse(session.started_at)) / 1000)) : null;
  return <section className="mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">SESSION COMMAND BAR</div><div className="mt-1 flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{session.title}</span><span className={`text-[10px] font-bold tracking-[.08em] ${stateTone(session.lifecycle_state)}`}>{session.lifecycle_state}</span></div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">Run Plan: {plan?.name || session.plan_snapshot?.name || '—'} · Program: {workspace?.program?.source_id || '未观测'}</div></div>
      <div className="text-center"><div className="text-[9px] uppercase tracking-[.1em] text-[var(--text-faint)]">Required</div><div className="mt-1 text-sm font-semibold tabular-nums">{requiredSummary.healthy}/{requiredSummary.total}</div></div>
      <div className="text-center"><div className="text-[9px] uppercase tracking-[.1em] text-[var(--text-faint)]">Preflight</div><div className="mt-1 text-sm font-semibold">{session.preflight_status || 'NOT RUN'}</div></div>
      {sessionSeconds != null && <div className="flex items-center gap-1.5 text-xs tabular-nums text-[var(--muted-foreground)]"><Clock3 size={13}/>{Math.floor(sessionSeconds/3600).toString().padStart(2,'0')}:{Math.floor((sessionSeconds%3600)/60).toString().padStart(2,'0')}:{(sessionSeconds%60).toString().padStart(2,'0')}</div>}
      {['PREP','READY'].includes(session.lifecycle_state) && <button className={btnSecondary} disabled={busy} onClick={runPreflight}><RefreshCw size={13}/>Preflight</button>}
      {session.lifecycle_state === 'READY' && <button className={btnPrimary} disabled={busy} onClick={startSession}><Play size={13}/>启动本场直播</button>}
      {session.lifecycle_state === 'ON_AIR' && <div className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success-soft)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--success)]"><CheckCircle2 size={13}/>ON AIR</div>}
      {session.lifecycle_state === 'ON_AIR' && <button className={btnDangerGhost} disabled={busy} onClick={() => setConfirmClose(true)}><Square size={12}/>结束本场直播</button>}
      {session.lifecycle_state === 'CLOSING' && <button className={btnSecondary} disabled={busy} onClick={closeSession}><RefreshCw size={12}/>继续收播</button>}
      {session.preflight_status === 'BLOCKED' && <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--destructive)]"><CircleAlert size={13}/>存在阻断项</div>}
    </div>
    <ConfirmDialog open={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={closeSession} confirming={busy} title="结束本场直播" description="将按顺序停止本 Session 的网络输出，等待录像 Finalize，再停止 Managed Pull。外部 IN-PUSH Publisher 不会被自动断开；任何残留都会保持 CLOSING，而不会假装结束成功。" confirmLabel="确认收播" />
  </section>;
}
