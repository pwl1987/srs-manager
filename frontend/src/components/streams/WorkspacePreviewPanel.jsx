import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import flvjs from 'flv.js';
import { Pause, Play, Radio } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { btnSecondary } from '../ui/styles';

function rmsDb(analyser) {
  if (!analyser) return -60;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const value of data) sum += value * value;
  const rms = Math.sqrt(sum / Math.max(1, data.length));
  if (!Number.isFinite(rms) || rms <= 0.001) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(rms)));
}

function LevelBar({ channel, value }) {
  const width = Math.max(0, Math.min(100, ((value + 60) / 60) * 100));
  return (
    <div className="grid grid-cols-[14px_minmax(0,1fr)_48px] items-center gap-2">
      <span className="text-[9px] font-semibold text-[var(--text-faint)]">{channel}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--success)_0_72%,var(--warning)_72%_90%,var(--destructive)_90%)] transition-[width] duration-100" style={{ width: `${width}%` }} />
      </div>
      <span className="text-right font-mono text-[9px] tabular-nums text-[var(--muted-foreground)]">{value.toFixed(1)} dB</span>
    </div>
  );
}

export default function WorkspacePreviewPanel({ stream, observed, t }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const flvRef = useRef(null);
  const audioRef = useRef({ context: null, source: null, splitter: null, left: null, right: null, silent: null, frame: null, last: 0 });
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [previewSources, setPreviewSources] = useState({ httpFlv: '', hls: '' });
  const [transport, setTransport] = useState('http-flv');
  const [levels, setLevels] = useState({ left: -60, right: -60 });
  const [meterAvailable, setMeterAvailable] = useState(true);
  const [error, setError] = useState('');

  function stopMeter() {
    const audio = audioRef.current;
    if (audio.frame) cancelAnimationFrame(audio.frame);
    audio.frame = null;
    setLevels({ left: -60, right: -60 });
  }

  function startMeter() {
    const audio = audioRef.current;
    stopMeter();
    const tick = timestamp => {
      if (timestamp - audio.last >= 100) {
        audio.last = timestamp;
        setLevels({ left: rmsDb(audio.left), right: rmsDb(audio.right) });
      }
      audio.frame = requestAnimationFrame(tick);
    };
    audio.frame = requestAnimationFrame(tick);
  }

  async function ensureAudioGraph(video) {
    const audio = audioRef.current;
    if (!audio.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) { setMeterAvailable(false); return false; }
      const context = new AudioContextCtor();
      const mediaSource = context.createMediaElementSource(video);
      const splitter = context.createChannelSplitter(2);
      const left = context.createAnalyser();
      const right = context.createAnalyser();
      const silent = context.createGain();
      left.fftSize = 256; right.fftSize = 256;
      left.smoothingTimeConstant = 0.72; right.smoothingTimeConstant = 0.72;
      silent.gain.value = 0;
      mediaSource.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
      mediaSource.connect(silent); silent.connect(context.destination);
      Object.assign(audio, { context, source: mediaSource, splitter, left, right, silent });
    }
    await audio.context.resume().catch(() => {});
    startMeter();
    return true;
  }

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio.frame) cancelAnimationFrame(audio.frame);
    if (audio.context) audio.context.close().catch(() => {});
  }, []);

  useEffect(() => {
    if (!playing || (!previewSources.httpFlv && !previewSources.hls)) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    setError('');
    let hls = null;
    let flv = null;
    let cancelled = false;

    const attachHls = async () => {
      if (!previewSources.hls || cancelled) { setError(t('streams:preview.notSupported')); return; }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = previewSources.hls;
      } else if (Hls.isSupported()) {
        hls = new Hls({ liveSyncDurationCount: 3, maxLiveSyncPlaybackRate: 1.5 });
        hlsRef.current = hls;
        hls.loadSource(previewSources.hls);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError(t('streams:preview.error')); });
      } else {
        setError(t('streams:preview.notSupported'));
        return;
      }
      video.play().catch(() => setError(t('streams:preview.error')));
    };

    const attach = async () => {
      await ensureAudioGraph(video);
      if (transport === 'http-flv' && previewSources.httpFlv && flvjs.isSupported()) {
        flv = flvjs.createPlayer({ type: 'flv', isLive: true, url: previewSources.httpFlv }, { enableWorker: true, enableStashBuffer: false, lazyLoad: false });
        flvRef.current = flv;
        flv.attachMediaElement(video);
        flv.load();
        flv.on(flvjs.Events.ERROR, () => {
          if (!cancelled && previewSources.hls) setTransport('hls');
          else if (!cancelled) setError(t('streams:preview.error'));
        });
        flv.play().catch(() => {
          if (!cancelled && previewSources.hls) setTransport('hls');
          else if (!cancelled) setError(t('streams:preview.error'));
        });
        return;
      }
      if (transport === 'http-flv' && previewSources.hls) setTransport('hls');
      else await attachHls();
    };
    attach();

    return () => {
      cancelled = true;
      stopMeter();
      audioRef.current.context?.suspend().catch(() => {});
      if (flv) { try { flv.pause(); flv.unload(); flv.detachMediaElement(); flv.destroy(); } catch {} }
      if (hls) hls.destroy();
      flvRef.current = null; hlsRef.current = null;
      video.pause(); video.removeAttribute('src'); video.load();
    };
  }, [playing, previewSources, transport, t]);

  async function startPreview() {
    if (observed?.online !== true || starting) return;
    setStarting(true); setError('');
    try {
      if (videoRef.current) await ensureAudioGraph(videoRef.current);
      const access = await api.post(`/streams/${stream.id}/preview-access`);
      const hls = access?.preview_urls?.hls || access?.preview_url || '';
      const httpFlv = access?.preview_urls?.http_flv || '';
      if (!hls && !httpFlv) throw new Error('Preview URL missing');
      setPreviewSources({ httpFlv, hls });
      setTransport(access?.preferred_transport === 'http-flv' && httpFlv ? 'http-flv' : 'hls');
      setPlaying(true);
    } catch {
      setError(t('streams:preview.accessError')); setPlaying(false);
    } finally { setStarting(false); }
  }

  function stopPreview() { setPlaying(false); setPreviewSources({ httpFlv: '', hls: '' }); setTransport('http-flv'); }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] shadow-[var(--shadow-panel)]">
      <div className="relative aspect-video bg-[oklch(0.22_0.006_258)]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} crossOrigin="anonymous" controls={playing} className="h-full w-full object-contain" />
        {!playing && <button type="button" onClick={startPreview} disabled={observed?.online !== true || starting} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(180deg,transparent,oklch(0.18_0.006_258/0.46))] text-[var(--foreground)] disabled:cursor-not-allowed">
          <span className={cn('flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm', observed?.online === true ? 'border-[var(--primary)]/35 bg-[var(--primary)]/16 text-[var(--primary)]' : 'border-[var(--border)] bg-[var(--secondary)] text-[var(--text-faint)]')}><Play size={18} fill="currentColor" /></span>
          <span className="text-xs font-medium text-[var(--foreground)]">{starting ? t('streams:workspace.console.startingPreview') : observed?.online === true ? '本地预览未开启' : t('streams:workspace.console.waitingSignal')}</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">{observed?.online === true ? '开启后只在本机核看，不代表远端已验证' : '没有节目输入时无法开启预览'}</span>
        </button>}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold backdrop-blur-md', observed?.online === true ? 'border-[var(--success)]/25 bg-[var(--success-soft)]/85 text-[var(--success)]' : 'border-[var(--border)] bg-[var(--secondary)]/85 text-[var(--muted-foreground)]')}><Radio size={11} />{observed?.online === true ? '正在播出' : '未播出'}</span>
          <span className="rounded-md border border-[var(--border-soft)] bg-[var(--background)]/78 px-2 py-1 text-[10px] text-[var(--muted-foreground)] backdrop-blur-md">{t('streams:workspace.console.localPreview')}</span>
          {playing && <span className="rounded-md border border-[var(--primary)]/20 bg-[var(--background)]/78 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--primary)] backdrop-blur-md">{transport === 'http-flv' ? 'HTTP-FLV' : 'HLS FALLBACK'}</span>}
        </div>
      </div>
      <div className="grid gap-3 border-t border-[var(--border-soft)] px-3.5 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)_auto] lg:items-center">
        <div className="min-w-0"><div className="truncate text-[10px] text-[var(--muted-foreground)]">{t('streams:workspace.console.secureProxy')}</div>{error && <div className="mt-0.5 text-[10px] text-[var(--destructive)]">{error}</div>}</div>
        <div className="space-y-1.5 rounded-lg bg-[var(--background)]/28 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 text-[9px] text-[var(--text-faint)]"><span>{t('streams:workspace.console.meter')}</span><span>{meterAvailable ? t('streams:workspace.console.meterHint') : t('streams:workspace.console.meterUnavailable')}</span></div>
          <LevelBar channel="L" value={levels.left} /><LevelBar channel="R" value={levels.right} />
        </div>
        {playing && <button type="button" className={btnSecondary} onClick={stopPreview}><Pause size={13} />{t('streams:workspace.console.pausePreview')}</button>}
      </div>
    </div>
  );
}
