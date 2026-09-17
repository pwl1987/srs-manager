const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const srsService = require('./services/srs');
const pullTaskService = require('./services/pull-task-service');
const internalMediaService = require('./services/internal-media-service');
const operationService = require('./services/operation-service');
const { decidePullSwitchStep } = require('./services/pull-switch-machine');
const { decidePullSwitchRecovery } = require('./services/pull-switch-recovery');
const { decidePullFailure } = require('./services/pull-failover-policy');
const { validateStreamUrl } = require('./utils/url-validation');

const INSTANCE_ID = randomUUID();
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SRS_PUBLISH_BASE = (process.env.SRS_RTMP_PUBLISH_BASE || 'rtmp://host.docker.internal:1935/live').replace(/\/+$/, '');
const POLL_MS = Math.max(500, Number(process.env.PULL_WORKER_POLL_MS || 2000));
const STARTUP_TIMEOUT_MS = Math.max(5000, Number(process.env.PULL_STARTUP_TIMEOUT_MS || 15000));
const STOP_GRACE_MS = Math.max(1000, Number(process.env.PULL_STOP_GRACE_MS || 5000));
const SWITCH_STOP_TIMEOUT_MS = Math.max(STOP_GRACE_MS, Number(process.env.PULL_SWITCH_STOP_TIMEOUT_MS || 10000));
const MAX_BACKOFF_MS = Math.max(5000, Number(process.env.PULL_MAX_BACKOFF_MS || 30000));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.PULL_MAX_ATTEMPTS || 8));
const SOURCE_MAX_ATTEMPTS = Math.max(1, Number(process.env.PULL_SOURCE_MAX_ATTEMPTS || 3));
const LEASE_MAX_AGE_MS = Math.max(POLL_MS * 3, Number(process.env.PULL_WORKER_LEASE_MAX_AGE_MS || 10000));
const STANDBY_RETRY_MS = Math.max(1000, Math.min(5000, Math.floor(LEASE_MAX_AGE_MS / 2)));
const ALLOWED_SOURCE_PROTOCOLS = ['rtmp', 'rtmps', 'srt', 'rtsp', 'http', 'https'];

const processes = new Map();
let shuttingDown = false;
let leaseHeld = false;
let timer = null;
let shutdownTimer = null;

