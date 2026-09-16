const db = require('../database');

function recordEvent(eventType, streamName) {
  try {
    db.prepare('INSERT INTO hook_events (event_type, stream_name) VALUES (?, ?)')
      .run(eventType, streamName);
  } catch (e) {
    // Idempotency: ignore duplicate events
    if (e.message.includes('UNIQUE constraint failed')) return;
    console.error(`[Hooks] Failed to record event: ${e.message}`);
  }
}

function handleOnPublish(data) {
  const streamName = data.stream_name || data.params?.stream;
  if (!streamName) return;

  recordEvent('on_publish', streamName);

  db.prepare(`
    UPDATE streams SET status = 'online', last_online_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(streamName);

  console.log(`[Hooks] Stream "${streamName}" published`);
}

function handleOnUnpublish(data) {
  const streamName = data.stream_name || data.params?.stream;
  if (!streamName) return;

  recordEvent('on_unpublish', streamName);

  db.prepare(`
    UPDATE streams SET status = 'offline', updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(streamName);

  console.log(`[Hooks] Stream "${streamName}" unpublished`);
}

function handleOnPlay(data) {
  const streamName = data.stream_name || data.params?.stream;
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
  const streamName = data.stream_name || data.params?.stream;
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
