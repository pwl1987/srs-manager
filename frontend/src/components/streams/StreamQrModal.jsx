import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy } from 'lucide-react';
import { resolvePullHls } from '../../lib/stream-url-display';
import Modal from '../ui/Modal';
import { btnSecondary } from '../ui/styles';

export default function StreamQrModal({ stream, onClose, t, onCopy }) {
  const [dataUrl, setDataUrl] = useState('');
  const source = resolvePullHls(stream);

  useEffect(() => {
    setDataUrl('');
    if (!source) return;
    QRCode.toDataURL(source, { width: 256, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(''));
  }, [source]);

  return (
    <Modal
      open={Boolean(stream)}
      onClose={onClose}
      title={t('streams:actions.qrcode')}
      size="sm"
      footer={source ? (
        <button className={btnSecondary} onClick={() => onCopy(source)}>
          <Copy size={14} />
          {t('common:actions.copy')}
        </button>
      ) : null}
    >
      {source ? (
        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            <img src={dataUrl} alt="QR" className="rounded-xl bg-white p-2" width={256} height={256} />
          ) : (
            <div className="w-64 h-64 animate-pulse bg-[var(--secondary)] rounded-xl" />
          )}
          <p className="text-xs text-[var(--muted-foreground)] break-all font-mono text-center">{source}</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">{t('streams:preview.placeholder')}</p>
      )}
    </Modal>
  );
}
