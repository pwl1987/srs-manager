const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const srsService = require('./services/srs');
const pushTaskService = require('./services/push-task-service');
const { buildPushArgs, nextBackoffMs } = require('./services/push-runtime');
const internalMediaService = require('./services/internal-media-service');

const INSTANCE_ID = randomUUID();
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SRS_PULL_BASE = (process.env.SRS_RTMP_PULL_BASE || 'rtmp://host.docker.internal:1935/live').replace(/\/+$/, '');
const POLL_MS = Math.max(500, Number(process.env.PUSH_WORKER_POLL_MS || 2000));
const STARTUP_CONFIRM_MS = Math.max(1500, Number(process.env.PUSH_STARTUP_CONFIRM_MS || 3000));
const STOP_GRACE_MS = Math.max(1000, Number(process.env.PUSH_STOP_GRACE_MS || 5000));
const MAX_BACKOFF_MS = Math.max(5000, Number(process.env.PUSH_MAX_BACKOFF_MS || 30000));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.PUSH_MAX_ATTEMPTS || 8));
const LEASE_MAX_AGE_MS = Math.max(POLL_MS * 3, Number(process.env.PUSH_WORKER_LEASE_MAX_AGE_MS || 10000));
const STANDBY_RETRY_MS = Math.max(1000, Math.min(5000, Math.floor(LEASE_MAX_AGE_MS / 2)));

const processes = new Map();
let shuttingDown = false;
let leaseHeld = false;
let timer = null;
let shutdownTimer = null;
function log(message, extra = '') {
  console.log(`[push-worker ${INSTANCE_ID.slice(0, 8)}] ${message}${extra ? ` ${extra}` : ''}`);
}

