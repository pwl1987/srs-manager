import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Pause, Play, Radio } from 'lucide-react';
import { resolvePullHls } from '../../lib/stream-url-display';
import { cn } from '../../lib/utils';
import { btnSecondary } from '../ui/styles';

export default function WorkspacePreviewPanel({ stream, observed, t }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const source = resolvePullHls(stream);

  useEffect(() => {
    if (!playing || !source) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    setError('');
    let hls = null;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
    } else if (Hls.isSupported()) {
      hls = new Hls({ liveSyncDurationCount: 3, maxLiveSyncPlaybackRate: 1.5 });
      hlsRef.current = hls;
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(t('streams:preview.error'));
      });
    } else {
      setError(t('streams:preview.notSupported'));
      setPlaying(false);
      return undefined;
    }

    video.play().catch(() => setPlaying(false));
    return () => {
      if (hls) hls.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [playing, source, t]);

  function toggle() {
    if (!source || observed?.online !== true) return;
    setPlaying(value => !value);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] shadow-[var(--shadow-panel)]">
      <div className="relative aspect-video bg-[oklch(0.12_0.006_258)]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} muted controls={playing} className="h-full w-full object-contain" />
        {!playing && (
          <button
            type="button"
            onClick={toggle}
            disabled={!source || observed?.online !== true}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[linear-gradient(180deg,transparent,oklch(0.11_0.006_258/0.52))] text-[var(--foreground)] disabled:cursor-not-allowed"
          >
            <span className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-sm',
              observed?.online === true
                ? 'border-[var(--primary)]/35 bg-[var(--primary)]/16 text-[var(--primary)]'
                : 'border-[var(--border)] bg-[var(--secondary)] text-[var(--text-faint)]'
            )}>
              <Play size={20} fill="currentColor" />
            </span>
            <span className="text-xs text-[var(--muted-foreground)]">
              {observed?.online === true ? t('streams:workspace.console.startPreview') : t('streams:workspace.console.waitingSignal')}
            </span>
          </button>
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold backdrop-blur-md',
            observed?.online === true
              ? 'border-[var(--success)]/25 bg-[var(--success-soft)]/85 text-[var(--success)]'
              : 'border-[var(--border)] bg-[var(--secondary)]/85 text-[var(--muted-foreground)]'
          )}>
            <Radio size={11} />{observed?.online === true ? 'ON AIR' : 'IDLE'}
          </span>
          <span className="rounded-md border border-white/10 bg-black/35 px-2 py-1 text-[10px] text-white/70 backdrop-blur-md">
            {t('streams:workspace.console.localPreview')}
          </span>
        </div>
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3 border-t border-[var(--border-soft)] px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="truncate font-mono text-[10px] text-[var(--muted-foreground)]" title={source || undefined}>{source || t('streams:workspace.console.noPreviewEndpoint')}</div>
          {error && <div className="mt-0.5 text-[10px] text-[var(--destructive)]">{error}</div>}
        </div>
        {playing && (
          <button type="button" className={btnSecondary} onClick={() => setPlaying(false)}>
            <Pause size={13} />{t('streams:workspace.console.pausePreview')}
          </button>
        )}
      </div>
    </div>
  );
}
