import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronRight, Layers3, Plus, Radio, Server, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { btnDangerGhost, btnGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';
import { directionIdFromOutputMode, getDirection } from '../../lib/directions';
import { buildOutputPayload, submitOutputDraft } from '../../lib/output-payload';
import { applySceneChoice } from '../../lib/wizard-flow';
import i18n from '../../i18n';

export function sceneLabel(sceneId) {
  if (!sceneId) return sceneId;
  return i18n.t(`streams:outputRack.scenes.${sceneId}`, { defaultValue: sceneId });
}

function opKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function outputModeLabelKey(mode) {
  const direction = getDirection(directionIdFromOutputMode(mode));
  return direction ? direction.labelKey : null;
}

export function useOutputModeLabel() {
  const { t } = useTranslation('streams');
  return mode => {
    const labelKey = outputModeLabelKey(mode);
    return labelKey ? t(labelKey) : mode;
  };
}
export function statusLabel(state) {
  if (!state) return i18n.t('streams:outputRack.evidence.unknown');
  return i18n.t(`streams:outputRack.statuses.${state}`, { defaultValue: state });
}

export function stateMeta(output) {
  const raw = String(output.runtime_state || output.desired_state || 'UNKNOWN').toUpperCase();
  const desired = String(output.desired_state || '').toUpperCase();
  const tone = ['FAILED', 'STALLED'].includes(raw) ? 'text-[var(--destructive)]'
    : ['RETRYING', 'STARTING', 'STOPPING', 'WAITING_INPUT', 'FINALIZING'].includes(raw) ? 'text-[var(--warning)]'
      : ['RUNNING', 'AVAILABLE', 'ACTIVE', 'RECORDING', 'COMPLETE'].includes(raw) ? 'text-[var(--success)]'
        : 'text-[var(--muted-foreground)]';
  const dot = tone.includes('destructive') ? 'bg-[var(--destructive)]'
    : tone.includes('warning') ? 'bg-[var(--warning)]'
      : tone.includes('success') ? 'bg-[var(--success)]' : 'bg-[var(--text-faint)]';
  const failedIntent = ['FAILED', 'STALLED'].includes(raw) && desired === 'RUNNING';
  return { raw, label: failedIntent ? i18n.t('streams:outputRack.failedIntentRetry') : statusLabel(raw), tone, dot, retry: failedIntent };
}

function mediaLabel(output, renditionMap) {
  const r = renditionMap.get(output.media_ref);
  if (!r) return i18n.t('streams:outputRack.passthrough');
  if (r.kind === 'PASSTHROUGH') return i18n.t('streams:outputRack.passthrough');
  return r.media_profile_id?.replace('media-profile:', i18n.t('streams:outputRack.renditionPrefix')) || i18n.t('streams:outputRack.sharedSpec');
}

export function Evidence({ output }) {
  const { t } = useTranslation('streams');
  const local = output.evidence?.local || {};
  const remote = output.evidence?.remote || {};
  return <div className="mt-2 grid gap-2 border-t border-[var(--border-soft)] pt-2 text-[10px] md:grid-cols-2">
    <div className="rounded-lg bg-[var(--background)]/28 p-2.5">
      <div className="font-semibold tracking-[.1em] text-[var(--text-faint)]">{t('streams:outputRack.evidence.local')}</div>
      <div className="mt-1.5 text-[var(--muted-foreground)]">{statusLabel(local.state) || local.state || t('streams:outputRack.evidence.unknown')} · {local.source || '—'}</div>
      <div className="mt-1 text-[var(--text-faint)]">{local.freshness || t('streams:outputRack.evidence.unknown')}{local.observed_at ? ` · ${local.observed_at}` : ''}</div>
    </div>
    <div className="rounded-lg bg-[var(--background)]/28 p-2.5">
      <div className="font-semibold tracking-[.1em] text-[var(--text-faint)]">{t('streams:outputRack.evidence.remote')}</div>
      <div className="mt-1.5 text-[var(--muted-foreground)]">{statusLabel(remote.state) || remote.state || t('streams:outputRack.evidence.unknown')} · {remote.source || t('streams:outputRack.evidence.noRemote')}</div>
      <div className="mt-1 text-[var(--text-faint)]">{remote.freshness || t('streams:outputRack.evidence.unknown')}</div>
    </div>
  </div>;
}

export function OutputRow({ output, renditionMap, busy, onToggle }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('streams');
  const modeLabel = useOutputModeLabel();
  const meta = stateMeta(output);
  const runtime = String(output.runtime_state || '').toUpperCase();
  const wantsRunning = String(output.desired_state || '').toUpperCase() === 'RUNNING' || (output.mode === 'SERVE' && runtime === 'AVAILABLE');
  const action = meta.retry ? 'start' : wantsRunning ? 'stop' : 'start';
  const actionLabel = meta.retry ? t('streams:outputRack.actions.retry') : wantsRunning ? t('streams:outputRack.actions.stop') : t('streams:outputRack.actions.start');
  const transitioning = ['STARTING', 'STOPPING', 'FINALIZING'].includes(runtime);
  const canControl = output.control_mode !== 'LEGACY_UNMANAGED';
  return <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 px-3 py-2.5">
    <div className="flex items-center gap-2">
      <button className={btnGhost} onClick={() => setOpen(v => !v)} aria-label={t('streams:outputRack.evidenceToggle')}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-semibold">{output.name}</span><span className="text-[9px] font-semibold tracking-[.04em] text-[var(--text-faint)]">{modeLabel(output.mode)}</span></div>
        <div className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{mediaLabel(output, renditionMap)} · {output.transport || output.format || output.endpoints?.filter(x => x.advertised !== false).map(x => x.transport).join('/') || '—'}{output.scene ? ` · ${sceneLabel(output.scene)}` : ''}</div>
      </div>
      <div className={`w-24 text-right text-[9px] font-semibold ${meta.tone}`}>{meta.label}</div>
      {canControl && <button className={wantsRunning && !meta.retry ? btnDangerGhost : btnSecondary} disabled={busy || transitioning} onClick={() => onToggle(output, action)}>
        {wantsRunning && !meta.retry ? <Square size={12}/> : <Radio size={12}/>} {transitioning ? t('streams:outputRack.actions.processing') : actionLabel}
      </button>}
    </div>
    {output.mode === 'RECORD' && <div className="mt-2 flex flex-wrap gap-1.5 pl-10 text-[9px] text-[var(--muted-foreground)]"><span className="rounded-md border border-[var(--border-soft)] px-2 py-1">{output.format?.toUpperCase()} · {output.asset?.state || t('streams:outputRack.noFile')}</span>{output.asset?.size_bytes > 0 && <span className="rounded-md border border-[var(--border-soft)] px-2 py-1">{(output.asset.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}{output.asset?.duration_seconds != null && <span className="rounded-md border border-[var(--border-soft)] px-2 py-1">{Math.round(output.asset.duration_seconds)} s</span>}</div>}
    {output.mode === 'SERVE' && <div className="mt-2 flex flex-wrap gap-1.5 pl-10">{(output.endpoints || []).map(ep => <span key={ep.transport} className={`rounded-md border px-2 py-1 text-[9px] ${ep.advertised === false ? 'border-[var(--border-soft)] text-[var(--text-faint)]' : 'border-[var(--primary)]/15 bg-[var(--primary)]/5 text-[var(--muted-foreground)]'}`}>{ep.transport.toUpperCase()} · {ep.protection || 'none'}{ep.advertised === false ? ` · ${t('streams:outputRack.unadvertised')}` : ''}</span>)}</div>}
    {open && <Evidence output={output}/>}
  </div>;
}

export function BuilderDrawer({ roomId, scenes, capabilities, onClose, onCreated, initialBuilderMode = 'scene', initialCompatibility = null }) {
  const { t } = useTranslation('streams');
  const modeLabel = useOutputModeLabel();
  const [builderMode, setBuilderMode] = useState(initialBuilderMode);
  const [sceneId, setSceneId] = useState('LIVE_PLATFORM_PUSH');
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [processing, setProcessing] = useState('PASSTHROUGH');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [mode, setMode] = useState('PUSH');
  const [transport, setTransport] = useState('rtmp');
  const [protection, setProtection] = useState('none');
  const [recordFormat, setRecordFormat] = useState('mp4');
  const [recordSubdir, setRecordSubdir] = useState('');
  const [segmentSeconds, setSegmentSeconds] = useState('6');
  const [saving, setSaving] = useState(false);
  const [compatibility, setCompatibility] = useState(initialCompatibility);
  const scene = scenes.find(x => x.id === sceneId) || scenes[0];
  const protectionOptions = useMemo(() => {
    const capabilityKey = `${mode}:${mode === 'RECORD' ? recordFormat : transport}`;
    const fromCaps = capabilities?.protections?.[capabilityKey] || [];
    if (mode === 'SERVE' && ['rtmp', 'http-flv'].includes(transport)) return fromCaps.filter(x => ['none', 'access-grant'].includes(x));
    if (mode === 'SERVE' && transport === 'hls') return fromCaps.filter(x => ['none', 'external-proxy'].includes(x));
    return fromCaps.length ? fromCaps : ['none'];
  }, [capabilities, mode, transport, recordFormat]);

  useEffect(() => {
    if (builderMode !== 'pro') { setCompatibility(null); return undefined; }
    if (!protectionOptions.includes(protection)) {
      setProtection(protectionOptions[0] || 'none');
      return undefined;
    }
    let active = true;
    api.post('/v3/output/validate', {
      room_id: roomId,
      mode,
      transport: mode === 'RECORD' ? undefined : transport,
      format: mode === 'RECORD' ? recordFormat : undefined,
      protection: mode === 'RECORD' ? 'storage-policy' : protection,
      destination: mode === 'RECORD' ? undefined : { kind: 'CUSTOM' }
    }).then(result => { if (active) setCompatibility(result); })
      .catch(error => { if (active) setCompatibility({ valid: false, message: error.message, reason_code: error.code }); });
    return () => { active = false; };
  }, [builderMode, roomId, mode, transport, recordFormat, protection, protectionOptions]);

  async function ensureTemplates() {
    if (templates.length) return;
    try { setTemplates(await api.get('/transcode-templates')); } catch { setTemplates([]); }
  }

  function chooseScene(nextId) {
    applySceneChoice(scenes, nextId, { setSceneId, setMode, setTransport, setProtection, setRecordFormat });
  }

  async function save() {
    if (!name.trim()) return toast.error(t('streams:outputRack.nameRequired'));
    setSaving(true);
    const saved = await submitOutputDraft({
      apiClient: api,
      roomId,
      notify: toast,
      t,
      fields: {
        builderMode, sceneId, scene, mode, transport, protection, processing, templateId,
        name, targetUrl, recordFormat, recordSubdir, segmentSeconds
      }
    });
    setSaving(false);
    if (saved) {
      onCreated();
      onClose();
    }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={onClose}>
    <aside className="h-full w-full max-w-[620px] overflow-y-auto border-l border-[var(--border)] bg-[var(--card)] shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--card)] px-5 py-4"><div><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{t('streams:outputRack.builder.header')}</div><h3 className="mt-1 text-base font-semibold">{t('streams:outputRack.builder.create')}</h3></div><button className={btnGhost} onClick={onClose}><X size={15}/></button></div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/30 p-1"><button className={builderMode === 'scene' ? btnPrimary : btnGhost} onClick={() => setBuilderMode('scene')}>{t('streams:outputRack.builder.sceneMode')}</button><button className={builderMode === 'pro' ? btnPrimary : btnGhost} onClick={() => { setBuilderMode('pro'); ensureTemplates(); }}>{t('streams:outputRack.builder.proMode')}</button></div>
        {builderMode === 'scene' && <div><label className={labelClass}>{t('streams:outputRack.builder.whatScene')}</label><div className="grid grid-cols-2 gap-2">{scenes.filter(x => x.id !== 'PROFESSIONAL').map(item => <button key={item.id} onClick={() => { chooseScene(item.id); ensureTemplates(); }} className={`rounded-xl border p-3 text-left text-xs ${sceneId === item.id ? 'border-[var(--primary)]/40 bg-[var(--primary)]/8' : 'border-[var(--border-soft)] bg-[var(--background)]/20 hover:border-[var(--primary)]/25'}`}><div className="font-semibold">{sceneLabel(item.id)}</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{modeLabel(item.mode)} · {(item.transports || item.formats || []).join(' / ')}</div></button>)}</div></div>}
        <div><label className={labelClass}>{t('streams:outputRack.builder.nameLabel')}</label><input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder={t('streams:outputRack.builder.namePlaceholder')} /></div>
        {builderMode === 'pro' && <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t('streams:outputRack.builder.direction')}</label><select className={inputClass} value={mode} onChange={e => { setMode(e.target.value); if (e.target.value === 'RECORD') setProtection('storage-policy'); }}>{['PUSH','SERVE','RECORD'].map(value => <option key={value} value={value}>{modeLabel(value)}</option>)}</select></div><div><label className={labelClass}>{mode === 'RECORD' ? t('streams:outputRack.builder.fileFormat') : t('streams:outputRack.builder.transport')}</label>{mode === 'RECORD' ? <select className={inputClass} value={recordFormat} onChange={e => setRecordFormat(e.target.value)}><option value="mp4">MP4</option><option value="ts">TS</option><option value="audio">{t('streams:outputRack.audioFormat')}</option></select> : <select className={inputClass} value={transport} onChange={e => setTransport(e.target.value)}>{(mode === 'PUSH' ? ['rtmp','rtmps','srt'] : ['rtmp','http-flv','hls']).map(x => <option key={x}>{x}</option>)}</select>}</div></div>}
        {(builderMode === 'pro' || (scene?.mode === 'PUSH')) && mode !== 'RECORD' && <div><label className={labelClass}>{t('streams:outputRack.builder.protection')}</label><select className={inputClass} value={protection} onChange={e => setProtection(e.target.value)}>{(builderMode === 'pro' ? protectionOptions : (scene?.mode === 'PUSH' ? ['none','url-credential','token','timestamp-signature','provider-credential','passphrase'] : ['none'])).map(x => <option key={x}>{x}</option>)}</select></div>}
        {builderMode === 'pro' && compatibility && <div className={`rounded-xl border p-3 text-[10px] leading-5 ${compatibility.valid ? 'border-[var(--success)]/18 bg-[var(--success)]/5 text-[var(--success)]' : 'border-[var(--destructive)]/18 bg-[var(--destructive)]/5 text-[var(--destructive)]'}`}><div className="font-semibold">{compatibility.valid ? `✓ ${t('streams:outputRack.builder.capabilityValid')}` : `× ${t('streams:outputRack.builder.capabilityInvalid')}`}</div><div className="mt-1 opacity-80">{compatibility.message || compatibility.reason_code || 'Capability validation'}</div>{compatibility.warnings?.map(w => <div key={w.code} className="mt-1 text-[var(--warning)]">! {w.message}</div>)}</div>}
        {(['PUSH','RECORD'].includes(mode) || ['PUSH','RECORD'].includes(scene?.mode)) && <><div><label className={labelClass}>{t('streams:outputRack.builder.mediaProcessing')}</label><div className="grid grid-cols-2 gap-2"><button className={processing === 'PASSTHROUGH' ? btnPrimary : btnSecondary} onClick={() => setProcessing('PASSTHROUGH')}>{t('streams:outputRack.passthrough')}</button><button className={processing === 'RENDITION' ? btnPrimary : btnSecondary} onClick={() => { setProcessing('RENDITION'); ensureTemplates(); }}>{t('streams:outputRack.builder.rendition')}</button></div></div>{processing === 'RENDITION' && <div><label className={labelClass}>{t('streams:outputRack.builder.specLabel')}</label><select className={inputClass} value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">{t('streams:outputRack.builder.specPlaceholder')}</option>{templates.filter(x => x.enabled).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">{t('streams:outputRack.builder.specHelp')}</p></div>}{(mode === 'PUSH' || scene?.mode === 'PUSH') && <div><label className={labelClass}>{t('streams:outputRack.builder.targetUrl')}</label><input className={inputClass} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder={transport === 'srt' ? 'srt://host:port?...' : 'rtmp://...'} /></div>}{(mode === 'RECORD' || scene?.mode === 'RECORD') && <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t('streams:outputRack.builder.format')}</label><select className={inputClass} value={recordFormat} onChange={e => setRecordFormat(e.target.value)}><option value="mp4">{t('streams:outputRack.builder.mp4Safe')}</option><option value="ts">TS</option><option value="audio">{t('streams:outputRack.audioFormat')}</option></select></div><div><label className={labelClass}>{t('streams:outputRack.builder.segment')}</label><input className={inputClass} type="number" min="2" max="3600" value={segmentSeconds} onChange={e => setSegmentSeconds(e.target.value)} /></div><div className="col-span-2"><label className={labelClass}>{t('streams:outputRack.builder.subdir')}</label><input className={inputClass} value={recordSubdir} onChange={e => setRecordSubdir(e.target.value)} placeholder={t('streams:outputRack.builder.subdirPlaceholder')} /></div></div>}</>}
        <div className="rounded-xl border border-[var(--primary)]/15 bg-[var(--primary)]/5 p-3 text-[10px] leading-5 text-[var(--muted-foreground)]"><Layers3 size={13} className="mr-1 inline text-[var(--primary)]"/>{t('streams:outputRack.builder.notice')}</div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--card)] px-5 py-4"><button className={btnSecondary} onClick={onClose}>{t('common:actions.cancel')}</button><button className={btnPrimary} disabled={saving || (processing === 'RENDITION' && !templateId) || (recordFormat === 'audio' && processing !== 'RENDITION') || (builderMode === 'pro' && compatibility?.valid === false)} onClick={save}>{saving ? t('streams:outputRack.saving') : t('streams:outputRack.saveButton')}</button></div>
    </aside>
  </div>;
}

