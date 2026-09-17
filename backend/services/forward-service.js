const db = require('../database');
const { validateStreamUrl } = require('../utils/url-validation');
const pushTaskService = require('./push-task-service');

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

// OUT-PUSH tasks are now controlled by the managed Push Worker.
// Keep this module as the compatibility facade used by the existing routes.
function listTasks() { return pushTaskService.listTasks(); }
function getTask(id) { return pushTaskService.getTask(id); }
function createTask(input) { return pushTaskService.createTask(input); }
function updateTask(id, updates) { return pushTaskService.updateTask(id, updates); }
function deleteTask(id) { return pushTaskService.deleteTask(id); }

// Legacy SRS Dynamic Forward compatibility. Managed-worker tasks are
// intentionally excluded so the same target cannot be pushed twice.
function getForwardTargets(streamName) {
  return pushTaskService.listLegacyDynamicTargets(streamName);
}

module.exports = {
  listSources, getSource, createSource, updateSource, deleteSource,
  listTasks, getTask, createTask, updateTask, deleteTask,
  getForwardTargets
};
