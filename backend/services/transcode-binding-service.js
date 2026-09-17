const db = require('../database');

const ROLES = new Set(['main', 'secondary', 'audio', 'custom']);
const DESIRED_STATES = new Set(['RUNNING', 'STOPPED']);
const RUNTIME_STATES = new Set(['STOPPED', 'WAITING_INPUT', 'STARTING', 'RUNNING', 'RETRYING', 'FAILED', 'STOPPING']);
const WORKER_HEARTBEAT_KEY = 'runtime.transcode_worker.heartbeat';

const SELECT_BINDING = `
  SELECT b.*, s.name AS stream_name,
         t.name AS template_name, t.vcodec, t.acodec,
         t.video_config, t.audio_config, t.output_format,
         t.enabled AS template_enabled, t.updated_at AS template_updated_at
  FROM stream_transcode_bindings b
  JOIN streams s ON s.id = b.stream_id
  JOIN transcode_templates t ON t.id = b.template_id
`;

function parseJson(value) {
  try { return JSON.parse(value || '{}') || {}; }
  catch { return {}; }
}

function normalizeSuffix(value) {
  const suffix = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(suffix)) {
    throw new Error('Output suffix must be 1-32 lowercase letters, digits, underscore or hyphen');
  }
  return suffix;
}

function outputStreamName(streamName, suffix) {
  return `${streamName}__${suffix}`;
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    stream_id: row.stream_id,
    stream_name: row.stream_name,
    template_id: row.template_id,
    template_name: row.template_name,
    template_enabled: Boolean(row.template_enabled),
    role: row.role,
    output_suffix: row.output_suffix,
    output_stream_name: outputStreamName(row.stream_name, row.output_suffix),
    sort_order: Number(row.sort_order || 100),
    desired_state: row.desired_state,
    runtime_state: row.runtime_state,
    attempt: Number(row.attempt || 0),
    last_error: row.last_error || null,
    next_retry_at: row.next_retry_at || null,
    worker_instance_id: row.worker_instance_id || null,
    last_started_at: row.last_started_at || null,
    last_stopped_at: row.last_stopped_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    template_updated_at: row.template_updated_at || null,
    template: {
      id: row.template_id,
      name: row.template_name,
      vcodec: row.vcodec || 'h264',
      acodec: row.acodec || 'aac',
      video_config: parseJson(row.video_config),
      audio_config: parseJson(row.audio_config),
      output_format: row.output_format || 'rtmp',
      enabled: Boolean(row.template_enabled)
    }
  };
}

function requireStream(id) {
  const streamId = Number(id);
  if (!Number.isInteger(streamId) || streamId <= 0) throw new Error('Invalid stream');
  if (!db.prepare('SELECT id FROM streams WHERE id = ?').get(streamId)) throw new Error('Stream not found');
  return streamId;
}

function requireTemplate(id, { enabled = false } = {}) {
  const templateId = Number(id);
  if (!Number.isInteger(templateId) || templateId <= 0) throw new Error('Invalid transcode template');
  const template = db.prepare('SELECT id, enabled FROM transcode_templates WHERE id = ?').get(templateId);
  if (!template) throw new Error('Transcode template not found');
  if (enabled && !template.enabled) throw new Error('Transcode template is disabled');
  return templateId;
}

function listBindingsByStream(streamId) {
  return db.prepare(`${SELECT_BINDING} WHERE b.stream_id = ? ORDER BY b.sort_order ASC, b.id ASC`)
    .all(Number(streamId)).map(hydrate);
}

function getBinding(id) {
  return hydrate(db.prepare(`${SELECT_BINDING} WHERE b.id = ?`).get(Number(id)));
}

function listWorkerBindings() {
  return db.prepare(`${SELECT_BINDING} ORDER BY b.stream_id ASC, b.sort_order ASC, b.id ASC`).all().map(hydrate);
}

