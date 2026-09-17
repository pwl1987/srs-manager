const srsService = require('./srs');
const { buildUrls } = require('./stream-urls');
const db = require('../database');
const outPullService = require('./out-pull-service');

function resolveTranscodeTemplateId(templateId) {
  if (templateId === undefined || templateId === null || templateId === '') return null;
  const id = Number(templateId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid transcode template');
  const tpl = db.prepare('SELECT id FROM transcode_templates WHERE id = ?').get(id);
  if (!tpl) throw new Error('Invalid transcode template');
  return id;
}

function templateNameMap() {
  const map = {};
  for (const row of db.prepare('SELECT id, name FROM transcode_templates').all()) map[row.id] = row.name;
  return map;
}

function isPublisher(client) {
  return String(client?.type || '').toLowerCase().includes('publish');
}

function currentUptimeSeconds(streamName) {
  const row = db.prepare("SELECT processed_at FROM hook_events WHERE event_type = 'on_publish' AND stream_name = ?")
    .get(streamName);
  if (!row) return null;
  const startedAt = Date.parse(row.processed_at.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function extractLiveStats(item) {
  const kbpsSource = item?.kbps?.recv_30s ?? item?.kbps?.publish ?? item?.stream?.inbps;
  const kbps = Math.round(Number(kbpsSource)) || 0;
  const clients = Math.round(Number(item?.clients ?? item?.stream?.cur_client)) || 0;
  return { kbps, viewers: Math.max(0, clients - 1) };
}

async function listStreams() {
  const [srsStreams, clients] = await Promise.all([
    srsService.getStreams(),
    srsService.listClients().catch(() => null)
  ]);
  const localStreams = db.prepare('SELECT * FROM streams ORDER BY created_at DESC').all();
  const templateNames = templateNameMap();

  return localStreams.map(local => {
    const srs = srsStreams.find(s => s.name === local.name);
    const live = srs ? extractLiveStats(srs) : { kbps: local.bitrate, viewers: local.viewers };
    const nonAudience = outPullService.nonAudienceClientIds(local.id);
    const audienceViewers = clients && srs
      ? clients.filter(client => srsService.clientMatchesStream(client, local.name, 'live') && !isPublisher(client) && !nonAudience.has(String(client.id))).length
      : live.viewers;
    return {
      ...local,
      ...buildUrls(local.name),
      transcode_template_name: local.transcode_template_id ? (templateNames[local.transcode_template_id] || null) : null,
      status: srs ? 'online' : local.status,
      bitrate: live.kbps,
      viewers: audienceViewers,
      uptime_seconds: srs ? currentUptimeSeconds(local.name) : null
    };
  });
}

async function listExternalStreams() {
  const [srsStreams, clients] = await Promise.all([
    srsService.getStreams(),
    srsService.listClients().catch(() => [])
  ]);
  const known = new Set(db.prepare('SELECT name FROM streams').all().map(r => r.name));
  return srsStreams
    .filter(s => (s.app || 'live') === 'live' && !known.has(s.name))
    .map(s => {
      const publisher = clients.find(c => srsService.clientMatchesStream(c, s.name, 'live') && isPublisher(c));
      const stats = extractLiveStats(s);
      return { name: s.name, kbps: stats.kbps, viewers: stats.viewers, publish_ip: publisher?.ip || null };
    });
}

async function getStream(id) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;
  const names = templateNameMap();
  return {
    ...stream,
    ...buildUrls(stream.name),
    transcode_template_name: stream.transcode_template_id ? (names[stream.transcode_template_id] || null) : null
  };
}

async function createStream(name, protocol, transcodeTemplateId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid stream name');
  const templateId = resolveTranscodeTemplateId(transcodeTemplateId);

  db.prepare('INSERT INTO streams (name, protocol, status, transcode_template_id) VALUES (?, ?, ?, ?)')
    .run(name, protocol || 'rtmp', 'offline', templateId);

  const stream = db.prepare('SELECT * FROM streams WHERE name = ?').get(name);
  return { ...stream, ...buildUrls(name) };
}

async function updateStream(id, { name, protocol, transcode_template_id }) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;

  const updates = {};
  if (name && name !== stream.name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid stream name');
    updates.name = name;
  }
  if (protocol) updates.protocol = protocol;
  if (transcode_template_id !== undefined) {
    updates.transcode_template_id = resolveTranscodeTemplateId(transcode_template_id);
  }

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

async function disconnectMatchingClients(id, predicate) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;

  const clients = await srsService.listClients();
  const targets = clients.filter(client =>
    srsService.clientMatchesStream(client, stream.name, 'live') && predicate(client)
  );

  let disconnected = 0;
  const errors = [];
  for (const client of targets) {
    try {
      await srsService.kickClient(client.id);
      disconnected++;
    } catch (e) {
      errors.push(`client ${client.id}: ${e.message}`);
    }
  }

  return { name: stream.name, disconnected, errors };
}

async function disconnectPublisher(id) {
  const result = await disconnectMatchingClients(id, isPublisher);
  if (!result) return null;
  return { ...result, scope: 'publisher' };
}

async function disconnectViewers(id) {
  const stream = db.prepare('SELECT id FROM streams WHERE id = ?').get(Number(id));
  if (!stream) return null;
  const nonAudience = outPullService.nonAudienceClientIds(stream.id);
  const result = await disconnectMatchingClients(id, client => !isPublisher(client) && !nonAudience.has(String(client.id)));
  if (!result) return null;
  return { ...result, scope: 'viewers' };
}

// Legacy broad stop: retained for compatibility. It actively kicks every SRS
// session for the stream, both publisher and players. New UI must use the
// precise disconnect-publisher / disconnect-viewers actions instead.
async function stopStream(id) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;

  const clients = await srsService.listClients();
  const targets = clients.filter(c => srsService.clientMatchesStream(c, stream.name, 'live'));

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

module.exports = {
  listStreams,
  listExternalStreams,
  getStream,
  createStream,
  updateStream,
  deleteStream,
  disconnectPublisher,
  disconnectViewers,
  stopStream
};