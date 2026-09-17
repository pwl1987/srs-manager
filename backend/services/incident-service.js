const crypto = require('node:crypto');
const db = require('../database');

function parseJson(value, fallback) {
  try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; }
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: Number(row.id), stream_id: Number(row.stream_id), session_id: row.session_id == null ? null : Number(row.session_id),
    fingerprint: row.fingerprint, category: row.category, severity: row.severity, code: row.code,
    subject_ref: row.subject_ref || null, status: row.status, title: row.title, message: row.message,
    impact: parseJson(row.impact_json, {}), first_seen_at: row.first_seen_at, last_seen_at: row.last_seen_at,
    acknowledged_at: row.acknowledged_at || null, acknowledged_by: row.acknowledged_by || null,
    recovered_at: row.recovered_at || null, created_at: row.created_at, updated_at: row.updated_at
  };
}

function classify(code) {
  if (code.includes('STORAGE')) return 'RESOURCE';
  if (code.includes('WORKER')) return 'SYSTEM';
  if (code.startsWith('PROGRAM_')) return 'SIGNAL';
  if (code.startsWith('PULL_')) return 'SYSTEM';
  return 'DELIVERY';
}
function activeSessionRequired(workspace) {
  const required = new Set();
  const session = workspace.session;
  if (!session || !['ON_AIR','CLOSING'].includes(session.lifecycle_state)) return required;
  for (const item of session.outputs || []) if (item.importance === 'REQUIRED') required.add(item.output_ref);
  return required;
}

function impactedOutputs(workspace, reason) {
  const outputs = workspace.outputs || [];
  if (reason.impact === 'all_outputs' || reason.subject_id === workspace.program?.id) return outputs.map(o => o.id);
  if (reason.impact === 'single_output' && reason.subject_id) return [reason.subject_id];
  if (reason.impact === 'dependent_outputs' && reason.subject_id) return outputs.filter(o => o.media_ref === reason.subject_id).map(o => o.id);
  if (reason.impact === 'outputs') return outputs.filter(o => o.mode === 'PUSH' && o.desired_state === 'RUNNING').map(o => o.id);
  if (reason.impact === 'recording') return outputs.filter(o => o.mode === 'RECORD' && o.desired_state === 'RUNNING').map(o => o.id);
  return [];
}

function suggestedAction(code) {
  if (code === 'PROGRAM_EXPECTED_NOT_OBSERVED') return 'Check current Program source and switch to a healthy standby if available.';
  if (code.includes('WORKER_UNAVAILABLE')) return 'Restore the affected worker, then verify runtime evidence before retrying.';
  if (code.includes('STORAGE_LOW')) return 'Free recording storage or move the recording target before continuing.';
  if (code.includes('RENDITION')) return 'Verify the shared Rendition; dependent outputs may recover together.';
  if (code.includes('OUTPUT_RUNTIME_FAILED')) return 'Retry only the affected Output and leave healthy Outputs running.';
  if (code.includes('RECORD_RUNTIME_FAILED')) return 'Inspect the recording asset and retry recording without disturbing network Outputs.';
  return 'Inspect the linked evidence and act only on the affected chain.';
}
function deriveIncidents(workspace) {
  const streamId = workspace.room?.legacy_stream_id;
  const sessionId = workspace.session?.legacy_session_id || null;
  const required = activeSessionRequired(workspace);
  return (workspace.health?.reasons || []).filter(r => r.severity !== 'INFO').map(reason => {
    const outputIds = impactedOutputs(workspace, reason);
    const requiredIds = outputIds.filter(id => required.has(id));
    let severity = reason.severity;
    if (severity === 'WARNING' && requiredIds.length && /FAILED|UNAVAILABLE|NOT_OBSERVED/.test(reason.code)) severity = 'CRITICAL';
    const programAffected = reason.impact === 'all_outputs' || reason.subject_id === workspace.program?.id;
    const canStillBroadcast = workspace.program?.state === 'LIVE' && !programAffected;
    const fingerprint = crypto.createHash('sha256').update([streamId, sessionId || 0, reason.code, reason.subject_id || 'none'].join('|')).digest('hex').slice(0, 24);
    return {
      fingerprint, stream_id: streamId, session_id: sessionId, category: classify(reason.code), severity,
      code: reason.code, subject_ref: reason.subject_id || null,
      title: reason.code.replaceAll('_', ' '), message: reason.message,
      impact: { output_ids: outputIds, required_output_ids: requiredIds, program_affected: programAffected, can_still_broadcast: canStillBroadcast, suggested_action: suggestedAction(reason.code) }
    };
  });
}

