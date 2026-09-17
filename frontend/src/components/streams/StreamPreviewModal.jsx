import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { resolvePullHls } from '../../lib/stream-url-display';
import Modal from '../ui/Modal';

export default function StreamPreviewModal({ stream, onClose, t }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const source = resolvePullHls(stream);
  const isPlaceholder = !source;

  useEffect(() => {
    setError('');
    if (!stream || isPlaceholder) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let hls = null;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(t('streams:preview.error'));
      });
      video.play().catch(() => {});
    } else {
      setError(t('streams:preview.notSupported'));
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [stream, source, isPlaceholder, t]);

  return (
    <Modal open={Boolean(stream)} onClose={onClose} title={t('streams:actions.preview')} size="lg">
      {isPlaceholder ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t('streams:preview.placeholder')}</p>
      ) : (
        <>
          {error && <p className="text-sm text-[var(--destructive)] mb-3">{error}</p>}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} controls autoPlay muted className="w-full rounded-xl bg-black aspect-video" />
          <p className="text-xs text-[var(--muted-foreground)] mt-3 break-all font-mono">{source}</p>
        </>
      )}
    </Modal>
  );
}
