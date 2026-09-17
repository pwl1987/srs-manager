const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-forward-backend-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const forwardRouter = require('../routes/forward');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/forward', forwardRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}
test('SRS Dynamic Forward POST contract returns only legacy dynamic targets and never duplicates managed Push Worker tasks', async (t) => {
  const server = await startApp();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const stream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('forward-news', 'rtmp', 'online')").run();
  const streamId = Number(stream.lastInsertRowid);
  db.prepare(`
    INSERT INTO forward_tasks (stream_id, target_type, target_url, enabled, execution_mode, desired_state, runtime_state)
    VALUES (?, 'legacy', 'rtmp://legacy.example.org/live/key', 1, 'srs_dynamic', 'RUNNING', 'RUNNING')
  `).run(streamId);
  db.prepare(`
    INSERT INTO forward_tasks (stream_id, target_type, target_url, enabled, execution_mode, desired_state, runtime_state)
    VALUES (?, 'managed', 'rtmp://managed.example.org/live/key', 1, 'managed_worker', 'RUNNING', 'RUNNING')
  `).run(streamId);

  const { port } = server.address();
  const post = await json(await fetch(`http://127.0.0.1:${port}/api/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'on_forward', stream: 'forward-news' })
  }));
  assert.equal(post.status, 200);
  assert.deepEqual(post.body.data.urls, ['rtmp://legacy.example.org/live/key']);
  assert.equal(post.body.data.urls.includes('rtmp://managed.example.org/live/key'), false);

  const get = await json(await fetch(`http://127.0.0.1:${port}/api/forward?stream=forward-news`));
  assert.deepEqual(get.body.urls, ['rtmp://legacy.example.org/live/key']);
});
