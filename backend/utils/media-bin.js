const fs = require('fs');

// PHASE-09-FIX-02 GATE (Mimosa: 不可信程序选择) — the canonical ALLOWLIST
// CONTRACT AUTHORITY for media binaries, NOT a runtime single source of
// truth. The five consumers (record/pull/push/transcode workers and the
// source preview) each pin the SAME literal chain in their own file: the
// static security scanner's taint analysis does not cross module boundaries,
// so a resolver result imported into a spawn call cannot be proven literal
// and grades as a command-injection high (empirically re-verified in
// PHASE-09-FIX-03 — see docs/security/MIMOSA-GATE-UNBLOCK.md). This module
// is the definition that tests/media-bin-literal.test.js enforces against:
// every consumer's chain must enumerate exactly these absolute paths, in
// order, terminating on null — no bare-name fallback (PATH can never select
// the program) and no environment value. When no candidate exists callers
// must enter an explicit unavailable state instead of spawning.
const FFMPEG_ALLOWLIST = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
const FFPROBE_ALLOWLIST = ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe'];

function firstExisting(candidates) {
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function resolveFfmpeg() {
  return firstExisting(FFMPEG_ALLOWLIST);
}

function resolveFfprobe() {
  return firstExisting(FFPROBE_ALLOWLIST);
}

module.exports = { resolveFfmpeg, resolveFfprobe, FFMPEG_ALLOWLIST, FFPROBE_ALLOWLIST };
