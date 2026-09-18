const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-stream-urls-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const settings = require('../services/settings-service');
const { buildUrls } = require('../services/stream-urls');

test.after(() => {
  delete process.env.EXPOSE_SRS_HTTP_ORIGIN_URLS;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('raw SRS HTTP origin URLs are hidden by default', () => {
  delete process.env.EXPOSE_SRS_HTTP_ORIGIN_URLS;
  const urls = buildUrls('news');
  assert.equal(urls.origin_http_exposed, false);
  assert.equal(urls.origin_pull_url_hls, null);
  assert.equal(urls.origin_pull_url_flv, null);
  assert.equal(urls.pull_url_hls, null);
  assert.equal(urls.pull_url_flv, null);
});

test('trusted-network diagnostic mode requires explicit opt-in', () => {
  process.env.EXPOSE_SRS_HTTP_ORIGIN_URLS = '1';
  const urls = buildUrls('news');
  assert.equal(urls.origin_http_exposed, true);
  assert.equal(urls.origin_pull_url_hls, 'http://127.0.0.1:8080/live/news.m3u8');
  assert.equal(urls.origin_pull_url_flv, 'http://127.0.0.1:8080/live/news.flv');
  delete process.env.EXPOSE_SRS_HTTP_ORIGIN_URLS;
});

test('explicit CDN delivery remains available without exposing origin HTTP', () => {
  settings.setSetting('cdn_domain', 'media.example.test');
  const urls = buildUrls('news');
  assert.equal(urls.origin_http_exposed, false);
  assert.equal(urls.pull_url_hls, 'https://media.example.test/news/index.m3u8');
  assert.equal(urls.pull_url_flv, 'https://media.example.test/news.flv');
});