function log(message, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[pull-worker ${INSTANCE_ID.slice(0, 8)}] ${message}${suffix}`);
}

function redactText(value) {
  return String(value || '')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)?([^\s?#]+)(\?[^\s#]*)?/g, '$1$3')
    .replace(/([?&](?:token|secret|signature|sig|key|auth|password|passwd)=)[^&\s]+/gi, '$1***')
    .slice(-1200);
}

function targetUrl(task) {
  const url = `${SRS_PUBLISH_BASE}/${encodeURIComponent(task.stream_name)}`;
  const separator = url.includes('?') ? '&' : '?';
  const token = internalMediaService.getInternalMediaToken();
  return `${url}${separator}internal_media_token=${encodeURIComponent(token)}&srs_manager_pull=${encodeURIComponent(task.id)}`;
}

function nextBackoffMs(attempt) {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(Math.max(0, attempt - 1), 5)));
  return Math.min(MAX_BACKOFF_MS, base + Math.floor(Math.random() * 500));
}

function retryAt(delayMs) {
  return new Date(Date.now() + delayMs).toISOString();
}

function canRetry(task) {
  if (!task.next_retry_at) return true;
  const at = Date.parse(task.next_retry_at);
  return !Number.isFinite(at) || at <= Date.now();
}

function isPublisher(client) {
  return String(client?.type || '').toLowerCase().includes('publish');
}

function scheduleRetry(task, error) {
  const attempt = Math.max(1, Number(task.attempt || 0));
  const safeError = redactText(error);
  const decision = decidePullFailure({
    attempt,
    maxAttempts: MAX_ATTEMPTS,
    sourceMaxAttempts: SOURCE_MAX_ATTEMPTS,
    sources: task.sources || [],
    activeSourceId: task.active_source_id
  });

  if (decision.action === 'failover') {
    const next = (task.sources || []).find(source => Number(source.external_source_id) === Number(decision.next_source_id));
    const reason = `Source ${task.source_name || task.active_source_id} failed after ${attempt} attempts: ${safeError || 'unknown error'}`;
    pullTaskService.switchActiveSource(task.id, decision.next_source_id, reason, 'RETRYING');
    log(`failover task ${task.id} stream=${task.stream_name} -> source=${next?.source_name || decision.next_source_id}`);
    return;
  }

  if (decision.action === 'failed') {
    pullTaskService.updateRuntime(task.id, {
      runtime_state: 'FAILED',
      last_error: decision.reason === 'all_sources_exhausted'
        ? `All enabled pull sources exhausted; last error: ${safeError || 'unknown error'}`
        : (safeError || `Pull failed after ${attempt} attempts`),
      next_retry_at: null,
      worker_instance_id: null
    });
    return;
  }

  pullTaskService.updateRuntime(task.id, {
    runtime_state: 'RETRYING',
    last_error: safeError,
    next_retry_at: retryAt(nextBackoffMs(attempt)),
    worker_instance_id: null
  });
}

function markStopped(taskId) {
  pullTaskService.updateRuntime(taskId, {
    runtime_state: 'STOPPED',
    attempt: 0,
    last_error: null,
    next_retry_at: null,
    worker_instance_id: null,
    last_stopped_at: new Date().toISOString()
  });
}

function stopProcess(taskId, reason = 'desired STOPPED') {
  const state = processes.get(taskId);
  if (!state || state.stopping) return;
  state.stopping = true;
  state.stopReason = reason;
  state.child.kill('SIGTERM');
  state.killTimer = setTimeout(() => {
    if (!state.exited) state.child.kill('SIGKILL');
  }, STOP_GRACE_MS);
}

function finalizeShutdown(exitCode = 0) {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (leaseHeld) {
    pullTaskService.clearWorkerHeartbeat(INSTANCE_ID);
    leaseHeld = false;
  }
  process.exit(exitCode);
}

function spawnTask(task, switchOperationId = null) {
  if (!task.source_url) {
    pullTaskService.updateRuntime(task.id, {
      runtime_state: 'FAILED',
      last_error: 'No usable active pull source',
      next_retry_at: null,
      worker_instance_id: null
    });
    if (switchOperationId) operationService.failOperation(switchOperationId, 'No usable active pull source');
    return null;
  }

  const check = validateStreamUrl(task.source_url, ALLOWED_SOURCE_PROTOCOLS, { allowPrivateNetwork: true });
  if (!check.valid) {
    pullTaskService.updateRuntime(task.id, {
      runtime_state: 'FAILED',
      last_error: `Source validation failed: ${check.error}`,
      next_retry_at: null,
      worker_instance_id: null
    });
    if (switchOperationId) operationService.failOperation(switchOperationId, `Source validation failed: ${check.error}`);
    return null;
  }

  const attempt = Number(task.attempt || 0) + 1;
  const output = targetUrl(task);
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'warning',
    '-i', task.source_url,
    '-map', '0:v?', '-map', '0:a?',
    '-c', 'copy', '-f', 'flv', output
  ];

  const child = spawn(FFMPEG_BIN, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
    shell: false
  });

  const state = {
    child,
    taskId: task.id,
    streamName: task.stream_name,
    sourceId: task.active_source_id,
    startedAt: Date.now(),
    lastStderr: '',
    stopping: false,
    stopReason: null,
    exited: false,
    killTimer: null,
    switchOperationId
  };
  processes.set(task.id, state);

  pullTaskService.updateRuntime(task.id, {
    runtime_state: 'STARTING',
    attempt,
    last_error: null,
    last_started_at: new Date().toISOString(),
    next_retry_at: null,
    worker_instance_id: INSTANCE_ID
  });

  child.stderr?.on('data', chunk => {
    state.lastStderr = redactText(`${state.lastStderr}\n${chunk.toString('utf8')}`);
  });

  child.on('error', error => {
    state.lastStderr = redactText(error.message);
  });

  child.once('close', (code, signal) => {
    state.exited = true;
    if (state.killTimer) clearTimeout(state.killTimer);
    processes.delete(task.id);

    if (state.stopReason === 'lease lost') {
      if (shuttingDown) {
        if (processes.size === 0) finalizeShutdown(0);
      } else if (!leaseHeld && processes.size === 0) {
        timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
      }
      return;
    }

    const fresh = pullTaskService.getTask(task.id, { includeSecret: true });
    if (!fresh) {
      if (shuttingDown && processes.size === 0) finalizeShutdown(0);
      return;
    }

    if (shuttingDown) {
      if (fresh.desired_state === 'RUNNING') {
        pullTaskService.updateRuntime(task.id, {
          runtime_state: 'RETRYING',
          last_error: 'Pull worker stopped; task will reconcile on restart',
          next_retry_at: new Date().toISOString(),
          worker_instance_id: null
        });
      } else {
        markStopped(task.id);
      }
      if (processes.size === 0) finalizeShutdown(0);
      return;
    }

    if (fresh.desired_state === 'STOPPED' || state.stopReason === 'desired STOPPED') {
      markStopped(task.id);
      return;
    }

    if (state.stopReason === 'source switch') {
      pullTaskService.updateRuntime(task.id, {
        runtime_state: 'RETRYING',
        last_error: null,
        next_retry_at: new Date().toISOString(),
        worker_instance_id: null
      });
      return;
    }

    if (state.stopReason === 'switch operation failed') {
      const operation = state.rollbackOperationId ? operationService.getOperation(state.rollbackOperationId) : null;
      if (operation && startPreviousSourceRollback(fresh, operation, state.rollbackReason || 'Switch operation failed')) return;
      return;
    }

    const failure = state.lastStderr
      || (state.stopReason === 'startup timeout'
        ? 'Timed out waiting for SRS publisher observation'
        : `ffmpeg exited code=${code} signal=${signal || 'none'}`);
    if (state.switchOperationId) {
      const operation = operationService.getOperation(state.switchOperationId);
      state.switchOperationId = null;
      if (operation && failSwitchAndProtectProgram(fresh, null, false, operation, failure)) return;
    }
    scheduleRetry(fresh, failure);
  });

  log(`starting task ${task.id} stream=${task.stream_name} source=${task.source_url_masked}`);
  return state;
}

async function snapshotPublishers() {
  const clients = await srsService.listClients({ pageSize: 100, maxItems: 10000 });
  return new Set(
    clients
      .filter(client => (srsService.clientAppName(client) || 'live') === 'live' && isPublisher(client))
      .map(client => srsService.clientStreamName(client))
      .filter(Boolean)
  );
}

function startPreviousSourceRollback(task, operation, reason) {
  const fromSourceId = Number(operation?.payload?.from_source_id);
  if (!Number.isInteger(fromSourceId) || fromSourceId <= 0) return false;
  try {
    pullTaskService.switchActiveSource(
      task.id,
      fromSourceId,
      `Rollback after failed source switch #${operation.id}: ${reason}`,
      'RETRYING'
    );
    const restored = pullTaskService.getTask(task.id, { includeSecret: true });
    const started = restored ? spawnTask(restored) : null;
    if (!started) return false;
    log(`switch operation ${operation.id} rollback started stream=${task.stream_name} source=${fromSourceId}`);
    return true;
  } catch (error) {
    log(`switch operation ${operation.id} rollback failed stream=${task.stream_name}`, redactText(error.message || error));
    return false;
  }
}

