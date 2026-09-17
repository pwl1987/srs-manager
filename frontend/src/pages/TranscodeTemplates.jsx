import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { getErrorCode } from '../lib/error-mapper';
import PageHeader from '../components/ui/PageHeader';
import TableShell from '../components/ui/TableShell';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import { TableSkeleton } from '../components/ui/Skeleton';
import SearchInput from '../components/ui/SearchInput';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { inputClass, labelClass, btnPrimary, btnSecondary, btnGhost, thClass, tdClass } from '../components/ui/styles';
import { Plus, Edit, Trash2, Code, Copy } from 'lucide-react';

function parseConfig(json) {
  try {
    return JSON.parse(json || '{}') || {};
  } catch {
    return {};
  }
}

// Number input state is kept as raw strings; converted (and dropped when empty) on submit.
function num(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) ? n : fallback;
}

export default function TranscodeTemplates() {
  const { t } = useTranslation(['transcode', 'common']);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showConfig, setShowConfig] = useState(null);
  const [form, setForm] = useState({
    name: '', vcodec: 'h264', acodec: 'aac',
    video_config: { width: '1280', height: '720', fps: '30', bitrate: '2000', gop_seconds: '2' },
    audio_config: { bitrate: '128', sample_rate: '48000', channels: '2' },
    output_format: 'rtmp', enabled: 1
  });
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    setLoading(true);
    setLoadError(null);
    try {
      setTemplates(await api.get('/transcode-templates'));
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({
      name: '', vcodec: 'h264', acodec: 'aac',
      video_config: { width: '1280', height: '720', fps: '30', bitrate: '2000', gop_seconds: '2' },
      audio_config: { bitrate: '128', sample_rate: '48000', channels: '2' },
      output_format: 'rtmp', enabled: 1
    });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(template) {
    const video = parseConfig(template.video_config);
    const audio = parseConfig(template.audio_config);
    setEditing(template);
    setForm({
      name: template.name,
      vcodec: template.vcodec === 'libx264' ? 'h264' : template.vcodec === 'libx265' ? 'h265' : (template.vcodec || 'h264'),
      acodec: template.acodec === 'libmp3lame' ? 'mp3' : (template.acodec || 'aac'),
      video_config: {
        width: video.width != null ? String(video.width) : '',
        height: video.height != null ? String(video.height) : '',
        fps: video.fps != null ? String(video.fps) : '',
        bitrate: video.bitrate != null ? String(video.bitrate) : '',
        gop_seconds: video.gop_seconds != null ? String(video.gop_seconds) : ''
      },
      audio_config: {
        bitrate: audio.bitrate != null ? String(audio.bitrate) : '',
        sample_rate: audio.sample_rate != null ? String(audio.sample_rate) : '',
        channels: audio.channels != null ? String(audio.channels) : ''
      },
      output_format: template.output_format || 'rtmp',
      enabled: template.enabled
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const videoConfig = {};
    for (const [key, value] of Object.entries(form.video_config)) {
      if (value !== '') videoConfig[key] = num(value, null);
    }
    const audioConfig = {};
    for (const [key, value] of Object.entries(form.audio_config)) {
      if (value !== '') audioConfig[key] = num(value, null);
    }

    const data = {
      ...form,
      video_config: JSON.stringify(videoConfig),
      audio_config: JSON.stringify(audioConfig)
    };
    try {
      if (editing) {
        await api.put(`/transcode-templates/${editing.id}`, data);
        toast.success(t('common:toasts.updated'));
      } else {
        await api.post('/transcode-templates', data);
        toast.success(t('common:toasts.created'));
      }
      setShowModal(false);
      loadTemplates();
    } catch (err) { setFormError(t(`common:errors.${getErrorCode(err)}`)); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      await api.delete(`/transcode-templates/${deleteTarget.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTarget(null);
      loadTemplates();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function showSrsConfig(id) {
    try {
      const data = await api.get(`/transcode-templates/${id}/srs-config`);
      setShowConfig(data.config);
    } catch (err) { toast.error(t(`common:errors.${getErrorCode(err)}`)); }
  }

  async function copyConfig() {
    if (!showConfig) return;
    try {
      await copyText(showConfig);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  const filtered = search
    ? templates.filter(tp => (tp.name || '').toLowerCase().includes(search.toLowerCase()))
    : templates;

  return (
    <div>
      <PageHeader
        title={t('transcode:title')}
        subtitle={t('transcode:subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button className={btnPrimary} onClick={openCreate}>
              <Plus size={16} /> {t('transcode:actions.create')}
            </button>
          </>
        }
      />

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={loadTemplates} />}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <EmptyState title={search ? t('common:page.emptyTitle') : t('transcode:empty')} />
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b">
              <th className={thClass}>{t('transcode:columns.name')}</th>
              <th className={thClass}>{t('transcode:columns.vcodec')}</th>
              <th className={thClass}>{t('transcode:columns.acodec')}</th>
              <th className={thClass}>{t('transcode:columns.videoConfig')}</th>
              <th className={thClass}>{t('transcode:columns.audioConfig')}</th>
              <th className={thClass}>{t('transcode:columns.outputFormat')}</th>
              <th className={thClass}>{t('transcode:columns.status')}</th>
              <th className={`${thClass} text-right`}>{t('transcode:columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(tpl => (
              <tr key={tpl.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                <td className={`${tdClass} font-medium`}>{tpl.name}</td>
                <td className={tdClass}>{t(`transcode:vcodecOptions.${tpl.vcodec}`, tpl.vcodec)}</td>
                <td className={tdClass}>{t(`transcode:acodecOptions.${tpl.acodec}`, tpl.acodec)}</td>
                <td className={`${tdClass} text-xs font-mono whitespace-nowrap`}>
                  {Object.entries(parseConfig(tpl.video_config)).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}
                </td>
                <td className={`${tdClass} text-xs font-mono whitespace-nowrap`}>
                  {Object.entries(parseConfig(tpl.audio_config)).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}
                </td>
                <td className={tdClass}>{t(`transcode:outputFormatOptions.${tpl.output_format}`, tpl.output_format)}</td>
                <td className={tdClass}>
                  <span className={cn('text-xs', tpl.enabled ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]')}>
                    {t(`transcode:status.${tpl.enabled ? 'enabled' : 'disabled'}`)}
                  </span>
                </td>
                <td className={tdClass}>
                  <div className="flex items-center justify-end gap-0.5">
                    <button className={btnGhost} onClick={() => showSrsConfig(tpl.id)} title={t('transcode:actions.srsConfig')}><Code size={14} /></button>
                    <button className={btnGhost} onClick={() => openEdit(tpl)} title={t('common:actions.edit')}><Edit size={14} /></button>
                    <button
                      className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                      onClick={() => setDeleteTarget(tpl)}
                      title={t('common:actions.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('transcode:modal.edit') : t('transcode:modal.create')}
        size="lg"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="tpl-form" type="submit">
              {editing ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="tpl-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>{t('transcode:modal.name')}</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputClass} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('transcode:modal.vcodec')}</label>
              <select value={form.vcodec} onChange={e => setForm({ ...form, vcodec: e.target.value })} className={inputClass}>
                <option value="h264">{t('transcode:vcodecOptions.h264')}</option>
                <option value="h265">{t('transcode:vcodecOptions.h265')}</option>
                <option value="none">{t('transcode:vcodecOptions.none')}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('transcode:modal.acodec')}</label>
              <select value={form.acodec} onChange={e => setForm({ ...form, acodec: e.target.value })} className={inputClass}>
                <option value="aac">{t('transcode:acodecOptions.aac')}</option>
                <option value="mp3">{t('transcode:acodecOptions.mp3')}</option>
                <option value="none">{t('transcode:acodecOptions.none')}</option>
              </select>
            </div>
          </div>
          {form.vcodec !== 'none' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>{t('transcode:modal.width')}</label>
                <input type="number" value={form.video_config.width}
                  onChange={e => setForm({ ...form, video_config: { ...form.video_config, width: e.target.value } })}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('transcode:modal.height')}</label>
                <input type="number" value={form.video_config.height}
                  onChange={e => setForm({ ...form, video_config: { ...form.video_config, height: e.target.value } })}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('transcode:modal.fps')}</label>
                <input type="number" value={form.video_config.fps}
                  onChange={e => setForm({ ...form, video_config: { ...form.video_config, fps: e.target.value } })}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('transcode:modal.bitrate')}</label>
                <input type="number" value={form.video_config.bitrate}
                  onChange={e => setForm({ ...form, video_config: { ...form.video_config, bitrate: e.target.value } })}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('transcode:modal.gopSeconds')}</label>
                <input type="number" min="0.2" step="0.1" value={form.video_config.gop_seconds}
                  onChange={e => setForm({ ...form, video_config: { ...form.video_config, gop_seconds: e.target.value } })}
                  className={inputClass} />
              </div>
            </div>
          )}
          {form.acodec !== 'none' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><label className={labelClass}>{t('transcode:modal.audioBitrate')}</label><input type="number" value={form.audio_config.bitrate} onChange={e => setForm({ ...form, audio_config: { ...form.audio_config, bitrate: e.target.value } })} className={inputClass} /></div>
              <div><label className={labelClass}>{t('transcode:modal.sampleRate')}</label><input type="number" value={form.audio_config.sample_rate} onChange={e => setForm({ ...form, audio_config: { ...form.audio_config, sample_rate: e.target.value } })} className={inputClass} /></div>
              <div><label className={labelClass}>{t('transcode:modal.channels')}</label><input type="number" min="1" max="8" value={form.audio_config.channels} onChange={e => setForm({ ...form, audio_config: { ...form.audio_config, channels: e.target.value } })} className={inputClass} /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('transcode:modal.outputFormat')}</label>
              <select value={form.output_format} onChange={e => setForm({ ...form, output_format: e.target.value })} className={inputClass}>
                <option value="rtmp">{t('transcode:outputFormatOptions.rtmp')}</option>
                <option value="hls">{t('transcode:outputFormatOptions.hls')}</option>
                <option value="mp4">{t('transcode:outputFormatOptions.mp4')}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('transcode:modal.enabled')}</label>
              <select value={form.enabled} onChange={e => setForm({ ...form, enabled: parseInt(e.target.value, 10) })} className={inputClass}>
                <option value={1}>{t('transcode:status.enabled')}</option>
                <option value={0}>{t('transcode:status.disabled')}</option>
              </select>
            </div>
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(showConfig)}
        onClose={() => setShowConfig(null)}
        title={t('transcode:srsConfig.title')}
        size="lg"
        footer={
          <>
            <p className="text-xs text-[var(--muted-foreground)] mr-auto">{t('transcode:srsConfig.description')}</p>
            <button className={btnSecondary} onClick={copyConfig}><Copy size={14} /> {t('common:actions.copy')}</button>
          </>
        }
      >
        <pre className="bg-[var(--muted)] rounded p-4 text-xs overflow-x-auto whitespace-pre">{showConfig}</pre>
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
    </div>
  );
}
