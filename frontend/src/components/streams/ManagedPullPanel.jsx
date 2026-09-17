import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleDot, Link2, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { getErrorCode } from '../../lib/error-mapper';
import { btnDangerGhost, btnPrimary, btnSecondary, inputClass } from '../ui/styles';

function RuntimeBadge({ state }) {
  const tones = {
    RUNNING: 'bg-[var(--success-soft)] text-[var(--success)]',
    STARTING: 'bg-[var(--info-soft)] text-[var(--info)]',
    RETRYING: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    BLOCKED: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    FAILED: 'bg-[var(--destructive)]/10 text-[var(--destructive)]',
    STOPPED: 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
  };
  return <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', tones[state] || tones.STOPPED)}>{state || 'STOPPED'}</span>;
}

export default function ManagedPullPanel({ workspace, stream, t, onChanged }) {
  const managed = workspace.inputs?.managed_pull || {};
  const task = managed.task;
  const worker = managed.worker || { available: false };
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (task) return;
    api.get('/external-sources')
      .then(rows => setSources((Array.isArray(rows) ? rows : []).filter(row => row.status === 'active')))
      .catch(() => setSources([]));
  }, [task]);

  async function mutate(path, body) {
    setWorking(true);
    try {
      await api.post(path, body);
      toast.success(t('streams:workspace.managedPull.updated'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
  }

  async function createTask() {
    if (!sourceId) return;
    await mutate('/pull-tasks', { stream_id: stream.id, external_source_id: Number(sourceId) });
  }

  async function deleteTask() {
    setWorking(true);
    try {
      await api.delete(`/pull-tasks/${task.id}`);
      toast.success(t('streams:workspace.managedPull.deleted'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link2 size={15} className="text-[var(--info)]" />
            <h2 className="text-sm font-semibold">{t('streams:workspace.managedPull.title')}</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.managedPull.subtitle')}</p>
        </div>
        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold',
          worker.available ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--warning-soft)] text-[var(--warning)]'
        )}>
          <CircleDot size={10} />
          {worker.available ? t('streams:workspace.managedPull.workerOnline') : t('streams:workspace.managedPull.workerOffline')}
        </span>
      </div>

      {!task ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select className={inputClass} value={sourceId} onChange={event => setSourceId(event.target.value)}>
              <option value="">{t('streams:workspace.managedPull.selectSource')}</option>
              {sources.map(source => (
                <option key={source.id} value={source.id}>{source.name} · {String(source.protocol || '').toUpperCase()}</option>
              ))}
            </select>
            <button className={btnPrimary} disabled={!sourceId || working} onClick={createTask}>
              <Link2 size={14} />{t('streams:workspace.managedPull.bind')}
            </button>
          </div>
          {sources.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">
              {t('streams:workspace.managedPull.noSources')} <Link to="/forwarding" className="text-[var(--primary)] hover:underline">{t('streams:workspace.managedPull.manageSources')}</Link>
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/35 p-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">{t('streams:workspace.managedPull.source')}</div>
              <div className="mt-1 text-sm font-medium">{task.source_name}</div>
              <div className="mt-1 break-all font-mono text-[10px] text-[var(--muted-foreground)]">{task.source_url_masked}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/35 p-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">{t('streams:workspace.managedPull.state')}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <RuntimeBadge state={task.runtime_state} />
                <span className="text-[10px] text-[var(--muted-foreground)]">Desired: {task.desired_state}</span>
                {managed.observed_publisher && <span className="text-[10px] font-medium text-[var(--success)]">{t('streams:workspace.managedPull.publisherObserved')}</span>}
              </div>
            </div>
          </div>

          {!worker.available && task.desired_state === 'RUNNING' && (
            <div className="flex gap-2 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] p-3 text-xs text-[var(--warning)]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{t('streams:workspace.managedPull.workerUnavailableHint')}</span>
            </div>
          )}

          {task.last_error && (
            <div className="rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-3 font-mono text-[10px] leading-5 text-[var(--destructive)]">
              {task.last_error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {task.desired_state === 'STOPPED' && task.runtime_state !== 'FAILED' && (
              <button className={btnPrimary} disabled={working} onClick={() => mutate(`/pull-tasks/${task.id}/start`)}>
                <Play size={14} />{t('streams:workspace.managedPull.start')}
              </button>
            )}
            {task.runtime_state === 'FAILED' && (
              <button className={btnPrimary} disabled={working} onClick={() => mutate(`/pull-tasks/${task.id}/retry`)}>
                <RefreshCw size={14} />{t('streams:workspace.managedPull.retry')}
              </button>
            )}
            {task.desired_state === 'RUNNING' && (
              <button className={btnSecondary} disabled={working} onClick={() => mutate(`/pull-tasks/${task.id}/stop`)}>
                <Square size={13} />{t('streams:workspace.managedPull.stop')}
              </button>
            )}
            <button
              className={btnDangerGhost}
              disabled={working || task.desired_state !== 'STOPPED' || task.runtime_state !== 'STOPPED'}
              onClick={deleteTask}
            >
              <Trash2 size={13} />{t('streams:workspace.managedPull.unbind')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
