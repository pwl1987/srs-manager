const db = require('../database');
const keyService = require('./key-service');

function listRequests(filters = {}) {
  let query = 'SELECT * FROM distribution_requests ORDER BY created_at DESC';
  const params = [];
  if (filters.status) { query += ' WHERE status = ?'; params.push(filters.status); }
  if (filters.applicant) { query += (filters.status ? ' AND' : ' WHERE') + ' applicant = ?'; params.push(filters.applicant); }
  return db.prepare(query).all(...params);
}

function getRequest(id) {
  return db.prepare('SELECT * FROM distribution_requests WHERE id = ?').get(id) || null;
}

function getRequestLogs(requestId) {
  return db.prepare('SELECT * FROM request_logs WHERE request_id = ? ORDER BY created_at DESC').all(requestId);
}

function getRequestsByApplicant(applicant) {
  return db.prepare('SELECT * FROM distribution_requests WHERE applicant = ? ORDER BY created_at DESC').all(applicant);
}

async function createRequest({ stream_id, channel_id, applicant, region, purpose, pull_url, expires_at, notes }) {
  if (!stream_id || !applicant || !pull_url || !expires_at) {
    throw new Error('Stream ID, applicant, pull URL, and expiration are required');
  }

  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(stream_id);
  if (!stream) throw new Error('Stream not found');

  db.prepare(`
    INSERT INTO distribution_requests (stream_id, channel_id, applicant, region, purpose, pull_url, expires_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stream_id, channel_id, applicant, region, purpose, pull_url, expires_at, notes);

  const request = db.prepare('SELECT * FROM distribution_requests WHERE applicant = ? AND pull_url = ?')
    .get(applicant, pull_url);

  db.prepare('INSERT INTO request_logs (request_id, action, detail) VALUES (?, ?, ?)')
    .run(request.id, 'created', `Distribution request created for "${applicant}"`);

  return request;
}

async function extendRequest(id, newExpiry) {
  const request = db.prepare('SELECT * FROM distribution_requests WHERE id = ?').get(id);
  if (!request) throw new Error('Request not found');
  if (request.status !== 'active') throw new Error('Can only extend active requests');

  db.prepare('UPDATE distribution_requests SET expires_at = ?, status = ?, extended_count = extended_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newExpiry, 'extended', id);

  db.prepare('INSERT INTO request_logs (request_id, action, detail) VALUES (?, ?, ?)')
    .run(id, 'extended', `Expiration extended to ${newExpiry}`);

  return db.prepare('SELECT * FROM distribution_requests WHERE id = ?').get(id);
}

async function revokeRequest(id) {
  const request = db.prepare('SELECT * FROM distribution_requests WHERE id = ?').get(id);
  if (!request) throw new Error('Request not found');
  if (request.status === 'revoked') throw new Error('Request already revoked');

  db.prepare('UPDATE distribution_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('revoked', id);

  db.prepare('INSERT INTO request_logs (request_id, action, detail) VALUES (?, ?, ?)')
    .run(id, 'revoked', 'Distribution request revoked');

  return db.prepare('SELECT * FROM distribution_requests WHERE id = ?').get(id);
}

// Check for expired requests and update status
function checkExpiredRequests() {
  const now = new Date().toISOString();
  db.prepare('UPDATE distribution_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE status IN (?, ?) AND expires_at < ?')
    .run('expired', 'active', 'extended', now);
}

module.exports = {
  listRequests, getRequest, getRequestLogs, getRequestsByApplicant,
  createRequest, extendRequest, revokeRequest, checkExpiredRequests
};