function createBinding({ stream_id, template_id, role = 'custom', output_suffix, sort_order = 100 }) {
  const streamId = requireStream(stream_id);
  const templateId = requireTemplate(template_id);
  const normalizedRole = String(role || 'custom').toLowerCase();
  if (!ROLES.has(normalizedRole)) throw new Error('Invalid transcode role');
  const suffix = normalizeSuffix(output_suffix || normalizedRole);
  const order = Number.isInteger(Number(sort_order)) ? Number(sort_order) : 100;
  const result = db.prepare(`
    INSERT INTO stream_transcode_bindings (
      stream_id, template_id, role, output_suffix, sort_order,
      desired_state, runtime_state, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'STOPPED', 'STOPPED', CURRENT_TIMESTAMP)
  `).run(streamId, templateId, normalizedRole, suffix, order);
  return getBinding(Number(result.lastInsertRowid));
}

function updateBinding(id, updates = {}) {
  const binding = getBinding(id);
  if (!binding) return null;
  if (binding.desired_state !== 'STOPPED' || binding.runtime_state !== 'STOPPED') {
    throw new Error('Stop transcode output before changing its configuration');
  }
  const fields = {};
  if (updates.template_id !== undefined) fields.template_id = requireTemplate(updates.template_id);
  if (updates.role !== undefined) {
    const role = String(updates.role || '').toLowerCase();
    if (!ROLES.has(role)) throw new Error('Invalid transcode role');
    fields.role = role;
  }
  if (updates.output_suffix !== undefined) fields.output_suffix = normalizeSuffix(updates.output_suffix);
  if (updates.sort_order !== undefined) {
    const order = Number(updates.sort_order);
    if (!Number.isInteger(order)) throw new Error('Invalid transcode sort order');
    fields.sort_order = order;
  }
  if (!Object.keys(fields).length) return binding;
  const clauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE stream_transcode_bindings SET ${clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(fields), Number(id));
  return getBinding(id);
}

function setDesiredState(id, desiredState) {
  const desired = String(desiredState || '').toUpperCase();
  if (!DESIRED_STATES.has(desired)) throw new Error('Invalid transcode desired state');
  const binding = getBinding(id);
  if (!binding) return null;
  if (desired === 'RUNNING') {
    requireTemplate(binding.template_id, { enabled: true });
    db.prepare(`
      UPDATE stream_transcode_bindings
      SET desired_state = 'RUNNING',
          runtime_state = CASE WHEN runtime_state IN ('STOPPED','FAILED') THEN 'WAITING_INPUT' ELSE runtime_state END,
          attempt = CASE WHEN runtime_state = 'FAILED' THEN 0 ELSE attempt END,
          last_error = CASE WHEN runtime_state = 'FAILED' THEN NULL ELSE last_error END,
          next_retry_at = CASE WHEN runtime_state = 'FAILED' THEN CURRENT_TIMESTAMP ELSE next_retry_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(id));
  } else {
    db.prepare(`
      UPDATE stream_transcode_bindings
      SET desired_state = 'STOPPED',
          runtime_state = CASE WHEN runtime_state IN ('RUNNING','STARTING','STOPPING') THEN 'STOPPING' ELSE 'STOPPED' END,
          next_retry_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(id));
  }
  return getBinding(id);
}

function retryBinding(id) {
  const binding = getBinding(id);
  if (!binding) return null;
  requireTemplate(binding.template_id, { enabled: true });
  const retry = db.transaction(() => {
    db.prepare(`
      UPDATE stream_transcode_bindings
      SET desired_state = CASE WHEN id = ? THEN 'RUNNING' ELSE desired_state END,
          runtime_state = CASE WHEN desired_state = 'RUNNING' OR id = ? THEN 'RETRYING' ELSE runtime_state END,
          attempt = CASE WHEN desired_state = 'RUNNING' OR id = ? THEN 0 ELSE attempt END,
          last_error = CASE WHEN desired_state = 'RUNNING' OR id = ? THEN NULL ELSE last_error END,
          next_retry_at = CASE WHEN desired_state = 'RUNNING' OR id = ? THEN CURRENT_TIMESTAMP ELSE next_retry_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE stream_id = ?
    `).run(Number(id), Number(id), Number(id), Number(id), Number(id), binding.stream_id);
  });
  retry.immediate();
  return getBinding(id);
}

