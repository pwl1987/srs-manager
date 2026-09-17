const db = require('../database');
const { validateStreamUrl } = require('../utils/url-validation');

const TARGET_PROTOCOLS = ['rtmp', 'rtmps', 'srt'];
const DESIRED_STATES = new Set(['RUNNING', 'STOPPED']);
const RUNTIME_STATES = new Set(['STOPPED', 'WAITING_INPUT', 'STARTING', 'RUNNING', 'RETRYING', 'FAILED', 'STOPPING', 'LEGACY_DYNAMIC']);
const WORKER_HEARTBEAT_KEY = 'runtime.push_worker.heartbeat';

function maskTargetUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = url.username ? '***' : '';
    url.password = url.password ? '***' : '';
    if (url.search) url.search = '?…';
    return url.toString();
  } catch {
    const match = String(value).match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?/);
    if (!match) return '[masked target]';
    const authority = match[2].includes('@') ? `***@${match[2].split('@').pop()}` : match[2];
    const hasQuery = String(value).includes('?');
    return `${match[1]}://${authority}${match[3] || ''}${hasQuery ? '?…' : ''}`;
  }
}

function targetProtocol(value) {
  try { return new URL(value).protocol.replace(':', '').toLowerCase(); }
  catch { return null; }
}

function parseMetadata(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  const allowed = ['name', 'scene', 'protection', 'destination_kind', 'destination_label'];
  const result = {};
  for (const key of allowed) {
    if (value[key] !== undefined && value[key] !== null) result[key] = String(value[key]).slice(0, 160);
  }
  return Object.keys(result).length ? result : null;
}

const SELECT_TASK = `
  SELECT ft.*, s.name AS stream_name,
         sb.output_suffix AS source_binding_suffix, sb.stream_id AS source_binding_stream_id
  FROM forward_tasks ft
  JOIN streams s ON s.id = ft.stream_id
  LEFT JOIN stream_transcode_bindings sb ON sb.id = ft.source_binding_id
`;

