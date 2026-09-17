import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import Hls from 'hls.js';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { formatBitrateKbps, formatDuration, formatDateTime } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import { displayUrl, resolvePullHls, resolvePullFlv } from '../lib/stream-url-display';
import DistributionSection from './StreamsDistribution';
import PageHeader from '../components/ui/PageHeader';
import TableShell from '../components/ui/TableShell';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import { TableSkeleton } from '../components/ui/Skeleton';
import SearchInput from '../components/ui/SearchInput';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { inputClass, labelClass, btnPrimary, btnSecondary, btnGhost, thClass, tdClass } from '../components/ui/styles';
import { Radio, Plus, Edit, Trash2, Copy, X, StopCircle, Play, QrCode, ChevronDown, ChevronRight, AlertTriangle, FlaskConical, Film } from 'lucide-react';

function PreviewModal({ stream, onClose, t }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const source = resolvePullHls(stream);
  const isPlaceholder = !source;

  useEffect(() => {
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
          <video ref={videoRef} controls autoPlay muted className="w-full rounded bg-black aspect-video" />
          <p className="text-xs text-[var(--muted-foreground)] mt-2 break-all font-mono">{source}</p>
        </>
      )}
    </Modal>
  );
}

function QrModal({ stream, onClose, t, onCopy }) {
  const [dataUrl, setDataUrl] = useState('');
  const qrSource = resolvePullHls(stream);

  useEffect(() => {
    if (!qrSource) return;
    QRCode.toDataURL(qrSource, { width: 256, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(''));
  }, [qrSource]);

  return (
    <Modal
      open={Boolean(stream)}
      onClose={onClose}
      title={t('streams:actions.qrcode')}
      size="sm"
      footer={<button className={btnSecondary} onClick={() => onCopy(qrSource)}><Copy size={14} />{t('common:actions.copy')}</button>}
    >
      <div className="flex flex-col items-center gap-3">
        {dataUrl ? (
          <img src={dataUrl} alt="QR" className="rounded bg-white p-2" width={256} height={256} />
        ) : (
          <div className="w-64 h-64 animate-pulse bg-[var(--secondary)] rounded" />
        )}
        <p className="text-xs text-[var(--muted-foreground)] break-all font-mono text-center">{qrSource}</p>
      </div>
    </Modal>
  );
}

function UrlRow({ label, url, t, onCopy }) {
  if (!url) return null;
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="text-xs text-[var(--muted-foreground)] shrink-0 w-24">{label}</span>
      <code className="text-xs bg-[var(--muted)] px-2 py-1.5 rounded flex-1 min-w-0 break-all font-mono">{url}</code>
      <button onClick={() => onCopy(url)} className={cn(btnGhost, 'shrink-0')} title={t('common:actions.copy')}>
        <Copy size={14} />
      </button>
    </div>
  );
}

