import { beforeEach, describe, expect, it } from 'vitest';
import { directHlsUrl, displayUrl, resolvePullHls } from './stream-url-display.js';

beforeEach(() => {
  globalThis.window = { location: { hostname: 'panel.example.test' } };
});

describe('stream URL display helpers', () => {
  it('builds direct HLS URLs from the panel host', () => {
    expect(directHlsUrl('news')).toBe('http://panel.example.test:8080/live/news.m3u8');
  });

  it('rewrites loopback URLs for remote operators', () => {
    expect(displayUrl('http://127.0.0.1:8080/live/news.flv')).toBe('http://panel.example.test:8080/live/news.flv');
  });

  it('uses direct HLS when CDN is explicitly unavailable', () => {
    expect(resolvePullHls({ name: 'news', cdn_configured: false })).toContain('/live/news.m3u8');
  });
});
