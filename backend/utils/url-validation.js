const net = require('net');

// IPv4 私有与保留地址段（含环回、链路本地、CGNAT、组播、保留、广播）
const RESERVED_IPV4 = [
  { c: [10, 0, 0, 0], m: [255, 0, 0, 0] },      // 10.0.0.0/8 私有
  { c: [172, 16, 0, 0], m: [255, 240, 0, 0] },  // 172.16.0.0/12 私有
  { c: [192, 168, 0, 0], m: [255, 255, 0, 0] }, // 192.168.0.0/16 私有
  { c: [127, 0, 0, 0], m: [255, 0, 0, 0] },     // 127.0.0.0/8 环回
  { c: [169, 254, 0, 0], m: [255, 255, 0, 0] }, // 169.254.0.0/16 链路本地
  { c: [0, 0, 0, 0], m: [255, 0, 0, 0] },       // 0.0.0.0/8 本网络
  { c: [100, 64, 0, 0], m: [255, 192, 0, 0] },  // 100.64.0.0/10 CGNAT
  { c: [192, 0, 0, 0], m: [255, 255, 255, 0] }, // 192.0.0.0/24 IETF 协议分配
  { c: [192, 0, 2, 0], m: [255, 255, 255, 0] }, // 192.0.2.0/24 TEST-NET-1
  { c: [198, 18, 0, 0], m: [255, 254, 0, 0] },  // 198.18.0.0/15 基准测试
  { c: [198, 51, 100, 0], m: [255, 255, 255, 0] }, // 198.51.100.0/24 TEST-NET-2
  { c: [203, 0, 113, 0], m: [255, 255, 255, 0] },  // 203.0.113.0/24 TEST-NET-3
  { c: [224, 0, 0, 0], m: [240, 0, 0, 0] },     // 224.0.0.0/4 组播
  { c: [240, 0, 0, 0], m: [240, 0, 0, 0] },     // 240.0.0.0/4 保留
];

function inCidr4(parts, cidr) {
  for (let i = 0; i < 4; i++) {
    if ((parts[i] & cidr.m[i]) !== (cidr.c[i] & cidr.m[i])) return false;
  }
  return true;
}

function isPrivateIP(ip) {
  if (!ip || typeof ip !== 'string') return false;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return RESERVED_IPV4.some(cidr => inCidr4(parts, cidr));
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;           // 未指定/环回
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;            // fc00::/7 私有
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;            // fe80::/10 链路本地
    if (/^2001:db8:/.test(lower)) return true;                     // 2001:db8::/32 文档专用
    if (lower.startsWith('::ffff:')) return isPrivateIP(lower.slice(7)); // IPv4 映射
    return false;
  }

  return false;
}

// 从 "host:port" / "[v6]:port" 中取出不带端口的主机名
function stripPort(host) {
  if (!host) return host;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  const idx = host.lastIndexOf(':');
  // 仅当冒号唯一时才视为端口分隔（IPv6 裸地址已由方括号分支处理）
  if (idx !== -1 && host.indexOf(':') === idx) return host.slice(0, idx);
  return host;
}

function isBlockedHost(hostname) {
  if (!hostname) return true;
  const host = stripPort(hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]') return true;
  return isPrivateIP(host);
}

function validateStreamUrl(url, allowedProtocols = ['rtmp', 'rtmps', 'http', 'https', 'srt', 'rtsp']) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  const trimmed = url.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'URL is too long' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    // RTMP/SRT/RTSP URL 非标准格式，手动解析
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^\s]*)$/);
    if (!match) {
      return { valid: false, error: 'Invalid URL format' };
    }
    const protocol = match[1].toLowerCase();
    if (!allowedProtocols.includes(protocol)) {
      return { valid: false, error: `Protocol "${protocol}" not allowed. Allowed: ${allowedProtocols.join(', ')}` };
    }
    const host = stripPort(match[2]);
    if (net.isIP(host)) {
      if (isPrivateIP(host)) {
        return { valid: false, error: 'Private or reserved IP addresses are not allowed in stream URLs' };
      }
    } else if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) {
      return { valid: false, error: 'Localhost is not allowed in stream URLs' };
    }
    return { valid: true };
  }

  // 标准 URL（http/https 等）
  const protocol = parsed.protocol.toLowerCase().replace(':', '');
  if (!allowedProtocols.includes(protocol)) {
    return { valid: false, error: `Protocol "${protocol}" not allowed. Allowed: ${allowedProtocols.join(', ')}` };
  }

  if (isBlockedHost(parsed.hostname)) {
    return { valid: false, error: 'Localhost, private, or reserved addresses are not allowed in stream URLs' };
  }

  return { valid: true };
}

module.exports = { validateStreamUrl, isPrivateIP, isBlockedHost, stripPort };
