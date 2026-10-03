import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Copy, KeyRound, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import Modal from '../ui/Modal';
import Stepper from '../ui/Stepper';
import { btnPrimary, btnSecondary, btnGhost, inputClass, labelClass } from '../ui/styles';
import { getDirection } from '../../lib/directions';
import { OUTPUT_SCENES, makeSceneLabeler, patchSceneInForm, submitWizard, toggleSceneInForm, wizardCompletionMode, wizardStepValid } from '../../lib/wizard-flow';
import { newWizardState, wizardStateReducer } from '../../lib/wizard-ui-state';

function CredentialFact({ label, value }) {
  const { t } = useTranslation(['streams']);
  return <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/40 px-3 py-2">
    <div className="min-w-0 text-left">
      <div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--foreground)]">{value}</div>
    </div>
    <button type="button" className={btnGhost} onClick={() => { navigator.clipboard?.writeText(value); toast.success(t('streams:wizard.credential.copied')); }}>
      <Copy size={12} />
    </button>
  </div>;
}

// Post-submit completion view: the ONE place the ingest credential plaintext is
// shown (only when the create response delivered it), plus preflight status.
export function WizardCompletion({ journal, outputsCount = 0, t }) {
  const credential = journal?.credential_display || null;
  const credentialRecovered = Boolean(journal?.credential_recovered);
  const preflight = journal?.preflight || null;
  return <div className="space-y-4" data-wizard-completion>
    {credential && <div className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/6 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--warning)]">
        <KeyRound size={13} />
        {t('streams:wizard.credential.title')}
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-[var(--muted-foreground)]">{t('streams:wizard.credential.onceWarning')}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <CredentialFact label={t('streams:wizard.credential.publishUrl')} value={credential.publish_url || '—'} />
        <CredentialFact label={t('streams:wizard.credential.streamKey')} value={credential.stream_key || '—'} />
        <CredentialFact label={t('streams:wizard.credential.serverUrl')} value={credential.server_url || '—'} />
        <CredentialFact label={t('streams:wizard.credential.token')} value={credential.token || '—'} />
      </div>
    </div>}

    {credentialRecovered && !credential && <div className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/6 p-4 text-[11px] leading-5 text-[var(--muted-foreground)]">
      <div className="flex items-center gap-2 font-semibold text-[var(--warning)]"><AlertTriangle size={13} />{t('streams:wizard.credential.recoveredTitle')}</div>
      <p className="mt-1.5">{t('streams:wizard.credential.recoveredBody')}</p>
    </div>}

    {preflight?.status && <div className={cn('rounded-xl border p-3 text-[11px] leading-5',
      preflight.status === 'READY' ? 'border-[var(--border-soft)] text-[var(--muted-foreground)]' : 'border-[var(--warning)]/25 bg-[var(--warning)]/6 text-[var(--muted-foreground)]')}>
      <div className="font-semibold text-[var(--foreground)]">{t('streams:wizard.preflight.status', { status: t(`streams:wizard.preflight.states.${preflight.status}`) })}</div>
      {preflight.status === 'READY_WITH_WARNING' && preflight.summary
        && <p className="mt-1">{t('streams:wizard.preflight.warnings', {
          warnings: preflight.summary.warnings,
          blockers: preflight.summary.blockers || 0
        })}</p>}
    </div>}

    {!outputsCount && <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">{t('streams:wizard.outputs.zeroNotice')}</div>}
  </div>;
}

// Failure view shown on the run step: names the interrupted step, surfaces the
// concrete preflight status when that is what failed, and offers the
// retry-unfinished affordance through the parent.
export function WizardFailure({ failure, preflight, t }) {
  if (!failure) return null;
  return <div className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/7 p-3 text-[11px] leading-5" data-wizard-failure>
    <div className="font-semibold text-[var(--destructive)]">{t('streams:wizard.failedTitle', { step: failure.step })}</div>
    <div className="mt-1 text-[var(--muted-foreground)]">{failure.message}</div>
    {failure.step === 'preflight' && preflight?.status && <div className="mt-1 font-semibold text-[var(--destructive)]">
      {t('streams:wizard.preflight.status', { status: t(`streams:wizard.preflight.states.${preflight.status}`) })}
      {preflight.summary?.blockers ? ` · ${t('streams:wizard.preflight.blockers', { count: preflight.summary.blockers })}` : ''}
    </div>}
    <div className="mt-1 text-[var(--muted-foreground)]">{t('streams:wizard.recoverHint')}</div>
  </div>;
}

