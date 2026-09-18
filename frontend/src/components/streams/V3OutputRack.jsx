import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Layers3, Plus, Radio, Server, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { btnDangerGhost, btnGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';

const SCENE_LABELS = {
  LIVE_PLATFORM_PUSH: '推到直播平台',
  CDN_PUSH: '推到 CDN',
  SRT_NODE: 'SRT 专线节点',
  CDN_ORIGIN: '作为 CDN 回源',
  PARTNER_PULL: '合作方拉流',
  PLAYBACK_ACCESS: '播放访问',
  LOCAL_RECORD: '本地录制',
  PROFESSIONAL: '专业自定义'
};

function opKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const MODE_LABELS = { PUSH: '主动推送', SERVE: '播放服务', RECORD: '本地录制' };
const STATUS_LABELS = {
  FAILED: '启动失败',
  STALLED: '已停滞',
  RETRYING: '重试中',
  STARTING: '启动中',
  STOPPING: '停止中',
  WAITING_INPUT: '等待输入',
  FINALIZING: '整理文件',
  RUNNING: '运行中',
  AVAILABLE: '可播放',
  ACTIVE: '进行中',
  RECORDING: '录制中',
  COMPLETE: '已完成',
  STOPPED: '已停止',
  UNKNOWN: '待确认'
};

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
  return { raw, label: failedIntent ? '启动失败 · 可重试' : STATUS_LABELS[raw] || raw, tone, dot, retry: failedIntent };
}

function mediaLabel(output, renditionMap) {
  const r = renditionMap.get(output.media_ref);
  if (!r) return '节目原始码流';
  if (r.kind === 'PASSTHROUGH') return '节目原始码流';
  return r.media_profile_id?.replace('media-profile:', '媒体规格 ') || '共享媒体规格';
}

export function Evidence({ output }) {
  const local = output.evidence?.local || {};
  const remote = output.evidence?.remote || {};
  return <div className="mt-2 grid gap-2 border-t border-[var(--border-soft)] pt-2 text-[10px] md:grid-cols-2">
    <div className="rounded-lg bg-[var(--background)]/28 p-2.5">
      <div className="font-semibold tracking-[.1em] text-[var(--text-faint)]">本地证据</div>
      <div className="mt-1.5 text-[var(--muted-foreground)]">{STATUS_LABELS[local.state] || local.state || '待确认'} · {local.source || '—'}</div>
      <div className="mt-1 text-[var(--text-faint)]">{local.freshness || '待确认'}{local.observed_at ? ` · ${local.observed_at}` : ''}</div>
    </div>
    <div className="rounded-lg bg-[var(--background)]/28 p-2.5">
      <div className="font-semibold tracking-[.1em] text-[var(--text-faint)]">远端证据</div>
      <div className="mt-1.5 text-[var(--muted-foreground)]">{STATUS_LABELS[remote.state] || remote.state || '待确认'} · {remote.source || '尚未接入远端验证'}</div>
      <div className="mt-1 text-[var(--text-faint)]">{remote.freshness || '待确认'}</div>
    </div>
  </div>;
}

