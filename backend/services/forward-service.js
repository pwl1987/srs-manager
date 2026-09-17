const db = require('../database');
const { validateStreamUrl } = require('../utils/url-validation');

const STREAM_PROTOCOLS = ['rtmp', 'rtmps', 'srt', 'rtsp', 'http', 'https'];

// External sources
function listSources() {
  return db.prepare('SELECT * FROM external_sources ORDER BY created_at DESC').all();
}

function getSource(id) {
  return db.prepare('SELECT * FROM external_sources WHERE id = ?').get(id) || null;
}

function createSource({ name, source_url, protocol, pull_mode }) {
  if (!name || !source_url) throw new Error('Name and source URL are required');
  const check = validateStreamUrl(source_url, STREAM_PROTOCOLS);
  if (!check.valid) throw new Error(`Invalid source URL: ${check.error}`);
  db.prepare('INSERT INTO external_sources (name, source_url, protocol, pull_mode) VALUES (?, ?, ?, ?)')
    .run(name, source_url, protocol || 'rtmp', pull_mode || 'pull');
  return db.prepare('SELECT * FROM external_sources WHERE name = ?').get(name);
}

function updateSource(id, updates) {
  const source = db.prepare('SELECT * FROM external_sources WHERE id = ?').get(id);
  if (!source) return null;
  // Whitelist: never build SET clauses from raw request keys.
  const allowed = ['name', 'source_url', 'protocol', 'pull_mode'];
  const fields = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) fields[key] = updates[key];
  }
  if (fields.source_url !== undefined) {
    const check = validateStreamUrl(fields.source_url, STREAM_PROTOCOLS);
    if (!check.valid) throw new Error(`Invalid source URL: ${check.error}`);
  }
  if (Object.keys(fields).length === 0) return source;
  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE external_sources SET ${setClauses} WHERE id = ?`).run(...Object.values(fields), id);
  return db.prepare('SELECT * FROM external_sources WHERE id = ?').get(id);
}

function deleteSource(id) {
  const source = db.prepare('SELECT * FROM external_sources WHERE id = ?').get(id);
  if (!source) return null;
  db.prepare('DELETE FROM external_sources WHERE id = ?').run(id);
  return { name: source.name };
}

// Forward tasks
function listTasks() {
  return db.prepare('SELECT * FROM forward_tasks ORDER BY created_at DESC').all();
}

function getTask(id) {
  return db.prepare('SELECT * FROM forward_tasks WHERE id = ?').get(id) || null;
}

function createTask({ stream_id, external_source_id, target_type, target_url, enabled }) {
  if (!target_type || !target_url) throw new Error('Target type and URL are required');
  const check = validateStreamUrl(target_url, STREAM_PROTOCOLS);
  if (!check.valid) throw new Error(`Invalid target URL: ${check.error}`);
  db.prepare('INSERT INTO forward_tasks (stream_id, external_source_id, target_type, target_url, enabled) VALUES (?, ?, ?, ?, ?)')
    .run(stream_id, external_source_id, target_type, target_url, enabled !== undefined ? enabled : 1);
  return db.prepare('SELECT * FROM forward_tasks WHERE target_url = ? AND target_type = ?').get(target_url, target_type);
}

function updateTask(id, updates) {
  const task = db.prepare('SELECT * FROM forward_tasks WHERE id = ?').get(id);
  if (!task) return null;
  // Whitelist: never build SET clauses from raw request keys.
  const allowed = ['stream_id', 'external_source_id', 'target_type', 'target_url', 'enabled'];
  const fields = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) fields[key] = updates[key];
  }
  if (fields.target_url !== undefined) {
    const check = validateStreamUrl(fields.target_url, STREAM_PROTOCOLS);
    if (!check.valid) throw new Error(`Invalid target URL: ${check.error}`);
  }
  if (Object.keys(fields).length === 0) return task;
  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE forward_tasks SET ${setClauses} WHERE id = ?`).run(...Object.values(fields), id);
  return db.prepare('SELECT * FROM forward_tasks WHERE id = ?').get(id);
}

function deleteTask(id) {
  const task = db.prepare('SELECT * FROM forward_tasks WHERE id = ?').get(id);
  if (!task) return null;
  db.prepare('DELETE FROM forward_tasks WHERE id = ?').run(id);
  return { id: task.id };
}

// SRS Forward backend: returns forward targets for a stream
function getForwardTargets(streamName) {
  const tasks = db.prepare('SELECT * FROM forward_tasks WHERE enabled = 1 AND status != \'error\'').all();
  const stream = db.prepare('SELECT id FROM streams WHERE name = ?').get(streamName);

  return tasks
    .filter(t => t.stream_id === stream?.id || !t.stream_id)
    .map(t => t.target_url);
}

module.exports = {
  listSources, getSource, createSource, updateSource, deleteSource,
  listTasks, getTask, createTask, updateTask, deleteTask,
  getForwardTargets
};