// Abandon notice (FIX-04 plan A): after "abandon this creation and start
// anew", states which server-side resources the discarded journal had
// already created — they are never silently deleted.
export function WizardAbandonedNotice({ abandoned, t }) {
  if (!abandoned) return null;
  return <div className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/6 p-3 text-[11px] leading-5" data-wizard-abandoned>
    <div className="flex items-center gap-2 font-semibold text-[var(--warning)]"><AlertTriangle size={13} />{t('streams:wizard.abandoned.title')}</div>
    <p className="mt-1 text-[var(--muted-foreground)]">{t('streams:wizard.abandoned.body', { name: abandoned.name || '—' })}</p>
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {abandoned.resources.map(resource => <li key={resource} className="rounded-md border border-[var(--warning)]/25 bg-[var(--background)]/50 px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">{t(`streams:wizard.abandoned.resources.${resource}`)}</li>)}
    </ul>
    <p className="mt-1.5 text-[var(--muted-foreground)]">{t('streams:wizard.abandoned.handleHint')}</p>
  </div>;
}

export default function CreateRoomWizard({ open, onClose, onCreated, initialStep = 0, initialForm = null }) {
  const { t } = useTranslation(['streams', 'common']);
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(wizardStateReducer, { initialStep, initialForm }, newWizardState);
  const { step, maxReached, form, journal, working, failure, completion, locked, abandoned } = state;
  const [scenes, setScenes] = useState(null);
  const [scenesError, setScenesError] = useState(false);

  // One-time credential lifecycle: closing the wizard (cancel, stay-after-done,
  // enter-workspace) discards the run — the plaintext token, the completion and
  // the journal — so reopening always starts from a brand-new journal. A retry
  // inside the same open session never passes through here.
  useEffect(() => {
    if (!open) dispatch({ type: 'RESET', initial: { initialStep, initialForm } });
  }, [open, initialStep, initialForm]);

  useEffect(() => {
    if (!open || scenes) return;
    let active = true;
    api.get('/v3/output/scenes')
      .then(data => { if (active) { setScenes(data?.scenes || []); setScenesError(false); } })
      .catch(() => { if (active) setScenesError(true); });
    return () => { active = false; };
  }, [open, scenes]);

  const scenesById = useMemo(() => Object.fromEntries((scenes || []).map(scene => [scene.id, scene])), [scenes]);

  const steps = useMemo(() => ([
    { key: 'basics', label: t('streams:wizard.steps.basics') },
    { key: 'direction', label: t('streams:wizard.steps.direction') },
    { key: 'input', label: t('streams:wizard.steps.input') },
    { key: 'outputs', label: t('streams:wizard.steps.outputs') },
    { key: 'run', label: t('streams:wizard.steps.run') }
  ]), [t]);

  function goTo(next) {
    dispatch({ type: 'GO_TO_STEP', step: next });
  }

  function toggleOutput(sceneId) {
    dispatch({ type: 'PATCH_FORM', patch: current => toggleSceneInForm(current, sceneId, scenesById[sceneId]) });
  }

  function updateOutput(sceneId, patch) {
    dispatch({ type: 'PATCH_FORM', patch: current => patchSceneInForm(current, sceneId, patch) });
  }

  const stepValid = current => wizardStepValid(form, current);

  const direction = getDirection(form.inputDirection);
  const labelFor = makeSceneLabeler(t);

  function enterWorkspace(streamId) {
    onCreated?.();
    onClose();
    navigate(`/streams/${streamId}`);
  }

  async function submit() {
    dispatch({ type: 'SUBMIT_START' });
    const runJournal = journal;
    try {
      await submitWizard({
        journal: runJournal,
        form,
        labelFor,
        scenesById,
        apiClient: api,
        notify: toast,
        t,
        onSuccess: outcome => {
          // The one-time credential must be shown BEFORE leaving the wizard; a
          // plain run without display-worthy facts goes straight to the room.
          if (wizardCompletionMode(outcome.journal)) {
            dispatch({ type: 'SUBMIT_OK', journal: runJournal, streamId: outcome.streamId });
          } else {
            enterWorkspace(outcome.streamId);
          }
        },
        onFailure: runFailure => dispatch({ type: 'SUBMIT_FAIL', failure: runFailure })
      });
    } finally {
      // Clearing `working` here covers callback-less edge exits; SUBMIT_OK and
      // SUBMIT_FAIL already cleared it on the normal paths.
      dispatch({ type: 'SUBMIT_SETTLED' });
    }
  }

  const footer = completion
    ? <div className="flex w-full items-center justify-end gap-2">
      <button className={btnSecondary} onClick={() => { onCreated?.(); onClose(); }}>{t('streams:wizard.done.stay')}</button>
      <button className={btnPrimary} onClick={() => enterWorkspace(completion.streamId)}>{t('streams:wizard.done.enter')}<ArrowRight size={13} /></button>
    </div>
    : <div className="flex w-full items-center justify-between gap-2">
      <div>
        {step > 0
          ? <button className={btnGhost} disabled={locked} onClick={() => dispatch({ type: 'SET_STEP', step: step - 1 })}><ArrowLeft size={13} />{t('streams:wizard.prev')}</button>
          : <button className={btnGhost} onClick={onClose}>{t('common:actions.cancel')}</button>}
      </div>
      <div className="flex items-center gap-2">
        {failure && <button className={btnSecondary} disabled={working} onClick={submit}><RotateCw size={13} />{t('streams:wizard.retryUnfinished')}</button>}
        {failure && <button className={btnGhost} disabled={working} onClick={() => dispatch({ type: 'ABANDON_CREATION' })}>{t('streams:wizard.abandon')}</button>}
        {step < steps.length - 1
          ? <button className={btnPrimary} disabled={!stepValid(step) || locked} onClick={() => goTo(step + 1)}>{t('streams:wizard.next')}<ArrowRight size={13} /></button>
          : <button className={btnPrimary} disabled={working || !stepValid(0) || !scenes} onClick={submit}>{working ? t('streams:wizard.submitting') : t('streams:wizard.submit')}</button>}
      </div>
    </div>;

  return <Modal open={open} onClose={onClose} title={t('streams:wizard.title')} size="wizard" footer={footer}>
    {completion ? <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <CheckCircle2 size={15} className="text-[var(--primary)]" />
        {t('streams:wizard.done.title', { name: form.name })}
      </div>
      <WizardCompletion journal={completion.journal} outputsCount={form.outputs.length} t={t} />
    </div> : <div className="space-y-4">
      <Stepper steps={steps} current={step} maxReached={maxReached} onSelect={next => dispatch({ type: 'SET_STEP', step: next })} t={t} />

      <WizardAbandonedNotice abandoned={abandoned} t={t} />

      {step === 0 && <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>{t('streams:liveOps.form.name')} *</label>
          <input className={inputClass} value={form.name} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, name: e.target.value }) })} required placeholder={t('streams:liveOps.form.namePlaceholder')} />
          <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">{t('streams:liveOps.form.nameHelp')}</p>
        </div>
        <div>
          <label className={labelClass}>{t('streams:wizard.fields.remark')}</label>
          <input className={inputClass} value={form.remark} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, remark: e.target.value }) })} placeholder={t('streams:wizard.fields.remarkPlaceholder')} />
        </div>
        <div>
          <label className={labelClass}>{t('streams:wizard.fields.businessUnit')}</label>
          <input className={inputClass} value={form.businessUnit} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, businessUnit: e.target.value }) })} placeholder={t('streams:wizard.fields.businessUnitPlaceholder')} />
        </div>
        <div>
          <label className={labelClass}>{t('streams:liveOps.form.protocol')}</label>
          <select className={inputClass} value={form.protocol} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, protocol: e.target.value }) })}>
            <option value="rtmp">RTMP</option>
            <option value="srt">SRT</option>
          </select>
        </div>
      </div>}

      {step === 1 && <div className="grid gap-3 md:grid-cols-2">
        {['IN_PUSH', 'IN_PULL'].map(id => {
          const item = getDirection(id);
          const Icon = item.icon;
          const selected = form.inputDirection === id;
          return <button key={id} type="button" onClick={() => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, inputDirection: id }) })}
            className={cn('rounded-xl border p-4 text-left', selected ? 'border-[var(--primary)]/45 bg-[var(--primary)]/8' : 'border-[var(--border-soft)] bg-[var(--background)]/20 hover:border-[var(--primary)]/25')}>
            <div className="flex items-center gap-2"><Icon size={15} className={selected ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'} /><span className="text-sm font-semibold">{t(item.labelKey)}</span>{selected && <CheckCircle2 size={14} className="text-[var(--primary)]" />}</div>
            <p className="mt-2 text-[11px] leading-5 text-[var(--muted-foreground)]">{t(item.hintKey)}</p>
          </button>;
        })}
      </div>}

      {step === 2 && (form.inputDirection === 'IN_PUSH'
        ? <div className="rounded-xl border border-[var(--primary)]/15 bg-[var(--primary)]/5 p-4 text-xs leading-6 text-[var(--muted-foreground)]">
          <div className="font-semibold text-[var(--foreground)]">{t('streams:wizard.push.title')}</div>
          <p className="mt-1.5">{t('streams:wizard.push.body')}</p>
        </div>
        : <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>{t('streams:wizard.pull.name')} *</label>
            <input className={inputClass} value={form.pullSource.name} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, pullSource: { ...current.pullSource, name: e.target.value } }) })} placeholder={t('streams:wizard.pull.namePlaceholder')} />
          </div>
          <div>
            <label className={labelClass}>{t('streams:wizard.pull.protocol')}</label>
            <select className={inputClass} value={form.pullSource.protocol} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, pullSource: { ...current.pullSource, protocol: e.target.value } }) })}>
              <option value="rtmp">RTMP</option>
              <option value="srt">SRT</option>
              <option value="http">HTTP-FLV</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className={labelClass}>{t('streams:wizard.pull.url')} *</label>
            <input className={inputClass} value={form.pullSource.source_url} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, pullSource: { ...current.pullSource, source_url: e.target.value } }) })} placeholder="rtmp://host/live/key" />
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">{t('streams:wizard.pull.urlHelp')}</p>
          </div>
        </div>)}

      {step === 3 && <div className="space-y-3">
        {scenesError && <div className="rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive)]/7 px-3 py-2 text-[11px] text-[var(--destructive)]">
          {t('streams:wizard.scenesLoadFailed')}{' '}
          <button type="button" className="underline" onClick={() => setScenes(null)}>{t('streams:wizard.scenesRetry')}</button>
        </div>}
        <div className="grid gap-2 md:grid-cols-3">
          {OUTPUT_SCENES.map(item => {
            const selected = form.outputs.some(output => output.sceneId === item.id);
            const scene = scenesById[item.id];
            return <button key={item.id} type="button" onClick={() => toggleOutput(item.id)} disabled={!scene}
              className={cn('rounded-xl border p-3 text-left text-xs', selected ? 'border-[var(--primary)]/45 bg-[var(--primary)]/8' : 'border-[var(--border-soft)] bg-[var(--background)]/20 hover:border-[var(--primary)]/25', !scene && 'opacity-50')}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{t(item.labelKey)}</span>{selected && <CheckCircle2 size={14} className="text-[var(--primary)]" />}</div>
              {scene && <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{(scene.transports || scene.formats || []).join(' / ')}</div>}
            </button>;
          })}
        </div>
        {!form.outputs.length && <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">{t('streams:wizard.outputs.zeroNotice')}</div>}
        {form.outputs.some(output => output.sceneId === 'LIVE_PLATFORM_PUSH') && <div>
          <label className={labelClass}>{t('streams:wizard.outputs.targetUrl')} *</label>
          <input className={inputClass} value={form.outputs.find(output => output.sceneId === 'LIVE_PLATFORM_PUSH')?.target_url || ''} onChange={e => updateOutput('LIVE_PLATFORM_PUSH', { target_url: e.target.value })} placeholder="rtmp://host/live/key" />
        </div>}
      </div>}

      {step === 4 && <div className="space-y-3">
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 text-xs leading-6">
          <div className="font-semibold text-[var(--foreground)]">{t('streams:wizard.run.summaryTitle')}</div>
          <ul className="mt-2 space-y-1 text-[var(--muted-foreground)]">
            <li>{t('streams:liveOps.form.name')}：{form.name}</li>
            <li>{t('streams:wizard.steps.direction')}：{direction ? t(direction.labelKey) : '—'}</li>
            <li>{t('streams:wizard.run.outputsCount', { count: form.outputs.length })}{!form.outputs.length ? ` · ${t('streams:wizard.outputs.zeroNotice')}` : ''}</li>
            {form.inputDirection === 'IN_PULL' && form.pullSource.source_url && <li>{t('streams:wizard.pull.url')}：{form.pullSource.source_url}</li>}
          </ul>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={form.createRunPlan} onChange={e => dispatch({ type: 'PATCH_FORM', patch: current => ({ ...current, createRunPlan: e.target.checked }) })} />
          {t('streams:wizard.run.createPlan')}
        </label>
        <WizardFailure failure={failure} preflight={journal.preflight} t={t} />
      </div>}
    </div>}
  </Modal>;
}
