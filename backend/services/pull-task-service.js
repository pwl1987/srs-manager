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

function listTaskSources(taskId, { includeSecret = false } = {}) {
  const rows = db.prepare(`
    SELECT pts.id, pts.pull_task_id, pts.external_source_id, pts.priority, pts.enabled,
           pts.created_at, pts.updated_at,
           es.name AS source_name, es.protocol AS source_protocol, es.source_url, es.status AS source_status
    FROM pull_task_sources pts
    JOIN external_sources es ON es.id = pts.external_source_id
    WHERE pts.pull_task_id = ?
    ORDER BY pts.priority ASC, pts.id ASC
  `).all(taskId);

  return rows.map(row => {
    const source = {
      id: row.id,
      pull_task_id: row.pull_task_id,
      external_source_id: row.external_source_id,
      priority: row.priority,
      enabled: Boolean(row.enabled),
      source_name: row.source_name,
      source_protocol: row.source_protocol,
      source_status: row.source_status,
      source_url_masked: maskSourceUrl(row.source_url),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    if (includeSecret) source.source_url = row.source_url;
    return source;
  });
}

function hydrate(row, includeSecret = false) {
  if (!row) return null;
  const task = {
    id: row.id,
    stream_id: row.stream_id,
    stream_name: row.stream_name,
    // Compatibility field: original/primary source. New code should use
    // sources[] + active_source_id instead of treating this as the runtime source.
    external_source_id: row.external_source_id,
    active_source_id: row.active_source_id || row.external_source_id || null,
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
    last_source_switch_at: row.last_source_switch_at,
    last_source_switch_reason: row.last_source_switch_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  if (includeSecret) task.source_url = row.source_url;
  task.sources = listTaskSources(task.id, { includeSecret });
  return task;
}

const SELECT_TASK = `
  SELECT pt.*, s.name AS stream_name,
         es.name AS source_name, es.protocol AS source_protocol, es.source_url
  FROM pull_tasks pt
  JOIN streams s ON s.id = pt.stream_id
  LEFT JOIN external_sources es ON es.id = COALESCE(pt.active_source_id, pt.external_source_id)
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

function requireActiveSource(sourceId) {
  const source = db.prepare("SELECT id FROM external_sources WHERE id = ? AND status = 'active'").get(sourceId);
  if (!source) throw new Error('Source not found or inactive');
}

function createTask({ stream_id, external_source_id }) {
  const streamId = Number(stream_id);
  const sourceId = Number(external_source_id);
  if (!Number.isInteger(streamId) || streamId <= 0) throw new Error('Invalid stream');
  if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error('Invalid source');
  if (!db.prepare('SELECT id FROM streams WHERE id = ?').get(streamId)) throw new Error('Stream not found');
  requireActiveSource(sourceId);
  if (db.prepare('SELECT id FROM pull_tasks WHERE stream_id = ?').get(streamId)) throw new Error('Pull task already exists for stream');

  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO pull_tasks (stream_id, external_source_id, active_source_id, desired_state, runtime_state)
      VALUES (?, ?, ?, 'STOPPED', 'STOPPED')
    `).run(streamId, sourceId, sourceId);
    const taskId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO pull_task_sources (pull_task_id, external_source_id, priority, enabled)
      VALUES (?, ?, 1, 1)
    `).run(taskId, sourceId);
    return taskId;
  });
  return getTask(create.immediate());
}

function addTaskSource(taskId, externalSourceId, priority = null) {
  const id = Number(taskId);
  const sourceId = Number(externalSourceId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid pull task');
  if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error('Invalid source');
  const task = getTask(id);
  if (!task) throw new Error('Pull task not found');
  requireActiveSource(sourceId);
  if (db.prepare('SELECT id FROM pull_task_sources WHERE pull_task_id = ? AND external_source_id = ?').get(id, sourceId)) {
    throw new Error('Source already exists in pull task');
  }

  let targetPriority = Number(priority);
  if (!Number.isInteger(targetPriority) || targetPriority <= 0) {
    const row = db.prepare('SELECT COALESCE(MAX(priority), 0) AS max_priority FROM pull_task_sources WHERE pull_task_id = ?').get(id);
    targetPriority = Number(row?.max_priority || 0) + 1;
  }
  if (db.prepare('SELECT id FROM pull_task_sources WHERE pull_task_id = ? AND priority = ?').get(id, targetPriority)) {
    throw new Error('Pull source priority already exists');
  }

  db.prepare(`
    INSERT INTO pull_task_sources (pull_task_id, external_source_id, priority, enabled)
    VALUES (?, ?, ?, 1)
  `).run(id, sourceId, targetPriority);
  return getTask(id);
}

function updateTaskSource(taskId, externalSourceId, updates = {}) {
  const id = Number(taskId);
  const sourceId = Number(externalSourceId);
  const task = getTask(id);
  if (!task) throw new Error('Pull task not found');
  const current = db.prepare('SELECT * FROM pull_task_sources WHERE pull_task_id = ? AND external_source_id = ?').get(id, sourceId);
  if (!current) throw new Error('Pull task source not found');

  const fields = {};
  if (updates.priority !== undefined) {
    const priority = Number(updates.priority);
    if (!Number.isInteger(priority) || priority <= 0) throw new Error('Invalid source priority');
    const conflict = db.prepare('SELECT id FROM pull_task_sources WHERE pull_task_id = ? AND priority = ? AND external_source_id != ?')
      .get(id, priority, sourceId);
    if (conflict) throw new Error('Pull source priority already exists');
    fields.priority = priority;
  }
  if (updates.enabled !== undefined) {
    const enabled = updates.enabled === true || Number(updates.enabled) === 1 ? 1 : 0;
    if (!enabled && Number(task.active_source_id) === sourceId && task.desired_state === 'RUNNING') {
      throw new Error('Active pull source cannot be disabled while task is running');
    }
    fields.enabled = enabled;
  }
  if (Object.keys(fields).length === 0) return task;
  const sets = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE pull_task_sources SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE pull_task_id = ? AND external_source_id = ?`)
    .run(...Object.values(fields), id, sourceId);
  return getTask(id);
}

