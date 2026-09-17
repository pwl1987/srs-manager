import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Play, RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { getErrorCode } from '../../lib/error-mapper';
import { btnGhost, btnSecondary } from '../ui/styles';

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

export default function ManagedPushPanel({ workspace, t, onChanged }) {
  const tasks = workspace.outputs?.forwards || [];
  const worker = workspace.outputs?.push_worker || { available: false };

  async function control(task, action) {
    try {
      await api.post(`/forward-tasks/${task.id}/${action}`);
      toast.success(t('streams:workspace.managedPush.updated'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    }
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
        <span className={cn(
          'rounded-md px-2 py-1 text-[10px] font-semibold',
          worker.available ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--warning-soft)] text-[var(--warning)]'
        )}>
          {worker.available ? t('streams:workspace.managedPush.workerOnline') : t('streams:workspace.managedPush.workerOffline')}
        </span>
      </div>

      {!worker.available && tasks.some(task => task.desired_state === 'RUNNING') && (
        <div className="mt-3 flex gap-2 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] p-3 text-xs text-[var(--warning)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t('streams:workspace.managedPush.workerUnavailableHint')}</span>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--border-soft)] p-4 text-xs text-[var(--muted-foreground)]">
          {t('streams:workspace.managedPush.empty')}{' '}
          <Link to="/forwarding" className="text-[var(--primary)] hover:underline">{t('streams:workspace.managedPush.configure')}</Link>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {tasks.map(task => {
            const legacy = task.execution_mode === 'srs_dynamic';
            return (
            <div key={task.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">{task.target_protocol || task.target_type}</span>
                    <RuntimeBadge state={task.runtime_state} />
                    <span className="text-[10px] text-[var(--text-faint)]">Desired: {task.desired_state}</span>
                  </div>
                  <div className="mt-2 break-all font-mono text-[10px] text-[var(--muted-foreground)]">{task.target_url_masked || '—'}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!legacy && task.desired_state === 'STOPPED' && task.runtime_state !== 'FAILED' && (
                    <button className={btnGhost} onClick={() => control(task, 'start')} title={t('streams:workspace.managedPush.start')}><Play size={13} /></button>
                  )}
                  {!legacy && task.desired_state === 'RUNNING' && (
                    <button className={btnGhost} onClick={() => control(task, 'stop')} title={t('streams:workspace.managedPush.stop')}><Square size={13} /></button>
                  )}
                  {!legacy && task.runtime_state === 'FAILED' && (
                    <button className={btnGhost} onClick={() => control(task, 'retry')} title={t('streams:workspace.managedPush.retry')}><RefreshCw size={13} /></button>
                  )}
                </div>
              </div>
              {legacy && <div className="mt-2 text-[10px] leading-4 text-[var(--warning)]">{t('streams:workspace.managedPush.legacyHint')}</div>}
              {task.last_error && <div className="mt-2 font-mono text-[10px] leading-5 text-[var(--destructive)]">{task.last_error}</div>}
            </div>
          );})}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-soft)] pt-3">
        <p className="text-[10px] leading-4 text-[var(--text-faint)]">{t('streams:workspace.managedPush.evidenceHint')}</p>
        <Link to="/forwarding" className={btnSecondary}>{t('streams:workspace.managedPush.configure')}</Link>
      </div>
    </section>
  );
}
