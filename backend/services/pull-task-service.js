const db = require('../database');

const DESIRED_STATES = new Set(['RUNNING', 'STOPPED']);
const RUNTIME_STATES = new Set(['STOPPED', 'STARTING', 'RUNNING', 'RETRYING', 'FAILED', 'BLOCKED']);
const WORKER_HEARTBEAT_KEY = 'runtime.pull_worker.heartbeat';

function maskSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = url.username ? '***' : '';
    url.password = url.password ? '***' : '';
    if (url.search) url.search = '?…';
    return url.toString();
  } catch {
    const match = String(value).match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?/);
    if (!match) return '[masked source]';
    const authority = match[2].includes('@') ? `***@${match[2].split('@').pop()}` : match[2];
    const hasQuery = String(value).includes('?');
    return `${match[1]}://${authority}${match[3] || ''}${hasQuery ? '?…' : ''}`;
  }
}

function hydrate(row, includeSecret = false) {
  if (!row) return null;
  const task = {
    id: row.id,
    stream_id: row.stream_id,
    stream_name: row.stream_name,
    external_source_id: row.external_source_id,
    source_name: row.source_name,
    source_protocol: row.source_protocol,
    source_url_masked: maskSourceUrl(row.source_url),
    desired_state: row.desired_state,
    runtime_state: row.runtime_state,
    attempt: row.attempt,
    last_error: row.last_error,
    last_started_at: row.last_started_at,
    last_stopped_at: row.last_stopped_at,
    next_retry_at: row.next_retry_at,
    worker_instance_id: row.worker_instance_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  if (includeSecret) task.source_url = row.source_url;
  return task;
}

const SELECT_TASK = `
  SELECT pt.*, s.name AS stream_name,
         es.name AS source_name, es.protocol AS source_protocol, es.source_url
  FROM pull_tasks pt
  JOIN streams s ON s.id = pt.stream_id
  JOIN external_sources es ON es.id = pt.external_source_id
`;

function listTasks() {
  return db.prepare(`${SELECT_TASK} ORDER BY pt.created_at DESC`).all().map(row => hydrate(row));
}

function getTask(id, { includeSecret = false } = {}) {
  const row = db.prepare(`${SELECT_TASK} WHERE pt.id = ?`).get(id);
  return hydrate(row, includeSecret);
}

function getTaskByStream(streamId, { includeSecret = false } = {}) {
  const row = db.prepare(`${SELECT_TASK} WHERE pt.stream_id = ?`).get(streamId);
  return hydrate(row, includeSecret);
}

function createTask({ stream_id, external_source_id }) {
  const streamId = Number(stream_id);
  const sourceId = Number(external_source_id);
  if (!Number.isInteger(streamId) || streamId <= 0) throw new Error('Invalid stream');
  if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error('Invalid source');
  if (!db.prepare('SELECT id FROM streams WHERE id = ?').get(streamId)) throw new Error('Stream not found');
  if (!db.prepare("SELECT id FROM external_sources WHERE id = ? AND status = 'active'").get(sourceId)) throw new Error('Source not found or inactive');
  if (db.prepare('SELECT id FROM pull_tasks WHERE stream_id = ?').get(streamId)) throw new Error('Pull task already exists for stream');

  const result = db.prepare(`
    INSERT INTO pull_tasks (stream_id, external_source_id, desired_state, runtime_state)
    VALUES (?, ?, 'STOPPED', 'STOPPED')
  `).run(streamId, sourceId);
  return getTask(Number(result.lastInsertRowid));
}

function deleteTask(id) {
  const task = getTask(id);
  if (!task) return null;
  if (task.desired_state !== 'STOPPED' || task.runtime_state !== 'STOPPED') {
    throw new Error('Pull task must be stopped before deletion');
  }
  db.prepare('DELETE FROM pull_tasks WHERE id = ?').run(id);
  return { id: task.id, stream_id: task.stream_id };
}

function setDesiredState(id, state) {
  if (!DESIRED_STATES.has(state)) throw new Error('Invalid desired state');
  const task = getTask(id);
  if (!task) return null;
  db.prepare(`
    UPDATE pull_tasks
    SET desired_state = ?,
        next_retry_at = CASE WHEN ? = 'STOPPED' THEN NULL ELSE next_retry_at END,
        last_error = CASE WHEN ? = 'RUNNING' THEN NULL ELSE last_error END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(state, state, state, id);
  return getTask(id);
}

function updateRuntime(id, fields) {
  const allowed = [
    'runtime_state', 'attempt', 'last_error', 'last_started_at',
    'last_stopped_at', 'next_retry_at', 'worker_instance_id'
  ];
  const updates = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) updates[key] = fields[key];
  }
  if (updates.runtime_state !== undefined && !RUNTIME_STATES.has(updates.runtime_state)) {
    throw new Error('Invalid runtime state');
  }
  if (Object.keys(updates).length === 0) return getTask(id);
  const sets = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE pull_tasks SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(updates), id);
  return getTask(id);
}

function listWorkerTasks() {
  return db.prepare(`${SELECT_TASK} WHERE pt.desired_state = 'RUNNING' OR pt.runtime_state != 'STOPPED' ORDER BY pt.id`)
    .all()
    .map(row => hydrate(row, true));
}

function resetStaleRuntime() {
  db.prepare(`
    UPDATE pull_tasks
    SET runtime_state = CASE WHEN desired_state = 'RUNNING' THEN 'RETRYING' ELSE 'STOPPED' END,
        worker_instance_id = NULL,
        last_error = CASE WHEN desired_state = 'RUNNING' THEN 'Pull worker restarted; reconciling task' ELSE last_error END,
        next_retry_at = CASE WHEN desired_state = 'RUNNING' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
    WHERE runtime_state IN ('STARTING', 'RUNNING', 'RETRYING') OR worker_instance_id IS NOT NULL
  `).run();
}

function writeWorkerHeartbeat(instanceId) {
  if (!instanceId) throw new Error('Worker instance ID is required');
  const payload = JSON.stringify({ instance_id: String(instanceId), ts: new Date().toISOString() });
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(WORKER_HEARTBEAT_KEY, payload);
}

function clearWorkerHeartbeat(instanceId) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
  if (!row?.value) return;
  try {
    const parsed = JSON.parse(row.value);
    if (parsed.instance_id !== String(instanceId)) return;
  } catch {
    // Corrupt heartbeat belongs to nobody; clearing is safe during shutdown.
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run(WORKER_HEARTBEAT_KEY);
}

function getWorkerHealth(maxAgeMs = 10000) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
  if (!row?.value) return { available: false, instance_id: null, last_seen_at: null, age_ms: null };
  try {
    const parsed = JSON.parse(row.value);
    const ts = Date.parse(parsed.ts);
    if (!parsed.instance_id || !Number.isFinite(ts)) throw new Error('invalid heartbeat');
    const age = Math.max(0, Date.now() - ts);
    return {
      available: age <= maxAgeMs,
      instance_id: parsed.instance_id,
      last_seen_at: parsed.ts,
      age_ms: age
    };
  } catch {
    return { available: false, instance_id: null, last_seen_at: null, age_ms: null };
  }
}

module.exports = {
  DESIRED_STATES,
  RUNTIME_STATES,
  maskSourceUrl,
  listTasks,
  getTask,
  getTaskByStream,
  createTask,
  deleteTask,
  setDesiredState,
  updateRuntime,
  listWorkerTasks,
  resetStaleRuntime,
  writeWorkerHeartbeat,
  clearWorkerHeartbeat,
  getWorkerHealth
};