function listActive(streamId) {
  return db.prepare("SELECT * FROM incidents WHERE stream_id = ? AND status IN ('OPEN','ACKNOWLEDGED') ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, first_seen_at")
    .all(Number(streamId)).map(hydrate);
}

function listRecent(streamId, limit = 20) {
  return db.prepare('SELECT * FROM incidents WHERE stream_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?').all(Number(streamId), Number(limit)).map(hydrate);
}

function addEvent(incidentId, eventType, detail = null) {
  db.prepare('INSERT INTO incident_events (incident_id, event_type, detail_json) VALUES (?, ?, ?)').run(Number(incidentId), eventType, detail == null ? null : JSON.stringify(detail));
}
function syncWorkspace(workspace) {
  const streamId = Number(workspace.room?.legacy_stream_id);
  const candidates = deriveIncidents(workspace);
  const tx = db.transaction(() => {
    const active = listActive(streamId);
    const seen = new Set();
    for (const candidate of candidates) {
      seen.add(candidate.fingerprint);
      const existing = active.find(item => item.fingerprint === candidate.fingerprint);
      if (existing) {
        db.prepare(`UPDATE incidents SET category=?, severity=?, code=?, subject_ref=?, title=?, message=?, impact_json=?, last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(candidate.category, candidate.severity, candidate.code, candidate.subject_ref, candidate.title, candidate.message, JSON.stringify(candidate.impact), existing.id);
        continue;
      }
      const result = db.prepare(`INSERT INTO incidents (stream_id, session_id, fingerprint, category, severity, code, subject_ref, status, title, message, impact_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`)
        .run(candidate.stream_id, candidate.session_id, candidate.fingerprint, candidate.category, candidate.severity, candidate.code, candidate.subject_ref, candidate.title, candidate.message, JSON.stringify(candidate.impact));
      addEvent(Number(result.lastInsertRowid), 'OPENED', { code: candidate.code, severity: candidate.severity });
    }
    for (const incident of active) {
      if (seen.has(incident.fingerprint)) continue;
      db.prepare("UPDATE incidents SET status='RECOVERED', recovered_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(incident.id);
      addEvent(incident.id, 'RECOVERED', { previous_status: incident.status });
    }
    return { active: listActive(streamId), recent: listRecent(streamId, 20) };
  });
  return tx.immediate();
}

function acknowledge(id, streamId, acknowledgedBy = null) {
  const current = hydrate(db.prepare('SELECT * FROM incidents WHERE id=? AND stream_id=?').get(Number(id), Number(streamId)));
  if (!current) return null;
  if (current.status === 'RECOVERED') return current;
  if (current.status === 'ACKNOWLEDGED') return current;
  db.prepare("UPDATE incidents SET status='ACKNOWLEDGED', acknowledged_at=CURRENT_TIMESTAMP, acknowledged_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(acknowledgedBy, current.id);
  addEvent(current.id, 'ACKNOWLEDGED', { acknowledged_by: acknowledgedBy });
  return hydrate(db.prepare('SELECT * FROM incidents WHERE id=?').get(current.id));
}

function listEvents(incidentId) {
  return db.prepare('SELECT id, event_type, detail_json, created_at FROM incident_events WHERE incident_id=? ORDER BY id').all(Number(incidentId))
    .map(row => ({ id: row.id, event_type: row.event_type, detail: parseJson(row.detail_json, null), created_at: row.created_at }));
}

module.exports = { deriveIncidents, syncWorkspace, listActive, listRecent, acknowledge, listEvents };
