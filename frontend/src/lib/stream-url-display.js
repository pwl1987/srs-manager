// Public/display URL helpers.
// Raw SRS HTTP origin URLs are intentionally not synthesized here: direct HLS
// bypasses the Manager preview token path and SRS on_play admission. Operator
// preview must use /api/preview; public playback must come from an explicitly
// configured CDN/reverse-proxy endpoint.

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === 'host.docker.internal';
}

export function directFlvUrl(name, httpPort = 8080) {
  return `http://${window.location.hostname}:${httpPort}/live/${name}.flv`;
}

export function directRtmpUrl(name, rtmpPort = 1935) {
  return `rtmp://${window.location.hostname}:${rtmpPort}/live/${name}`;
}

export function displayUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (isLoopbackHost(u.hostname)) u.hostname = window.location.hostname;
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function resolvePullHls(stream) {
  if (!stream) return '';
  return displayUrl(stream.pull_url_hls || '');
}

export function resolvePullFlv(stream) {
  if (!stream) return '';
  return displayUrl(stream.pull_url_flv || '');
}

export function resolveOriginHls(stream) {
  if (!stream) return '';
  return displayUrl(stream.origin_pull_url_hls || '');
}
