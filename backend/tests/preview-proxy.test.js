const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-preview-proxy-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'preview-proxy-test-secret';

const db = require('../database');
const settings = require('../services/settings-service');
const access = require('../services/preview-access-service');
const previewRouter = require('../routes/preview');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
test('preview proxy requires a stream-bound token and rewrites nested HLS resources', async (t) => {
  const origin = express();
  origin.get('/live/news.m3u8', (req, res) => {
    const body = req.query.hls_ctx
      ? '#EXTM3U\n#EXTINF:2.0,\nnews-1.ts?hls_ctx=abc\n'
      : '#EXTM3U\n/live/news.m3u8?hls_ctx=abc\n';
    res.type('application/vnd.apple.mpegurl').send(body);
  });
  origin.get('/live/news-1.ts', (req, res) => {
    res.type('video/mp2t').send(Buffer.from([0x47, 0x40, 0x00, 0x10]));
  });
  const originServer = await listen(origin);
  const originPort = originServer.address().port;
  settings.setSetting('srs_api_url', `http://127.0.0.1:${originPort}/api/v1`);
  settings.setSetting('srs_http_port', String(originPort));

  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('news', 'rtmp')").run().lastInsertRowid);
  const stream = { id: streamId, name: 'news' };
  const token = access.issuePreviewToken(stream).token;

  const manager = express();
  manager.use('/api/preview', previewRouter);
  const managerServer = await listen(manager);
  const managerPort = managerServer.address().port;

  t.after(async () => {
    await Promise.all([
      new Promise(resolve => managerServer.close(resolve)),
      new Promise(resolve => originServer.close(resolve))
    ]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${managerPort}/api/preview/${streamId}`;
  const denied = await fetch(`${base}/index.m3u8`);
  assert.equal(denied.status, 403);

  const index = await fetch(`${base}/index.m3u8?preview_token=${encodeURIComponent(token)}`);
  assert.equal(index.status, 200);
  const indexText = await index.text();
  assert.match(indexText, new RegExp(`/api/preview/${streamId}/resource\\?`));
  assert.match(indexText, /preview_token=/);
  const mediaPath = indexText.split(/\r?\n/).find(line => line && !line.startsWith('#'));
  assert.ok(mediaPath);
  const media = await fetch(new URL(mediaPath, `http://127.0.0.1:${managerPort}`));
  assert.equal(media.status, 200);
  const mediaText = await media.text();
  const segmentPath = mediaText.split(/\r?\n/).find(line => line && !line.startsWith('#'));
  assert.ok(segmentPath);

  const segment = await fetch(new URL(segmentPath, `http://127.0.0.1:${managerPort}`));
  assert.equal(segment.status, 200);
  assert.equal(segment.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.deepEqual(Buffer.from(await segment.arrayBuffer()), Buffer.from([0x47, 0x40, 0x00, 0x10]));

  const crossStreamPath = encodeURIComponent('/live/other-1.ts');
  const crossStream = await fetch(`${base}/resource?preview_token=${encodeURIComponent(token)}&path=${crossStreamPath}`);
  assert.equal(crossStream.status, 400);

  const otherId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('other', 'rtmp')").run().lastInsertRowid);
  const otherToken = access.issuePreviewToken({ id: otherId, name: 'other' }).token;
  const wrongToken = await fetch(`${base}/index.m3u8?preview_token=${encodeURIComponent(otherToken)}`);
  assert.equal(wrongToken.status, 403);
});
