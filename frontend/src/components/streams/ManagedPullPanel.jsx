import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRightLeft, CircleDot, Link2, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { getErrorCode } from '../../lib/error-mapper';
import { btnDangerGhost, btnPrimary, btnSecondary, btnGhost, inputClass } from '../ui/styles';
import ConfirmDialog from '../ui/ConfirmDialog';

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
  const activeOperation = managed.active_operation || null;
  const latestOperation = managed.operations?.[0] || null;
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [switchTargetId, setSwitchTargetId] = useState('');
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    api.get('/external-sources')
      .then(rows => setSources((Array.isArray(rows) ? rows : []).filter(row => row.status === 'active')))
      .catch(() => setSources([]));
  }, [task?.id]);

  const taskSources = task?.sources || [];
  const availableSources = useMemo(() => {
    const used = new Set(taskSources.map(source => Number(source.external_source_id)));
    return sources.filter(source => !used.has(Number(source.id)));
  }, [sources, taskSources]);
  const switchCandidates = taskSources.filter(source =>
    Number(source.external_source_id) !== Number(task?.active_source_id)
      && source.enabled
      && source.source_status === 'active'
  );
  const sourceName = sourceIdValue => taskSources.find(source => Number(source.external_source_id) === Number(sourceIdValue))?.source_name || `#${sourceIdValue}`;
  const switchTarget = switchCandidates.find(source => Number(source.external_source_id) === Number(switchTargetId));
  const configurationLocked = Boolean(activeOperation);

  async function post(path, body) {
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

  async function runRequest(method, path, body) {
    setWorking(true);
    try {
      await api[method](path, body);
      toast.success(t('streams:workspace.managedPull.updated'));
      setSourceId('');
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
  }

  async function createTask() {
    if (!sourceId) return;
    await post('/pull-tasks', { stream_id: stream.id, external_source_id: Number(sourceId) });
    setSourceId('');
  }

  async function addStandby() {
    if (!task || !sourceId) return;
    await runRequest('post', `/pull-tasks/${task.id}/sources`, { external_source_id: Number(sourceId) });
  }

  async function toggleSource(source) {
    await runRequest('put', `/pull-tasks/${task.id}/sources/${source.external_source_id}`, { enabled: source.enabled ? 0 : 1 });
  }

  async function removeSource(source) {
    await runRequest('delete', `/pull-tasks/${task.id}/sources/${source.external_source_id}`);
  }

  async function requestSwitch() {
    if (!task || !switchTargetId) return;
    setWorking(true);
    try {
      await api.post(`/pull-tasks/${task.id}/switch-source`, { target_source_id: Number(switchTargetId) });
      toast.success(t('streams:workspace.managedPull.switchQueued'));
      setConfirmSwitch(false);
      setSwitchTargetId('');
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
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
              <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                <span>{task.source_name}</span>
                {task.sources?.length > 1 && (
                  <span className="rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--warning)]">
                    {t('streams:workspace.managedPull.failoverArmed')}
                  </span>
                )}
              </div>
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

          {activeOperation && (
            <div className="rounded-lg border border-[var(--info)]/25 bg-[var(--info-soft)]/45 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft size={14} className="text-[var(--info)]" />
                  <span className="text-xs font-semibold">{t('streams:workspace.managedPull.switchInProgress')}</span>
                </div>
                <span className="rounded-md bg-[var(--background)]/55 px-2 py-1 font-mono text-[10px] text-[var(--info)]">{activeOperation.state}</span>
              </div>
              <div className="mt-2 text-xs text-[var(--muted-foreground)]">
                {sourceName(activeOperation.payload?.from_source_id)}
                <span className="mx-2 text-[var(--text-faint)]">→</span>
                <span className="font-medium text-[var(--foreground)]">{sourceName(activeOperation.payload?.target_source_id)}</span>
              </div>
              <div className="mt-1 text-[10px] leading-5 text-[var(--text-faint)]">
                {t(`streams:workspace.managedPull.operationState.${activeOperation.state}`, activeOperation.state)}
              </div>
            </div>
          )}

          {!activeOperation && latestOperation?.state === 'FAILED' && (
            <div className="rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-3 text-xs text-[var(--destructive)]">
              <div className="font-medium">{t('streams:workspace.managedPull.switchFailed')}</div>
              <div className="mt-1 font-mono text-[10px] leading-5">{latestOperation.error || t('streams:workspace.managedPull.unknownSwitchError')}</div>
            </div>
          )}

          <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold">{t('streams:workspace.managedPull.candidates')}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{t('streams:workspace.managedPull.failoverHint')}</div>
              </div>
              <span className="text-[10px] text-[var(--muted-foreground)]">{taskSources.length} {t('streams:workspace.managedPull.sourcesCount')}</span>
            </div>

            <div className="mt-3 space-y-2">
              {taskSources.map(source => {
                const active = Number(source.external_source_id) === Number(task.active_source_id);
                const destructiveLocked = configurationLocked || (active && task.desired_state === 'RUNNING');
                return (
                  <div key={source.id} className={cn(
                    'grid gap-2 rounded-lg border px-3 py-2.5 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center',
                    active ? 'border-[var(--success)]/30 bg-[var(--success-soft)]/25' : 'border-[var(--border-soft)] bg-[var(--card)]'
                  )}>
                    <div className="text-center text-[10px] font-semibold text-[var(--text-faint)]">P{source.priority}</div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-medium">{source.source_name}</span>
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[9px] font-semibold',
                          active ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
                        )}>
                          {active ? t('streams:workspace.managedPull.active') : t('streams:workspace.managedPull.standby')}
                        </span>
                        {!source.enabled && <span className="text-[9px] text-[var(--text-faint)]">{t('streams:workspace.managedPull.disabled')}</span>}
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]" title={source.source_url_masked}>{source.source_url_masked}</div>
                    </div>
                    <div className="flex justify-end gap-1">
                      <button
                        className={btnGhost}
                        disabled={working || destructiveLocked}
                        onClick={() => toggleSource(source)}
                        title={source.enabled ? t('streams:workspace.managedPull.disable') : t('streams:workspace.managedPull.enable')}
                      >
                        <CircleDot size={13} className={source.enabled ? 'text-[var(--success)]' : 'text-[var(--text-faint)]'} />
                      </button>
                      <button
                        className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)]')}
                        disabled={working || destructiveLocked || taskSources.length <= 1}
                        onClick={() => removeSource(source)}
                        title={t('streams:workspace.managedPull.removeSource')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {task.desired_state === 'RUNNING' && switchCandidates.length > 0 && (
              <div className="mt-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning-soft)]/25 p-3">
                <div className="text-xs font-semibold">{t('streams:workspace.managedPull.manualSwitch')}</div>
                <div className="mt-1 text-[10px] leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.managedPull.manualSwitchHint')}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    className={inputClass}
                    value={switchTargetId}
                    disabled={working || configurationLocked || !worker.available}
                    onChange={event => setSwitchTargetId(event.target.value)}
                  >
                    <option value="">{t('streams:workspace.managedPull.selectSwitchTarget')}</option>
                    {switchCandidates.map(source => (
                      <option key={source.id} value={source.external_source_id}>P{source.priority} · {source.source_name}</option>
                    ))}
                  </select>
                  <button
                    className={btnSecondary}
                    disabled={!switchTargetId || working || configurationLocked || !worker.available}
                    onClick={() => setConfirmSwitch(true)}
                  >
                    <ArrowRightLeft size={14} />{t('streams:workspace.managedPull.switchSource')}
                  </button>
                </div>
              </div>
            )}

            {availableSources.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select className={inputClass} value={sourceId} onChange={event => setSourceId(event.target.value)}>
                  <option value="">{t('streams:workspace.managedPull.selectStandby')}</option>
                  {availableSources.map(source => (
                    <option key={source.id} value={source.id}>{source.name} · {String(source.protocol || '').toUpperCase()}</option>
                  ))}
                </select>
                <button className={btnSecondary} disabled={!sourceId || working || configurationLocked} onClick={addStandby}>
                  <Plus size={14} />{t('streams:workspace.managedPull.addStandby')}
                </button>
              </div>
            )}
          </div>

          {task.last_source_switch_reason && (
            <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning-soft)]/50 p-3 text-xs text-[var(--warning)]">
              <div className="font-medium">{t('streams:workspace.managedPull.lastSwitch')}</div>
              <div className="mt-1 text-[10px] leading-5">{task.last_source_switch_reason}</div>
            </div>
          )}

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
              <button className={btnPrimary} disabled={working} onClick={() => post(`/pull-tasks/${task.id}/start`)}>
                <Play size={14} />{t('streams:workspace.managedPull.start')}
              </button>
            )}
            {task.runtime_state === 'FAILED' && (
              <button className={btnPrimary} disabled={working} onClick={() => post(`/pull-tasks/${task.id}/retry`)}>
                <RefreshCw size={14} />{t('streams:workspace.managedPull.retry')}
              </button>
            )}
            {task.desired_state === 'RUNNING' && (
              <button className={btnSecondary} disabled={working} onClick={() => post(`/pull-tasks/${task.id}/stop`)}>
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

      <ConfirmDialog
        open={confirmSwitch}
        onClose={() => setConfirmSwitch(false)}
        onConfirm={requestSwitch}
        confirming={working}
        title={t('streams:workspace.managedPull.switchConfirmTitle')}
        description={t('streams:workspace.managedPull.switchConfirmDescription', {
          from: task?.source_name || '—',
          to: switchTarget?.source_name || '—'
        })}
        confirmLabel={t('streams:workspace.managedPull.switchConfirmAction')}
      />
    </section>
  );
}
