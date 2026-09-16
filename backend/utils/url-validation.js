const net = require('net');

function isPrivateIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b, c, d] = parts;
  // 10.x.x.x
  if (a === 10) return true;
  // 172.16.x.x - 172.31.x.x
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.x.x
  if (a === 192 && b === 168) return true;
  // 127.x.x.x
  if (a === 127) return true;
  // 169.254.x.x (link-local)
  if (a === 169 && b === 254) return true;
  // 0.x.x.x
  if (a === 0) return true;
  return false;
}

function validateStreamUrl(url, allowedProtocols = ['rtmp', 'rtmps', 'http', 'https', 'srt']) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // RTMP/SRT URLs are not standard URLs, parse manually
    const match = url.match(/^([a-zA-Z0-9]+):\/\/([^/]+)(.*)$/);
    if (!match) {
      return { valid: false, error: 'Invalid URL format' };
    }
    const [_, protocol, host, _path] = match;
    if (!allowedProtocols.includes(protocol.toLowerCase())) {
      return { valid: false, error: `Protocol "${protocol}" not allowed. Allowed: ${allowedProtocols.join(', ')}` };
    }
    // Check if host is a private IP
    if (net.isIP(host) && isPrivateIP(host)) {
      return { valid: false, error: 'Private IP addresses are not allowed in stream URLs' };
    }
    return { valid: true };
  }

  // Standard URL (http/https)
  const protocol = parsed.protocol.toLowerCase().replace(':', '');
  if (!allowedProtocols.includes(protocol)) {
    return { valid: false, error: `Protocol "${protocol}" not allowed. Allowed: ${allowedProtocols.join(', ')}` };
  }

  const hostname = parsed.hostname;
  if (net.isIP(hostname) && isPrivateIP(hostname)) {
    return { valid: false, error: 'Private IP addresses are not allowed in stream URLs' };
  }

  // Block localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return { valid: false, error: 'Localhost is not allowed in stream URLs' };
  }

  return { valid: true };
}

module.exports = { validateStreamUrl, isPrivateIP };