export default function Streams() {
  const { t } = useTranslation(['streams', 'common']);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', protocol: 'rtmp', transcode_template_id: '' });
  const [formError, setFormError] = useState('');
  const [previewStream, setPreviewStream] = useState(null);
  const [qrStream, setQrStream] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [stopTarget, setStopTarget] = useState(null);
  const [working, setWorking] = useState(false);
  const [externalLive, setExternalLive] = useState([]);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    api.get('/transcode-templates').then(setTemplates).catch(() => {});
  }, []);

  async function loadStreams(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const [list, external] = await Promise.all([
        api.get('/streams'),
        api.get('/streams/external-live').catch(() => [])
      ]);
      setStreams(list);
      setExternalLive(Array.isArray(external) ? external : []);
    } catch (err) {
      setError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  usePolling(() => loadStreams(true), 10000);

  const filtered = search
    ? streams.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : streams;

  function openCreate() {
    setEditing(null);
    setForm({ name: '', protocol: 'rtmp', transcode_template_id: '' });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(stream) {
    setEditing(stream);
    setForm({ name: stream.name, protocol: stream.protocol, transcode_template_id: stream.transcode_template_id || '' });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    try {
      if (editing) {
        await api.put(`/streams/${editing.id}`, form);
      } else {
        await api.post('/streams', form);
      }
      setShowModal(false);
      toast.success(t(editing ? 'common:toasts.updated' : 'common:toasts.created'));
      loadStreams(true);
    } catch (err) {
      setFormError(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  async function handleCopy(url) {
    try {
      await copyText(url);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      await api.delete(`/streams/${deleteTarget.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTarget(null);
      loadStreams(true);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function confirmStop() {
    if (!stopTarget) return;
    setWorking(true);
    try {
      const result = await api.post(`/streams/${stopTarget.id}/stop`);
      toast.success(t('common:toasts.stopped') + (result?.kicked ? ` (${result.kicked})` : ''));
      setStopTarget(null);
      loadStreams(true);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function registerExternal(name) {
    setWorking(true);
    try {
      await api.post('/streams', { name, protocol: 'rtmp' });
      toast.success(t('common:toasts.created'));
      loadStreams(true);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('streams:title')}
        subtitle={t('streams:subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button className={btnPrimary} onClick={openCreate}>
              <Plus size={16} /> {t('common:actions.create')}
            </button>
          </>
        }
      />

      {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => loadStreams()} />}

      {externalLive.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-500 mb-2">
            <AlertTriangle size={16} className="shrink-0" />
            {t('streams:external.title')}
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mb-2">{t('streams:external.hint')}</p>
          <div className="space-y-1.5">
            {externalLive.map(x => (
              <div key={x.name} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse shrink-0" />
                  <span className="font-mono font-medium truncate">{x.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                    {x.publish_ip || '-'} · {formatBitrateKbps(x.kbps)}
                  </span>
                </div>
                <button
                  className={cn(btnSecondary, 'shrink-0 text-xs')}
                  disabled={working}
                  onClick={() => registerExternal(x.name)}
                >
                  {t('streams:external.register')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <EmptyState
            title={search ? t('common:page.emptyTitle') : t('streams:empty.title')}
            description={search ? undefined : t('streams:empty.description')}
            action={search ? undefined : (
              <button className={btnPrimary} onClick={openCreate}>{t('streams:empty.createButton')}</button>
            )}
          />
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b">
              <th className={thClass}></th>
              <th className={thClass}>{t('streams:columns.name')}</th>
              <th className={thClass}>{t('streams:columns.status')}</th>
              <th className={thClass}>{t('streams:columns.viewers')}</th>
              <th className={thClass}>{t('streams:columns.bitrate')}</th>
              <th className={thClass}>{t('streams:columns.uptime')}</th>
              <th className={thClass}>{t('streams:columns.createdAt')}</th>
              <th className={`${thClass} text-right`}>{t('streams:columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(s => (
              <React.Fragment key={s.id}>
                <tr className="hover:bg-[var(--surface-hover)] transition-colors">
                  <td className={tdClass}>
                    <button
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      title={t('streams:actions.expand')}
                    >
                      {expandedId === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className={tdClass}>
                    <span className="flex items-center gap-2">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', s.status === 'online' ? 'bg-[var(--success)]' : 'bg-[var(--border)]')} />
                      <span className="font-medium">{s.name}</span>
                      {s.transcode_template_name && (
                        <span
                          className="hidden md:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] whitespace-nowrap"
                          title={t('streams:transcode.badge', { name: s.transcode_template_name })}
                        >
                          <Film size={10} />
                          {s.transcode_template_name}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span className={cn('text-xs px-2 py-1 rounded whitespace-nowrap',
                      s.status === 'online' ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]')}>
                      {t(`streams:status.${s.status}`, s.status)}
                    </span>
                  </td>
                  <td className={tdClass}>{s.viewers || 0}</td>
                  <td className={tdClass}>{s.status === 'online' ? formatBitrateKbps(s.bitrate) : '-'}</td>
                  <td className={tdClass}>{s.uptime_seconds ? formatDuration(s.uptime_seconds) : '-'}</td>
                  <td className={`${tdClass} whitespace-nowrap text-[var(--muted-foreground)]`}>{formatDateTime(s.created_at)}</td>
                  <td className={tdClass}>
                    <div className="flex items-center justify-end gap-0.5">
                      <button className={btnGhost} onClick={() => setPreviewStream(s)} title={t('streams:actions.preview')}><Play size={14} /></button>
                      <button className={btnGhost} onClick={() => setQrStream(s)} title={t('streams:actions.qrcode')}><QrCode size={14} /></button>
                      {s.status === 'online' && (
                        <button
                          className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                          onClick={() => setStopTarget(s)}
                          title={t('streams:actions.stopStream')}
                        >
                          <StopCircle size={14} />
                        </button>
                      )}
                      <button className={btnGhost} onClick={() => openEdit(s)} title={t('streams:actions.edit')}><Edit size={14} /></button>
                      <button
                        className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                        onClick={() => setDeleteTarget(s)}
                        title={t('streams:actions.delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr className="bg-[var(--muted)]/30">
                    <td></td>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="space-y-2">
                        <UrlRow label={`${t('streams:info.pushAddress')} (RTMP)`} url={displayUrl(s.push_url)} t={t} onCopy={handleCopy} />
                        {s.cdn_configured === false ? (
                          <>
                            <UrlRow label={`${t('streams:info.pullAddress')} (HLS)`} url={resolvePullHls(s)} t={t} onCopy={handleCopy} />
                            <UrlRow label={`${t('streams:info.pullAddress')} (${t('streams:info.flv')})`} url={resolvePullFlv(s)} t={t} onCopy={handleCopy} />
                            <UrlRow label={`${t('streams:info.pullAddress')} (RTMP)`} url={displayUrl(s.push_url)} t={t} onCopy={handleCopy} />
                            <p className="text-xs text-amber-500 flex items-center gap-1.5 pt-1">
                              <FlaskConical size={12} />
                              {t('streams:info.testModeNote')}
                            </p>
                          </>
                        ) : (
                          <>
                            <UrlRow label={`${t('streams:info.pullAddress')} (HLS)`} url={s.pull_url_hls} t={t} onCopy={handleCopy} />
                            <UrlRow label={`${t('streams:info.pullAddress')} (${t('streams:info.flv')})`} url={resolvePullFlv(s)} t={t} onCopy={handleCopy} />
                            <UrlRow label={`${t('streams:info.pullAddress')} (RTMP)`} url={s.pull_url_rtmp} t={t} onCopy={handleCopy} />
                          </>
                        )}
                        <DistributionSection stream={s} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('streams:modal.edit') : t('streams:modal.create')}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="stream-form" type="submit">
              {editing ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="stream-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>{t('streams:modal.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder={t('streams:modal.namePlaceholder')}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>{t('streams:modal.protocol')}</label>
            <select
              value={form.protocol}
              onChange={e => setForm({ ...form, protocol: e.target.value })}
              className={inputClass}
            >
              <option value="rtmp">RTMP</option>
              <option value="rtsp">RTSP</option>
              <option value="hls">HLS</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('streams:transcode.label')}</label>
            <select
              value={form.transcode_template_id}
              onChange={e => setForm({ ...form, transcode_template_id: e.target.value })}
              className={inputClass}
            >
              <option value="">{t('streams:transcode.none')}</option>
              {templates.map(tpl => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}（{tpl.vcodec}/{tpl.acodec}）</option>
              ))}
            </select>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">{t('streams:transcode.note')}</p>
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      <PreviewModal stream={previewStream} onClose={() => setPreviewStream(null)} t={t} />
      <QrModal stream={qrStream} onClose={() => setQrStream(null)} t={t} onCopy={handleCopy} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTarget?.name || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
      <ConfirmDialog
        open={Boolean(stopTarget)}
        onClose={() => setStopTarget(null)}
        onConfirm={confirmStop}
        confirming={working}
        title={t('common:confirm.stopStream.title', { name: stopTarget?.name || '' })}
        description={t('common:confirm.stopStream.description', { viewers: stopTarget?.viewers || 0 })}
        confirmLabel={t('common:confirm.stopStream.confirm')}
      />
    </div>
  );
}
