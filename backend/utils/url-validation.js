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
  if (!lower.startsWith('::ffff:')) return null;
  const rest = lower.slice(7);
  if (net.isIPv4(rest)) return rest;
  // WHATWG serializes an embedded IPv4 tail as hex: "::ffff:7f00:1" == 127.0.0.1.
  const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return ((hi >> 8) & 255) + '.' + (hi & 255) + '.' + ((lo >> 8) & 255) + '.' + (lo & 255);
  }
  return null;
}

// WHATWG URL and net.isIPv4 both leave inet_aton shorthand ("127.1",
// "2130706433", "0177.0.0.1") untouched, but FFmpeg/libc resolves it as IPv4.
// Canonicalize before CIDR matching so blocked ranges cannot be bypassed.
function parseIPv4Shorthand(host) {
  if (!/^[0-9a-fA-FxX.]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  const parse = (p) => {
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) return parseInt(p.slice(2), 16);
    if (p.length > 1 && p[0] === '0') return parseInt(p.slice(1), 8);
    if (/^[0-9]+$/.test(p)) return parseInt(p, 10);
    return NaN;
  };
  const parts = host.split('.');
  if (parts.length === 1) {
    const n = parse(parts[0]);
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) return null;
    return ((n >>> 24) & 255) + '.' + ((n >>> 16) & 255) + '.' + ((n >>> 8) & 255) + '.' + (n & 255);
  }
  if (parts.length > 4) return null;
  const fill = 4 - parts.length;
  // inet_aton semantics: every part except the last is one byte; the last part
  // fills the remaining bytes and may exceed 255 (macOS resolves 127.999 as 127.0.3.231).
  const nums = parts.map((p, i) => {
    const n = parse(p);
    const max = i < parts.length - 1 ? 255 : (fill > 0 ? 0xFFFF : 255);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
  });
  if (nums.some(n => n === null)) return null;
  if (parts.length === 4) return nums.join('.');
  const last = nums[nums.length - 1];
  const bytes = nums.slice(0, -1);
  for (let shift = fill * 8 - 8; shift >= 0; shift -= 8) bytes.push((last >> shift) & 255);
  return bytes.join('.');
}

function canonicalIPv4(ip) {
  if (net.isIPv4(ip)) return ip;
  return parseIPv4Shorthand(ip);
}

function isPrivateNetworkIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const v4 = canonicalIPv4(ip);
  if (v4) {
    const parts = v4.split('.').map(Number);
    return PRIVATE_IPV4.some(cidr => inCidr4(parts, cidr));
  }
  if (net.isIPv6(ip)) {
    const mapped = mappedIPv4(ip);
    if (mapped) return isPrivateNetworkIP(mapped);
    return /^f[cd][0-9a-f]{2}:/i.test(ip); // fc00::/7 ULA
  }
  return false;
}

function isUnsafeIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const v4 = canonicalIPv4(ip);
  if (v4) {
    const parts = v4.split('.').map(Number);
    return UNSAFE_IPV4.some(cidr => inCidr4(parts, cidr));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = mappedIPv4(lower);
    if (mapped) return isUnsafeIP(mapped);
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
