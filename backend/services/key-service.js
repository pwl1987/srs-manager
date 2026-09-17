const crypto = require('crypto');
const db = require('../database');

function generateKey(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function listKeys() {
  return db.prepare('SELECT * FROM auth_keys ORDER BY created_at DESC').all();
}

function getKey(id) {
  return db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(id) || null;
}

function createKey({ type, stream_id, channel_id, description, expires_at, auto_rotate_days }) {
  const key = generateKey();
  db.prepare(`
    INSERT INTO auth_keys (type, stream_id, channel_id, key, description, expires_at, auto_rotate_days)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(type, stream_id, channel_id, key, description, expires_at, auto_rotate_days);
  return db.prepare('SELECT * FROM auth_keys WHERE key = ?').get(key);
}

function updateKey(id, { expires_at, description, auto_rotate_days }) {
  const key = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(id);
  if (!key) return null;

  const updates = {};
  if (expires_at) updates.expires_at = expires_at;
  if (description !== undefined) updates.description = description;
  if (auto_rotate_days !== undefined) updates.auto_rotate_days = auto_rotate_days;

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE auth_keys SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);
  }
  return db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(id);
}

function deleteKey(id) {
  const key = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(id);
  if (!key) return null;
  db.prepare('DELETE FROM auth_keys WHERE id = ?').run(id);
  return { type: key.type, id: key.id };
}

function rotateKey(id) {
  const key = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(id);
  if (!key) return null;
  const newKey = generateKey();
  db.prepare('UPDATE auth_keys SET key = ?, last_rotated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newKey, id);
  return db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(id);
}

module.exports = { listKeys, getKey, createKey, updateKey, deleteKey, rotateKey, generateKey };
