import React from 'react';
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

const SESSION_STATE_LABELS = {
  PREP: '准备中',
  READY: '待开播',
  ON_AIR: '正在播出',
  CLOSING: '收播中',
  ENDED: '已结束'
};

function stateTone(state) {
  if (state === 'ON_AIR') return 'text-[var(--success)]';
  if (state === 'READY') return 'text-[var(--primary)]';
  if (state === 'PREP' || state === 'CLOSING') return 'text-[var(--warning)]';
  return 'text-[var(--muted-foreground)]';
}

function nextStep(session) {
  if (session.lifecycle_state === 'PREP') return '运行预检';
  if (session.lifecycle_state === 'READY') return '开始播出';
  if (session.lifecycle_state === 'ON_AIR') return '保持监控';
  if (session.lifecycle_state === 'CLOSING') return '完成收播';
  return '查看状态';
}

function outputHealthy(output) {
  if (!output) return false;
  if (output.mode === 'SERVE') return output.runtime_state === 'AVAILABLE';
  if (output.mode === 'RECORD') return ['RECORDING', 'COMPLETE'].includes(output.runtime_state);
  return output.runtime_state === 'RUNNING';
}
export default function SessionCommandBar({ roomId, workspace, onChanged, compact = false, readOnly = false, initialShowQuickPlan = false, initialConfirmClose = false }) {
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [showQuickPlan, setShowQuickPlan] = useState(initialShowQuickPlan);
  const [quickName, setQuickName] = useState('标准开播方案');
  const [selectedOutputs, setSelectedOutputs] = useState({});
  const [optionalOutputs, setOptionalOutputs] = useState({});
  const [confirmClose, setConfirmClose] = useState(initialConfirmClose);
  const session = workspace?.session || null;
  const outputs = workspace?.outputs || [];
  const sourceId = workspace?.program?.source_id || null;
  const sourceName = workspace?.sources?.find(source => source.id === sourceId)?.name || sourceId || '未确认';

  async function loadPlans() {
    try {
      const data = await api.get(`/v3/rooms/${roomId}/run-plans`);
      const next = data?.run_plans || [];
      setPlans(next);
      if (!planId && next[0]) setPlanId(String(next[0].id));
    } catch (error) { toast.error(error.message || '读取开播方案失败'); }
  }

  useEffect(() => { if (!readOnly) loadPlans(); }, [roomId, readOnly]);

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
      toast.success(op?.phase === 'SUCCEEDED' ? '本场直播已开始播出' : '已提交开播操作');
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

  if (!session) return <section className={compact ? "rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-2" : "mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]"}>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1"><label className={labelClass}>开播方案</label><select className={inputClass} value={planId} onChange={event => setPlanId(event.target.value)}><option value="">选择一个开播方案</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
      <div className="min-w-[220px] flex-1"><label className={labelClass}>本场标题</label><input className={inputClass} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：晚间新闻直播" /></div>
      <button className={plans.length ? btnSecondary : btnPrimary} onClick={() => setShowQuickPlan(value => !value)}><Plus size={13}/>{plans.length ? '新建开播方案' : '先创建开播方案'}</button>
      <button className={btnPrimary} disabled={busy || !planId} onClick={createSession} title={!planId ? '请先选择或创建开播方案' : undefined}>创建本场直播</button>
    </div>
    {!plans.length && !showQuickPlan && <div className="mt-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-3 py-2.5 text-xs"><div className="font-semibold text-[var(--foreground)]">还没有开播方案</div><div className="mt-1 leading-5 text-[var(--muted-foreground)]">开播方案会记录本场使用的节目源、输出渠道，以及哪些输出是必须成功的。先创建方案，才能创建本场直播。</div></div>}
    {showQuickPlan && <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
      <div className="mb-3 grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]"><div><label className={labelClass}>方案名称</label><input className={inputClass} value={quickName} onChange={event => setQuickName(event.target.value)} /></div><div className="text-[10px] leading-5 text-[var(--muted-foreground)]">方案会记录当前节目源和所选输出。保存后，可以用它创建本场直播；本场创建后仍可独立调整。</div></div>
      <div className="space-y-2">{outputs.map(output => <label key={output.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 px-3 py-2 text-xs"><input type="checkbox" checked={Boolean(selectedOutputs[output.id])} onChange={event => setSelectedOutputs(current => ({ ...current, [output.id]: event.target.checked }))}/><span className="min-w-0 flex-1 truncate">{output.name}</span><span className="text-[10px] text-[var(--text-faint)]">{output.mode === 'PUSH' ? '主动推送给第三方' : output.mode === 'SERVE' ? '提供地址给第三方拉取' : '本地录制'}</span><select className="rounded-md border border-[var(--border-soft)] bg-[var(--background)] px-2 py-1 text-[10px]" disabled={!selectedOutputs[output.id]} value={optionalOutputs[output.id] ? 'OPTIONAL' : 'REQUIRED'} onChange={event => setOptionalOutputs(current => ({ ...current, [output.id]: event.target.value === 'OPTIONAL' }))}><option value="REQUIRED">必需</option><option value="OPTIONAL">可选</option></select></label>)}</div>
      <div className="mt-3 flex justify-end"><button className={btnPrimary} disabled={busy} onClick={createQuickPlan}>保存方案</button></div>
    </div>}
  </section>;

  const plan = plans.find(item => Number(item.id) === Number(session.run_plan_id));
  const sessionSeconds = session.started_at ? Math.max(0, Math.floor((Date.now() - Date.parse(session.started_at)) / 1000)) : null;
  return <section className={compact ? "rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-2" : "mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]"}>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">本场直播</div><div className="mt-1 flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{session.title}</span><span className={`rounded-md bg-[var(--secondary)] px-2 py-1 text-[10px] font-semibold ${stateTone(session.lifecycle_state)}`}>{SESSION_STATE_LABELS[session.lifecycle_state] || session.lifecycle_state}</span></div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">开播方案：{plan?.name || session.plan_snapshot?.name || '—'} · 节目源：{sourceName} · 下一步：{nextStep(session)}</div></div>
      <div className="text-center"><div className="text-[9px] text-[var(--text-faint)]">必需输出</div><div className="mt-1 text-sm font-semibold tabular-nums">{requiredSummary.healthy}/{requiredSummary.total}</div></div>
      <div className="text-center"><div className="text-[9px] text-[var(--text-faint)]">预检</div><div className="mt-1 text-sm font-semibold">{session.preflight_status === 'PASS' ? '通过' : session.preflight_status === 'WARNING' ? '有警告' : session.preflight_status === 'BLOCKED' ? '被阻断' : '未运行'}</div></div>
      {sessionSeconds != null && <div className="flex items-center gap-1.5 text-xs tabular-nums text-[var(--muted-foreground)]"><Clock3 size={13}/>{Math.floor(sessionSeconds/3600).toString().padStart(2,'0')}:{Math.floor((sessionSeconds%3600)/60).toString().padStart(2,'0')}:{(sessionSeconds%60).toString().padStart(2,'0')}</div>}
      {['PREP','READY'].includes(session.lifecycle_state) && <button className={btnSecondary} disabled={busy} onClick={runPreflight}><RefreshCw size={13}/>运行预检</button>}
      {session.lifecycle_state === 'READY' && <button className={btnPrimary} disabled={busy} onClick={startSession}><Play size={13}/>开始播出</button>}
      {session.lifecycle_state === 'ON_AIR' && <div className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success-soft)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--success)]"><CheckCircle2 size={13}/>正在播出</div>}
      {session.lifecycle_state === 'ON_AIR' && <button className={btnDangerGhost} disabled={busy} onClick={() => setConfirmClose(true)}><Square size={12}/>结束本场直播</button>}
      {session.lifecycle_state === 'CLOSING' && <button className={btnSecondary} disabled={busy} onClick={closeSession}><RefreshCw size={12}/>继续完成收播</button>}
      {session.preflight_status === 'BLOCKED' && <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--destructive)]"><CircleAlert size={13}/>存在阻断项</div>}
    </div>
    <ConfirmDialog open={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={closeSession} confirming={busy} title="结束本场直播" description="将依次停止本场网络输出，等待录像整理完成，再停止主动拉流。外部推流不会自动断开；如果仍有残留，页面会保留“收播中”状态，直到确认完成。" confirmLabel="确认收播" />
  </section>;
}
