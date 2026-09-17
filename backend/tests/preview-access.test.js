process.env.JWT_SECRET = 'preview-service-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/preview-access-service');
test('operator preview token is short lived and stream bound', () => {
  const stream = { id: 7, name: 'news-main' };
  const issued = service.issuePreviewToken(stream);
  assert.ok(issued.token);
  assert.equal(service.verifyPreviewToken(issued.token, stream), true);
  assert.equal(service.verifyPreviewToken(issued.token, { id: 8, name: 'other' }), false);
  assert.ok(Date.parse(issued.expires_at) > Date.now());
  assert.ok(issued.ttl_seconds <= 600);
  assert.equal(issued.preferred_transport, 'http-flv');
  assert.ok(issued.preview_urls.http_flv.includes('/live.flv?preview_token='));
  assert.ok(issued.preview_urls.hls.includes('/index.m3u8?preview_token='));
  assert.equal(issued.preview_url, issued.preview_urls.hls);
});
