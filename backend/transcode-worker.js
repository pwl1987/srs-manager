const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const srsService = require('./services/srs');
const bindingService = require('./services/transcode-binding-service');
const { buildGroupArgs, bindingSignature } = require('./services/transcode-runtime');
const internalMediaService = require('./services/internal-media-service');

const INSTANCE_ID = randomUUID();
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SRS_PULL_BASE = (process.env.SRS_RTMP_PULL_BASE || 'rtmp://host.docker.internal:1935/live').replace(/\/+$/, '');
const SRS_PUBLISH_BASE = (process.env.SRS_RTMP_PUBLISH_BASE || 'rtmp://host.docker.internal:1935/live').replace(/\/+$/, '');
const POLL_MS = Math.max(500, Number(process.env.TRANSCODE_WORKER_POLL_MS || 2000));
const STARTUP_TIMEOUT_MS = Math.max(5000, Number(process.env.TRANSCODE_STARTUP_TIMEOUT_MS || 15000));
const STOP_GRACE_MS = Math.max(1000, Number(process.env.TRANSCODE_STOP_GRACE_MS || 5000));
const MAX_BACKOFF_MS = Math.max(5000, Number(process.env.TRANSCODE_MAX_BACKOFF_MS || 30000));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.TRANSCODE_MAX_ATTEMPTS || 8));
const LEASE_MAX_AGE_MS = Math.max(POLL_MS * 3, Number(process.env.TRANSCODE_WORKER_LEASE_MAX_AGE_MS || 10000));
const STANDBY_RETRY_MS = Math.max(1000, Math.min(5000, Math.floor(LEASE_MAX_AGE_MS / 2)));

const processes = new Map();
let shuttingDown = false;
let leaseHeld = false;
let timer = null;
let shutdownTimer = null;

function log(message, extra = '') {
  console.log(`[transcode-worker ${INSTANCE_ID.slice(0, 8)}] ${message}${extra ? ` ${extra}` : ''}`);
}

function redactText(value) {
  return String(value || '')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)?([^\s?#]+)(\?[^\s#]*)?/g, '$1$3')
    .replace(/([?&][^=\s]*(?:token|secret|signature|sig|key|auth|password|passwd)[^=\s]*=)[^&\s]+/gi, '$1***')
    .slice(-1600);
}

function sourceUrl(binding) {
  const token = internalMediaService.getInternalMediaToken();
  return `${SRS_PULL_BASE}/${encodeURIComponent(binding.stream_name)}?internal_media_token=${encodeURIComponent(token)}&transcode_stream=${encodeURIComponent(binding.stream_id)}`;
}

function targetUrl(binding) {
  return `${SRS_PUBLISH_BASE}/${encodeURIComponent(binding.output_stream_name)}?srs_manager_transcode=${encodeURIComponent(binding.id)}`;
}

function retryAt(delayMs) {
  return new Date(Date.now() + delayMs).toISOString();
}

function nextBackoffMs(attempt) {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(Math.max(0, attempt - 1), 5)));
  return Math.min(MAX_BACKOFF_MS, base + Math.floor(Math.random() * 500));
}

function ids(bindings) {
  return bindings.map(binding => binding.id);
}

function markStopped(bindings) {
  if (!bindings.length) return;
  bindingService.updateRuntimeMany(ids(bindings), {
    runtime_state: 'STOPPED', attempt: 0, last_error: null,
    next_retry_at: null, worker_instance_id: null,
    last_stopped_at: new Date().toISOString()
  });
}

function markWaitingInput(bindings) {
  if (!bindings.length) return;
  bindingService.updateRuntimeMany(ids(bindings), {
    runtime_state: 'WAITING_INPUT', last_error: null,
    next_retry_at: null, worker_instance_id: null
  });
}

function scheduleRetry(bindings, error) {
  if (!bindings.length) return;
  const attempt = Math.max(...bindings.map(binding => Math.max(1, Number(binding.attempt || 0))));
  const safeError = redactText(error) || 'Transcode pipeline exited unexpectedly';
  if (attempt >= MAX_ATTEMPTS) {
    bindingService.updateRuntimeMany(ids(bindings), {
      runtime_state: 'FAILED', last_error: safeError,
      next_retry_at: null, worker_instance_id: null
    });
    return;
  }
  bindingService.updateRuntimeMany(ids(bindings), {
    runtime_state: 'RETRYING', last_error: safeError,
    next_retry_at: retryAt(nextBackoffMs(attempt)), worker_instance_id: null
  });
}