function redactText(value) {
  return String(value || '')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)?([^\s?#]+)(\?[^\s#]*)?/g, '$1$3')
    .replace(/([?&][^=\s]*(?:token|secret|signature|sig|key|auth|password|passwd)[^=\s]*=)[^&\s]+/gi, '$1***')
    .slice(-1200);
}

function sourceUrl(task) {
  const base = `${SRS_PULL_BASE}/${encodeURIComponent(task.source_stream_name || task.stream_name)}`;
  const token = internalMediaService.getInternalMediaToken();
  return `${base}?internal_media_token=${encodeURIComponent(token)}&push_task=${encodeURIComponent(task.id)}`;
}

function retryAt(delayMs) {
  return new Date(Date.now() + delayMs).toISOString();
}

function canRetry(task) {
  if (!task.next_retry_at) return true;
  const at = Date.parse(task.next_retry_at);
  return !Number.isFinite(at) || at <= Date.now();
}
function markStopped(taskId) {
  pushTaskService.updateRuntime(taskId, {
    runtime_state: 'STOPPED',
    attempt: 0,
    error_message: null,
    next_retry_at: null,
    worker_instance_id: null,
    last_stopped_at: new Date().toISOString()
  });
}

function markWaitingInput(taskId) {
  pushTaskService.updateRuntime(taskId, {
    runtime_state: 'WAITING_INPUT',
    error_message: null,
    next_retry_at: null,
    worker_instance_id: null
  });
}

function scheduleRetry(task, error) {
  const attempt = Math.max(1, Number(task.attempt || 0));
  const safeError = redactText(error) || 'OUT-PUSH process exited unexpectedly';
  if (attempt >= MAX_ATTEMPTS) {
    pushTaskService.updateRuntime(task.id, {
      runtime_state: 'FAILED',
      error_message: safeError,
      next_retry_at: null,
      worker_instance_id: null
    });
    return;
  }
  pushTaskService.updateRuntime(task.id, {
    runtime_state: 'RETRYING',
    error_message: safeError,
    next_retry_at: retryAt(nextBackoffMs(
      attempt,
      MAX_BACKOFF_MS,
      Math.floor(Math.random() * 500)
    )),
    worker_instance_id: null
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
    pushTaskService.clearWorkerHeartbeat(INSTANCE_ID);
    leaseHeld = false;
  }
  process.exit(exitCode);
}
function spawnTask(task) {
  const source = sourceUrl(task);
  let args;
  try {
    args = buildPushArgs(source, task.target_url);
  } catch (error) {
    pushTaskService.updateRuntime(task.id, {
      runtime_state: 'FAILED',
      error_message: redactText(error.message),
      next_retry_at: null,
      worker_instance_id: null
    });
    return null;
  }

  const attempt = Number(task.attempt || 0) + 1;
  const child = spawn(FFMPEG_BIN, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
    shell: false
  });
  const state = {
    child,
    taskId: task.id,
    streamName: task.source_stream_name || task.stream_name,
    startedAt: Date.now(),
    lastStderr: '',
    stopping: false,
    stopReason: null,
    exited: false,
    killTimer: null
  };
  processes.set(task.id, state);
  pushTaskService.updateRuntime(task.id, {
    runtime_state: 'STARTING',
    attempt,
    error_message: null,
    next_retry_at: null,
    worker_instance_id: INSTANCE_ID,
    last_started_at: new Date().toISOString()
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
      if (shuttingDown && processes.size === 0) finalizeShutdown(0);
      else if (!shuttingDown && !leaseHeld && processes.size === 0) {
        timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
      }
      return;
    }
    const fresh = pushTaskService.getTask(task.id, { includeSecret: true });
    if (!fresh) {
      if (shuttingDown && processes.size === 0) finalizeShutdown(0);
      return;
    }

    if (shuttingDown) {
      if (fresh.desired_state === 'RUNNING') {
        pushTaskService.updateRuntime(task.id, {
          runtime_state: 'RETRYING',
          error_message: 'Push worker stopped; task will reconcile on restart',
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
    if (state.stopReason === 'input offline') {
      markWaitingInput(task.id);
      return;
    }

    const failure = state.lastStderr || `ffmpeg exited code=${code} signal=${signal || 'none'}`;
    scheduleRetry(fresh, failure);
  });
  log(`starting task ${task.id} stream=${task.source_stream_name || task.stream_name} target=${task.target_url_masked}`);
  return state;
}

async function snapshotLiveStreams() {
  const streams = await srsService.getStreams({ pageSize: 100, maxItems: 10000 });
  return new Set(
    streams
      .filter(stream => (stream.app || 'live') === 'live')
      .map(stream => stream.name)
      .filter(Boolean)
  );
}

async function reconcile() {
  if (shuttingDown || !leaseHeld) return;
  let liveStreams;
  try {
    liveStreams = await snapshotLiveStreams();
  } catch (error) {
    log('SRS observation unavailable; no OUT-PUSH will be started', redactText(error.message));
    for (const task of pushTaskService.listWorkerTasks()) {
      if (!processes.has(task.id) && task.desired_state === 'RUNNING' && task.runtime_state !== 'FAILED') {
        pushTaskService.updateRuntime(task.id, {
          runtime_state: 'RETRYING',
          error_message: `SRS observation unavailable: ${redactText(error.message)}`,
          next_retry_at: retryAt(5000),
          worker_instance_id: null
        });
      }
    }
    return;
  }
  for (const task of pushTaskService.listWorkerTasks()) {
    const state = processes.get(task.id);
    const inputOnline = liveStreams.has(task.source_stream_name || task.stream_name);

    if (task.desired_state === 'STOPPED') {
      if (state) stopProcess(task.id, 'desired STOPPED');
      else if (task.runtime_state !== 'STOPPED') markStopped(task.id);
      continue;
    }

    if (state) {
      if (!inputOnline && !state.stopping) {
        stopProcess(task.id, 'input offline');
        continue;
      }
      if (task.runtime_state === 'STARTING' && Date.now() - state.startedAt >= STARTUP_CONFIRM_MS) {
        pushTaskService.updateRuntime(task.id, {
          runtime_state: 'RUNNING',
          error_message: null,
          next_retry_at: null,
          worker_instance_id: INSTANCE_ID
        });
      }
      continue;
    }
    if (!inputOnline) {
      if (task.runtime_state !== 'WAITING_INPUT') markWaitingInput(task.id);
      continue;
    }
    if (task.runtime_state === 'FAILED') continue;
    if (!canRetry(task)) continue;
    spawnTask(task);
  }
}

function handleLeaseLoss() {
  if (!leaseHeld) return;
  leaseHeld = false;
  log(`lease lost; draining ${processes.size} managed process(es)`);
  for (const taskId of processes.keys()) stopProcess(taskId, 'lease lost');
  if (!shuttingDown && processes.size === 0) {
    timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
  }
}

async function tick() {
  if (shuttingDown || !leaseHeld) return;
  try {
    if (!pushTaskService.renewWorkerLease(INSTANCE_ID)) {
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
    const lease = pushTaskService.claimWorkerLease(INSTANCE_ID, LEASE_MAX_AGE_MS);
    if (!lease.acquired) {
      log(`standby; active worker=${String(lease.instance_id).slice(0, 8)} age=${lease.age_ms}ms`);
      timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
      return;
    }
    leaseHeld = true;
    pushTaskService.resetStaleRuntime();
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
