const net = require('net');

// RFC1918 private ranges are common in broadcast/LAN media workflows. They can
// be allowed explicitly for trusted media endpoints while unsafe/local ranges
// remain blocked.
const PRIVATE_IPV4 = [
  { c: [10, 0, 0, 0], m: [255, 0, 0, 0] },
  { c: [172, 16, 0, 0], m: [255, 240, 0, 0] },
  { c: [192, 168, 0, 0], m: [255, 255, 0, 0] }
];

const UNSAFE_IPV4 = [
  { c: [127, 0, 0, 0], m: [255, 0, 0, 0] },       // loopback
  { c: [169, 254, 0, 0], m: [255, 255, 0, 0] },   // link-local / metadata
  { c: [0, 0, 0, 0], m: [255, 0, 0, 0] },         // this network / unspecified
  { c: [100, 64, 0, 0], m: [255, 192, 0, 0] },    // CGNAT
  { c: [192, 0, 0, 0], m: [255, 255, 255, 0] },   // IETF protocol assignments
  { c: [192, 0, 2, 0], m: [255, 255, 255, 0] },   // TEST-NET-1
  { c: [198, 18, 0, 0], m: [255, 254, 0, 0] },    // benchmarking
  { c: [198, 51, 100, 0], m: [255, 255, 255, 0] }, // TEST-NET-2
  { c: [203, 0, 113, 0], m: [255, 255, 255, 0] }, // TEST-NET-3
  { c: [224, 0, 0, 0], m: [240, 0, 0, 0] },       // multicast
  { c: [240, 0, 0, 0], m: [240, 0, 0, 0] }        // reserved / broadcast
];

function inCidr4(parts, cidr) {
  for (let i = 0; i < 4; i++) {
    if ((parts[i] & cidr.m[i]) !== (cidr.c[i] & cidr.m[i])) return false;
  }
  return true;
}

function mappedIPv4(ip) {
  const lower = String(ip || '').toLowerCase();
  return lower.startsWith('::ffff:') ? lower.slice(7) : null;
}

function isPrivateNetworkIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return PRIVATE_IPV4.some(cidr => inCidr4(parts, cidr));
  }
  if (net.isIPv6(ip)) {
    const mapped = mappedIPv4(ip);
    if (mapped && net.isIPv4(mapped)) return isPrivateNetworkIP(mapped);
    return /^f[cd][0-9a-f]{2}:/i.test(ip); // fc00::/7 ULA
  }
  return false;
}

function isUnsafeIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return UNSAFE_IPV4.some(cidr => inCidr4(parts, cidr));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = mappedIPv4(lower);
    if (mapped && net.isIPv4(mapped)) return isUnsafeIP(mapped);
    if (lower === '::' || lower === '::1') return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
    if (/^ff[0-9a-f]{2}:/.test(lower)) return true;    // ff00::/8 multicast
    if (/^2001:db8:/.test(lower)) return true;         // documentation
    return false;
  }
  return false;
}

// Backward-compatible helper: historically this meant "non-public/blocked IP".
function isPrivateIP(ip) {
  return isPrivateNetworkIP(ip) || isUnsafeIP(ip);
}

function stripPort(host) {
  if (!host) return host;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  const idx = host.lastIndexOf(':');
  if (idx !== -1 && host.indexOf(':') === idx) return host.slice(0, idx);
  return host;
}

function isBlockedHost(hostname, { allowPrivateNetwork = false } = {}) {
  if (!hostname) return true;
  const host = stripPort(hostname).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isUnsafeIP(host)) return true;
  if (!allowPrivateNetwork && isPrivateNetworkIP(host)) return true;
  return false;
}

function validateStreamUrl(
  url,
  allowedProtocols = ['rtmp', 'rtmps', 'http', 'https', 'srt', 'rtsp'],
  { allowPrivateNetwork = false } = {}
) {
  if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };

  const trimmed = url.trim();
  if (trimmed.length > 2048) return { valid: false, error: 'URL is too long' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Some media URLs are accepted by FFmpeg even when WHATWG URL parsing fails.
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^\s]*)$/);
    if (!match) return { valid: false, error: 'Invalid URL format' };
    const protocol = match[1].toLowerCase();
    if (!allowedProtocols.includes(protocol)) {
      return { valid: false, error: `Protocol "${protocol}" not allowed. Allowed: ${allowedProtocols.join(', ')}` };
    }
    const host = stripPort(match[2].split('@').pop());
    if (isBlockedHost(host, { allowPrivateNetwork })) {
      return { valid: false, error: 'Localhost or unsafe/reserved address is not allowed in stream URLs' };
    }
    return { valid: true };
  }

  const protocol = parsed.protocol.toLowerCase().replace(':', '');
  if (!allowedProtocols.includes(protocol)) {
    return { valid: false, error: `Protocol "${protocol}" not allowed. Allowed: ${allowedProtocols.join(', ')}` };
  }

  if (isBlockedHost(parsed.hostname, { allowPrivateNetwork })) {
    return { valid: false, error: 'Localhost or unsafe/reserved address is not allowed in stream URLs' };
  }

  return { valid: true };
}

module.exports = {
  validateStreamUrl,
  isPrivateIP,
  isPrivateNetworkIP,
  isUnsafeIP,
  isBlockedHost,
  stripPort
};
