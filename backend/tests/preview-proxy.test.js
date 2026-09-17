process.env.JWT_SECRET = 'preview-proxy-test-secret';
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-preview-proxy-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const access = require('../services/preview-access-service');
const proxy = require('../services/preview-proxy-service');
const previewRouter = require('../routes/preview');

function startApp() {
  const app = express();
  app.use('/api/preview', previewRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function firstMediaLine(text) {
  return text.split(/\r?\n/).find(line => line && !line.startsWith('#'));
}

test('preview proxy requires a stream-bound token and rewrites nested HLS resources', async (t) => {
  const row = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('preview-test', 'rtmp', 'online')").run();
  const stream = { id: Number(row.lastInsertRowid), name: 'preview-test' };
  const issued = access.issuePreviewToken(stream);
  const originalFetch = proxy.fetchOrigin;
  proxy.fetchOrigin = async url => {
    const target = new URL(String(url));
    if (target.pathname.endsWith('preview-test.m3u8') && !target.searchParams.has('hls_ctx')) {
      return new Response('#EXTM3U\n/live/preview-test.m3u8?hls_ctx=ctx1\n', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    if (target.pathname.endsWith('preview-test.m3u8')) {
      return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:2.0,\npreview-test-1.ts?hls_ctx=ctx1\n', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    if (target.pathname.endsWith('preview-test-1.ts')) {
      return new Response(Uint8Array.from([0x47, 1, 2, 3]), { status: 200, headers: { 'content-type': 'video/mp2t' } });
    }
    return new Response('missing', { status: 404 });
  };
  const server = await startApp();
  t.after(async () => {
    proxy.fetchOrigin = originalFetch;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const denied = await fetch(`${base}/api/preview/${stream.id}/index.m3u8`);
  assert.equal(denied.status, 403);

  const master = await fetch(`${base}${issued.preview_url}`);
  assert.equal(master.status, 200);
  const masterText = await master.text();
  assert.equal(masterText.includes('127.0.0.1:8080'), false);
  const nestedPath = firstMediaLine(masterText);
  assert.match(nestedPath, new RegExp(`^/api/preview/${stream.id}/resource\\?`));

  const media = await fetch(`${base}${nestedPath}`);
  assert.equal(media.status, 200);
  const mediaText = await media.text();
  const segmentPath = firstMediaLine(mediaText);
  assert.match(segmentPath, new RegExp(`^/api/preview/${stream.id}/resource\\?`));

  const segment = await fetch(`${base}${segmentPath}`);
  assert.equal(segment.status, 200);
  assert.equal(segment.headers.get('content-type'), 'video/mp2t');
  assert.deepEqual([...new Uint8Array(await segment.arrayBuffer())], [0x47, 1, 2, 3]);
  const cross = new URL(`${base}/api/preview/${stream.id}/resource`);
  cross.searchParams.set('preview_token', issued.token);
  cross.searchParams.set('path', '/live/other-stream-1.ts');
  const crossResponse = await fetch(cross);
  assert.equal(crossResponse.status, 400);

  const wrongStream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('preview-other', 'rtmp', 'online')").run();
  const wrongId = Number(wrongStream.lastInsertRowid);
  const wrongTokenUse = await fetch(`${base}/api/preview/${wrongId}/index.m3u8?preview_token=${encodeURIComponent(issued.token)}`);
  assert.equal(wrongTokenUse.status, 403);
});
