const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-stream-name-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const db = require('../database');
const streamService = require('../services/stream-service');
const srsService = require('../services/srs');
const { buildUrls } = require('../services/stream-urls');
const { isValidStreamName } = require('../utils/stream-name');

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('stream names keep Unicode labels through creation, update, and delivery URLs', async () => {
  assert.equal(isValidStreamName('任意社会学'), true);
  assert.equal(isValidStreamName('文艺工程学'), true);

  const created = await streamService.createStream('任意社会学', 'rtmp');
  assert.equal(created.name, '任意社会学');
  assert.equal(created.push_url, `rtmp://127.0.0.1:1935/live/${encodeURIComponent('任意社会学')}`);

  const updated = await streamService.updateStream(created.id, { name: '文艺工程学' });
  assert.equal(updated.name, '文艺工程学');
  assert.equal(updated.origin_pull_url_rtmp, `rtmp://127.0.0.1:1935/live/${encodeURIComponent('文艺工程学')}`);

  const urls = buildUrls('文艺工程学');
  assert.equal(urls.push_url, `rtmp://127.0.0.1:1935/live/${encodeURIComponent('文艺工程学')}`);
});

test('stream names still reject path and control characters', async () => {
  assert.equal(isValidStreamName('bad/name'), false);
  assert.equal(isValidStreamName('bad%name'), false);
  assert.equal(isValidStreamName(' bad'), false);
  await assert.rejects(() => streamService.createStream('bad/name', 'rtmp'), /Invalid stream name/);
});

test('SRS lookup preserves Unicode names when encoding the API path', async (t) => {
  const originalFetch = global.fetch;
  let requestedPath = null;
  global.fetch = async (url) => {
    requestedPath = new URL(url).pathname;
    return { ok: true, json: async () => ({ stream: { name: '任意社会学' } }) };
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await srsService.getStreamByName('任意社会学');
  assert.equal(result.name, '任意社会学');
  assert.equal(requestedPath, `/api/v1/streams/${encodeURIComponent('任意社会学')}`);
});
