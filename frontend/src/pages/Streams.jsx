import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Activity, AlertTriangle, ArrowUpRight, Clock3, Copy, Edit3,
  Film, Plus, QrCode, Radio, Trash2, Users
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { formatBitrateKbps, formatDuration, formatDateTime } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import { displayUrl } from '../lib/stream-url-display';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import { CardSkeleton } from '../components/ui/Skeleton';
import SearchInput from '../components/ui/SearchInput';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import StreamPreviewModal from '../components/streams/StreamPreviewModal';
import StreamQrModal from '../components/streams/StreamQrModal';
import {
  inputClass, labelClass, btnPrimary, btnSecondary, btnGhost, btnDangerGhost
} from '../components/ui/styles';

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
      <Icon size={13} className="text-[var(--text-faint)]" />
      <span>{label}</span>
      <span className="font-medium text-[var(--foreground)] tabular-nums">{value}</span>
    </div>
  );
}

function StreamCard({ stream, t, onPreview, onQr, onCopy, onEdit, onDelete }) {
  const live = stream.status === 'online';
  return (
    <article className="group rounded-xl border border-[var(--border-soft)] bg-[var(--card)] shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--border)]">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              live ? 'bg-[var(--success)] shadow-[0_0_0_4px_var(--success-soft)]' : 'bg-[var(--text-faint)]'
            )} />
            <Link
              to={`/streams/${stream.id}`}
              className="truncate text-[15px] font-semibold tracking-[-0.01em] hover:text-[var(--primary)]"
            >
              {stream.name}
            </Link>
            <span className={cn(
              'rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
              live ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
            )}>
              {t(`streams:status.${stream.status}`, stream.status)}
            </span>
            <span className="rounded-md border border-[var(--border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
              {stream.protocol || 'rtmp'}
            </span>
            {stream.transcode_template_name && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                <Film size={10} />
                {stream.transcode_template_name}
              </span>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Metric icon={Users} label={t('streams:columns.viewers')} value={stream.viewers || 0} />
            <Metric icon={Activity} label={t('streams:columns.bitrate')} value={live ? formatBitrateKbps(stream.bitrate) : '-'} />
            <Metric icon={Clock3} label={t('streams:columns.uptime')} value={stream.uptime_seconds ? formatDuration(stream.uptime_seconds) : '-'} />
            <span className="text-xs text-[var(--text-faint)]">
              {t('streams:list.created')} {formatDateTime(stream.created_at)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
          <button className={btnGhost} onClick={() => onPreview(stream)} title={t('streams:actions.preview')}>
            <Radio size={14} />
            <span className="hidden xl:inline">{t('streams:actions.preview')}</span>
          </button>
          <button className={btnGhost} onClick={() => onQr(stream)} title={t('streams:actions.qrcode')}>
            <QrCode size={14} />
          </button>
          <button
            className={btnGhost}
            onClick={() => onCopy(displayUrl(stream.push_url))}
            title={t('streams:actions.copyPushUrl')}
          >
            <Copy size={14} />
          </button>
          <Link to={`/streams/${stream.id}`} className={cn(btnSecondary, 'ml-1')}>
            {t('streams:actions.workspace')}
            <ArrowUpRight size={14} />
          </Link>
          <button className={btnGhost} onClick={() => onEdit(stream)} title={t('streams:actions.edit')}>
            <Edit3 size={14} />
          </button>
          <button className={btnDangerGhost} onClick={() => onDelete(stream)} title={t('streams:actions.delete')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function Streams() {
  const { t } = useTranslation(['streams', 'common']);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', protocol: 'rtmp', transcode_template_id: '' });
  const [formError, setFormError] = useState('');
  const [previewStream, setPreviewStream] = useState(null);
  const [qrStream, setQrStream] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
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
      setStreams(Array.isArray(list) ? list : []);
      setExternalLive(Array.isArray(external) ? external : []);
    } catch (err) {
      setError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  usePolling(() => loadStreams(true), 10000);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? streams.filter(stream => stream.name.toLowerCase().includes(q))
    : streams;
  const liveCount = streams.filter(stream => stream.status === 'online').length;

  function openCreate() {
    setEditing(null);
    setForm({ name: '', protocol: 'rtmp', transcode_template_id: '' });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(stream) {
    setEditing(stream);
    setForm({
      name: stream.name,
      protocol: stream.protocol || 'rtmp',
      transcode_template_id: stream.transcode_template_id || ''
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    try {
      if (editing) await api.put(`/streams/${editing.id}`, form);
      else await api.post('/streams', form);
      setShowModal(false);
      toast.success(t(editing ? 'common:toasts.updated' : 'common:toasts.created'));
      loadStreams(true);
    } catch (err) {
      setFormError(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  async function handleCopy(value) {
    if (!value) return;
    try {
      await copyText(value);
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
        eyebrow={t('streams:list.eyebrow')}
        title={t('streams:title')}
        subtitle={t('streams:subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button className={btnPrimary} onClick={openCreate}>
              <Plus size={16} />
              {t('common:actions.create')}
            </button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-2 sm:max-w-xl">
        {[
          [t('streams:list.liveNow'), liveCount, 'text-[var(--success)]'],
          [t('streams:list.total'), streams.length, 'text-[var(--foreground)]'],
          [t('streams:list.unregistered'), externalLive.length, externalLive.length ? 'text-[var(--warning)]' : 'text-[var(--foreground)]']
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-2.5">
            <div className={cn('text-xl font-semibold tabular-nums', color)}>{value}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">{label}</div>
          </div>
        ))}
      </div>

      {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => loadStreams()} />}

      {externalLive.length > 0 && (
        <section className="mb-5 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/7 p-4">
          <div className="mb-3 flex items-start gap-3">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <div>
              <h3 className="text-sm font-semibold">{t('streams:external.title')}</h3>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:external.hint')}</p>
            </div>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {externalLive.map(item => (
              <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/45 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-medium">{item.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {item.publish_ip || '-'} · {formatBitrateKbps(item.kbps)}
                  </div>
                </div>
                <button className={cn(btnSecondary, 'shrink-0')} disabled={working} onClick={() => registerExternal(item.name)}>
                  {t('streams:external.register')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(item => <CardSkeleton key={item} className="h-24" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)]">
          <EmptyState
            title={search ? t('common:page.emptyTitle') : t('streams:empty.title')}
            description={search ? undefined : t('streams:empty.description')}
            action={search ? undefined : (
              <button className={btnPrimary} onClick={openCreate}>{t('streams:empty.createButton')}</button>
            )}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(stream => (
            <StreamCard
              key={stream.id}
              stream={stream}
              t={t}
              onPreview={setPreviewStream}
              onQr={setQrStream}
              onCopy={handleCopy}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t(editing ? 'streams:modal.edit' : 'streams:modal.create')}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="stream-form" type="submit">{t('common:actions.save')}</button>
          </>
        }
      >
        <form id="stream-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>{t('streams:modal.name')}</label>
            <input
              value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })}
              className={`${inputClass} font-mono`}
              placeholder={t('streams:modal.namePlaceholder')}
              required
            />
          </div>
          <div>
            <label className={labelClass}>{t('streams:modal.protocol')}</label>
            <select value={form.protocol} onChange={event => setForm({ ...form, protocol: event.target.value })} className={inputClass}>
              <option value="rtmp">RTMP</option>
              <option value="srt">SRT</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('streams:transcode.label')}</label>
            <select
              value={form.transcode_template_id}
              onChange={event => setForm({ ...form, transcode_template_id: event.target.value })}
              className={inputClass}
            >
              <option value="">{t('streams:transcode.none')}</option>
              {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">{t('streams:transcode.note')}</p>
          </div>
          {formError && <p className="text-sm text-[var(--destructive)]">{formError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTarget?.name || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />

      <StreamPreviewModal stream={previewStream} onClose={() => setPreviewStream(null)} t={t} />
      <StreamQrModal stream={qrStream} onClose={() => setQrStream(null)} t={t} onCopy={handleCopy} />
    </div>
  );
}
