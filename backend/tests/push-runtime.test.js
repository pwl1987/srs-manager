const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPushArgs, nextBackoffMs } = require('../services/push-runtime');

test('managed OUT-PUSH builds protocol-specific FFmpeg outputs', () => {
  const source = 'rtmp://origin.example.org/live/news';
  const rtmp = buildPushArgs(source, 'rtmp://platform.example.org/live/key');
  assert.deepEqual(rtmp.slice(-3), ['-f', 'flv', 'rtmp://platform.example.org/live/key']);
  assert.equal(rtmp.includes('-c'), true);
  assert.equal(rtmp[rtmp.indexOf('-c') + 1], 'copy');

  const srt = buildPushArgs(source, 'srt://platform.example.org:9000?mode=caller');
  assert.deepEqual(srt.slice(-3), ['-f', 'mpegts', 'srt://platform.example.org:9000?mode=caller']);

  assert.throws(() => buildPushArgs(source, 'https://example.org/live'), /Unsupported OUT-PUSH protocol/);
  assert.equal(nextBackoffMs(1, 30000, 0), 1000);
  assert.equal(nextBackoffMs(20, 30000, 0), 30000);
});