function hydrate(row, includeSecret = false) {
  if (!row) return null;
  const task = {
    id: row.id,
    stream_id: row.stream_id,
    stream_name: row.stream_name,
    external_source_id: row.external_source_id,
    source_binding_id: row.source_binding_id == null ? null : Number(row.source_binding_id),
    v3_metadata: parseMetadata(row.v3_metadata_json),
    source_stream_name: row.source_binding_id && Number(row.source_binding_stream_id) === Number(row.stream_id)
      ? `${row.stream_name}__${row.source_binding_suffix}`
      : row.stream_name,
    target_type: row.target_type,
    target_url_masked: maskTargetUrl(row.target_url),
    target_protocol: targetProtocol(row.target_url),
    execution_mode: row.execution_mode || 'managed_worker',
    desired_state: row.desired_state || (row.enabled ? 'RUNNING' : 'STOPPED'),
    runtime_state: row.runtime_state || 'STOPPED',
    enabled: row.desired_state === 'RUNNING' || Boolean(row.enabled),
    attempt: Number(row.attempt || 0),
    last_error: row.error_message || null,
    next_retry_at: row.next_retry_at || null,
    worker_instance_id: row.worker_instance_id || null,
    last_started_at: row.last_started_at || null,
    last_stopped_at: row.last_stopped_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
  if (includeSecret) task.target_url = row.target_url;
  return task;
}

function listTasks({ includeSecret = false } = {}) {
  return db.prepare(`${SELECT_TASK} ORDER BY ft.created_at DESC`).all().map(row => hydrate(row, includeSecret));
}

function listTasksByStream(streamId, { includeSecret = false } = {}) {
  return db.prepare(`${SELECT_TASK} WHERE ft.stream_id = ? ORDER BY ft.created_at DESC`)
    .all(Number(streamId)).map(row => hydrate(row, includeSecret));
}

function getTask(id, { includeSecret = false } = {}) {
  return hydrate(db.prepare(`${SELECT_TASK} WHERE ft.id = ?`).get(Number(id)), includeSecret);
}

function validateTarget(url) {
  const check = validateStreamUrl(url, TARGET_PROTOCOLS, { allowPrivateNetwork: true });
  if (!check.valid) throw new Error(`Invalid OUT-PUSH target URL: ${check.error}`);
}

function requireStream(streamId) {
  const id = Number(streamId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid stream');
  if (!db.prepare('SELECT id FROM streams WHERE id = ?').get(id)) throw new Error('Stream not found');
  return id;
}


function requireSourceBinding(streamId, bindingId) {
  if (bindingId === undefined || bindingId === null || bindingId === '') return null;
  const id = Number(bindingId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid source rendition binding');
  const binding = db.prepare('SELECT id, stream_id FROM stream_transcode_bindings WHERE id = ?').get(id);
  if (!binding) throw new Error('Source rendition binding not found');
  if (Number(binding.stream_id) !== Number(streamId)) throw new Error('Source rendition binding belongs to another stream');
  return id;
}

function createTask({ stream_id, source_binding_id = null, v3_metadata = null, target_type, target_url, enabled = 0 }) {
  const streamId = requireStream(stream_id);
  const sourceBindingId = requireSourceBinding(streamId, source_binding_id);
  if (!target_type || !target_url) throw new Error('Target type and URL are required');
  validateTarget(target_url);
  const desired = enabled === true || Number(enabled) === 1 ? 'RUNNING' : 'STOPPED';
  const runtime = desired === 'RUNNING' ? 'WAITING_INPUT' : 'STOPPED';
  const metadata = sanitizeMetadata(v3_metadata);
  const result = db.prepare(`
    INSERT INTO forward_tasks (
      stream_id, external_source_id, source_binding_id, v3_metadata_json, target_type, target_url, enabled,
      execution_mode, desired_state, runtime_state, status, updated_at
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, 'managed_worker', ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(streamId, sourceBindingId, metadata ? JSON.stringify(metadata) : null, target_type, target_url, desired === 'RUNNING' ? 1 : 0, desired, runtime, runtime.toLowerCase());
  return getTask(Number(result.lastInsertRowid));
}

function updateTask(id, updates = {}) {
  const task = getTask(id);
  if (!task) return null;
  const changingRuntimeConfig = ['stream_id', 'source_binding_id', 'target_type', 'target_url'].some(key => updates[key] !== undefined);
  if (changingRuntimeConfig && task.desired_state === 'RUNNING') {
    throw new Error('Stop OUT-PUSH before changing stream or target');
  }

  const fields = {};
  const effectiveStreamId = updates.stream_id !== undefined ? requireStream(updates.stream_id) : task.stream_id;
  const effectiveBindingId = updates.source_binding_id !== undefined ? updates.source_binding_id : task.source_binding_id;
  if (updates.stream_id !== undefined) fields.stream_id = effectiveStreamId;
  if (updates.stream_id !== undefined || updates.source_binding_id !== undefined) fields.source_binding_id = requireSourceBinding(effectiveStreamId, effectiveBindingId);
  if (updates.v3_metadata !== undefined) {
    const metadata = sanitizeMetadata(updates.v3_metadata);
    fields.v3_metadata_json = metadata ? JSON.stringify(metadata) : null;
  }
  if (updates.target_type !== undefined) fields.target_type = String(updates.target_type || '').trim();
  if (updates.target_url !== undefined && updates.target_url !== '') {
    validateTarget(updates.target_url);
    fields.target_url = updates.target_url;
  }

  if (Object.keys(fields).length > 0) {
    const setClauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
    db.prepare(`UPDATE forward_tasks SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...Object.values(fields), Number(id));
  }

  if (updates.enabled !== undefined) {
    return setDesiredState(id, updates.enabled === true || Number(updates.enabled) === 1 ? 'RUNNING' : 'STOPPED');
  }
  return getTask(id);
}

function setDesiredState(id, desiredState) {
  const desired = String(desiredState || '').toUpperCase();
  if (!DESIRED_STATES.has(desired)) throw new Error('Invalid OUT-PUSH desired state');
  const task = getTask(id);
  if (!task) return null;

  if (task.execution_mode === 'srs_dynamic') {
    db.prepare(`
      UPDATE forward_tasks
      SET enabled = ?, desired_state = ?, runtime_state = 'LEGACY_DYNAMIC',
          status = 'legacy_dynamic', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(desired === 'RUNNING' ? 1 : 0, desired, Number(id));
    return getTask(id);
  }

  if (desired === 'RUNNING') {
    db.prepare(`
      UPDATE forward_tasks
      SET enabled = 1, desired_state = 'RUNNING',
          runtime_state = CASE WHEN runtime_state IN ('FAILED', 'STOPPED') THEN 'WAITING_INPUT' ELSE runtime_state END,
          status = CASE WHEN runtime_state IN ('FAILED', 'STOPPED') THEN 'waiting_input' ELSE status END,
          attempt = CASE WHEN runtime_state = 'FAILED' THEN 0 ELSE attempt END,
          error_message = CASE WHEN runtime_state = 'FAILED' THEN NULL ELSE error_message END,
          next_retry_at = CASE WHEN runtime_state = 'FAILED' THEN CURRENT_TIMESTAMP ELSE next_retry_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(id));
  } else {
    db.prepare(`
      UPDATE forward_tasks
      SET enabled = 0, desired_state = 'STOPPED',
          runtime_state = CASE WHEN runtime_state = 'STOPPED' THEN 'STOPPED' ELSE 'STOPPING' END,
          status = CASE WHEN runtime_state = 'STOPPED' THEN 'stopped' ELSE 'stopping' END,
          next_retry_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(id));
  }
  return getTask(id);
}

function retryTask(id) {
  const task = getTask(id);
  if (!task) return null;
  if (task.execution_mode === 'srs_dynamic') throw new Error('Legacy Dynamic Forward has no managed retry operation');
  db.prepare(`
    UPDATE forward_tasks
    SET enabled = 1, desired_state = 'RUNNING', runtime_state = 'RETRYING', status = 'retrying',
        attempt = 0, error_message = NULL, next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(Number(id));
  return getTask(id);
}

function updateRuntime(id, updates = {}) {
  const allowed = ['runtime_state', 'attempt', 'error_message', 'next_retry_at', 'worker_instance_id', 'last_started_at', 'last_stopped_at'];
  const fields = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) fields[key] = updates[key];
  }
  if (fields.runtime_state !== undefined) {
    const state = String(fields.runtime_state).toUpperCase();
    if (!RUNTIME_STATES.has(state)) throw new Error('Invalid OUT-PUSH runtime state');
    fields.runtime_state = state;
    fields.status = state.toLowerCase();
  }
  if (Object.keys(fields).length === 0) return getTask(id);
  const clauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE forward_tasks SET ${clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(fields), Number(id));
  return getTask(id);
}

function deleteTask(id) {
  const task = getTask(id);
  if (!task) return null;
  const safelyStopped = task.execution_mode === 'srs_dynamic'
    ? task.desired_state === 'STOPPED'
    : task.desired_state === 'STOPPED' && task.runtime_state === 'STOPPED';
  if (!safelyStopped) throw new Error('Stop OUT-PUSH before deleting it');
  db.prepare('DELETE FROM forward_tasks WHERE id = ?').run(Number(id));
  return { id: task.id };
}

function listWorkerTasks() {
  return db.prepare(`${SELECT_TASK} WHERE ft.execution_mode = 'managed_worker' ORDER BY ft.id ASC`)
    .all().map(row => hydrate(row, true));
}

function resetStaleRuntime() {
  db.prepare(`
    UPDATE forward_tasks
    SET runtime_state = CASE WHEN desired_state = 'RUNNING' THEN 'RETRYING' ELSE 'STOPPED' END,
        status = CASE WHEN desired_state = 'RUNNING' THEN 'retrying' ELSE 'stopped' END,
        worker_instance_id = NULL,
        error_message = CASE WHEN desired_state = 'RUNNING' THEN 'Push worker restarted; reconciling task' ELSE error_message END,
        next_retry_at = CASE WHEN desired_state = 'RUNNING' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
    WHERE execution_mode = 'managed_worker'
      AND (runtime_state IN ('STARTING', 'RUNNING', 'RETRYING', 'STOPPING') OR worker_instance_id IS NOT NULL)
  `).run();
}

function parseHeartbeat(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const ts = Date.parse(parsed.ts);
    if (!parsed.instance_id || !Number.isFinite(ts)) return null;
    return { instance_id: String(parsed.instance_id), ts: parsed.ts, ts_ms: ts };
  } catch { return null; }
}

function heartbeatPayload(instanceId, now = new Date()) {
  return JSON.stringify({ instance_id: String(instanceId), ts: now.toISOString() });
}

function claimWorkerLease(instanceId, maxAgeMs = 10000) {
  if (!instanceId) throw new Error('Worker instance ID is required');
  const owner = String(instanceId);
  const claim = db.transaction(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
    const current = parseHeartbeat(row?.value);
    if (current && current.instance_id !== owner) {
      const age = Math.max(0, nowMs - current.ts_ms);
      if (age <= maxAgeMs) return { acquired: false, instance_id: current.instance_id, last_seen_at: current.ts, age_ms: age };
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(WORKER_HEARTBEAT_KEY, heartbeatPayload(owner, now));
    return { acquired: true, instance_id: owner, last_seen_at: now.toISOString(), age_ms: 0 };
  });
  return claim.immediate();
}

function renewWorkerLease(instanceId) {
  const owner = String(instanceId || '');
  if (!owner) throw new Error('Worker instance ID is required');
  const renew = db.transaction(() => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
    const current = parseHeartbeat(row?.value);
    if (!current || current.instance_id !== owner) return false;
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(heartbeatPayload(owner), WORKER_HEARTBEAT_KEY);
    return true;
  });
  return renew.immediate();
}

