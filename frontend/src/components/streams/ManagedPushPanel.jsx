import { useState } from 'react';
import { AlertTriangle, ArrowUpRight, Plus, Play, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { getErrorCode } from '../../lib/error-mapper';
import { btnDangerGhost, btnGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';

const PUSH_URL = /^(rtmp|rtmps|srt):\/\/\S+/i;

function RuntimeBadge({ state }) {
  const tones = {
    RUNNING: 'bg-[var(--success-soft)] text-[var(--success)]',
    STARTING: 'bg-[var(--info-soft)] text-[var(--info)]',
    WAITING_INPUT: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    RETRYING: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    FAILED: 'bg-[var(--destructive)]/10 text-[var(--destructive)]',
    STOPPING: 'bg-[var(--secondary)] text-[var(--muted-foreground)]',
    STOPPED: 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
  };
  return <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', tones[state] || tones.STOPPED)}>{state || 'STOPPED'}</span>;
}

export default function ManagedPushPanel({ workspace, stream, t, onChanged }) {
  const tasks = workspace.outputs?.forwards || [];
  const worker = workspace.outputs?.push_worker || { available: false };
  const [showCreate, setShowCreate] = useState(false);
  const [targetType, setTargetType] = useState('custom_rtmp');
  const [targetUrl, setTargetUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState('');

  async function control(task, action) {
    setWorking(true);
    try {
      await api.post(`/forward-tasks/${task.id}/${action}`);
      toast.success(t('streams:workspace.managedPush.updated'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally { setWorking(false); }
  }

  async function createTask(event) {
    event.preventDefault();
    setFormError('');
    const url = targetUrl.trim();
    if (!PUSH_URL.test(url)) {
      setFormError(t('streams:workspace.managedPush.invalidUrl'));
      return;
    }
    setWorking(true);
    try {
      await api.post('/forward-tasks', { stream_id: stream.id, target_type: targetType, target_url: url, enabled: 0 });
      toast.success(t('streams:workspace.managedPush.created'));
      setTargetUrl('');
      setShowCreate(false);
      await onChanged?.();
    } catch (error) {
      setFormError(t(`common:errors.${getErrorCode(error)}`));
    } finally { setWorking(false); }
  }

  async function deleteTask(task) {
    setWorking(true);
    try {
      await api.delete(`/forward-tasks/${task.id}`);
      toast.success(t('streams:workspace.managedPush.deleted'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally { setWorking(false); }
  }

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ArrowUpRight size={15} className="text-[var(--primary)]" />
            <h2 className="text-sm font-semibold">{t('streams:workspace.managedPush.title')}</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.managedPush.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', worker.available ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--warning-soft)] text-[var(--warning)]')}>
            {worker.available ? t('streams:workspace.managedPush.workerOnline') : t('streams:workspace.managedPush.workerOffline')}
          </span>
          <button className={btnSecondary} onClick={() => { setShowCreate(value => !value); setFormError(''); }}>
            {showCreate ? <X size={13} /> : <Plus size={13} />}{showCreate ? t('common:actions.cancel') : t('streams:workspace.managedPush.addTarget')}
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createTask} className="mt-4 rounded-xl border border-[var(--primary)]/18 bg-[var(--background)]/28 p-3">
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className={labelClass}>{t('streams:workspace.managedPush.targetType')}</label>
              <select className={inputClass} value={targetType} onChange={event => setTargetType(event.target.value)}>
                <option value="custom_rtmp">RTMP / RTMPS</option>
                <option value="srs_edge">SRS Edge</option>
                <option value="cdn_channel">CDN / SRT</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('streams:workspace.managedPush.targetUrl')}</label>
              <input className={`${inputClass} font-mono`} value={targetUrl} onChange={event => setTargetUrl(event.target.value)} placeholder="rtmp://… / srt://…" autoComplete="off" />
            </div>
            <button className={btnPrimary} disabled={working || !targetUrl.trim()} type="submit"><Plus size={13} />{t('streams:workspace.managedPush.createStopped')}</button>
          </div>
          {formError && <p className="mt-2 text-xs text-[var(--destructive)]">{formError}</p>}
          <p className="mt-2 text-[10px] text-[var(--text-faint)]">{t('streams:workspace.managedPush.createHint')}</p>
        </form>
      )}

      {!worker.available && tasks.some(task => task.desired_state === 'RUNNING') && (
        <div className="mt-3 flex gap-2 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] p-3 text-xs text-[var(--warning)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t('streams:workspace.managedPush.workerUnavailableHint')}</span>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--border-soft)] p-4 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.managedPush.empty')}</div>
      ) : (
        <div className="mt-4 space-y-2">
          {tasks.map(task => {
            const legacy = task.execution_mode === 'srs_dynamic';
            const safelyStopped = legacy ? task.desired_state === 'STOPPED' : task.desired_state === 'STOPPED' && task.runtime_state === 'STOPPED';
            return (
              <div key={task.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/25 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">{task.target_protocol || task.target_type}</span>
                      <RuntimeBadge state={task.runtime_state} />
                      <span className="text-[10px] text-[var(--text-faint)]">Desired: {task.desired_state}</span>
                    </div>
                    <div className="mt-2 break-all font-mono text-[10px] text-[var(--muted-foreground)]">{task.target_url_masked || '—'}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!legacy && task.desired_state === 'STOPPED' && task.runtime_state !== 'FAILED' && <button className={btnGhost} disabled={working} onClick={() => control(task, 'start')} title={t('streams:workspace.managedPush.start')}><Play size={13} /></button>}
                    {!legacy && task.desired_state === 'RUNNING' && <button className={btnGhost} disabled={working} onClick={() => control(task, 'stop')} title={t('streams:workspace.managedPush.stop')}><Square size={13} /></button>}
                    {!legacy && task.runtime_state === 'FAILED' && <button className={btnGhost} disabled={working} onClick={() => control(task, 'retry')} title={t('streams:workspace.managedPush.retry')}><RefreshCw size={13} /></button>}
                    <button className={btnDangerGhost} disabled={working || !safelyStopped} onClick={() => deleteTask(task)} title={t('common:actions.delete')}><Trash2 size={13} /></button>
                  </div>
                </div>
                {legacy && <div className="mt-2 text-[10px] leading-4 text-[var(--warning)]">{t('streams:workspace.managedPush.legacyHint')}</div>}
                {task.last_error && <div className="mt-2 font-mono text-[10px] leading-5 text-[var(--destructive)]">{task.last_error}</div>}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 border-t border-[var(--border-soft)] pt-3 text-[10px] leading-4 text-[var(--text-faint)]">{t('streams:workspace.managedPush.evidenceHint')}</p>
    </section>
  );
}
