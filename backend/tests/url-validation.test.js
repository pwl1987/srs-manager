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

test('default URL validation remains strict for private networks', () => {
  assert.equal(validateStreamUrl('rtmp://10.30.5.199/live/news', ['rtmp']).valid, false);
  assert.equal(validateStreamUrl('rtmp://media.example.org/live/news', ['rtmp']).valid, true);
});
