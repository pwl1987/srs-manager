const settingsService = require('./settings-service');

function originBase() {
  let hostname = '127.0.0.1';
  try {
    hostname = new URL(settingsService.getSrsApiUrl()).hostname || hostname;
  } catch {}
  const port = settingsService.getSrsHttpPort();
  return `http://${hostname}:${port}`;
}

function originPlaylistUrl(streamName) {
  return new URL(`/live/${encodeURIComponent(String(streamName))}.m3u8`, `${originBase()}/`).toString();
}

function validateResourceUrl(resource, streamName) {
  const playlist = new URL(originPlaylistUrl(streamName));
  const target = new URL(String(resource || ''), playlist);
  if (target.protocol !== playlist.protocol || target.host !== playlist.host) {
    throw new Error('Preview resource must remain on the configured SRS origin');
  }
  const encoded = encodeURIComponent(String(streamName));
  const playlistPath = `/live/${encoded}.m3u8`;
  const segmentPrefix = `/live/${encoded}-`;
  if (target.pathname !== playlistPath && !target.pathname.startsWith(segmentPrefix)) {
    throw new Error('Preview resource does not belong to this stream');
  }
  return target;
}

function proxyUrl(streamId, token, resource) {
  const target = new URL(String(resource));
  const relative = `${target.pathname}${target.search}`;
  const query = new URLSearchParams({ preview_token: token, path: relative });
  return `/api/preview/${encodeURIComponent(streamId)}/resource?${query}`;
}
function rewriteUriAttributes(line, stream, token, playlistUrl) {
  return String(line).replace(/URI="([^"]+)"/g, (_match, value) => {
    const resolved = validateResourceUrl(new URL(value, playlistUrl).toString(), stream.name);
    return `URI="${proxyUrl(stream.id, token, resolved.toString())}"`;
  });
}

function rewritePlaylist(text, stream, token, playlistUrl = originPlaylistUrl(stream.name)) {
  return String(text || '').split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return trimmed.includes('URI="') ? rewriteUriAttributes(line, stream, token, playlistUrl) : line;
    }
    const resolved = validateResourceUrl(new URL(trimmed, playlistUrl).toString(), stream.name);
    return proxyUrl(stream.id, token, resolved.toString());
  }).join('\n');
}

async function fetchOrigin(url, { range = null, timeoutMs = 8000 } = {}) {
  const headers = {};
  if (range) headers.Range = range;
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
}

module.exports = {
  originBase,
  originPlaylistUrl,
  validateResourceUrl,
  proxyUrl,
  rewritePlaylist,
  fetchOrigin
};