function failSwitchAndProtectProgram(task, state, publisherObserved, operation, reason) {
  const plan = decidePullSwitchRecovery({
    operation,
    processState: state,
    publisherObserved,
    activeSourceId: task.active_source_id
  });
  const result = {
    from_source_id: operation.payload?.from_source_id || null,
    target_source_id: operation.payload?.target_source_id || null,
    recovery: plan.action,
    recovery_source_id: plan.source_id || null
  };
  operationService.failOperation(operation.id, reason, result);

  if (plan.action === 'preserve_current') {
    pullTaskService.updateRuntime(task.id, {
      active_source_id: plan.source_id,
      runtime_state: publisherObserved ? 'RUNNING' : 'STARTING',
      last_error: `Switch failed; previous Program preserved: ${reason}`,
      next_retry_at: null,
      worker_instance_id: INSTANCE_ID
    });
    if (state) state.switchOperationId = null;
    log(`switch operation ${operation.id} failed; previous Program preserved stream=${task.stream_name} source=${plan.source_id}`, reason);
    return true;
  }

  if (plan.action === 'preserve_observed') {
    pullTaskService.updateRuntime(task.id, {
      active_source_id: plan.source_id,
      runtime_state: 'BLOCKED',
      last_error: `Switch failed; previous publisher remains observed without managed process ownership: ${reason}`,
      next_retry_at: null,
      worker_instance_id: null
    });
    log(`switch operation ${operation.id} failed; observed previous Program left untouched stream=${task.stream_name} source=${plan.source_id}`, reason);
    return true;
  }

  if (plan.action === 'rollback') {
    if (state && !state.exited) {
      state.rollbackOperationId = operation.id;
      state.rollbackReason = reason;
      state.switchOperationId = null;
      if (!state.stopping) stopProcess(task.id, 'switch operation failed');
      return true;
    }
    if (startPreviousSourceRollback(task, operation, reason)) return true;
  }

  pullTaskService.updateRuntime(task.id, {
    runtime_state: 'FAILED',
    last_error: reason,
    next_retry_at: null,
    worker_instance_id: null
  });
  return false;
}

