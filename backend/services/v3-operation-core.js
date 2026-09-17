const db = require('../database');

const ACTIVE_PHASES = new Set(['QUEUED', 'RUNNING', 'VERIFYING']);
const TERMINAL_PHASES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const TRANSITIONS = Object.freeze({
  QUEUED: new Set(['RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  RUNNING: new Set(['VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  VERIFYING: new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])
});

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: `operation:${row.id}`,
    legacy_operation_id: row.id,
    type: row.type,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    phase: row.state,
    requested_by: row.requested_by || null,
    idempotency_key: row.idempotency_key || null,
    payload: parseJson(row.payload_json),
    result: parseJson(row.result_json),
    error: row.error || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function numericOperationId(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^operation:(\d+)$/);
  const id = Number(match ? match[1] : raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getOperation(id) {
  const numeric = numericOperationId(id);
  if (!numeric) return null;
  return hydrate(db.prepare('SELECT * FROM operations WHERE id = ?').get(numeric));
}

function findIdempotent(type, subjectType, subjectId, key) {
  if (!key) return null;
  return hydrate(db.prepare(`
    SELECT * FROM operations
    WHERE type = ? AND subject_type = ? AND subject_id = ? AND idempotency_key = ?
    ORDER BY id DESC LIMIT 1
  `).get(type, subjectType, Number(subjectId), String(key)));
}

function activeForSubject(subjectType, subjectId) {
  return hydrate(db.prepare(`
    SELECT * FROM operations
    WHERE subject_type = ? AND subject_id = ?
      AND state IN ('QUEUED','RUNNING','VERIFYING')
    ORDER BY id DESC LIMIT 1
  `).get(subjectType, Number(subjectId)));
}

function createOrReuse({ type, subject_type, subject_id, idempotency_key, requested_by = null, payload = null }) {
  if (!type || !subject_type) throw new Error('Operation type and subject_type are required');
  const subjectId = Number(subject_id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) throw new Error('Invalid operation subject_id');
  if (!idempotency_key || !String(idempotency_key).trim()) throw new Error('Idempotency-Key is required');
  const key = String(idempotency_key).trim();
  const existing = findIdempotent(type, subject_type, subjectId, key);
  if (existing) return { operation: existing, reused: true };
  const conflict = activeForSubject(subject_type, subjectId);
  if (conflict) return { operation: conflict, reused: false, conflict: true };

  const create = db.transaction(() => {
    const again = findIdempotent(type, subject_type, subjectId, key);
    if (again) return { operation: again, reused: true };
    const active = activeForSubject(subject_type, subjectId);
    if (active) return { operation: active, reused: false, conflict: true };
    const result = db.prepare(`
      INSERT INTO operations (type, subject_type, subject_id, state, requested_by, payload_json, idempotency_key)
      VALUES (?, ?, ?, 'QUEUED', ?, ?, ?)
    `).run(type, subject_type, subjectId, requested_by, payload == null ? null : JSON.stringify(payload), key);
    return { operation: getOperation(Number(result.lastInsertRowid)), reused: false };
  });
  return create.immediate();
}

function transition(id, nextPhase, { result = null, error = null } = {}) {
  const current = getOperation(id);
  if (!current) throw new Error('Operation not found');
  const next = String(nextPhase || '').toUpperCase();
  if (current.phase === next) return current;
  if (TERMINAL_PHASES.has(current.phase)) return current;
  if (!TRANSITIONS[current.phase]?.has(next)) throw new Error(`Invalid operation transition: ${current.phase} -> ${next}`);
  const terminal = TERMINAL_PHASES.has(next);
  db.prepare(`
    UPDATE operations
    SET state = ?, result_json = ?, error = ?,
        started_at = CASE WHEN started_at IS NULL AND ? IN ('RUNNING','VERIFYING','SUCCEEDED','FAILED') THEN CURRENT_TIMESTAMP ELSE started_at END,
        completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next, result == null ? null : JSON.stringify(result), error, next, terminal ? 1 : 0, current.legacy_operation_id);
  return getOperation(current.legacy_operation_id);
}

module.exports = { ACTIVE_PHASES, TERMINAL_PHASES, getOperation, findIdempotent, activeForSubject, createOrReuse, transition };
