const fs = require('fs');
const path = require('path');

function storageRoot() {
  const fallbackData = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  return path.resolve(process.env.RECORD_STORAGE_ROOT || path.join(fallbackData, 'recordings'));
}

function ensureRoot() {
  const root = storageRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o750 });
  return root;
}

function normalizeSubdir(value = '') {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  if (path.posix.isAbsolute(raw) || raw.includes('\0')) throw new Error('Recording subdir must be relative');
  const parts = raw.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '.' || part === '..' || !/^[\p{L}\p{N}._-]+$/u.test(part)) throw new Error('Invalid recording subdir');
  }
  return parts.join('/');
}

function safeFileStem(value, fallback = 'recording') {
  const input = String(value || fallback).normalize('NFKC').trim();
  const safe = input.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 96);
  return safe || fallback;
}

function resolveRelative(relativePath) {
  const root = ensureRoot();
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel || path.posix.isAbsolute(rel) || rel.includes('\0')) throw new Error('Recording path must be relative');
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Recording path escapes storage root');
  return target;
}

function diskBudget(estimatedBitrateBps, options = {}) {
  const root = ensureRoot();
  const statfs = options.statfs || fs.statfsSync;
  const stats = statfs(root);
  const bsize = Number(stats.bsize || 0);
  const total = Number(stats.blocks || 0) * bsize;
  const available = Number(stats.bavail ?? stats.bfree ?? 0) * bsize;
  const reserveRatio = Number.isFinite(options.reserveRatio) ? options.reserveRatio : 0.10;
  const minReserveBytes = Number.isFinite(options.minReserveBytes) ? options.minReserveBytes : 256 * 1024 * 1024;
  const reserve = Math.max(total * reserveRatio, minReserveBytes);
  const usable = Math.max(0, available - reserve);
  const bitrate = Number(estimatedBitrateBps || 0);
  return {
    root,
    total_bytes: Math.max(0, Math.floor(total)),
    available_bytes: Math.max(0, Math.floor(available)),
    reserve_bytes: Math.max(0, Math.floor(reserve)),
    usable_bytes: Math.max(0, Math.floor(usable)),
    estimated_seconds: bitrate > 0 ? Math.floor((usable * 8) / bitrate) : null,
    low_space: usable <= 0
  };
}

module.exports = { storageRoot, ensureRoot, normalizeSubdir, safeFileStem, resolveRelative, diskBudget };
