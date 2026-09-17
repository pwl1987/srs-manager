const db = require('../database');
const renditionService = require('./v3-rendition-service');
const storageService = require('./record-storage-service');

const DESIRED_STATES = new Set(['RUNNING', 'STOPPED']);
const RUNTIME_STATES = new Set([
  'STOPPED', 'STARTING', 'RECORDING', 'STOPPING',
  'FINALIZING', 'COMPLETE', 'STALLED', 'FAILED'
]);
const FORMATS = new Set(['ts', 'mp4', 'audio']);
const AUDIO_FORMATS = new Set(['aac', 'mp3']);

const SELECT_TASK = `
  SELECT rt.*, s.name AS stream_name,
         sb.output_suffix AS source_binding_suffix,
         sb.stream_id AS source_binding_stream_id,
         tt.vcodec AS source_vcodec, tt.acodec AS source_acodec
  FROM record_tasks rt
  JOIN streams s ON s.id = rt.stream_id
  LEFT JOIN stream_transcode_bindings sb ON sb.id = rt.source_binding_id
  LEFT JOIN transcode_templates tt ON tt.id = sb.template_id
`;
function hydrate(row) {
  if (!row) return null;
  return {
    id: Number(row.id), stream_id: Number(row.stream_id), stream_name: row.stream_name,
    source_binding_id: row.source_binding_id == null ? null : Number(row.source_binding_id),
    source_stream_name: row.source_binding_id && Number(row.source_binding_stream_id) === Number(row.stream_id)
      ? `${row.stream_name}__${row.source_binding_suffix}` : row.stream_name,
    source_vcodec: row.source_vcodec || null, source_acodec: row.source_acodec || null,
    name: row.name, format: row.format, audio_format: row.audio_format || null,
    subdir: row.subdir || '', filename_prefix: row.filename_prefix || null,
    segment_seconds: Number(row.segment_seconds || 6), retention_days: row.retention_days == null ? null : Number(row.retention_days),
    desired_state: row.desired_state, runtime_state: row.runtime_state,
    attempt: Number(row.attempt || 0), worker_instance_id: row.worker_instance_id || null,
    last_error: row.last_error || null, last_growth_at: row.last_growth_at || null,
    bytes_written: Number(row.bytes_written || 0), last_started_at: row.last_started_at || null,
    last_stopped_at: row.last_stopped_at || null, created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
}
function requireStream(streamId) {
  const id = Number(streamId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid stream');
  if (!db.prepare('SELECT id FROM streams WHERE id = ?').get(id)) throw new Error('Stream not found');
  return id;
}

function requireBinding(streamId, bindingId) {
  if (bindingId === undefined || bindingId === null || bindingId === '') return null;
  const id = Number(bindingId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid source rendition binding');
  const row = db.prepare(`SELECT b.id, b.stream_id, t.vcodec, t.acodec
    FROM stream_transcode_bindings b JOIN transcode_templates t ON t.id = b.template_id
    WHERE b.id = ?`).get(id);
  if (!row) throw new Error('Source rendition binding not found');
  if (Number(row.stream_id) !== Number(streamId)) throw new Error('Source rendition binding belongs to another stream');
  return row;
}

function normalizeFormat(format, audioFormat) {
  const value = String(format || '').toLowerCase();
  if (!FORMATS.has(value)) throw new Error('Invalid recording format');
  const audio = audioFormat == null || audioFormat === '' ? null : String(audioFormat).toLowerCase();
  if (value === 'audio' && !AUDIO_FORMATS.has(audio)) throw new Error('audio_format must be aac or mp3');
  if (value !== 'audio' && audio) throw new Error('audio_format is only valid for audio recordings');
  return { format: value, audio_format: audio };
}
function validateAudioSource(binding, audioFormat) {
  if (!binding) throw new Error('Audio recording requires an audio-only Rendition');
  const video = String(binding.vcodec || '').toLowerCase();
  const audio = String(binding.acodec || '').toLowerCase();
  const normalizedAudio = audio === 'libmp3lame' ? 'mp3' : audio;
  if (video !== 'none') throw new Error('Audio recording requires an audio-only Rendition');
  if (normalizedAudio !== audioFormat) throw new Error('Audio Rendition codec must match audio_format');
}

function listTasksByStream(streamId) {
  return db.prepare(`${SELECT_TASK} WHERE rt.stream_id = ? ORDER BY rt.created_at DESC`)
    .all(Number(streamId)).map(hydrate);
}

function listWorkerTasks() {
  return db.prepare(`${SELECT_TASK} ORDER BY rt.id ASC`).all().map(hydrate);
}

function getTask(id) {
  return hydrate(db.prepare(`${SELECT_TASK} WHERE rt.id = ?`).get(Number(id)));
}

function createTask(input = {}) {
  const streamId = requireStream(input.stream_id);
  const normalized = normalizeFormat(input.format, input.audio_format);
  const binding = requireBinding(streamId, input.source_binding_id);
  if (normalized.format === 'audio') validateAudioSource(binding, normalized.audio_format);
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Recording name is required');
  const subdir = storageService.normalizeSubdir(input.subdir || '');
  const filenamePrefix = input.filename_prefix ? storageService.safeFileStem(input.filename_prefix) : null;
  const segmentSeconds = Number(input.segment_seconds ?? 6);
  if (!Number.isInteger(segmentSeconds) || segmentSeconds < 2 || segmentSeconds > 3600) throw new Error('segment_seconds must be 2-3600');
  const retentionDays = input.retention_days == null || input.retention_days === '' ? null : Number(input.retention_days);
  if (retentionDays != null && (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650)) {
    throw new Error('retention_days must be 1-3650');
  }
  const result = db.prepare(`INSERT INTO record_tasks (
    stream_id, source_binding_id, name, format, audio_format, subdir,
    filename_prefix, segment_seconds, retention_days, desired_state, runtime_state, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STOPPED', 'STOPPED', CURRENT_TIMESTAMP)`)
    .run(streamId, binding?.id || null, name.slice(0, 160), normalized.format,
      normalized.audio_format, subdir, filenamePrefix, segmentSeconds, retentionDays);
  return getTask(Number(result.lastInsertRowid));
}

function setDesiredState(id, desiredState) {
  const task = getTask(id);
  if (!task) return null;
  const desired = String(desiredState || '').toUpperCase();
  if (!DESIRED_STATES.has(desired)) throw new Error('Invalid recording desired state');
  if (desired === 'RUNNING') {
    db.prepare(`UPDATE record_tasks
      SET desired_state = 'RUNNING',
          runtime_state = CASE WHEN runtime_state IN ('STOPPED','COMPLETE','FAILED') THEN 'STARTING' ELSE runtime_state END,
          attempt = CASE WHEN runtime_state = 'FAILED' THEN 0 ELSE attempt END,
          last_error = CASE WHEN runtime_state = 'FAILED' THEN NULL ELSE last_error END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(Number(id));
  } else {
    db.prepare(`UPDATE record_tasks
      SET desired_state = 'STOPPED',
          runtime_state = CASE WHEN runtime_state IN ('STOPPED','COMPLETE','FAILED') THEN runtime_state ELSE 'STOPPING' END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(Number(id));
  }
  if (task.source_binding_id) renditionService.reconcileDesiredState(task.source_binding_id);
  return getTask(id);
}

function updateRuntime(id, updates = {}) {
  const before = getTask(id);
  if (!before) return null;
  const fields = {};
  const allowed = ['runtime_state','attempt','worker_instance_id','last_error','last_growth_at','bytes_written','last_started_at','last_stopped_at'];
  for (const key of allowed) if (updates[key] !== undefined) fields[key] = updates[key];
  if (fields.runtime_state !== undefined) {
    const state = String(fields.runtime_state).toUpperCase();
    if (!RUNTIME_STATES.has(state)) throw new Error('Invalid recording runtime state');
    fields.runtime_state = state;
  }
  if (!Object.keys(fields).length) return getTask(id);
  const clauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE record_tasks SET ${clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(fields), Number(id));
  if (before.source_binding_id && fields.runtime_state !== undefined) {
    renditionService.reconcileDesiredState(before.source_binding_id);
  }
  return getTask(id);
}
function deleteTask(id) {
  const task = getTask(id);
  if (!task) return null;
  if (task.desired_state !== 'STOPPED' || !['STOPPED','COMPLETE','FAILED'].includes(task.runtime_state)) {
    throw new Error('Stop recording before deleting it');
  }
  const asset = db.prepare('SELECT id FROM record_assets WHERE record_task_id = ? LIMIT 1').get(Number(id));
  if (asset) throw new Error('Recording task with assets cannot be deleted');
  db.prepare('DELETE FROM record_tasks WHERE id = ?').run(Number(id));
  return { id: task.id };
}

module.exports = {
  DESIRED_STATES, RUNTIME_STATES, FORMATS, AUDIO_FORMATS,
  listTasksByStream, listWorkerTasks, getTask, createTask,
  setDesiredState, updateRuntime, deleteTask,
  resetStaleRuntime, claimWorkerLease, renewWorkerLease,
  clearWorkerHeartbeat, getWorkerHealth
};

const WORKER_HEARTBEAT_KEY = 'runtime.record_worker.heartbeat';

function heartbeatPayload(instanceId, now = new Date()) {
  return JSON.stringify({ instance_id: String(instanceId), ts: now.toISOString() });
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

function claimWorkerLease(instanceId, maxAgeMs = 10000) {
  if (!instanceId) throw new Error('Worker instance ID is required');
  const owner = String(instanceId);
  const claim = db.transaction(() => {
    const now = new Date();
    const current = parseHeartbeat(db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY)?.value);
    if (current && current.instance_id !== owner && now.getTime() - current.ts_ms <= maxAgeMs) {
      return { acquired: false, instance_id: current.instance_id, last_seen_at: current.ts, age_ms: now.getTime() - current.ts_ms };
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(WORKER_HEARTBEAT_KEY, heartbeatPayload(owner, now));
    return { acquired: true, instance_id: owner, last_seen_at: now.toISOString(), age_ms: 0 };
  });
  return claim.immediate();
}

function renewWorkerLease(instanceId) {
  const owner = String(instanceId || '');
  if (!owner) throw new Error('Worker instance ID is required');
  const renew = db.transaction(() => {
    const current = parseHeartbeat(db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY)?.value);
    if (!current || current.instance_id !== owner) return false;
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(heartbeatPayload(owner), WORKER_HEARTBEAT_KEY);
    return true;
  });
  return renew.immediate();
}

function clearWorkerHeartbeat(instanceId) {
  const current = parseHeartbeat(db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY)?.value);
  if (!current || current.instance_id !== String(instanceId)) return;
  db.prepare('DELETE FROM settings WHERE key = ?').run(WORKER_HEARTBEAT_KEY);
}
function getWorkerHealth(maxAgeMs = 10000) {
  const current = parseHeartbeat(db.prepare('SELECT value FROM settings WHERE key = ?').get(WORKER_HEARTBEAT_KEY)?.value);
  if (!current) return { available: false, instance_id: null, last_seen_at: null, age_ms: null };
  const age = Math.max(0, Date.now() - current.ts_ms);
  return { available: age <= maxAgeMs, instance_id: current.instance_id, last_seen_at: current.ts, age_ms: age };
}

function resetStaleRuntime() {
  db.prepare(`UPDATE record_tasks
    SET runtime_state = CASE WHEN desired_state = 'RUNNING' THEN 'STARTING' ELSE 'STOPPED' END,
        worker_instance_id = NULL,
        last_error = CASE WHEN desired_state = 'RUNNING' THEN 'Record worker restarted; starting a new recoverable asset' ELSE last_error END,
        updated_at = CURRENT_TIMESTAMP
    WHERE runtime_state IN ('STARTING','RECORDING','STOPPING','FINALIZING','STALLED')
       OR worker_instance_id IS NOT NULL`).run();
}