function reconcileSwitchOperation(task, state, publisherObserved) {
  const operation = operationService.getActivePullSwitch(task.id);
  if (!operation) return false;

  const decision = decidePullSwitchStep({
    operation,
    processState: state,
    publisherObserved,
    stopTimeoutMs: SWITCH_STOP_TIMEOUT_MS,
    startupTimeoutMs: STARTUP_TIMEOUT_MS
  });

  try {
    switch (decision.action) {
      case 'stop_current':
        if (operation.state === 'QUEUED') operationService.transitionOperation(operation.id, 'STOPPING');
        if (state && !state.stopping) stopProcess(task.id, 'source switch');
        return true;

      case 'begin_stop_wait':
        if (operation.state === 'QUEUED') operationService.transitionOperation(operation.id, 'STOPPING');
        return true;

      case 'activate_target': {
        let currentOperation = operation;
        if (currentOperation.state === 'QUEUED') {
          currentOperation = operationService.transitionOperation(currentOperation.id, 'STOPPING');
        }
        const targetId = Number(currentOperation.payload?.target_source_id);
        pullTaskService.switchActiveSource(
          task.id,
          targetId,
          `Manual source switch operation #${currentOperation.id}`,
          'RETRYING'
        );
        operationService.transitionOperation(currentOperation.id, 'STARTING');
        log(`switch operation ${currentOperation.id} activated target source=${targetId} stream=${task.stream_name}`);
        return true;
      }

      case 'start_target': {
        const fresh = pullTaskService.getTask(task.id, { includeSecret: true });
        const targetId = Number(operation.payload?.target_source_id);
        if (!fresh || Number(fresh.active_source_id) !== targetId) {
          throw new Error('Pull task active source does not match switch target');
        }
        const started = spawnTask(fresh, operation.id);
        if (started && operation.state === 'STARTING') {
          operationService.transitionOperation(operation.id, 'VERIFYING');
        }
        return true;
      }

      case 'mark_verifying':
        if (state) state.switchOperationId = operation.id;
        if (operation.state === 'STARTING') operationService.transitionOperation(operation.id, 'VERIFYING');
        return true;

      case 'succeed':
        pullTaskService.updateRuntime(task.id, {
          runtime_state: 'RUNNING',
          last_error: null,
          next_retry_at: null,
          worker_instance_id: INSTANCE_ID
        });
        operationService.transitionOperation(operation.id, 'SUCCEEDED', {
          result: {
            from_source_id: operation.payload?.from_source_id || null,
            active_source_id: Number(operation.payload?.target_source_id)
          }
        });
        if (state) state.switchOperationId = null;
        log(`switch operation ${operation.id} succeeded stream=${task.stream_name} source=${operation.payload?.target_source_id}`);
        return true;

      case 'fail': {
        const reason = decision.reason || 'Pull source switch failed';
        failSwitchAndProtectProgram(task, state, publisherObserved, operation, reason);
        return true;
      }

      case 'wait':
      default:
        return true;
    }
  } catch (error) {
    const reason = redactText(error.message || error);
    failSwitchAndProtectProgram(task, state, publisherObserved, operation, reason);
    log(`switch operation ${operation.id} exception stream=${task.stream_name}`, reason);
    return true;
  }
}

