function targetProtocol(targetUrl) {
  try {
    return new URL(targetUrl).protocol.replace(':', '').toLowerCase();
  } catch {
    return null;
  }
}

function buildPushArgs(sourceUrl, targetUrl) {
  const protocol = targetProtocol(targetUrl);
  if (!['rtmp', 'rtmps', 'srt'].includes(protocol)) {
    throw new Error(`Unsupported OUT-PUSH protocol: ${protocol || 'unknown'}`);
  }
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'warning',
    '-i', sourceUrl,
    '-map', '0:v?', '-map', '0:a?',
    '-c', 'copy'
  ];
  if (protocol === 'srt') args.push('-f', 'mpegts', targetUrl);
  else args.push('-f', 'flv', targetUrl);
  return args;
}
function nextBackoffMs(attempt, maxBackoffMs = 30000, jitter = 0) {
  const n = Math.max(1, Number(attempt) || 1);
  const base = Math.min(maxBackoffMs, 1000 * (2 ** Math.min(n - 1, 5)));
  return Math.min(maxBackoffMs, base + Math.max(0, Number(jitter) || 0));
}

module.exports = { targetProtocol, buildPushArgs, nextBackoffMs };