export function OutputRow({ output, renditionMap, busy, onToggle }) {
  const [open, setOpen] = useState(false);
  const meta = stateMeta(output);
  const runtime = String(output.runtime_state || '').toUpperCase();
  const wantsRunning = String(output.desired_state || '').toUpperCase() === 'RUNNING' || (output.mode === 'SERVE' && runtime === 'AVAILABLE');
  const action = meta.retry ? 'start' : wantsRunning ? 'stop' : 'start';
  const actionLabel = meta.retry ? '重试' : wantsRunning ? '停止' : '启动';
  const canControl = output.control_mode !== 'LEGACY_UNMANAGED';
  return <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/20 px-3 py-2.5">
    <div className="flex items-center gap-2">
      <button className={btnGhost} onClick={() => setOpen(v => !v)} aria-label="展开运行证据">{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-semibold">{output.name}</span><span className="text-[9px] font-semibold tracking-[.04em] text-[var(--text-faint)]">{MODE_LABELS[output.mode] || output.mode}</span></div>
        <div className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{mediaLabel(output, renditionMap)} · {output.transport || output.format || output.endpoints?.filter(x => x.advertised !== false).map(x => x.transport).join('/') || '—'}{output.scene ? ` · ${SCENE_LABELS[output.scene] || output.scene}` : ''}</div>
      </div>
      <div className={`w-24 text-right text-[9px] font-semibold ${meta.tone}`}>{meta.label}</div>
      {canControl && <button className={wantsRunning && !meta.retry ? btnDangerGhost : btnSecondary} disabled={busy} onClick={() => onToggle(output, action)}>
        {wantsRunning && !meta.retry ? <Square size={12}/> : <Radio size={12}/>} {actionLabel}
      </button>}
    </div>
    {output.mode === 'RECORD' && <div className="mt-2 flex flex-wrap gap-1.5 pl-10 text-[9px] text-[var(--muted-foreground)]"><span className="rounded-md border border-[var(--border-soft)] px-2 py-1">{output.format?.toUpperCase()} · {output.asset?.state || 'NO ASSET'}</span>{output.asset?.size_bytes > 0 && <span className="rounded-md border border-[var(--border-soft)] px-2 py-1">{(output.asset.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}{output.asset?.duration_seconds != null && <span className="rounded-md border border-[var(--border-soft)] px-2 py-1">{Math.round(output.asset.duration_seconds)} s</span>}</div>}
    {output.mode === 'SERVE' && <div className="mt-2 flex flex-wrap gap-1.5 pl-10">{(output.endpoints || []).map(ep => <span key={ep.transport} className={`rounded-md border px-2 py-1 text-[9px] ${ep.advertised === false ? 'border-[var(--border-soft)] text-[var(--text-faint)]' : 'border-[var(--primary)]/15 bg-[var(--primary)]/5 text-[var(--muted-foreground)]'}`}>{ep.transport.toUpperCase()} · {ep.protection || 'none'}{ep.advertised === false ? ' · not advertised' : ''}</span>)}</div>}
    {open && <Evidence output={output}/>}
  </div>;
}

function BuilderDrawer({ roomId, scenes, capabilities, onClose, onCreated }) {
  const [builderMode, setBuilderMode] = useState('scene');
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
  const [compatibility, setCompatibility] = useState(null);
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
    const next = scenes.find(x => x.id === nextId);
    setSceneId(nextId);
    if (!next) return;
    setMode(next.mode || 'PUSH');
    setTransport(next.default_transport || next.transports?.[0] || 'rtmp');
    setProtection(next.default_protection || 'none');
    if (next.default_format) setRecordFormat(next.default_format);
  }

  async function save() {
    const effectiveMode = builderMode === 'scene' ? (scene?.mode || mode) : mode;
    if (!name.trim()) return toast.error('请填写输出名称');
    setSaving(true);
    try {
      let payload;
      if (effectiveMode === 'PUSH') {
        if (!targetUrl.trim()) throw new Error('PUSH 输出必须填写目标地址');
        payload = {
          mode: 'PUSH', name: name.trim(), scene: builderMode === 'scene' ? sceneId : 'PROFESSIONAL', transport,
          protection, processing: processing === 'RENDITION' ? { mode: 'RENDITION', template_id: Number(templateId) } : { mode: 'PASSTHROUGH' },
          destination: { kind: 'CUSTOM', label: name.trim(), target_url: targetUrl.trim() }
        };
      } else if (effectiveMode === 'RECORD') {
        payload = {
          mode: 'RECORD', name: name.trim(), scene: builderMode === 'scene' ? sceneId : 'PROFESSIONAL',
          format: recordFormat, protection: 'storage-policy',
          processing: processing === 'RENDITION' ? { mode: 'RENDITION', template_id: Number(templateId) } : { mode: 'PASSTHROUGH' },
          storage: { subdir: recordSubdir.trim(), filename_prefix: name.trim(), segment_seconds: Number(segmentSeconds || 6) }
        };
        if (recordFormat === 'audio') payload.audio_format = 'aac';
      } else {
        payload = {
          mode: 'SERVE', name: name.trim(), scene: builderMode === 'scene' ? sceneId : 'PROFESSIONAL',
          transports: builderMode === 'scene' ? scene?.transports : [transport], consumer: { label: name.trim() }
        };
        if (builderMode === 'pro') payload.endpoint_protections = { [transport]: protection };
      }
      await api.post(`/v3/rooms/${roomId}/outputs`, payload);
      toast.success('输出已保存，默认不会自动启动');
      onCreated();
      onClose();
    } catch (error) { toast.error(error.message || '创建输出失败'); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={onClose}>
    <aside className="h-full w-full max-w-[620px] overflow-y-auto border-l border-[var(--border)] bg-[var(--card)] shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--card)] px-5 py-4"><div><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">OUTPUT BUILDER</div><h3 className="mt-1 text-base font-semibold">创建输出</h3></div><button className={btnGhost} onClick={onClose}><X size={15}/></button></div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/30 p-1"><button className={builderMode === 'scene' ? btnPrimary : btnGhost} onClick={() => setBuilderMode('scene')}>场景模式</button><button className={builderMode === 'pro' ? btnPrimary : btnGhost} onClick={() => { setBuilderMode('pro'); ensureTemplates(); }}>专业模式</button></div>
        {builderMode === 'scene' && <div><label className={labelClass}>我要做什么</label><div className="grid grid-cols-2 gap-2">{scenes.filter(x => x.id !== 'PROFESSIONAL').map(item => <button key={item.id} onClick={() => { chooseScene(item.id); ensureTemplates(); }} className={`rounded-xl border p-3 text-left text-xs ${sceneId === item.id ? 'border-[var(--primary)]/40 bg-[var(--primary)]/8' : 'border-[var(--border-soft)] bg-[var(--background)]/20 hover:border-[var(--primary)]/25'}`}><div className="font-semibold">{SCENE_LABELS[item.id] || item.id}</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{item.mode} · {(item.transports || item.formats || []).join(' / ')}</div></button>)}</div></div>}
        <div><label className={labelClass}>输出名称</label><input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="例如：视频号 / 网宿 CDN / 合作方 A" /></div>
        {builderMode === 'pro' && <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Mode</label><select className={inputClass} value={mode} onChange={e => { setMode(e.target.value); if (e.target.value === 'RECORD') setProtection('storage-policy'); }}><option>PUSH</option><option>SERVE</option><option>RECORD</option></select></div><div><label className={labelClass}>{mode === 'RECORD' ? 'Format' : 'Transport'}</label>{mode === 'RECORD' ? <select className={inputClass} value={recordFormat} onChange={e => setRecordFormat(e.target.value)}><option value="mp4">MP4</option><option value="ts">TS</option><option value="audio">Audio</option></select> : <select className={inputClass} value={transport} onChange={e => setTransport(e.target.value)}>{(mode === 'PUSH' ? ['rtmp','rtmps','srt'] : ['rtmp','http-flv','hls']).map(x => <option key={x}>{x}</option>)}</select>}</div></div>}
        {(builderMode === 'pro' || (scene?.mode === 'PUSH')) && mode !== 'RECORD' && <div><label className={labelClass}>Protection</label><select className={inputClass} value={protection} onChange={e => setProtection(e.target.value)}>{(builderMode === 'pro' ? protectionOptions : (scene?.mode === 'PUSH' ? ['none','url-credential','token','timestamp-signature','provider-credential','passphrase'] : ['none'])).map(x => <option key={x}>{x}</option>)}</select></div>}
        {builderMode === 'pro' && compatibility && <div className={`rounded-xl border p-3 text-[10px] leading-5 ${compatibility.valid ? 'border-[var(--success)]/18 bg-[var(--success)]/5 text-[var(--success)]' : 'border-[var(--destructive)]/18 bg-[var(--destructive)]/5 text-[var(--destructive)]'}`}><div className="font-semibold">{compatibility.valid ? '✓ 当前组合可执行' : '× 当前组合不可执行'}</div><div className="mt-1 opacity-80">{compatibility.message || compatibility.reason_code || 'Capability validation'}</div>{compatibility.warnings?.map(w => <div key={w.code} className="mt-1 text-[var(--warning)]">! {w.message}</div>)}</div>}
        {(['PUSH','RECORD'].includes(mode) || ['PUSH','RECORD'].includes(scene?.mode)) && <><div><label className={labelClass}>媒体处理</label><div className="grid grid-cols-2 gap-2"><button className={processing === 'PASSTHROUGH' ? btnPrimary : btnSecondary} onClick={() => setProcessing('PASSTHROUGH')}>Program Original</button><button className={processing === 'RENDITION' ? btnPrimary : btnSecondary} onClick={() => { setProcessing('RENDITION'); ensureTemplates(); }}>共享 Rendition</button></div></div>{processing === 'RENDITION' && <div><label className={labelClass}>媒体规格</label><select className={inputClass} value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">选择媒体规格</option>{templates.filter(x => x.enabled).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">相同实际编码参数会自动复用同一条 Rendition，不重复编码。</p></div>}{(mode === 'PUSH' || scene?.mode === 'PUSH') && <div><label className={labelClass}>目标地址</label><input className={inputClass} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder={transport === 'srt' ? 'srt://host:port?...' : 'rtmp://...'} /></div>}{(mode === 'RECORD' || scene?.mode === 'RECORD') && <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>格式</label><select className={inputClass} value={recordFormat} onChange={e => setRecordFormat(e.target.value)}><option value="mp4">MP4（安全分段后 Finalize）</option><option value="ts">TS</option><option value="audio">Audio AAC</option></select></div><div><label className={labelClass}>分段秒数</label><input className={inputClass} type="number" min="2" max="3600" value={segmentSeconds} onChange={e => setSegmentSeconds(e.target.value)} /></div><div className="col-span-2"><label className={labelClass}>存储子目录（可选）</label><input className={inputClass} value={recordSubdir} onChange={e => setRecordSubdir(e.target.value)} placeholder="例如 news/2026-09" /></div></div>}</>}
        <div className="rounded-xl border border-[var(--primary)]/15 bg-[var(--primary)]/5 p-3 text-[10px] leading-5 text-[var(--muted-foreground)]"><Layers3 size={13} className="mr-1 inline text-[var(--primary)]"/>创建动作只保存配置，不会自动发流。Start 后才进入 Desired → Runtime → Observed 验证。</div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--card)] px-5 py-4"><button className={btnSecondary} onClick={onClose}>取消</button><button className={btnPrimary} disabled={saving || (processing === 'RENDITION' && !templateId) || (recordFormat === 'audio' && processing !== 'RENDITION') || (builderMode === 'pro' && compatibility?.valid === false)} onClick={save}>{saving ? '保存中…' : '保存输出'}</button></div>
    </aside>
  </div>;
}

export default function V3OutputRack({ roomId, workspace, scenes = [], onChanged, embedded = false }) {
  const [drawer, setDrawer] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const renditionMap = useMemo(() => new Map((workspace?.renditions || []).map(r => [r.id, r])), [workspace]);
  const outputs = workspace?.outputs || [];
  const incidents = outputs.filter(o => ['FAILED', 'RETRYING', 'STALLED'].includes(String(o.runtime_state || '').toUpperCase()));
  const running = outputs.filter(o => o.mode === 'SERVE' ? o.runtime_state === 'AVAILABLE' : ['RUNNING', 'RECORDING'].includes(String(o.runtime_state || '').toUpperCase())).length;

  async function toggle(output, action) {
    setBusyId(output.id);
    try {
      await api.post(`/v3/rooms/${roomId}/outputs/${encodeURIComponent(output.id)}/${action}`, {}, { headers: { 'Idempotency-Key': opKey(`${action}-${output.id}`) } });
      toast.success(action === 'start' ? '已提交启动操作' : '已提交停止操作');
      await onChanged();
    } catch (error) { toast.error(error.message || '输出操作失败'); }
    finally { setBusyId(null); }
  }

  return <section className={embedded ? "h-full bg-transparent p-3" : "rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]"}>
    <div className="mb-3 flex items-start justify-between gap-4"><div><div className="text-[10px] font-semibold tracking-[.14em] text-[var(--text-faint)]">输出分发</div><div className="mt-1 text-sm font-semibold">所有输出</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{running} 路运行中 · {incidents.length} 路异常 · {(workspace?.renditions || []).filter(r => r.kind === 'TRANSCODE').length} 个共享规格</div></div><button className={btnPrimary} onClick={() => setDrawer(true)}><Plus size={13}/>新建输出</button></div>
    {incidents.length > 0 && <div className="mb-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning-soft)]/8 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-[var(--warning)]"><AlertTriangle size={13}/>{incidents.length} 个输出需要处理</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">异常只提升对应通道，不影响其他健康输出。</div></div>}
    <div className="space-y-2">{outputs.length ? outputs.map(output => <OutputRow key={output.id} output={output} renditionMap={renditionMap} busy={busyId === output.id} onToggle={toggle}/>) : <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">还没有 V3 Output。使用“新建输出”从场景开始。</div>}</div>
    {drawer && <BuilderDrawer roomId={roomId} scenes={scenes} capabilities={workspace?.capabilities} onClose={() => setDrawer(false)} onCreated={onChanged}/>}
  </section>;
}