async function reconcile() {
  if (shuttingDown || !leaseHeld) return;

  let publisherNames;
  try {
    publisherNames = await snapshotPublishers();
  } catch (error) {
    log('SRS observation unavailable; no new pull task will be started', redactText(error.message));
    for (const task of pullTaskService.listWorkerTasks()) {
      if (!processes.has(task.id) && task.desired_state === 'RUNNING' && task.runtime_state !== 'FAILED') {
        pullTaskService.updateRuntime(task.id, {
          runtime_state: 'RETRYING',
          last_error: `SRS observation unavailable: ${redactText(error.message)}`,
          next_retry_at: retryAt(Math.min(MAX_BACKOFF_MS, 5000)),
          worker_instance_id: null
        });
      }
    }
    return;
  }

  const tasks = pullTaskService.listWorkerTasks();
  for (const task of tasks) {
    const state = processes.get(task.id);

    if (task.desired_state === 'STOPPED') {
      operationService.cancelActivePullSwitch(task.id, 'Pull task stopped while source switch was in progress');
      if (state) stopProcess(task.id, 'desired STOPPED');
      else if (task.runtime_state !== 'STOPPED') markStopped(task.id);
      continue;
    }

    if (reconcileSwitchOperation(task, state, publisherNames.has(task.stream_name))) {
      continue;
    }

    if (state) {
      const observed = publisherNames.has(task.stream_name);
      if (observed && task.runtime_state !== 'RUNNING') {
        pullTaskService.updateRuntime(task.id, {
          runtime_state: 'RUNNING',
          last_error: null,
          next_retry_at: null,
          worker_instance_id: INSTANCE_ID
        });
      } else if (!observed && Date.now() - state.startedAt > STARTUP_TIMEOUT_MS && !state.stopping) {
        state.lastStderr = state.lastStderr || 'Timed out waiting for SRS publisher observation';
        stopProcess(task.id, 'startup timeout');
      }
      continue;
    }

    if (task.runtime_state === 'FAILED') continue;
    if (!canRetry(task)) continue;

    if (publisherNames.has(task.stream_name)) {
      pullTaskService.updateRuntime(task.id, {
        runtime_state: 'BLOCKED',
        last_error: 'Input ownership conflict: publisher already exists',
        next_retry_at: retryAt(5000),
        worker_instance_id: null
      });
      continue;
    }

    spawnTask(task);
  }
}

function handleLeaseLoss() {
  if (!leaseHeld) return;
  leaseHeld = false;
  log(`lease lost; draining ${processes.size} managed process(es)`);
  for (const taskId of processes.keys()) stopProcess(taskId, 'lease lost');
  if (!shuttingDown && processes.size === 0) timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
}

async function tick() {
  if (shuttingDown || !leaseHeld) return;
  try {
    if (!pullTaskService.renewWorkerLease(INSTANCE_ID)) {
      handleLeaseLoss();
      return;
    }
    await reconcile();
  } catch (error) {
    log('reconcile failed', redactText(error.stack || error.message));
  } finally {
    if (!shuttingDown && leaseHeld) timer = setTimeout(tick, POLL_MS);
  }
}

function bootstrap() {
  if (shuttingDown || leaseHeld) return;
  try {
    const lease = pullTaskService.claimWorkerLease(INSTANCE_ID, LEASE_MAX_AGE_MS);
    if (!lease.acquired) {
      log(`standby; active worker=${String(lease.instance_id).slice(0, 8)} age=${lease.age_ms}ms`);
      timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
      return;
    }
    leaseHeld = true;
    pullTaskService.resetStaleRuntime();
    log('lease acquired; started');
    tick();
  } catch (error) {
    log('lease acquisition failed', redactText(error.stack || error.message));
    timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearTimeout(timer);
  log(`received ${signal}; stopping ${processes.size} managed process(es)`);
  for (const taskId of processes.keys()) stopProcess(taskId, 'worker shutdown');
  if (processes.size === 0) {
    finalizeShutdown(0);
    return;
  }
  shutdownTimer = setTimeout(() => finalizeShutdown(0), STOP_GRACE_MS + 1000);
  shutdownTimer.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap();