function clearWorkerHeartbeat(instanceId) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
  const current = parseHeartbeat(row?.value);
  if (!current || current.instance_id !== String(instanceId)) return;
  db.prepare('DELETE FROM settings WHERE key = ?').run(WORKER_HEARTBEAT_KEY);
}

function getWorkerHealth(maxAgeMs = 10000) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
  const current = parseHeartbeat(row?.value);
  if (!current) return { available: false, instance_id: null, last_seen_at: null, age_ms: null };
  const age = Math.max(0, Date.now() - current.ts_ms);
  return { available: age <= maxAgeMs, instance_id: current.instance_id, last_seen_at: current.ts, age_ms: age };
}

function listLegacyDynamicTargets(streamName) {
  const stream = db.prepare('SELECT id FROM streams WHERE name = ?').get(streamName);
  if (!stream) return [];
  return db.prepare(`
    SELECT target_url FROM forward_tasks
    WHERE stream_id = ? AND execution_mode = 'srs_dynamic' AND enabled = 1
  `).all(stream.id).map(row => row.target_url);
}

module.exports = {
  TARGET_PROTOCOLS,
  DESIRED_STATES,
  RUNTIME_STATES,
  maskTargetUrl,
  listTasks,
  listTasksByStream,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  setDesiredState,
  retryTask,
  updateRuntime,
  listWorkerTasks,
  resetStaleRuntime,
  claimWorkerLease,
  renewWorkerLease,
  clearWorkerHeartbeat,
  getWorkerHealth,
  listLegacyDynamicTargets
};
