const db = require('../database');
const runPlanService = require('./run-plan-service');

const LIFECYCLE = new Set(['PREP', 'READY', 'ON_AIR', 'CLOSING', 'ENDED']);
const ALLOWED = { PREP: new Set(['READY', 'ENDED']), READY: new Set(['PREP', 'ON_AIR', 'ENDED']), ON_AIR: new Set(['CLOSING']), CLOSING: new Set(['ENDED']), ENDED: new Set() };
function parseJson(value, fallback) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function outputsFor(id) { return db.prepare('SELECT * FROM session_outputs WHERE session_id = ? ORDER BY sort_order, id').all(Number(id)).map(x => ({ id: x.id, output_ref: x.output_ref, importance: x.importance, auto_start: Boolean(x.auto_start), temporary: Boolean(x.temporary), sort_order: x.sort_order, source_plan_output_id: x.source_plan_output_id || null })); }
function hydrate(row) { if (!row) return null; return { id: row.id, stream_id: row.stream_id, run_plan_id: row.run_plan_id || null, title: row.title, lifecycle_state: row.lifecycle_state, planned_program_source_id: row.planned_program_source_id || null, failover_source_ids: parseJson(row.failover_json, []), plan_snapshot: parseJson(row.plan_snapshot_json, {}), preflight_status: row.preflight_status || null, preflight: parseJson(row.preflight_json, null), preflight_at: row.preflight_at || null, created_by: row.created_by || null, ready_at: row.ready_at || null, started_at: row.started_at || null, closing_at: row.closing_at || null, ended_at: row.ended_at || null, created_at: row.created_at, updated_at: row.updated_at, outputs: outputsFor(row.id) }; }
function getSession(id) { return hydrate(db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(id))); }
function listSessionsByStream(streamId) { return db.prepare('SELECT * FROM sessions WHERE stream_id = ? ORDER BY created_at DESC, id DESC').all(Number(streamId)).map(hydrate); }
function getActiveSessionForStream(streamId) { return hydrate(db.prepare("SELECT * FROM sessions WHERE stream_id = ? AND lifecycle_state <> 'ENDED' ORDER BY id DESC LIMIT 1").get(Number(streamId))); }

function createSession(input = {}) {
  const streamId = Number(input.stream_id); if (!Number.isInteger(streamId) || !db.prepare('SELECT id FROM streams WHERE id = ?').get(streamId)) throw new Error('Stream not found');
  const plan = input.run_plan_id ? runPlanService.getPlan(input.run_plan_id) : null;
  if (input.run_plan_id && (!plan || Number(plan.stream_id) !== streamId)) throw new Error('Run Plan not found in this Room');
  const active = getActiveSessionForStream(streamId); if (active) throw new Error('An active Session already exists for this Room');
  const snap = runPlanService.snapshot(plan);
  const title = String(input.title || plan?.name || 'Live Session').trim(); if (!title) throw new Error('Session title is required');
  const tx = db.transaction(() => {
    const result = db.prepare("INSERT INTO sessions (stream_id, run_plan_id, title, lifecycle_state, planned_program_source_id, failover_json, plan_snapshot_json, created_by, updated_at) VALUES (?, ?, ?, 'PREP', ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .run(streamId, plan?.id || null, title.slice(0, 180), snap.program_source_id, JSON.stringify(snap.failover_source_ids), JSON.stringify(snap), input.created_by || null);
    const sessionId = Number(result.lastInsertRowid);
    const insert = db.prepare('INSERT INTO session_outputs (session_id, output_ref, importance, auto_start, temporary, sort_order, source_plan_output_id) VALUES (?, ?, ?, ?, 0, ?, ?)');
    for (const item of snap.outputs) insert.run(sessionId, item.output_ref, item.importance, item.auto_start ? 1 : 0, item.sort_order, item.source_plan_output_id || null);
    return getSession(sessionId);
  });
  return tx.immediate();
}

function transition(id, nextState) {
  const session = getSession(id); if (!session) return null;
  const next = String(nextState || '').toUpperCase(); if (!LIFECYCLE.has(next)) throw new Error('Invalid Session lifecycle state');
  if (next === session.lifecycle_state) return session;
  if (!ALLOWED[session.lifecycle_state].has(next)) throw new Error(`Invalid Session transition ${session.lifecycle_state} -> ${next}`);
  const stamps = { READY: 'ready_at', ON_AIR: 'started_at', CLOSING: 'closing_at', ENDED: 'ended_at' };
  const stamp = stamps[next];
  db.prepare(`UPDATE sessions SET lifecycle_state = ?, ${stamp ? `${stamp} = COALESCE(${stamp}, CURRENT_TIMESTAMP),` : ''} updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(next, session.id);
  return getSession(id);
}

function recordPreflight(id, result, { mark_ready = false } = {}) {
  const session = getSession(id); if (!session) return null;
  db.prepare('UPDATE sessions SET preflight_status = ?, preflight_json = ?, preflight_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(result.status, JSON.stringify(result), result.evaluated_at, session.id);
  let fresh = getSession(id);
  if (mark_ready && ['PREP', 'READY'].includes(fresh.lifecycle_state)) {
    if (result.status === 'BLOCKED' && fresh.lifecycle_state === 'READY') fresh = transition(id, 'PREP');
    else if (result.status !== 'BLOCKED' && fresh.lifecycle_state === 'PREP') fresh = transition(id, 'READY');
  }
  return fresh;
}

module.exports = { LIFECYCLE, getSession, listSessionsByStream, getActiveSessionForStream, createSession, transition, recordPreflight };
