const srsService = require('./srs');
const { buildUrls } = require('./stream-urls');
const db = require('../database');

async function listStreams() {
  const srsStreams = await srsService.getStreams();
  const localStreams = db.prepare('SELECT * FROM streams ORDER BY created_at DESC').all();

  return localStreams.map(local => {
    const srs = srsStreams.find(s => s.name === local.name);
    return {
      ...local,
      ...buildUrls(local.name),
      status: srs ? 'online' : local.status,
      bitrate: srs ? srs.stream?.inbps || 0 : local.bitrate,
      viewers: srs ? srs.stream?.cur_client || 0 : local.viewers
    };
  });
}

async function getStream(id) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;
  return { ...stream, ...buildUrls(stream.name) };
}

async function createStream(name, protocol) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid stream name');

  db.prepare('INSERT INTO streams (name, protocol, status) VALUES (?, ?, ?)')
    .run(name, protocol || 'rtmp', 'offline');

  const stream = db.prepare('SELECT * FROM streams WHERE name = ?').get(name);
  return { ...stream, ...buildUrls(name) };
}

async function updateStream(id, { name, protocol }) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;

  const updates = {};
  if (name && name !== stream.name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid stream name');
    updates.name = name;
  }
  if (protocol) updates.protocol = protocol;

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE streams SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...Object.values(updates), id);
  }

  const updated = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  return { ...updated, ...buildUrls(updated.name) };
}

async function deleteStream(id) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;
  db.prepare('DELETE FROM streams WHERE id = ?').run(id);
  return { name: stream.name };
}

module.exports = { listStreams, getStream, createStream, updateStream, deleteStream };
