const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStreamUrl,
  isPrivateNetworkIP,
  isUnsafeIP
} = require('../utils/url-validation');

test('stream URL validation can explicitly allow RFC1918/ULA media endpoints', () => {
  const protocols = ['rtmp', 'srt', 'rtsp', 'http', 'https'];
  for (const url of [
    'rtmp://10.30.5.199/live/news',
    'srt://172.16.5.10:9000?mode=caller',
    'rtsp://192.168.50.20/camera',
    'http://10.20.30.40/live/index.m3u8',
    'rtmp://[fd12:3456::20]/live/news'
  ]) {
    assert.equal(validateStreamUrl(url, protocols, { allowPrivateNetwork: true }).valid, true, url);
  }

  assert.equal(isPrivateNetworkIP('10.30.5.199'), true);
  assert.equal(isPrivateNetworkIP('172.31.255.254'), true);
  assert.equal(isPrivateNetworkIP('192.168.1.10'), true);
  assert.equal(isPrivateNetworkIP('8.8.8.8'), false);
});

test('private media allowance never opens loopback, link-local, metadata or reserved ranges', () => {
  const protocols = ['rtmp', 'http'];
  for (const url of [
    'rtmp://127.0.0.1/live/news',
    'http://169.254.169.254/latest/meta-data',
    'rtmp://0.0.0.0/live/news',
    'rtmp://224.0.0.1/live/news',
    'rtmp://localhost/live/news',
    'rtmp://localhost./live/news',
    'rtmp://[::1]/live/news',
    'rtmp://[fe80::1]/live/news'
  ]) {
    assert.equal(validateStreamUrl(url, protocols, { allowPrivateNetwork: true }).valid, false, url);
  }

  assert.equal(isUnsafeIP('127.0.0.1'), true);
  assert.equal(isUnsafeIP('169.254.169.254'), true);
  assert.equal(isUnsafeIP('10.30.5.199'), false);
});

test('inet_aton shorthand and IPv4-mapped IPv6 cannot bypass blocked ranges', () => {
  const protocols = ['rtmp', 'http'];
  // FFmpeg/libc resolves these as IPv4 even though WHATWG URL and net.isIPv4 leave them as-is.
  for (const url of [
    'rtmp://127.1/live/news',                        // inet_aton shorthand -> 127.0.0.1
    'rtmp://2130706433/live/news',                   // decimal integer -> 127.0.0.1
    'rtmp://0177.0.0.1/live/news',                   // octal -> 127.0.0.1
    'rtmp://0x7f000001/live/news',                   // hex -> 127.0.0.1
    'rtmp://0/live/news',                            // 0.0.0.0
    'rtmp://[::ffff:127.0.0.1]/live/news',           // WHATWG serializes the tail as ::ffff:7f00:1
    'rtmp://[0:0:0:0:0:ffff:127.0.0.1]/live/news',
    'rtmp://[::ffff:7f00:1]/live/news',
    'rtmp://127.999/live/news'                       // inet_aton: last part is 16-bit (macOS -> 127.0.3.231)
  ]) {
    assert.equal(validateStreamUrl(url, protocols).valid, false, url);
    assert.equal(validateStreamUrl(url, protocols, { allowPrivateNetwork: true }).valid, false, url + ' (optin)');
  }

  assert.equal(isUnsafeIP('127.1'), true);
  assert.equal(isUnsafeIP('::ffff:7f00:1'), true);
  assert.equal(isUnsafeIP('0x1ffffffff'), false); // >32 bits: not an IPv4 literal
  // Shorthand of a private address is still private under opt-in.
  assert.equal(isPrivateNetworkIP('167837958'), true); // 10.0.2.38
  // Last part > 255 is a 16-bit tail per inet_aton: 10.0.999 -> 10.0.3.231 (RFC1918).
  assert.equal(validateStreamUrl('rtmp://10.0.999/live/news', protocols).valid, false);
  assert.equal(validateStreamUrl('rtmp://10.0.999/live/news', protocols, { allowPrivateNetwork: true }).valid, true);
  assert.equal(isPrivateNetworkIP('100.14.5.5'), false); // 1678379589 = public

  // Canonical forms and public hosts must keep working.
  assert.equal(validateStreamUrl('rtmp://media.example.org/live/news', protocols).valid, true);
  assert.equal(validateStreamUrl('rtmp://10.30.5.199/live/news', protocols, { allowPrivateNetwork: true }).valid, true);
});

test('default URL validation remains strict for private networks', () => {
  assert.equal(validateStreamUrl('rtmp://10.30.5.199/live/news', ['rtmp']).valid, false);
  assert.equal(validateStreamUrl('rtmp://media.example.org/live/news', ['rtmp']).valid, true);
});
