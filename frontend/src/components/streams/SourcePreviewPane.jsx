import React, { useEffect, useRef, useState } from 'react';
import flvjs from 'flv.js';
import { Eye, X } from 'lucide-react';
import { btnGhost } from '../ui/styles';

export default function SourcePreviewPane({ preview, onClose }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !preview?.preview_url) return undefined;
    if (!flvjs.isSupported()) {
      setError('当前浏览器不支持 HTTP-FLV 预监');
      return undefined;
    }
    const player = flvjs.createPlayer({ type: 'flv', isLive: true, url: preview.preview_url }, {
      enableWorker: true, enableStashBuffer: false, lazyLoad: false
    });
    playerRef.current = player;
    player.attachMediaElement(video);
    player.load();
    player.on(flvjs.Events.ERROR, () => setError('备用源预监连接失败'));
    player.play().catch(() => {});
    return () => {
      try { player.pause(); player.unload(); player.detachMediaElement(); player.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [preview?.preview_url]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--primary)]/25 bg-[var(--card)] shadow-[var(--shadow-panel)]">
      <div className="flex h-10 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--primary)]/6 px-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-[var(--primary)]"><Eye size={12} />备用源预监 · 不切换节目</div>
          <div className="truncate text-[10px] text-[var(--muted-foreground)]">{preview?.source_name || preview?.source_id}</div>
        </div>
        <button type="button" className={btnGhost} onClick={onClose} title="关闭预监"><X size={13} /></button>
      </div>
      <div className="relative aspect-video bg-[oklch(0.19_0.006_258)]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls className="h-full w-full object-contain" />
        {error && <div className="absolute inset-x-3 bottom-3 rounded-md bg-[var(--destructive)]/85 px-2 py-1.5 text-[10px] text-white">{error}</div>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-soft)] px-3 py-2 text-[9px] text-[var(--text-faint)]">
        <span>HTTP-FLV · 临时按需预监</span>
        <span>关闭后停止临时预监任务</span>
      </div>
    </div>
  );
}