export async function toggleOutput({ apiClient = api, roomId, output, action, onChanged = async () => {}, notify = toast, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  async function waitForOutputOperation(operation) {
    let current = operation;
    for (let attempt = 0; attempt < 30 && current && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(current.phase); attempt += 1) {
      await sleep(500);
      current = await apiClient.get(`/v3/operations/${encodeURIComponent(current.id)}`);
    }
    return current;
  }

  try {
    await apiClient.post(`/v3/rooms/${roomId}/outputs/${encodeURIComponent(output.id)}/${action}`, {}, { headers: { 'Idempotency-Key': opKey(`${action}-${output.id}`) } });
    notify.success(i18n.t(action === 'start' ? 'streams:outputRack.toggle.startSubmitted' : 'streams:outputRack.toggle.stopSubmitted'));
    await onChanged();
  } catch (error) {
    if (error.status === 409 && error.detail?.id) {
      try {
        const operation = await waitForOutputOperation(error.detail);
        await onChanged();
        if (operation?.phase === 'SUCCEEDED') notify.success(i18n.t('streams:outputRack.toggle.completed'));
        else if (operation?.phase === 'FAILED') notify.error(operation.error || i18n.t('streams:outputRack.toggle.operationFailed'));
        else notify.warning(i18n.t('streams:outputRack.toggle.inProgress'));
      } catch (pollError) {
        notify.error(pollError.message || i18n.t('streams:outputRack.toggle.syncFailed'));
      }
    } else {
      notify.error(error.message || i18n.t('streams:outputRack.toggle.operationFailed'));
    }
  }
}

export default function V3OutputRack({ roomId, workspace, scenes = [], onChanged, embedded = false }) {
  const { t } = useTranslation('streams');
  const [drawer, setDrawer] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const renditionMap = useMemo(() => new Map((workspace?.renditions || []).map(r => [r.id, r])), [workspace]);
  const outputs = workspace?.outputs || [];
  const incidents = outputs.filter(o => ['FAILED', 'RETRYING', 'STALLED'].includes(String(o.runtime_state || '').toUpperCase()));
  const running = outputs.filter(o => o.mode === 'SERVE' ? o.runtime_state === 'AVAILABLE' : ['RUNNING', 'RECORDING'].includes(String(o.runtime_state || '').toUpperCase())).length;

  async function toggle(output, action) {
    setBusyId(output.id);
    await toggleOutput({ roomId, output, action, onChanged }).finally(() => setBusyId(null));
  }

  return <section className={embedded ? "h-full bg-transparent p-3" : "rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]"}>
    <div className="mb-3 flex items-start justify-between gap-4"><div><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{t('streams:outputRack.rack.title')}</div><div className="mt-1 text-sm font-semibold">{t('streams:outputRack.rack.all')}</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{t('streams:outputRack.rack.summary', { running, incidents: incidents.length, specs: (workspace?.renditions || []).filter(r => r.kind === 'TRANSCODE').length })}</div></div><button className={btnPrimary} onClick={() => setDrawer(true)}><Plus size={13}/>{t('streams:outputRack.rack.new')}</button></div>
    {incidents.length > 0 && <div className="mb-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning-soft)]/8 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-[var(--warning)]"><AlertTriangle size={13}/>{t('streams:outputRack.incidentsTitle', { count: incidents.length })}</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{t('streams:outputRack.incidentsNote')}</div></div>}
    <div className="space-y-2">{outputs.length ? outputs.map(output => <OutputRow key={output.id} output={output} renditionMap={renditionMap} busy={busyId === output.id} onToggle={toggle}/>) : <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">{t('streams:outputRack.rack.empty')}</div>}</div>
    {drawer && <BuilderDrawer roomId={roomId} scenes={scenes} capabilities={workspace?.capabilities} onClose={() => setDrawer(false)} onCreated={onChanged}/>}
  </section>;
}