function updateRuntime(id, updates = {}) {
  const allowed = ['runtime_state', 'attempt', 'last_error', 'next_retry_at', 'worker_instance_id', 'last_started_at', 'last_stopped_at'];
  const fields = {};
  for (const key of allowed) if (updates[key] !== undefined) fields[key] = updates[key];
  if (fields.runtime_state !== undefined) {
    const state = String(fields.runtime_state).toUpperCase();
    if (!RUNTIME_STATES.has(state)) throw new Error('Invalid transcode runtime state');
    fields.runtime_state = state;
  }
  if (!Object.keys(fields).length) return getBinding(id);
  const clauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE stream_transcode_bindings SET ${clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(fields), Number(id));
  return getBinding(id);
}

function updateRuntimeMany(ids, updates = {}) {
  const clean = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!clean.length) return;
  const allowed = ['runtime_state', 'attempt', 'last_error', 'next_retry_at', 'worker_instance_id', 'last_started_at', 'last_stopped_at'];
  const fields = {};
  for (const key of allowed) if (updates[key] !== undefined) fields[key] = updates[key];
  if (fields.runtime_state !== undefined) {
    const state = String(fields.runtime_state).toUpperCase();
    if (!RUNTIME_STATES.has(state)) throw new Error('Invalid transcode runtime state');
    fields.runtime_state = state;
  }
  if (!Object.keys(fields).length) return;
  const clauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  const placeholders = clean.map(() => '?').join(',');
  db.prepare(`UPDATE stream_transcode_bindings SET ${clauses}, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`)
    .run(...Object.values(fields), ...clean);
}

function deleteBinding(id) {
  const binding = getBinding(id);
  if (!binding) return null;
  const consumer = db.prepare('SELECT id FROM forward_tasks WHERE source_binding_id = ? LIMIT 1').get(Number(id));
  if (consumer) throw new Error('Rendition is still referenced by an output');
  if (binding.desired_state !== 'STOPPED' || binding.runtime_state !== 'STOPPED') throw new Error('Stop transcode output before deleting it');
  db.prepare('DELETE FROM stream_transcode_bindings WHERE id = ?').run(Number(id));
  return { id: binding.id, output_stream_name: binding.output_stream_name };
}

function resetStaleRuntime() {
  db.prepare(`
    UPDATE stream_transcode_bindings
    SET runtime_state = CASE WHEN desired_state = 'RUNNING' THEN 'RETRYING' ELSE 'STOPPED' END,
        worker_instance_id = NULL,
        last_error = CASE WHEN desired_state = 'RUNNING' THEN 'Transcode worker restarted; reconciling pipeline' ELSE last_error END,
        next_retry_at = CASE WHEN desired_state = 'RUNNING' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
    WHERE runtime_state IN ('STARTING','RUNNING','RETRYING','STOPPING') OR worker_instance_id IS NOT NULL
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
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY);
    const current = parseHeartbeat(row?.value);
    if (current && current.instance_id !== owner) {
      const age = Math.max(0, now.getTime() - current.ts_ms);
      if (age <= maxAgeMs) return { acquired: false, instance_id: current.instance_id, last_seen_at: current.ts, age_ms: age };
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
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

module.exports = {
  ROLES, DESIRED_STATES, RUNTIME_STATES,
  normalizeSuffix, outputStreamName,
  listBindingsByStream, listWorkerBindings, getBinding,
  createBinding, updateBinding, deleteBinding,
  setDesiredState, retryBinding, updateRuntime, updateRuntimeMany,
  resetStaleRuntime, claimWorkerLease, renewWorkerLease,
  clearWorkerHeartbeat, getWorkerHealth
};
