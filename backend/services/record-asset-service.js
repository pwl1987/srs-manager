const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const storageService = require('./record-storage-service');
const runtime = require('./record-runtime');

const STATES = new Set(['PREPARING','RECORDING','FINALIZING','COMPLETE','RECOVERABLE','FAILED']);

function hydrate(row) {
  if (!row) return null;
  return {
    id: Number(row.id), record_task_id: Number(row.record_task_id),
    state: row.state, work_dir: row.work_dir, final_path: row.final_path || null,
    format: row.format, segment_count: Number(row.segment_count || 0),
    size_bytes: Number(row.size_bytes || 0), duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    error: row.error || null, started_at: row.started_at,
    completed_at: row.completed_at || null, created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
}

function getAsset(id) {
  return hydrate(db.prepare('SELECT * FROM record_assets WHERE id = ?').get(Number(id)));
}
function listAssetsByTask(taskId) {
  return db.prepare('SELECT * FROM record_assets WHERE record_task_id = ? ORDER BY created_at DESC, id DESC')
    .all(Number(taskId)).map(hydrate);
}

function timestampSlug(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function createAsset(task, options = {}) {
  if (!task?.id) throw new Error('Recording task is required');
  const now = options.now instanceof Date ? options.now : new Date();
  const nonce = String(options.nonce || crypto.randomBytes(4).toString('hex')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
  const stem = storageService.safeFileStem(task.filename_prefix || task.name || `record-${task.id}`);
  const base = `${stem}-${timestampSlug(now)}-${nonce || 'asset'}`;
  const subdir = storageService.normalizeSubdir(task.subdir || '');
  const workDir = [subdir, `${base}.work`].filter(Boolean).join('/');
  const finalPath = [subdir, `${base}.${runtime.finalExtension(task)}`].filter(Boolean).join('/');
  storageService.resolveRelative(workDir);
  storageService.resolveRelative(finalPath);

  const result = db.prepare(`INSERT INTO record_assets (
    record_task_id, state, work_dir, final_path, format, started_at, updated_at
  ) VALUES (?, 'PREPARING', ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .run(Number(task.id), workDir, finalPath, task.format, now.toISOString());
  return getAsset(Number(result.lastInsertRowid));
}
function resolveAssetPaths(asset, { createWorkDir = false } = {}) {
  const workDir = storageService.resolveRelative(asset.work_dir);
  const finalPath = storageService.resolveRelative(asset.final_path);
  if (createWorkDir) fs.mkdirSync(workDir, { recursive: true, mode: 0o750 });
  return { work_dir: workDir, final_path: finalPath, concat_file: path.join(workDir, 'concat.txt') };
}

function updateAsset(id, updates = {}) {
  const fields = {};
  const allowed = ['state','segment_count','size_bytes','duration_seconds','error','completed_at'];
  for (const key of allowed) if (updates[key] !== undefined) fields[key] = updates[key];
  if (fields.state !== undefined) {
    const state = String(fields.state).toUpperCase();
    if (!STATES.has(state)) throw new Error('Invalid recording asset state');
    fields.state = state;
  }
  if (!Object.keys(fields).length) return getAsset(id);
  const clauses = Object.keys(fields).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE record_assets SET ${clauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(fields), Number(id));
  return getAsset(id);
}

function scanSegments(asset) {
  const { work_dir: workDir } = resolveAssetPaths(asset);
  if (!fs.existsSync(workDir)) return { segment_count: 0, size_bytes: 0, latest_mtime_ms: null, files: [] };
  const files = fs.readdirSync(workDir).filter(name => /^segment-\d{6}\.ts$/.test(name)).sort();
  let size = 0;
  let latest = null;
  for (const name of files) {
    const stat = fs.statSync(path.join(workDir, name));
    size += stat.size;
    latest = latest == null ? stat.mtimeMs : Math.max(latest, stat.mtimeMs);
  }
  return { segment_count: files.length, size_bytes: size, latest_mtime_ms: latest, files };
}

function refreshObserved(assetId) {
  const asset = getAsset(assetId);
  if (!asset) return null;
  const observed = scanSegments(asset);
  updateAsset(asset.id, { segment_count: observed.segment_count, size_bytes: observed.size_bytes });
  return { asset: getAsset(asset.id), observed };
}

module.exports = {
  STATES, getAsset, listAssetsByTask, createAsset, resolveAssetPaths,
  updateAsset, scanSegments, refreshObserved
};
