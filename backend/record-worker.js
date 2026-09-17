const { spawn, spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const srsService = require('./services/srs');
const taskService = require('./services/record-task-service');
const assetService = require('./services/record-asset-service');
const storageService = require('./services/record-storage-service');
const recordRuntime = require('./services/record-runtime');
const internalMediaService = require('./services/internal-media-service');

const INSTANCE_ID = randomUUID();
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
const SRS_PULL_BASE = (process.env.SRS_RTMP_PULL_BASE || 'rtmp://host.docker.internal:1935/live').replace(/\/+$/, '');
const POLL_MS = Math.max(500, Number(process.env.RECORD_WORKER_POLL_MS || 2000));
const STOP_GRACE_MS = Math.max(1000, Number(process.env.RECORD_STOP_GRACE_MS || 5000));
const STALL_MS = Math.max(10000, Number(process.env.RECORD_STALL_MS || 30000));
const LEASE_MAX_AGE_MS = Math.max(POLL_MS * 3, Number(process.env.RECORD_WORKER_LEASE_MAX_AGE_MS || 10000));
const STANDBY_RETRY_MS = Math.max(1000, Math.min(5000, Math.floor(LEASE_MAX_AGE_MS / 2)));
const FINALIZE_TIMEOUT_MS = Math.max(10000, Number(process.env.RECORD_FINALIZE_TIMEOUT_MS || 120000));
const processes = new Map();
let shuttingDown = false;
let leaseHeld = false;
let timer = null;
let shutdownTimer = null;

function log(message, extra = '') {
  console.log(`[record-worker ${INSTANCE_ID.slice(0, 8)}] ${message}${extra ? ` ${extra}` : ''}`);
}

function redactText(value) {
  return String(value || '')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)?([^\s?#]+)(\?[^\s#]*)?/g, '$1$3')
    .replace(/([?&][^=\s]*(?:token|secret|signature|sig|key|auth|password|passwd)[^=\s]*=)[^&\s]+/gi, '$1***')
    .slice(-1600);
}

function sourceUrl(task) {
  const token = internalMediaService.getInternalMediaToken();
  const name = encodeURIComponent(task.source_stream_name || task.stream_name);
  return `${SRS_PULL_BASE}/${name}?internal_media_token=${encodeURIComponent(token)}&record_task=${encodeURIComponent(task.id)}`;
}

function estimatedBitrate(task) {
  const fallback = task.format === 'audio' ? 512_000 : 12_000_000;
  return Math.max(64_000, Number(process.env.RECORD_ESTIMATED_BITRATE_BPS || fallback));
}
function diskBudget(task) {
  const reserveRatio = Number(process.env.RECORD_RESERVE_RATIO || 0.10);
  const minReserveBytes = Number(process.env.RECORD_MIN_FREE_BYTES || 256 * 1024 * 1024);
  return storageService.diskBudget(estimatedBitrate(task), { reserveRatio, minReserveBytes });
}

function markTask(taskId, runtimeState, extra = {}) {
  return taskService.updateRuntime(taskId, { runtime_state: runtimeState, ...extra });
}

function markStopped(taskId) {
  return markTask(taskId, 'STOPPED', {
    worker_instance_id: null, last_error: null,
    last_stopped_at: new Date().toISOString()
  });
}

function markWaiting(taskId) {
  return markTask(taskId, 'STARTING', {
    worker_instance_id: null, last_error: null
  });
}

async function snapshotLiveStreams() {
  const streams = await srsService.getStreams({ pageSize: 100, maxItems: 10000 });
  return new Set(streams.filter(stream => (stream.app || 'live') === 'live' && stream.name)
    .map(stream => stream.name));
}
function probeDuration(filePath) {
  const result = spawnSync(FFPROBE_BIN, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ], { encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) return null;
  const value = Number(String(result.stdout || '').trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function markInterrupted(asset, reason) {
  const observed = assetService.scanSegments(asset);
  return assetService.updateAsset(asset.id, {
    state: observed.segment_count ? 'RECOVERABLE' : 'FAILED',
    segment_count: observed.segment_count,
    size_bytes: observed.size_bytes,
    error: observed.segment_count ? reason : `${reason}; no media segments were written`,
    completed_at: new Date().toISOString()
  });
}

function finalizeAsset(task, asset) {
  let manifest;
  try {
    manifest = assetService.writeConcatManifest(asset);
  } catch (error) {
    assetService.updateAsset(asset.id, { state: 'FAILED', error: error.message, completed_at: new Date().toISOString() });
    markTask(task.id, 'FAILED', { worker_instance_id: null, last_error: error.message, last_stopped_at: new Date().toISOString() });
    return false;
  }
  markTask(task.id, 'FINALIZING', { worker_instance_id: INSTANCE_ID, last_error: null });
  assetService.updateAsset(asset.id, { state: 'FINALIZING', segment_count: manifest.segment_count, size_bytes: manifest.size_bytes, error: null });
  const args = recordRuntime.buildFinalizeArgs(manifest.concat_file, manifest.final_path, task);
  const result = spawnSync(FFMPEG_BIN, args, { encoding: 'utf8', timeout: FINALIZE_TIMEOUT_MS, env: process.env });
  if (result.status !== 0 || !fs.existsSync(manifest.final_path) || fs.statSync(manifest.final_path).size <= 0) {
    const error = redactText(result.stderr || `ffmpeg finalize failed status=${result.status}`);
    assetService.updateAsset(asset.id, { state: 'RECOVERABLE', error, completed_at: new Date().toISOString() });
    markTask(task.id, 'FAILED', { worker_instance_id: null, last_error: error, last_stopped_at: new Date().toISOString() });
    return false;
  }
  const size = fs.statSync(manifest.final_path).size;
  const duration = probeDuration(manifest.final_path);
  assetService.updateAsset(asset.id, {
    state: 'COMPLETE', size_bytes: size, duration_seconds: duration,
    error: null, completed_at: new Date().toISOString()
  });
  markTask(task.id, 'COMPLETE', {
    worker_instance_id: null, last_error: null, bytes_written: size,
    last_growth_at: new Date().toISOString(), last_stopped_at: new Date().toISOString()
  });
  return true;
}
function stopProcess(taskId, reason) {
  const state = processes.get(Number(taskId));
  if (!state || state.stopping) return;
  state.stopping = true;
  state.stopReason = reason;
  state.child.kill(reason === 'desired STOPPED' ? 'SIGINT' : 'SIGTERM');
  state.killTimer = setTimeout(() => {
    if (!state.exited) state.child.kill('SIGKILL');
  }, STOP_GRACE_MS);
}

function spawnTask(task) {
  const budget = diskBudget(task);
  if (budget.low_space) {
    markTask(task.id, 'FAILED', {
      worker_instance_id: null,
      last_error: `Insufficient recording storage; usable=${budget.usable_bytes} bytes`
    });
    return null;
  }
  const asset = assetService.createAsset(task);
  const paths = assetService.resolveAssetPaths(asset, { createWorkDir: true });
  const args = recordRuntime.buildCaptureArgs(sourceUrl(task), paths.work_dir, task);
  const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore','ignore','pipe'], env: process.env, shell: false });
  const state = {
    child, taskId: task.id, assetId: asset.id,
    startedAt: Date.now(), lastGrowthAt: Date.now(), lastSize: 0,
    lastStderr: '', stopping: false, stopReason: null,
    exited: false, killTimer: null
  };
  processes.set(task.id, state);
  markTask(task.id, 'STARTING', {
    attempt: Number(task.attempt || 0) + 1,
    worker_instance_id: INSTANCE_ID,
    last_error: null,
    bytes_written: 0,
    last_growth_at: null,
    last_started_at: new Date().toISOString()
  });
  child.stderr?.on('data', chunk => {
    state.lastStderr = redactText(`${state.lastStderr}\n${chunk.toString('utf8')}`);
  });
  child.on('error', error => { state.lastStderr = redactText(error.message); });
  child.once('close', (code, signal) => {
    state.exited = true;
    if (state.killTimer) clearTimeout(state.killTimer);
    processes.delete(task.id);
    handleProcessExit(state, code, signal);
  });
  log(`starting task ${task.id} source=${task.source_stream_name || task.stream_name} asset=${asset.id}`);
  return state;
}
function handleProcessExit(state, code, signal) {
  const task = taskService.getTask(state.taskId);
  const asset = assetService.getAsset(state.assetId);
  if (!task || !asset) {
    if (shuttingDown && processes.size === 0) finalizeShutdown(0);
    return;
  }

  if (state.stopReason === 'desired STOPPED') {
    finalizeAsset(task, asset);
  } else if (state.stopReason === 'lease lost' || state.stopReason === 'worker shutdown') {
    markInterrupted(asset, 'Record worker stopped; TS segments retained');
    if (task.desired_state === 'RUNNING') markWaiting(task.id);
    else markStopped(task.id);
  } else if (state.stopReason === 'input offline') {
    markInterrupted(asset, 'Recording input disappeared; TS segments retained');
    markWaiting(task.id);
  } else {
    const error = state.lastStderr || `ffmpeg exited code=${code} signal=${signal || 'none'}`;
    markInterrupted(asset, redactText(error));
    markTask(task.id, 'FAILED', {
      worker_instance_id: null,
      last_error: redactText(error),
      last_stopped_at: new Date().toISOString()
    });
  }

  if (shuttingDown && processes.size === 0) finalizeShutdown(0);
}
function observeProcess(state, task) {
  const refreshed = assetService.refreshObserved(state.assetId);
  if (!refreshed) return;
  const { asset, observed } = refreshed;
  const now = Date.now();
  if (observed.size_bytes > state.lastSize) {
    state.lastSize = observed.size_bytes;
    state.lastGrowthAt = now;
    if (asset.state !== 'RECORDING') assetService.updateAsset(asset.id, { state: 'RECORDING', error: null });
    markTask(task.id, 'RECORDING', {
      worker_instance_id: INSTANCE_ID,
      last_error: null,
      bytes_written: observed.size_bytes,
      last_growth_at: new Date(now).toISOString()
    });
    return;
  }
  if (now - state.lastGrowthAt >= STALL_MS && now - state.startedAt >= STALL_MS) {
    markTask(task.id, 'STALLED', {
      worker_instance_id: INSTANCE_ID,
      last_error: `Recording media has not grown for ${STALL_MS}ms`
    });
    stopProcess(task.id, 'stalled');
  }
}
async function reconcile() {
  if (shuttingDown || !leaseHeld) return;
  let liveStreams;
  try {
    liveStreams = await snapshotLiveStreams();
  } catch (error) {
    log('SRS observation unavailable; no new recording will start', redactText(error.message));
    return;
  }

  for (const task of taskService.listWorkerTasks()) {
    const state = processes.get(task.id);
    const inputOnline = liveStreams.has(task.source_stream_name || task.stream_name);

    if (task.desired_state === 'STOPPED') {
      if (state) stopProcess(task.id, 'desired STOPPED');
      else if (!['STOPPED','COMPLETE','FAILED'].includes(task.runtime_state)) markStopped(task.id);
      continue;
    }

    if (state) {
      if (!inputOnline && !state.stopping) {
        stopProcess(task.id, 'input offline');
        continue;
      }
      observeProcess(state, task);
      continue;
    }

    if (!inputOnline) {
      if (task.runtime_state !== 'STARTING') markWaiting(task.id);
      continue;
    }
    if (task.runtime_state === 'FAILED') continue;
    spawnTask(task);
  }
}
function finalizeShutdown(exitCode = 0) {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (leaseHeld) {
    taskService.clearWorkerHeartbeat(INSTANCE_ID);
    leaseHeld = false;
  }
  process.exit(exitCode);
}

function handleLeaseLoss() {
  if (!leaseHeld) return;
  leaseHeld = false;
  log(`lease lost; draining ${processes.size} recording process(es)`);
  for (const taskId of processes.keys()) stopProcess(taskId, 'lease lost');
  if (!shuttingDown && processes.size === 0) timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
}

async function tick() {
  if (shuttingDown || !leaseHeld) return;
  try {
    if (!taskService.renewWorkerLease(INSTANCE_ID)) {
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
    const lease = taskService.claimWorkerLease(INSTANCE_ID, LEASE_MAX_AGE_MS);
    if (!lease.acquired) {
      log(`standby; active worker=${String(lease.instance_id).slice(0, 8)} age=${lease.age_ms}ms`);
      timer = setTimeout(bootstrap, STANDBY_RETRY_MS);
      return;
    }
    leaseHeld = true;
    assetService.recoverInterruptedAssets();
    taskService.resetStaleRuntime();
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
  log(`received ${signal}; stopping ${processes.size} recording process(es)`);
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
