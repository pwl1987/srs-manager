import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { getErrorCode } from '../lib/error-mapper';
import PageHeader from '../components/ui/PageHeader';
import TableShell from '../components/ui/TableShell';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import { TableSkeleton } from '../components/ui/Skeleton';
import SearchInput from '../components/ui/SearchInput';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { inputClass, labelClass, btnPrimary, btnSecondary, btnGhost, thClass, tdClass, helpTextClass } from '../components/ui/styles';
import { Plus, Edit, Trash2, Power, Download, Upload, Info } from 'lucide-react';

const URL_PATTERN = /^(rtmp|rtmps|srt|rtsp|http|https):\/\/\S+/i;

export default function Forwarding() {
  const { t } = useTranslation(['forwarding', 'common']);
  const [sources, setSources] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [sourceForm, setSourceForm] = useState({ name: '', source_url: '', protocol: 'rtmp', pull_mode: 'pull' });
  const [taskForm, setTaskForm] = useState({ stream_id: '', external_source_id: '', target_type: 'cdn_channel', target_url: '', enabled: 1 });
  const [formError, setFormError] = useState('');
  const [deleteSource, setDeleteSource] = useState(null);
  const [deleteTask, setDeleteTask] = useState(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    loadAll();
    api.get('/streams').then(setStreams).catch(() => {});
  }, []);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [srcs, tks] = await Promise.all([
        api.get('/external-sources'),
        api.get('/forward-tasks')
      ]);
      setSources(srcs);
      setTasks(tks);
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  function openCreateSource() {
    setEditingSource(null);
    setSourceForm({ name: '', source_url: '', protocol: 'rtmp', pull_mode: 'pull' });
    setFormError('');
    setShowSourceModal(true);
  }

  function openEditSource(source) {
    setEditingSource(source);
    setSourceForm({ name: source.name, source_url: '', protocol: source.protocol, pull_mode: source.pull_mode });
    setFormError('');
    setShowSourceModal(true);
  }

  async function handleSourceSubmit(e) {
    e.preventDefault();
    setFormError('');
    const candidateUrl = sourceForm.source_url.trim();
    if ((!editingSource || candidateUrl) && !URL_PATTERN.test(candidateUrl)) {
      setFormError(t('common:errors.VALIDATION_TEMPLATE_INVALID'));
      return;
    }
    try {
      const payload = { ...sourceForm, source_url: candidateUrl };
      if (editingSource) {
        await api.put(`/external-sources/${editingSource.id}`, payload);
        toast.success(t('common:toasts.updated'));
      } else {
        await api.post('/external-sources', payload);
        toast.success(t('common:toasts.created'));
      }
      setShowSourceModal(false);
      loadAll();
    } catch (err) { setFormError(t(`common:errors.${getErrorCode(err)}`)); }
  }

  function openCreateTask() {
    setEditingTask(null);
    setTaskForm({ stream_id: streams[0]?.id || '', external_source_id: sources[0]?.id || '', target_type: 'cdn_channel', target_url: '', enabled: 1 });
    setFormError('');
    setShowTaskModal(true);
  }

  function openEditTask(task) {
    setEditingTask(task);
    setTaskForm({
      stream_id: task.stream_id, external_source_id: task.external_source_id,
      target_type: task.target_type, target_url: task.target_url, enabled: task.enabled
    });
    setFormError('');
    setShowTaskModal(true);
  }

  async function handleTaskSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!URL_PATTERN.test(taskForm.target_url)) {
      setFormError(t('common:errors.VALIDATION_TEMPLATE_INVALID'));
      return;
    }
    try {
      if (editingTask) {
        await api.put(`/forward-tasks/${editingTask.id}`, taskForm);
        toast.success(t('common:toasts.updated'));
      } else {
        await api.post('/forward-tasks', taskForm);
        toast.success(t('common:toasts.created'));
      }
      setShowTaskModal(false);
      loadAll();
    } catch (err) { setFormError(t(`common:errors.${getErrorCode(err)}`)); }
  }

  async function confirmDeleteSource() {
    if (!deleteSource) return;
    setWorking(true);
    try {
      await api.delete(`/external-sources/${deleteSource.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteSource(null);
      loadAll();
    } catch (err) { toast.error(t(`common:errors.${getErrorCode(err)}`)); }
    finally { setWorking(false); }
  }

  async function confirmDeleteTask() {
    if (!deleteTask) return;
    setWorking(true);
    try {
      await api.delete(`/forward-tasks/${deleteTask.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTask(null);
      loadAll();
    } catch (err) { toast.error(t(`common:errors.${getErrorCode(err)}`)); }
    finally { setWorking(false); }
  }

  async function handleToggleTask(task) {
    try {
      await api.put(`/forward-tasks/${task.id}`, { enabled: task.enabled ? 0 : 1 });
      toast.success(t('common:toasts.updated'));
      loadAll();
    } catch (err) { toast.error(t(`common:errors.${getErrorCode(err)}`)); }
  }

  const q = search.toLowerCase();
  const filteredSources = search
    ? sources.filter(s => (s.name || '').toLowerCase().includes(q) || (s.source_url_masked || '').toLowerCase().includes(q))
    : sources;
  const filteredTasks = search
    ? tasks.filter(task => {
        const stream = streams.find(s => s.id === task.stream_id);
        return (task.target_url || '').toLowerCase().includes(q) || (stream?.name || '').toLowerCase().includes(q);
      })
    : tasks;

  return (
    <div>
      <PageHeader
        title={t('forwarding:title')}
        subtitle={t('forwarding:subtitle')}
        actions={<SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />}
      />

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={loadAll} />}

      {loading ? (
        <>
          <TableSkeleton rows={3} />
          <div className="h-6" />
          <TableSkeleton rows={3} />
        </>
      ) : (
        <>
          {/* External Sources */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--muted-foreground)]">{t('forwarding:sources.title')}</h3>
              <button className={btnSecondary} onClick={openCreateSource}>
                <Plus size={14} /> {t('forwarding:sources.actions.create')}
              </button>
            </div>
            {filteredSources.length === 0 ? (
              <div className="bg-[var(--card)] rounded-lg border"><EmptyState title={t('forwarding:sources.empty')} /></div>
            ) : (
              <TableShell>
                <thead>
                  <tr className="border-b">
                    <th className={thClass}>{t('forwarding:sources.columns.name')}</th>
                    <th className={thClass}>{t('forwarding:sources.columns.url')}</th>
                    <th className={thClass}>{t('forwarding:sources.columns.protocol')}</th>
                    <th className={thClass}>{t('forwarding:sources.columns.mode')}</th>
                    <th className={`${thClass} text-right`}>{t('forwarding:sources.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredSources.map(s => (
                    <tr key={s.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className={`${tdClass} font-medium`}>{s.name}</td>
                      <td className={tdClass}>
                        <code className="font-mono text-xs truncate block max-w-[320px]" title={s.source_url_masked || undefined}>{s.source_url_masked || '—'}</code>
                      </td>
                      <td className={tdClass}>{t(`forwarding:protocol.${s.protocol}`, s.protocol)}</td>
                      <td className={tdClass}>
                        <span className="flex items-center gap-1.5">
                          {s.pull_mode === 'pull' ? <Download size={14} className="text-[var(--info)]" /> : <Upload size={14} className="text-[var(--warning)]" />}
                          {t(`forwarding:mode.${s.pull_mode}`, s.pull_mode)}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <div className="flex items-center justify-end gap-0.5">
                          <button className={btnGhost} onClick={() => openEditSource(s)} title={t('common:actions.edit')}><Edit size={14} /></button>
                          <button
                            className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                            onClick={() => setDeleteSource(s)}
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
          </div>

          {/* Forward Tasks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--muted-foreground)]">{t('forwarding:tasks.title')}</h3>
              <button className={btnSecondary} onClick={openCreateTask}>
                <Plus size={14} /> {t('forwarding:tasks.actions.create')}
              </button>
            </div>
            <p className={cn(helpTextClass, 'flex items-center gap-1.5 mb-3')}>
              <Info size={12} className="shrink-0" /> {t('forwarding:tasks.note')}
            </p>
            {filteredTasks.length === 0 ? (
              <div className="bg-[var(--card)] rounded-lg border"><EmptyState title={t('forwarding:tasks.empty')} /></div>
            ) : (
              <TableShell>
                <thead>
                  <tr className="border-b">
                    <th className={thClass}>{t('forwarding:tasks.columns.stream')}</th>
                    <th className={thClass}>{t('forwarding:tasks.columns.source')}</th>
                    <th className={thClass}>{t('forwarding:tasks.columns.targetType')}</th>
                    <th className={thClass}>{t('forwarding:tasks.columns.targetUrl')}</th>
                    <th className={thClass}>{t('forwarding:tasks.columns.status')}</th>
                    <th className={thClass}>{t('forwarding:tasks.columns.runtimeStatus')}</th>
                    <th className={`${thClass} text-right`}>{t('forwarding:tasks.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredTasks.map(task => {
                    const stream = streams.find(s => s.id === task.stream_id);
                    const source = sources.find(s => s.id === task.external_source_id);
                    return (
                      <tr key={task.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                        <td className={`${tdClass} font-medium`}>{stream?.name || '-'}</td>
                        <td className={tdClass}>{source?.name || '-'}</td>
                        <td className={tdClass}>{t(`forwarding:targetType.${task.target_type}`, task.target_type)}</td>
                        <td className={tdClass}>
                          <code className="font-mono text-xs truncate block max-w-[240px]" title={task.target_url}>{task.target_url}</code>
                        </td>
                        <td className={tdClass}>
                          <span className={cn('text-xs px-2 py-1 rounded whitespace-nowrap',
                            task.enabled ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]')}>
                            {t(`forwarding:status.${task.enabled ? 'enabled' : 'disabled'}`)}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <span
                            className={cn('text-xs whitespace-nowrap',
                              task.status === 'error' ? 'text-[var(--destructive)]' : 'text-[var(--muted-foreground)]')}
                            title={task.error_message || undefined}
                          >
                            {t(`forwarding:taskStatus.${task.status || 'idle'}`, task.status || 'idle')}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              className={btnGhost}
                              onClick={() => handleToggleTask(task)}
                              title={t(task.enabled ? 'common:actions.hide' : 'common:actions.show')}
                            >
                              <Power size={14} className={task.enabled ? 'text-[var(--success)]' : ''} />
                            </button>
                            <button className={btnGhost} onClick={() => openEditTask(task)} title={t('common:actions.edit')}><Edit size={14} /></button>
                            <button
                              className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                              onClick={() => setDeleteTask(task)}
                              title={t('common:actions.delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
            )}
          </div>
        </>
      )}

      {/* Source Modal */}
      <Modal
        open={showSourceModal}
        onClose={() => setShowSourceModal(false)}
        title={editingSource ? t('forwarding:sources.modal.edit') : t('forwarding:sources.modal.create')}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowSourceModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="source-form" type="submit">
              {editingSource ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="source-form" onSubmit={handleSourceSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>{t('forwarding:sources.modal.name')}</label>
            <input type="text" value={sourceForm.name} onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>{t('forwarding:sources.modal.url')}</label>
            {editingSource && (
              <div className="mb-2 rounded-lg border border-[var(--border-soft)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs text-[var(--muted-foreground)]">
                {editingSource.source_url_masked || '—'}
              </div>
            )}
            <input
              type="text"
              value={sourceForm.source_url}
              onChange={e => setSourceForm({ ...sourceForm, source_url: e.target.value })}
              className={`${inputClass} font-mono`}
              placeholder={editingSource ? t('forwarding:sources.modal.urlKeepPlaceholder') : 'rtmp://…'}
              required={!editingSource}
            />
            {editingSource && <p className={helpTextClass}>{t('forwarding:sources.modal.urlKeepHint')}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('forwarding:sources.modal.protocol')}</label>
              <select value={sourceForm.protocol} onChange={e => setSourceForm({ ...sourceForm, protocol: e.target.value })} className={inputClass}>
                <option value="rtmp">{t('forwarding:protocol.rtmp')}</option>
                <option value="srt">{t('forwarding:protocol.srt')}</option>
                <option value="hls">{t('forwarding:protocol.hls')}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('forwarding:sources.modal.mode')}</label>
              <select value={sourceForm.pull_mode} onChange={e => setSourceForm({ ...sourceForm, pull_mode: e.target.value })} className={inputClass}>
                <option value="pull">{t('forwarding:mode.pull')}</option>
                <option value="push">{t('forwarding:mode.push')}</option>
              </select>
            </div>
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      {/* Task Modal */}
      <Modal
        open={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        title={editingTask ? t('forwarding:tasks.modal.edit') : t('forwarding:tasks.modal.create')}
        size="lg"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowTaskModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="task-form" type="submit">
              {editingTask ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="task-form" onSubmit={handleTaskSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('forwarding:tasks.modal.stream')}</label>
              <select value={taskForm.stream_id} onChange={e => setTaskForm({ ...taskForm, stream_id: e.target.value })} className={inputClass} required>
                <option value="">{t('common:labels.selectPlaceholder')}</option>
                {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('forwarding:tasks.modal.source')}</label>
              <select value={taskForm.external_source_id} onChange={e => setTaskForm({ ...taskForm, external_source_id: e.target.value })} className={inputClass}>
                <option value="">{t('common:labels.selectPlaceholder')}</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('forwarding:tasks.modal.targetType')}</label>
            <select value={taskForm.target_type} onChange={e => setTaskForm({ ...taskForm, target_type: e.target.value })} className={inputClass}>
              <option value="cdn_channel">{t('forwarding:targetType.cdnChannel')}</option>
              <option value="srs_edge">{t('forwarding:targetType.srsEdge')}</option>
              <option value="custom_rtmp">{t('forwarding:targetType.customRtmp')}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('forwarding:tasks.modal.targetUrl')}</label>
            <input type="text" value={taskForm.target_url} onChange={e => setTaskForm({ ...taskForm, target_url: e.target.value })} className={`${inputClass} font-mono`} placeholder="rtmp://…" required />
          </div>
          <div>
            <label className={labelClass}>{t('forwarding:tasks.modal.enabled')}</label>
            <select value={taskForm.enabled} onChange={e => setTaskForm({ ...taskForm, enabled: parseInt(e.target.value, 10) })} className={inputClass}>
              <option value={1}>{t('forwarding:status.enabled')}</option>
              <option value={0}>{t('forwarding:status.disabled')}</option>
            </select>
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteSource)}
        onClose={() => setDeleteSource(null)}
        onConfirm={confirmDeleteSource}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteSource?.name || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
      <ConfirmDialog
        open={Boolean(deleteTask)}
        onClose={() => setDeleteTask(null)}
        onConfirm={confirmDeleteTask}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTask?.target_url || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
    </div>
  );
}
