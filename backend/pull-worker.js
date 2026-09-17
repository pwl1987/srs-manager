const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const srsService = require('./services/srs');
const pullTaskService = require('./services/pull-task-service');
const { validateStreamUrl } = require('./utils/url-validation');

const INSTANCE_ID = randomUUID();
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SRS_PUBLISH_BASE = (process.env.SRS_RTMP_PUBLISH_BASE || 'rtmp://host.docker.internal:1935/live').replace(/\/+$/, '');
const POLL_MS = Math.max(500, Number(process.env.PULL_WORKER_POLL_MS || 2000));
const STARTUP_TIMEOUT_MS = Math.max(5000, Number(process.env.PULL_STARTUP_TIMEOUT_MS || 15000));
const STOP_GRACE_MS = Math.max(1000, Number(process.env.PULL_STOP_GRACE_MS || 5000));
const MAX_BACKOFF_MS = Math.max(5000, Number(process.env.PULL_MAX_BACKOFF_MS || 30000));
const ALLOWED_SOURCE_PROTOCOLS = ['rtmp', 'rtmps', 'srt', 'rtsp', 'http', 'https'];

const processes = new Map();
let shuttingDown = false;
let timer = null;

function log(message, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[pull-worker ${INSTANCE_ID.slice(0, 8)}] ${message}${suffix}`);
}

function redactText(value) {
  return String(value || '')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)?([^\s?#]+)(\?[^\s#]*)?/g, '$1$3$4'.replace('$4', ''))
    .replace(/([?&](?:token|secret|signature|sig|key|auth|password|passwd)=)[^&\s]+/gi, '$1***')
    .slice(-1200);
}

function targetUrl(task) {
  const url = `${SRS_PUBLISH_BASE}/${encodeURIComponent(task.stream_name)}`;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}srs_manager_pull=${encodeURIComponent(task.id)}`;
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
  pullTaskService.updateRuntime(task.id, {
    runtime_state: 'RETRYING',
    last_error: redactText(error),
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

function spawnTask(task) {
  const check = validateStreamUrl(task.source_url, ALLOWED_SOURCE_PROTOCOLS);
  if (!check.valid) {
    pullTaskService.updateRuntime(task.id, {
      runtime_state: 'FAILED',
      last_error: `Source validation failed: ${check.error}`,
      next_retry_at: null,
      worker_instance_id: null
    });
    return;
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
    startedAt: Date.now(),
    lastStderr: '',
    stopping: false,
    exited: false,
    killTimer: null
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

  child.on('exit', (code, signal) => {
    state.exited = true;
    if (state.killTimer) clearTimeout(state.killTimer);
    processes.delete(task.id);

    const fresh = pullTaskService.getTask(task.id, { includeSecret: true });
    if (!fresh) return;

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
      return;
    }

    if (fresh.desired_state === 'STOPPED' || state.stopping) {
      markStopped(task.id);
      return;
    }

    scheduleRetry(fresh, state.lastStderr || `ffmpeg exited code=${code} signal=${signal || 'none'}`);
  });

  log(`starting task ${task.id} stream=${task.stream_name} source=${task.source_url_masked}`);
}

async function snapshotPublishers() {
  const clients = await srsService.listClients({ pageSize: 100, maxItems: 10000 });
  return new Set(
    clients
      .filter(client => (client.app || 'live') === 'live' && isPublisher(client))
      .map(client => client.stream)
      .filter(Boolean)
  );
}

async function reconcile() {
  if (shuttingDown) return;

  let publisherNames;
  try {
    publisherNames = await snapshotPublishers();
  } catch (error) {
    log('SRS observation unavailable; no new pull task will be started', redactText(error.message));
    for (const task of pullTaskService.listWorkerTasks()) {
      if (!processes.has(task.id) && task.desired_state === 'RUNNING') {
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
      if (state) stopProcess(task.id);
      else if (task.runtime_state !== 'STOPPED') markStopped(task.id);
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

    if (!canRetry(task)) continue;

    if (publisherNames.has(task.stream_name)) {
      if (task.runtime_state !== 'BLOCKED' || task.last_error !== 'Input ownership conflict: publisher already exists') {
        pullTaskService.updateRuntime(task.id, {
          runtime_state: 'BLOCKED',
          last_error: 'Input ownership conflict: publisher already exists',
          next_retry_at: retryAt(5000),
          worker_instance_id: null
        });
      }
      continue;
    }

    spawnTask(task);
  }
}

async function tick() {
  try {
    await reconcile();
  } catch (error) {
    log('reconcile failed', redactText(error.stack || error.message));
  } finally {
    if (!shuttingDown) timer = setTimeout(tick, POLL_MS);
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearTimeout(timer);
  log(`received ${signal}; stopping ${processes.size} managed process(es)`);
  for (const taskId of processes.keys()) stopProcess(taskId, 'worker shutdown');
  if (processes.size === 0) process.exit(0);
  setTimeout(() => process.exit(0), STOP_GRACE_MS + 1000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

pullTaskService.resetStaleRuntime();
log('started');
tick();