function stopProcess(streamId, reason) {
  const state = processes.get(Number(streamId));
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
    bindingService.clearWorkerHeartbeat(INSTANCE_ID);
    leaseHeld = false;
  }
  process.exit(exitCode);
}

function spawnGroup(bindings) {
  const active = bindings.filter(binding => binding.desired_state === 'RUNNING' && binding.template_enabled);
  if (!active.length) return null;
  const streamId = active[0].stream_id;
  let args;
  try {
    args = buildGroupArgs(sourceUrl(active[0]), active, targetUrl);
  } catch (error) {
    bindingService.updateRuntimeMany(ids(active), {
      runtime_state: 'FAILED', last_error: redactText(error.message),
      next_retry_at: null, worker_instance_id: null
    });
    return null;
  }

  const attempt = Math.max(...active.map(binding => Number(binding.attempt || 0))) + 1;
  const child = spawn(FFMPEG_BIN, args, {
    stdio: ['ignore', 'ignore', 'pipe'], env: process.env, shell: false
  });
  const state = {
    child, streamId, streamName: active[0].stream_name,
    bindingIds: ids(active),
    expectedOutputs: active.map(binding => binding.output_stream_name),
    signature: bindingSignature(active),
    startedAt: Date.now(), lastStderr: '', stopping: false,
    stopReason: null, exited: false, killTimer: null
  };
  processes.set(streamId, state);
  bindingService.updateRuntimeMany(state.bindingIds, {
    runtime_state: 'STARTING', attempt, last_error: null,
    next_retry_at: null, worker_instance_id: INSTANCE_ID,
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
    processes.delete(streamId);
    handleProcessExit(state, code, signal);
  });

  log(`starting stream=${state.streamName} outputs=${state.expectedOutputs.join(',')}`);
  return state;
}

function handleProcessExit(state, code, signal) {
  const fresh = bindingService.listBindingsByStream(state.streamId);
  const desired = fresh.filter(binding => binding.desired_state === 'RUNNING' && binding.template_enabled);
  const stopped = fresh.filter(binding => binding.desired_state === 'STOPPED');
  if (stopped.length) markStopped(stopped);

  if (state.stopReason === 'lease lost') {
    if (shuttingDown && processes.size === 0) finalizeShutdown(0);
    else if (!shuttingDown && !leaseHeld && processes.size === 0) {
      timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
    }
    return;
  }
  if (!desired.length) {
    if (shuttingDown && processes.size === 0) finalizeShutdown(0);
    return;
  }
  if (shuttingDown) {
    bindingService.updateRuntimeMany(ids(desired), {
      runtime_state: 'RETRYING',
      last_error: 'Transcode worker stopped; pipeline will reconcile on restart',
      next_retry_at: new Date().toISOString(), worker_instance_id: null
    });
    if (processes.size === 0) finalizeShutdown(0);
    return;
  }
  if (state.stopReason === 'input offline') {
    markWaitingInput(desired);
    return;
  }
  if (state.stopReason === 'configuration changed' || state.stopReason === 'desired state changed') {
    bindingService.updateRuntimeMany(ids(desired), {
      runtime_state: 'RETRYING', last_error: null,
      next_retry_at: new Date().toISOString(), worker_instance_id: null
    });
    return;
  }

  const failure = state.lastStderr || (state.stopReason === 'startup timeout'
    ? 'Timed out waiting for all derived SRS streams'
    : `ffmpeg exited code=${code} signal=${signal || 'none'}`);
  scheduleRetry(desired, failure);
}

