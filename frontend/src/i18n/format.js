import i18next from './index';

export function formatBytes(bytes) {
  if (bytes == null) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(2)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBitrate(bps) {
  if (bps == null || isNaN(bps)) return '-';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

// Input in Kbps (the unit the streams table stores).
export function formatBitrateKbps(kbps) {
  if (kbps == null || isNaN(kbps)) return '-';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(2)} Mbps`;
  return `${Math.round(kbps)} Kbps`;
}

export function formatRelativeTime(dateStr) {
  if (!dateStr) return '-';
  const rtf = new Intl.RelativeTimeFormat(i18next.language, { numeric: 'auto' });
  const diff = (Date.parse(dateStr) - Date.now()) / 1000;
  if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'second');
  if (Math.abs(diff) < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Intl.DateTimeFormat(i18next.language, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(dateStr));
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Intl.DateTimeFormat(i18next.language, {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(dateStr));
}

const CODEC_MAP = {
  h264: 'H.264',
  h265: 'H.265',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg4: 'MPEG-4',
  mpeg1: 'MPEG-1',
  theora: 'Theora',
  x264: 'x264',
  x265: 'x265',
  ffv1: 'FFV1',
  svq1: 'Sorenson Video 1',
  dnxhd: 'DNxHD',
  prores: 'Apple ProRes',
  mjpeg: 'Motion JPEG',
  raw: 'Raw',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  pcm: 'PCM',
  wma: 'WMA'
};

export function formatCodec(code) {
  if (!code) return '-';
  const normalized = code.toLowerCase();
  return CODEC_MAP[normalized] || code;
}