function deleteTaskSource(taskId, externalSourceId) {
  const id = Number(taskId);
  const sourceId = Number(externalSourceId);
  const task = getTask(id);
  if (!task) throw new Error('Pull task not found');
  const sources = listTaskSources(id);
  const current = sources.find(source => Number(source.external_source_id) === sourceId);
  if (!current) throw new Error('Pull task source not found');
  if (sources.length <= 1) throw new Error('Pull task must keep at least one source');
  if (Number(task.active_source_id) === sourceId && task.desired_state === 'RUNNING') {
    throw new Error('Active pull source cannot be removed while task is running');
  }

  db.prepare('DELETE FROM pull_task_sources WHERE pull_task_id = ? AND external_source_id = ?').run(id, sourceId);
  if (Number(task.active_source_id) === sourceId) {
    const next = listTaskSources(id).find(source => source.enabled && source.source_status === 'active');
    if (!next) throw new Error('Pull task has no enabled source');
    db.prepare(`
      UPDATE pull_tasks
      SET active_source_id = ?, attempt = 0,
          last_source_switch_at = CURRENT_TIMESTAMP,
          last_source_switch_reason = 'active source removed while stopped',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(next.external_source_id, id);
  }
  return getTask(id);
}

function getNextEnabledSource(taskId, currentSourceId) {
  const sources = listTaskSources(taskId, { includeSecret: true })
    .filter(source => source.enabled && source.source_status === 'active');
  if (!sources.length) return null;
  const currentIndex = sources.findIndex(source => Number(source.external_source_id) === Number(currentSourceId));
  if (currentIndex < 0) return sources[0];
  return sources[currentIndex + 1] || null;
}

function ensureUsableActiveSource(taskId, { includeSecret = false } = {}) {
  const task = getTask(taskId, { includeSecret });
  if (!task) return null;
  const active = task.sources.find(source =>
    Number(source.external_source_id) === Number(task.active_source_id)
      && source.enabled
      && source.source_status === 'active'
  );
  if (active) return task;

  const next = task.sources.find(source => source.enabled && source.source_status === 'active');
  if (!next) return task;
  db.prepare(`
    UPDATE pull_tasks
    SET active_source_id = ?, attempt = 0,
        last_source_switch_at = CURRENT_TIMESTAMP,
        last_source_switch_reason = 'selected first usable source',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next.external_source_id, task.id);
  return getTask(task.id, { includeSecret });
}

function switchActiveSource(taskId, externalSourceId, reason, runtimeState = 'RETRYING') {
  const id = Number(taskId);
  const sourceId = Number(externalSourceId);
  if (!RUNTIME_STATES.has(runtimeState)) throw new Error('Invalid runtime state');
  const candidate = listTaskSources(id).find(source =>
    Number(source.external_source_id) === sourceId
      && source.enabled
      && source.source_status === 'active'
  );
  if (!candidate) throw new Error('Pull task source not enabled or active');
  db.prepare(`
    UPDATE pull_tasks
    SET active_source_id = ?, attempt = 0, runtime_state = ?,
        last_error = ?, next_retry_at = CURRENT_TIMESTAMP, worker_instance_id = NULL,
        last_source_switch_at = CURRENT_TIMESTAMP,
        last_source_switch_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sourceId, runtimeState, reason || null, reason || null, id);
  return getTask(id);
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
    'last_stopped_at', 'next_retry_at', 'worker_instance_id',
    'active_source_id', 'last_source_switch_at', 'last_source_switch_reason'
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
    .map(row => hydrate(row, true))
    .map(task => ensureUsableActiveSource(task.id, { includeSecret: true }));
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

function parseHeartbeat(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const ts = Date.parse(parsed.ts);
    if (!parsed.instance_id || !Number.isFinite(ts)) return null;
    return { instance_id: String(parsed.instance_id), ts: parsed.ts, ts_ms: ts };
  } catch {
    return null;
  }
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
      if (age <= maxAgeMs) {
        return {
          acquired: false,
          instance_id: current.instance_id,
          last_seen_at: current.ts,
          age_ms: age
        };
      }
    }

    const payload = heartbeatPayload(owner, now);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(WORKER_HEARTBEAT_KEY, payload);
    return { acquired: true, instance_id: owner, last_seen_at: now.toISOString(), age_ms: 0 };
  });
  return claim.immediate();
}

function renewWorkerLease(instanceId) {
  if (!instanceId) throw new Error('Worker instance ID is required');
  const owner = String(instanceId);
  const renew = db.transaction(() => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
    const current = parseHeartbeat(row?.value);
    if (!current || current.instance_id !== owner) return false;
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run(heartbeatPayload(owner), WORKER_HEARTBEAT_KEY);
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
  return {
    available: age <= maxAgeMs,
    instance_id: current.instance_id,
    last_seen_at: current.ts,
    age_ms: age
  };
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
  listTaskSources,
  addTaskSource,
  updateTaskSource,
  deleteTaskSource,
  getNextEnabledSource,
  ensureUsableActiveSource,
  switchActiveSource,
  setDesiredState,
  updateRuntime,
  listWorkerTasks,
  resetStaleRuntime,
  claimWorkerLease,
  renewWorkerLease,
  clearWorkerHeartbeat,
  getWorkerHealth
};