function groupBindings(bindings) {
  const groups = new Map();
  for (const binding of bindings) {
    const key = Number(binding.stream_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(binding);
  }
  return groups;
}

async function snapshotLiveStreams() {
  const streams = await srsService.getStreams({ pageSize: 100, maxItems: 10000 });
  return new Map(streams.filter(stream => (stream.app || 'live') === 'live' && stream.name)
    .map(stream => [stream.name, stream]));
}

function retryReady(bindings) {
  const times = bindings
    .map(binding => Date.parse(binding.next_retry_at))
    .filter(Number.isFinite);
  return times.length === 0 || Math.min(...times) <= Date.now();
}

function failDisabledTemplates(bindings) {
  const invalid = bindings.filter(binding => binding.desired_state === 'RUNNING' && !binding.template_enabled);
  if (!invalid.length) return;
  bindingService.updateRuntimeMany(ids(invalid), {
    runtime_state: 'FAILED', last_error: 'Transcode template is disabled',
    next_retry_at: null, worker_instance_id: null
  });
}

async function reconcile() {
  if (shuttingDown || !leaseHeld) return;
  const allBindings = bindingService.listWorkerBindings();
  const groups = groupBindings(allBindings);
  let liveStreams;
  try {
    liveStreams = await snapshotLiveStreams();
  } catch (error) {
    handleObservationFailure(allBindings, error);
    return;
  }

  for (const [streamId, bindings] of groups) {
    reconcileStream(streamId, bindings, liveStreams);
  }
  for (const streamId of processes.keys()) {
    if (!groups.has(streamId)) stopProcess(streamId, 'desired state changed');
  }
}

function handleObservationFailure(bindings, error) {
  const message = `SRS observation unavailable: ${redactText(error.message)}`;
  log('SRS observation unavailable; no transcode pipeline will be started', redactText(error.message));
  for (const binding of bindings) {
    if (binding.desired_state !== 'RUNNING' || binding.runtime_state === 'FAILED') continue;
    bindingService.updateRuntime(binding.id, {
      runtime_state: 'RETRYING', last_error: message,
      next_retry_at: retryAt(5000), worker_instance_id: null
    });
  }
}

function reconcileStream(streamId, bindings, liveStreams) {
  const state = processes.get(streamId);
  failDisabledTemplates(bindings);
  const desired = bindings.filter(binding => binding.desired_state === 'RUNNING' && binding.template_enabled);
  const stopped = bindings.filter(binding => binding.desired_state === 'STOPPED');
  if (!state && stopped.some(binding => binding.runtime_state !== 'STOPPED')) markStopped(stopped);

  if (!desired.length) {
    if (state) stopProcess(streamId, 'desired state changed');
    return;
  }

  const sourceOnline = liveStreams.has(desired[0].stream_name);
  const signature = bindingSignature(desired);
  if (state) {
    reconcileRunningState(state, desired, liveStreams, sourceOnline, signature);
    return;
  }

  if (!sourceOnline) {
    if (desired.some(binding => binding.runtime_state !== 'WAITING_INPUT')) markWaitingInput(desired);
    return;
  }
  if (desired.some(binding => binding.runtime_state === 'FAILED')) return;
  if (!retryReady(desired)) return;
  spawnGroup(desired);
}

function reconcileRunningState(state, desired, liveStreams, sourceOnline, signature) {
  if (state.signature !== signature) {
    stopProcess(state.streamId, 'configuration changed');
    return;
  }
  if (!sourceOnline) {
    stopProcess(state.streamId, 'input offline');
    return;
  }

  const outputsObserved = state.expectedOutputs.every(name => liveStreams.has(name));
  if (outputsObserved) {
    const pending = desired.filter(binding => binding.runtime_state !== 'RUNNING');
    if (pending.length) {
      bindingService.updateRuntimeMany(ids(pending), {
        runtime_state: 'RUNNING', last_error: null,
        next_retry_at: null, worker_instance_id: INSTANCE_ID
      });
    }
    return;
  }

  if (Date.now() - state.startedAt >= STARTUP_TIMEOUT_MS) {
    stopProcess(state.streamId, 'startup timeout');
  }
}

function handleLeaseLoss() {
  if (!leaseHeld) return;
  leaseHeld = false;
  log(`lease lost; draining ${processes.size} pipeline(s)`);
  for (const streamId of processes.keys()) stopProcess(streamId, 'lease lost');
  if (!shuttingDown && processes.size === 0) {
    timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
  }
}

async function tick() {
  if (shuttingDown || !leaseHeld) return;
  try {
    if (!bindingService.renewWorkerLease(INSTANCE_ID)) {
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
    const lease = bindingService.claimWorkerLease(INSTANCE_ID, LEASE_MAX_AGE_MS);
    if (!lease.acquired) {
      log(`standby; active worker=${String(lease.instance_id).slice(0, 8)} age=${lease.age_ms}ms`);
      timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
      return;
    }
    leaseHeld = true;
    bindingService.resetStaleRuntime();
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
  log(`received ${signal}; stopping ${processes.size} pipeline(s)`);
  for (const streamId of processes.keys()) stopProcess(streamId, 'worker shutdown');
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
