const db = require('../database');

const IMPORTANCE = new Set(['REQUIRED', 'OPTIONAL']);

function requireStream(streamId) {
  const id = Number(streamId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid stream');
  if (!db.prepare('SELECT id FROM streams WHERE id = ?').get(id)) throw new Error('Stream not found');
  return id;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; }
}

function normalizeSourceId(value) {
  if (value == null || value === '') return null;
  const id = String(value).trim();
  if (!/^source:[a-z0-9:_-]+$/i.test(id) || id.length > 220) throw new Error('Invalid source reference');
  return id;
}

function normalizeFailover(values = [], primary = null) {
  if (!Array.isArray(values)) throw new Error('failover_source_ids must be an array');
  const out = [];
  for (const value of values) {
    const id = normalizeSourceId(value);
    if (!id || id === primary || out.includes(id)) continue;
    if (out.length >= 16) throw new Error('Too many failover sources');
    out.push(id);
  }
  return out;
}

function outputBelongsToStream(streamId, outputRef) {
  let match = String(outputRef || '').match(/^output:push:(\d+)$/);
  if (match) return Boolean(db.prepare('SELECT id FROM forward_tasks WHERE id = ? AND stream_id = ?').get(Number(match[1]), streamId));
  match = String(outputRef || '').match(/^output:record:(\d+)$/);
  if (match) return Boolean(db.prepare('SELECT id FROM record_tasks WHERE id = ? AND stream_id = ?').get(Number(match[1]), streamId));
  match = String(outputRef || '').match(/^output:serve:(\d+)$/);
  if (match) return Number(match[1]) === Number(streamId) && Boolean(db.prepare('SELECT stream_id FROM out_pull_policies WHERE stream_id = ?').get(streamId));
  return false;
}

function normalizeOutputs(streamId, outputs = []) {
  if (!Array.isArray(outputs)) throw new Error('outputs must be an array');
  const seen = new Set();
  return outputs.map((item, index) => {
    const outputRef = String(item?.output_ref || '').trim();
    if (!outputRef || seen.has(outputRef)) throw new Error('Run Plan output references must be unique');
    if (!outputBelongsToStream(streamId, outputRef)) throw new Error(`Output does not belong to this Room: ${outputRef}`);
    seen.add(outputRef);
    const importance = String(item.importance || 'REQUIRED').toUpperCase();
    if (!IMPORTANCE.has(importance)) throw new Error('importance must be REQUIRED or OPTIONAL');
    return { output_ref: outputRef, importance, auto_start: item.auto_start !== false, sort_order: Number.isInteger(Number(item.sort_order)) ? Number(item.sort_order) : (index + 1) * 10 };
  });
}

function hydrate(row) {
  if (!row) return null;
  const outputs = db.prepare('SELECT * FROM run_plan_outputs WHERE run_plan_id = ? ORDER BY sort_order, id').all(row.id)
    .map(x => ({ id: x.id, output_ref: x.output_ref, importance: x.importance, auto_start: Boolean(x.auto_start), sort_order: x.sort_order }));
  return { id: row.id, stream_id: row.stream_id, name: row.name, description: row.description || null, program_source_id: row.program_source_id || null, failover_source_ids: parseJson(row.failover_json, []), status: row.status, outputs, created_at: row.created_at, updated_at: row.updated_at };
}

function getPlan(id) { return hydrate(db.prepare('SELECT * FROM run_plans WHERE id = ?').get(Number(id))); }
function listPlansByStream(streamId) { return db.prepare('SELECT * FROM run_plans WHERE stream_id = ? ORDER BY updated_at DESC, id DESC').all(Number(streamId)).map(hydrate); }

function replaceOutputs(planId, outputs) {
  db.prepare('DELETE FROM run_plan_outputs WHERE run_plan_id = ?').run(planId);
  const insert = db.prepare('INSERT INTO run_plan_outputs (run_plan_id, output_ref, importance, auto_start, sort_order) VALUES (?, ?, ?, ?, ?)');
  for (const item of outputs) insert.run(planId, item.output_ref, item.importance, item.auto_start ? 1 : 0, item.sort_order);
}

function createPlan(input = {}) {
  const streamId = requireStream(input.stream_id);
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Run Plan name is required');
  const primary = normalizeSourceId(input.program_source_id);
  const failover = normalizeFailover(input.failover_source_ids || [], primary);
  const outputs = normalizeOutputs(streamId, input.outputs || []);
  const tx = db.transaction(() => {
    const result = db.prepare("INSERT INTO run_plans (stream_id, name, description, program_source_id, failover_json, status, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)")
      .run(streamId, name.slice(0, 160), input.description ? String(input.description).slice(0, 1000) : null, primary, JSON.stringify(failover));
    replaceOutputs(Number(result.lastInsertRowid), outputs);
    return getPlan(Number(result.lastInsertRowid));
  });
  return tx.immediate();
}

function updatePlan(id, input = {}) {
  const current = getPlan(id);
  if (!current) return null;
  const primary = input.program_source_id !== undefined ? normalizeSourceId(input.program_source_id) : current.program_source_id;
  const failover = input.failover_source_ids !== undefined ? normalizeFailover(input.failover_source_ids, primary) : current.failover_source_ids;
  const outputs = input.outputs !== undefined ? normalizeOutputs(current.stream_id, input.outputs) : current.outputs;
  const name = input.name !== undefined ? String(input.name || '').trim() : current.name;
  if (!name) throw new Error('Run Plan name is required');
  const tx = db.transaction(() => {
    db.prepare('UPDATE run_plans SET name = ?, description = ?, program_source_id = ?, failover_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name.slice(0, 160), input.description !== undefined ? (input.description ? String(input.description).slice(0, 1000) : null) : current.description, primary, JSON.stringify(failover), input.status || current.status, current.id);
    if (input.outputs !== undefined) replaceOutputs(current.id, outputs);
    return getPlan(current.id);
  });
  return tx.immediate();
}

function snapshot(plan) {
  if (!plan) return { run_plan_id: null, name: null, program_source_id: null, failover_source_ids: [], outputs: [] };
  return { run_plan_id: plan.id, name: plan.name, program_source_id: plan.program_source_id, failover_source_ids: [...plan.failover_source_ids], outputs: plan.outputs.map(x => ({ source_plan_output_id: x.id, output_ref: x.output_ref, importance: x.importance, auto_start: x.auto_start, sort_order: x.sort_order })) };
}

module.exports = { IMPORTANCE, getPlan, listPlansByStream, createPlan, updatePlan, snapshot, outputBelongsToStream };
