const db = require('../database');
const outPullService = require('./out-pull-service');
const ingestCredentialService = require('./ingest-credential-service');

function recordEvent(eventType, streamName) {
  try {
    // Upsert: UNIQUE(event_type, stream_name) keeps only the latest event of
    // each type per stream, with a fresh processed_at on every occurrence.
    db.prepare(`
      INSERT INTO hook_events (event_type, stream_name, processed_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(event_type, stream_name) DO UPDATE SET processed_at = CURRENT_TIMESTAMP
    `).run(eventType, streamName);
  } catch (e) {
    console.error(`[Hooks] Failed to record event: ${e.message}`);
  }
}

function handleOnPublish(data) {
  // SRS sends the stream name as "stream"; "stream_name" is kept for older callers.
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return { allowed: true, reason: 'missing_stream' };
  const authorization = ingestCredentialService.authorizePublish(data);
  if (!authorization.allowed) {
    console.log(`[Hooks] Publisher rejected for "${streamName}": ${authorization.reason}`);
    return authorization;
  }
  ingestCredentialService.recordPublishSession(data, authorization);
  recordEvent('on_publish', streamName);

  db.prepare(`
    UPDATE streams SET status = 'online', last_online_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(streamName);

  console.log(`[Hooks] Stream "${streamName}" published (${authorization.reason})`);
  return authorization;
}

function handleOnUnpublish(data) {
  // SRS sends the stream name as "stream"; "stream_name" is kept for older callers.
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return;

  ingestCredentialService.recordUnpublishSession(data);
  recordEvent('on_unpublish', streamName);

  db.prepare(`
    UPDATE streams SET status = 'offline', updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(streamName);

  console.log(`[Hooks] Stream "${streamName}" unpublished`);
}

function handleOnPlay(data) {
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return { allowed: true, reason: 'missing_stream' };

  const authorization = outPullService.authorizePlay(data);
  if (!authorization.allowed) {
    console.log(`[Hooks] Viewer rejected for "${streamName}": ${authorization.reason}`);
    return authorization;
  }

  recordEvent('on_play', streamName);
  const session = outPullService.recordPlaySession(data, authorization);
  const stream = db.prepare('SELECT viewers FROM streams WHERE name = ?').get(streamName);
  if (stream && session?.session_kind === 'external') {
    db.prepare('UPDATE streams SET viewers = viewers + 1, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(streamName);
  }
  console.log(`[Hooks] Viewer started playing "${streamName}" (${authorization.reason})`);
  return authorization;
}

function handleOnStop(data) {
  // SRS sends the stream name as "stream"; "stream_name" is kept for older callers.
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return;

  recordEvent('on_stop', streamName);

  const session = outPullService.recordStopSession(data);
  const stream = db.prepare('SELECT viewers FROM streams WHERE name = ?').get(streamName);
  if (stream && stream.viewers > 0 && session?.session_kind === 'external') {
    db.prepare('UPDATE streams SET viewers = viewers - 1, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(streamName);
  }

  console.log(`[Hooks] Viewer stopped playing "${streamName}"`);
}

module.exports = { handleOnPublish, handleOnUnpublish, handleOnPlay, handleOnStop, recordEvent };
