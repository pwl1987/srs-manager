// Test-mode URL helpers. When the CDN domain is not configured the backend
// returns null pull URLs and cdn_configured:false; playback then falls back to
// SRS direct-connect addresses built from the host the panel is served from.
// Backend URLs pointing at loopback hosts are rewritten the same way so
// copy-paste works from any client machine during testing.

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

export function directHlsUrl(name, httpPort = 8080) {
  return `http://${window.location.hostname}:${httpPort}/live/${name}.m3u8`;
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
  if (stream.cdn_configured === false) return directHlsUrl(stream.name, stream.http_port || 8080);
  return stream.pull_url_hls || directHlsUrl(stream.name, stream.http_port || 8080);
}

export function resolvePullFlv(stream) {
  if (!stream) return '';
  if (stream.cdn_configured === false) return directFlvUrl(stream.name, stream.http_port || 8080);
  return stream.pull_url_flv || directFlvUrl(stream.name, stream.http_port || 8080);
}
