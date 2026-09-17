const srsService = require('./srs');
const { buildUrls } = require('./stream-urls');
const db = require('../database');

// Uptime of the current publishing session: time since the latest on_publish
// hook event. processed_at is SQLite CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS").
function currentUptimeSeconds(streamName) {
  const row = db.prepare("SELECT processed_at FROM hook_events WHERE event_type = 'on_publish' AND stream_name = ?")
    .get(streamName);
  if (!row) return null;
  const startedAt = Date.parse(row.processed_at.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

// SRS 6 /streams list items expose stats as item.kbps / item.clients; the
// per-stream detail shape (item.stream.inbps) is accepted as a fallback.
// kbps.recv_30s is the server-side receive bitrate in kbps (30s rolling
// window); clients counts every session including the publisher.
function extractLiveStats(item) {
  const kbpsSource = item?.kbps?.recv_30s ?? item?.kbps?.publish ?? item?.stream?.inbps;
  const kbps = Math.round(Number(kbpsSource)) || 0;
  const clients = Math.round(Number(item?.clients ?? item?.stream?.cur_client)) || 0;
  return { kbps, viewers: Math.max(0, clients - 1) };
}

async function listStreams() {
  const srsStreams = await srsService.getStreams();
  const localStreams = db.prepare('SELECT * FROM streams ORDER BY created_at DESC').all();

  return localStreams.map(local => {
    const srs = srsStreams.find(s => s.name === local.name);
    const live = srs ? extractLiveStats(srs) : { kbps: local.bitrate, viewers: local.viewers };
    return {
      ...local,
      ...buildUrls(local.name),
      status: srs ? 'online' : local.status,
      bitrate: live.kbps,
      viewers: live.viewers,
      uptime_seconds: srs ? currentUptimeSeconds(local.name) : null
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

// Stop a live broadcast by kicking every SRS client session on the stream
// (publisher and players). Returns the number of kicked sessions.
async function stopStream(id) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;

  const clients = await srsService.listClients();
  const targets = clients.filter(c => c.app === 'live' && c.stream === stream.name);

  let kicked = 0;
  const errors = [];
  for (const client of targets) {
    try {
      await srsService.kickClient(client.id);
      kicked++;
    } catch (e) {
      errors.push(`client ${client.id}: ${e.message}`);
    }
  }

  db.prepare("UPDATE streams SET status = 'offline', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return { name: stream.name, kicked, errors };
}

module.exports = { listStreams, getStream, createStream, updateStream, deleteStream, stopStream };
