const db = require('../database');

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
  if (!streamName) return;

  recordEvent('on_publish', streamName);

  db.prepare(`
    UPDATE streams SET status = 'online', last_online_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(streamName);

  console.log(`[Hooks] Stream "${streamName}" published`);
}

function handleOnUnpublish(data) {
  // SRS sends the stream name as "stream"; "stream_name" is kept for older callers.
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return;

  recordEvent('on_unpublish', streamName);

  db.prepare(`
    UPDATE streams SET status = 'offline', updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(streamName);

  console.log(`[Hooks] Stream "${streamName}" unpublished`);
}

function handleOnPlay(data) {
  // SRS sends the stream name as "stream"; "stream_name" is kept for older callers.
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return;

  recordEvent('on_play', streamName);

  const stream = db.prepare('SELECT viewers FROM streams WHERE name = ?').get(streamName);
  if (stream) {
    db.prepare('UPDATE streams SET viewers = viewers + 1, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(streamName);
  }

  console.log(`[Hooks] Viewer started playing "${streamName}"`);
}

function handleOnStop(data) {
  // SRS sends the stream name as "stream"; "stream_name" is kept for older callers.
  const streamName = data.stream || data.stream_name || data.params?.stream;
  if (!streamName) return;

  recordEvent('on_stop', streamName);

  const stream = db.prepare('SELECT viewers FROM streams WHERE name = ?').get(streamName);
  if (stream && stream.viewers > 0) {
    db.prepare('UPDATE streams SET viewers = viewers - 1, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(streamName);
  }

  console.log(`[Hooks] Viewer stopped playing "${streamName}"`);
}

module.exports = { handleOnPublish, handleOnUnpublish, handleOnPlay, handleOnStop, recordEvent };
