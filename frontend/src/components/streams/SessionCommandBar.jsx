import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleAlert, Clock3, Play, Plus, RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { btnDangerGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';
import ConfirmDialog from '../ui/ConfirmDialog';
import useSessionCommands from './use-session-commands';
import { directionIdFromOutputMode, directionIdFromSourceKind, getDirection } from '../../lib/directions';

const SESSION_STATE_KEYS = {
  PREP: 'streams:sessionBar.state.PREP',
  READY: 'streams:sessionBar.state.READY',
  ON_AIR: 'streams:sessionBar.state.ON_AIR',
  CLOSING: 'streams:sessionBar.state.CLOSING',
  ENDED: 'streams:sessionBar.state.ENDED'
};

const NEXT_STEP_KEYS = {
  PREP: 'streams:sessionBar.next.PREP',
  READY: 'streams:sessionBar.next.READY',
  ON_AIR: 'streams:sessionBar.next.ON_AIR',
  CLOSING: 'streams:sessionBar.next.CLOSING'
};

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

function preflightMeta(status, t) {
  if (['PASS', 'READY'].includes(status)) return [t('streams:sessionBar.preflight.pass'), 'text-[var(--success)]'];
  if (['WARNING', 'READY_WITH_WARNING'].includes(status)) return [t('streams:sessionBar.preflight.warning'), 'text-[var(--warning)]'];
  if (status === 'BLOCKED') return [t('streams:sessionBar.preflight.blocked'), 'text-[var(--destructive)]'];
  return [t('streams:sessionBar.preflight.none'), 'text-[var(--muted-foreground)]'];
}

export default function SessionCommandBar({ roomId, workspace, onChanged, compact = false, readOnly = false, initialShowQuickPlan = false, initialConfirmClose = false }) {
  const { t } = useTranslation('streams');
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [title, setTitle] = useState('');
  const [showQuickPlan, setShowQuickPlan] = useState(initialShowQuickPlan);
  const [quickName, setQuickName] = useState('标准开播方案');
  const [quickSourceId, setQuickSourceId] = useState('');
  const [selectedOutputs, setSelectedOutputs] = useState({});
  const [optionalOutputs, setOptionalOutputs] = useState({});
  const [confirmClose, setConfirmClose] = useState(initialConfirmClose);
  const [uiBusy, setUiBusy] = useState(false);
  const session = workspace?.session || null;
  const outputs = workspace?.outputs || [];
  const sources = workspace?.sources || [];
  const availableSources = sources.filter(source => source.configured !== false);
  const observedSourceId = workspace?.program?.source_id || null;
  const plannedSourceId = session?.planned_program_source_id || observedSourceId;
  const sourceName = sources.find(source => source.id === plannedSourceId)?.name || plannedSourceId || t('streams:sessionBar.session.noSourceSelected');
  const commands = useSessionCommands({ roomId, session, onChanged });
  const { runPreflight, startSession, closeSession } = commands;
  const busy = commands.busy || uiBusy;

  async function loadPlans() {
    try {
      const next = await commands.loadPlans();
      setPlans(next);
      if (!planId && next[0]) setPlanId(String(next[0].id));
    } catch (error) { toast.error(error.message || t('streams:sessionBar.plansLoadFailed')); }
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
  const [preflightLabel, preflightTone] = preflightMeta(session?.preflight_status, t);

  function createSession() {
    return commands.createSession({
      planId,
      title,
      fallbackTitle: plans.find(plan => String(plan.id) === String(planId))?.name
    });
  }

  async function createQuickPlan() {
    const chosen = outputs.filter(output => selectedOutputs[output.id]);
    const created = await commands.createQuickPlan({
      name: quickName,
      sourceId: quickSourceId,
      outputs: chosen.map(output => ({ id: output.id, optional: Boolean(optionalOutputs[output.id]) }))
    });
    if (created?.id) {
      await loadPlans();
      setPlanId(String(created.id));
      setShowQuickPlan(false);
    }
  }

  if (!session) return <section className={compact ? "rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-2" : "mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]"}>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1"><label className={labelClass}>{t('streams:sessionBar.noSession.planLabel')}</label><select className={inputClass} value={planId} onChange={event => setPlanId(event.target.value)}><option value="">{t('streams:sessionBar.noSession.planPlaceholder')}</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
      <div className="min-w-[220px] flex-1"><label className={labelClass}>{t('streams:sessionBar.noSession.titleLabel')}</label><input className={inputClass} value={title} onChange={event => setTitle(event.target.value)} placeholder={t('streams:sessionBar.noSession.titlePlaceholder')} /></div>
      <button className={plans.length ? btnSecondary : btnPrimary} onClick={() => setShowQuickPlan(value => !value)}><Plus size={13}/>{plans.length ? t('streams:sessionBar.noSession.newPlan') : t('streams:sessionBar.noSession.firstPlan')}</button>
      <button className={btnPrimary} disabled={busy || !planId} onClick={createSession} title={!planId ? t('streams:sessionBar.planRequired') : undefined}>{t('streams:sessionBar.noSession.createSession')}</button>
    </div>
    {!plans.length && !showQuickPlan && <div className="mt-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-3 py-2.5 text-xs"><div className="font-semibold text-[var(--foreground)]">{t('streams:sessionBar.noSession.emptyTitle')}</div><div className="mt-1 leading-5 text-[var(--muted-foreground)]">{t('streams:sessionBar.noSession.emptyBody')}</div></div>}
    {showQuickPlan && <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
      <div className="mb-3 grid gap-3 md:grid-cols-[minmax(160px,0.7fr)_minmax(180px,0.85fr)_minmax(0,1.25fr)]"><div><label className={labelClass}>{t('streams:sessionBar.quickPlan.nameLabel')}</label><input className={inputClass} value={quickName} onChange={event => setQuickName(event.target.value)} /></div><div><label className={labelClass}>{t('streams:sessionBar.quickPlan.sourceLabel')}</label><select className={inputClass} value={quickSourceId} onChange={event => setQuickSourceId(event.target.value)}><option value="">{t('streams:sessionBar.quickPlan.sourcePlaceholder')}</option>{availableSources.map(source => <option key={source.id} value={source.id}>{source.name} · {(() => { const d = getDirection(directionIdFromSourceKind(source.kind)); return d ? t(d.labelKey) : (source.kind || ''); })()}</option>)}</select></div><div className="text-[10px] leading-5 text-[var(--muted-foreground)]">{t('streams:sessionBar.quickPlan.help')}</div></div>
      {!availableSources.length && <div className="mb-2 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-3 py-2 text-[10px] text-[var(--muted-foreground)]">{t('streams:sessionBar.quickPlan.noSources')}</div>}
      {!outputs.length && <div className="mb-2 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-3 py-2 text-[10px] text-[var(--muted-foreground)]">{t('streams:sessionBar.quickPlan.noOutputs')}</div>}
      <div className="space-y-2">{outputs.map(output => <label key={output.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 px-3 py-2 text-xs"><input type="checkbox" checked={Boolean(selectedOutputs[output.id])} onChange={event => setSelectedOutputs(current => ({ ...current, [output.id]: event.target.checked }))}/><span className="min-w-0 flex-1 truncate">{output.name}</span><span className="text-[10px] text-[var(--text-faint)]">{(() => { const d = getDirection(directionIdFromOutputMode(output.mode)); return d ? t(d.labelKey) : (output.mode || ''); })()}</span><select className="rounded-md border border-[var(--border-soft)] bg-[var(--background)] px-2 py-1 text-[10px]" disabled={!selectedOutputs[output.id]} value={optionalOutputs[output.id] ? 'OPTIONAL' : 'REQUIRED'} onChange={event => setOptionalOutputs(current => ({ ...current, [output.id]: event.target.value === 'OPTIONAL' }))}><option value="REQUIRED">{t('streams:sessionBar.quickPlan.required')}</option><option value="OPTIONAL">{t('streams:sessionBar.quickPlan.optional')}</option></select></label>)}</div>
      <div className="mt-3 flex justify-end"><button className={btnPrimary} disabled={busy || !quickSourceId || !availableSources.some(source => source.id === quickSourceId) || !outputs.some(output => selectedOutputs[output.id])} onClick={createQuickPlan}>{t('streams:sessionBar.quickPlan.save')}</button></div>
    </div>}
  </section>;

  const plan = plans.find(item => Number(item.id) === Number(session.run_plan_id));
  const sessionSeconds = session.started_at ? Math.max(0, Math.floor((Date.now() - Date.parse(session.started_at)) / 1000)) : null;
  const nextStepLabel = t(NEXT_STEP_KEYS[session.lifecycle_state] || 'streams:sessionBar.next.default');
  return <section className={compact ? "rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-2" : "mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]"}>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{t('streams:sessionBar.session.title')}</div><div className="mt-1 flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{session.title}</span><span className={`rounded-md bg-[var(--secondary)] px-2 py-1 text-[10px] font-semibold ${stateTone(session.lifecycle_state)}`}>{t(SESSION_STATE_KEYS[session.lifecycle_state]) || session.lifecycle_state}</span></div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{t('streams:sessionBar.session.metaLine', { plan: plan?.name || session.plan_snapshot?.name || '—', source: sourceName, next: nextStepLabel })}</div></div>
      <div className="text-center"><div className="text-[9px] text-[var(--text-faint)]">{t('streams:sessionBar.session.requiredOutputs')}</div><div className="mt-1 text-sm font-semibold tabular-nums">{requiredSummary.healthy}/{requiredSummary.total}</div></div>
      <div className="text-center"><div className="text-[9px] text-[var(--text-faint)]">{t('streams:sessionBar.session.preflight')}</div><div className={`mt-1 text-sm font-semibold ${preflightTone}`}>{preflightLabel}</div></div>
      {sessionSeconds != null && <div className="flex items-center gap-1.5 text-xs tabular-nums text-[var(--muted-foreground)]"><Clock3 size={13}/>{Math.floor(sessionSeconds/3600).toString().padStart(2,'0')}:{Math.floor((sessionSeconds%3600)/60).toString().padStart(2,'0')}:{(sessionSeconds%60).toString().padStart(2,'0')}</div>}
      {['PREP','READY'].includes(session.lifecycle_state) && <button className={btnSecondary} disabled={busy} onClick={runPreflight}><RefreshCw size={13}/>{t('streams:sessionBar.actions.runPreflight')}</button>}
      {session.lifecycle_state === 'READY' && <button className={btnPrimary} disabled={busy} onClick={startSession}><Play size={13}/>{t('streams:sessionBar.actions.start')}</button>}
      {session.lifecycle_state === 'ON_AIR' && <div className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success-soft)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--success)]"><CheckCircle2 size={13}/>{t('streams:sessionBar.actions.onAir')}</div>}
      {session.lifecycle_state === 'ON_AIR' && <button className={btnDangerGhost} disabled={busy} onClick={() => setConfirmClose(true)}><Square size={12}/>{t('streams:sessionBar.actions.end')}</button>}
      {session.lifecycle_state === 'CLOSING' && <button className={btnSecondary} disabled={busy} onClick={closeSession}><RefreshCw size={12}/>{t('streams:sessionBar.actions.continueClosing')}</button>}
      {session.preflight_status === 'BLOCKED' && <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--destructive)]"><CircleAlert size={13}/>{t('streams:sessionBar.session.blocked')}</div>}
    </div>
    <ConfirmDialog open={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={closeSession} confirming={busy} title={t('streams:sessionBar.close.title')} description={t('streams:sessionBar.close.description')} confirmLabel={t('streams:sessionBar.close.confirm')} />
  </section>;
}
