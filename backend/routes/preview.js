const express = require('express');
const db = require('../database');
const access = require('../services/preview-access-service');
const proxy = require('../services/preview-proxy-service');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const sourcePreview = require('../services/source-preview-service');

const router = express.Router();

function streamById(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT id, name FROM streams WHERE id = ?').get(id) || null;
}

function authorize(req, res) {
  const stream = streamById(req.params.streamId);
  if (!stream) {
    res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found' });
    return null;
  }
  const token = String(req.query.preview_token || '');
  if (!access.verifyPreviewToken(token, stream)) {
    res.status(403).json({ code: 'PREVIEW_ACCESS_DENIED', error: 'Preview access denied' });
    return null;
  }
  return { stream, token };
}

function previewHeaders(res) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
}
async function sendPlaylist(res, originResponse, auth, originUrl) {
  const text = await originResponse.text();
  const rewritten = proxy.rewritePlaylist(text, auth.stream, auth.token, originUrl);
  previewHeaders(res);
  res.status(originResponse.status);
  res.type('application/vnd.apple.mpegurl');
  res.send(rewritten);
}

router.get('/:streamId/source/:sourceId/live.flv', async (req, res) => {
  const stream = streamById(req.params.streamId);
  if (!stream) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found' });
  const token = String(req.query.preview_token || '');
  if (!access.verifySourcePreviewToken(token, stream, req.params.sourceId)) {
    previewHeaders(res); return res.status(403).json({ code: 'PREVIEW_ACCESS_DENIED', error: 'Preview access denied' });
  }
  let preview;
  try { preview = sourcePreview.start(stream.id, req.params.sourceId); }
  catch (error) {
    previewHeaders(res);
    const busy = String(error.message).includes('concurrency');
    return res.status(busy ? 429 : 409).json({ code: busy ? 'SOURCE_PREVIEW_BUSY' : 'SOURCE_PREVIEW_UNAVAILABLE', error: error.message });
  }
  previewHeaders(res); res.status(200); res.set('Content-Type', 'video/x-flv');
  const stop = () => preview.stop();
  res.once('close', stop);
  try { await pipeline(preview.stdout, res); }
  catch (error) { if (!res.headersSent) res.status(502).json({ code: 'SOURCE_PREVIEW_FAILED', error: 'Source preview failed' }); }
  finally { res.off('close', stop); preview.stop(); }
});

router.get('/:streamId/live.flv', async (req, res) => {
  const auth = authorize(req, res);
  if (!auth) return;
  const originUrl = proxy.originFlvUrl(auth.stream.name);
  let upstream;
  try {
    upstream = await proxy.fetchLiveOrigin(originUrl, { timeoutMs: 5000 });
  } catch (error) {
    previewHeaders(res);
    return res.status(502).json({ code: 'PREVIEW_ORIGIN_UNAVAILABLE', error: `Preview origin unavailable: ${error.message}` });
  }
  if (!upstream.ok || !upstream.body) {
    previewHeaders(res);
    return res.status(upstream.status === 404 ? 404 : 502).json({ code: 'PREVIEW_ORIGIN_UNAVAILABLE', error: 'Preview origin unavailable' });
  }
  previewHeaders(res);
  res.status(upstream.status);
  res.set('Content-Type', upstream.headers.get('content-type') || 'video/x-flv');
  const body = Readable.fromWeb(upstream.body);
  const close = () => body.destroy();
  res.once('close', close);
  try {
    await pipeline(body, res);
  } catch (error) {
    if (!res.headersSent) return res.status(502).json({ code: 'PREVIEW_STREAM_FAILED', error: `Preview stream failed: ${error.message}` });
  } finally {
    res.off('close', close);
  }
});

router.get('/:streamId/index.m3u8', async (req, res) => {
  const auth = authorize(req, res);
  if (!auth) return;
  const originUrl = proxy.originPlaylistUrl(auth.stream.name);
  try {
    const upstream = await proxy.fetchOrigin(originUrl, { timeoutMs: 5000 });
    if (!upstream.ok) {
      previewHeaders(res);
      return res.status(upstream.status === 404 ? 404 : 502).json({ code: 'PREVIEW_ORIGIN_UNAVAILABLE', error: 'Preview origin unavailable' });
    }
    return sendPlaylist(res, upstream, auth, originUrl);
  } catch (error) {
    previewHeaders(res);
    return res.status(502).json({ code: 'PREVIEW_ORIGIN_UNAVAILABLE', error: `Preview origin unavailable: ${error.message}` });
  }
});

router.get('/:streamId/resource', async (req, res) => {
  const auth = authorize(req, res);
  if (!auth) return;
  let target;
  try {
    target = proxy.validateResourceUrl(req.query.path, auth.stream.name);
  } catch (error) {
    previewHeaders(res);
    return res.status(400).json({ code: 'PREVIEW_RESOURCE_INVALID', error: error.message });
  }
  try {
    const upstream = await proxy.fetchOrigin(target.toString(), {
      range: req.headers.range || null,
      timeoutMs: 8000
    });
    if (!upstream.ok && upstream.status !== 206) {
      previewHeaders(res);
      return res.status(upstream.status === 404 ? 404 : 502).json({ code: 'PREVIEW_RESOURCE_UNAVAILABLE', error: 'Preview resource unavailable' });
    }
    const contentType = upstream.headers.get('content-type') || '';
    if (target.pathname.endsWith('.m3u8') || contentType.includes('mpegurl')) {
      return sendPlaylist(res, upstream, auth, target.toString());
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    previewHeaders(res);
    res.status(upstream.status);
    if (contentType) res.set('Content-Type', contentType);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.set('Content-Range', contentRange);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.set('Accept-Ranges', acceptRanges);
    res.set('Content-Length', String(body.length));
    return res.send(body);
  } catch (error) {
    previewHeaders(res);
    return res.status(502).json({ code: 'PREVIEW_RESOURCE_UNAVAILABLE', error: `Preview resource unavailable: ${error.message}` });
  }
});

module.exports = router;
