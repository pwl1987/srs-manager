import { beforeEach, describe, expect, it } from 'vitest';
import { displayUrl, resolveOriginHls, resolvePullFlv, resolvePullHls } from './stream-url-display.js';

beforeEach(() => {
  globalThis.window = { location: { hostname: 'panel.example.test' } };
});

describe('stream URL display helpers', () => {
  it('rewrites loopback URLs for remote operators', () => {
    expect(displayUrl('http://127.0.0.1:8080/live/news.flv')).toBe('http://panel.example.test:8080/live/news.flv');
  });

  it('does not synthesize raw SRS HLS/FLV when CDN is unavailable', () => {
    const stream = { name: 'news', cdn_configured: false, http_port: 8080 };
    expect(resolvePullHls(stream)).toBe('');
    expect(resolvePullFlv(stream)).toBe('');
  });

  it('returns only explicit public delivery URLs', () => {
    const stream = {
      pull_url_hls: 'https://cdn.example.test/news/index.m3u8',
      pull_url_flv: 'https://cdn.example.test/news.flv'
    };
    expect(resolvePullHls(stream)).toBe('https://cdn.example.test/news/index.m3u8');
    expect(resolvePullFlv(stream)).toBe('https://cdn.example.test/news.flv');
  });

  it('never reconstructs a hidden origin HLS URL', () => {
    expect(resolveOriginHls({ name: 'news', origin_pull_url_hls: null, http_port: 8080 })).toBe('');
  });
});
