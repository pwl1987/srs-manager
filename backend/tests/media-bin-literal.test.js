const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// PHASE-09-FIX-02 regression gate (Mimosa: 不可信程序选择). The media tools
// spawned by the workers and the source preview are FAIL-CLOSED: the executable
// may only be an absolute allowlist path (canonical definition in
// backend/utils/media-bin.js) or null — never a bare PATH-resolved name and
// never an environment value. A null resolution must put the caller in an
// explicit unavailable/FAILED state instead of spawning.
//
// PHASE-09-FIX-03: each consumer pins its OWN literal chain on purpose —
// the scanner's taint analysis does not cross module boundaries, so
// `const FFMPEG_BIN = resolveFfmpeg()` near a spawn cannot be proven literal
// and grades as command-injection high (probe evidence in
// docs/security/MIMOSA-GATE-UNBLOCK.md). Any drift towards that form, a bare
// name, or a reordered/partial allowlist must fail right here.

const { resolveFfmpeg, resolveFfprobe, FFMPEG_ALLOWLIST, FFPROBE_ALLOWLIST } = require('../utils/media-bin');

const SPAWN_SITES = [
  'record-worker.js',
  'pull-worker.js',
  'push-worker.js',
  'transcode-worker.js'
].map(file => path.join(__dirname, '..', file))
  .concat(path.join(__dirname, '..', 'services', 'source-preview-service.js'));

function assertLiteralChain(source, constantName, allowlist, file) {
  const line = source.match(new RegExp(`const ${constantName} = .*?;`))?.[0];
  assert.ok(line, `${file} must define ${constantName}`);
  const tokens = [...line.matchAll(/'([^']+)'/g)].map(match => match[1]);
  // fs.existsSync('<p>') ? '<p>' for every allowlist entry, in order.
  assert.deepEqual(tokens, allowlist.flatMap(candidate => [candidate, candidate]),
    `${file}: ${constantName} must enumerate exactly the canonical allowlist in order`);
  assert.match(line, /: null;$/, `${file}: ${constantName} must terminate fail-closed on null — no bare-name PATH fallback`);
}

test('media tool spawn sites pin absolute allowlist chains that terminate on null', () => {
  for (const file of SPAWN_SITES) {
    const source = fs.readFileSync(file, 'utf8');
    assertLiteralChain(source, 'FFMPEG_BIN', FFMPEG_ALLOWLIST, path.basename(file));
    assert.doesNotMatch(source, /: '(ffmpeg|ffprobe)';/,
      `${path.basename(file)} must not fall back to a bare PATH-resolved program name`);
    assert.doesNotMatch(source, /process\.env\.(FFMPEG_BIN|FFPROBE_BIN)/,
      `${path.basename(file)} must not read the spawned binary from the environment`);
    // Every spawn/spawnSync call uses the pinned constant with an argument
    // array (literal or variable), never a shell string. Combined with the
    // absolute-or-null constants above, PATH can never select the program.
    for (const match of source.matchAll(/spawnSync?\(/g)) {
      const call = source.slice(match.index, match.index + 120);
      assert.match(call, /^spawnSync?\(\s*(FFMPEG_BIN|FFPROBE_BIN)\s*,\s*[\[A-Za-z_$]/,
        `${path.basename(file)}: spawn must call the pinned constant with an argument array`);
      assert.doesNotMatch(call, /,\s*(true|\{[^}]*shell\s*:\s*true)/,
        `${path.basename(file)}: spawn must not enable a shell`);
    }
  }
});

test('record worker also pins ffprobe via the allowlist chain', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'record-worker.js'), 'utf8');
  assertLiteralChain(source, 'FFPROBE_BIN', FFPROBE_ALLOWLIST, 'record-worker.js');
});

test('every worker treats a null binary as an explicit unavailable state, not a spawn', () => {
  const guards = {
    'record-worker.js': /if \(!FFMPEG_BIN\) \{[\s\S]{0,400}last_error: 'ffmpeg binary unavailable \(fail-closed\); no allowlisted installation found'/,
    'pull-worker.js': /if \(!FFMPEG_BIN\) \{[\s\S]{0,400}last_error: 'ffmpeg binary unavailable \(fail-closed\); no allowlisted installation found'/,
    'push-worker.js': /if \(!FFMPEG_BIN\) \{[\s\S]{0,400}error_message: 'ffmpeg binary unavailable \(fail-closed\); no allowlisted installation found'/,
    'transcode-worker.js': /if \(!FFMPEG_BIN\) \{[\s\S]{0,400}last_error: 'ffmpeg binary unavailable \(fail-closed\); no allowlisted installation found'/
  };
  for (const [file, pattern] of Object.entries(guards)) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, pattern, `${file} must fail tasks explicitly when no allowlisted binary exists`);
  }
  const preview = fs.readFileSync(path.join(__dirname, '..', 'services', 'source-preview-service.js'), 'utf8');
  assert.match(preview, /if \(!FFMPEG_BIN\) return false;/, 'source preview capability must report unavailable when no allowlisted binary exists');
});

test('resolver return value is only an absolute allowlist path or null', () => {
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  assert.ok(ffmpeg === null || FFMPEG_ALLOWLIST.includes(ffmpeg), `unexpected ffmpeg resolution: ${ffmpeg}`);
  assert.ok(ffprobe === null || FFPROBE_ALLOWLIST.includes(ffprobe), `unexpected ffprobe resolution: ${ffprobe}`);
  assert.ok(!FFMPEG_ALLOWLIST.includes('ffmpeg') && !FFPROBE_ALLOWLIST.includes('ffprobe'), 'allowlists must contain absolute paths only');
});

test('a polluted PATH cannot influence the resolution and a planted fake never runs', () => {
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-fake-bin-'));
  const originalPath = process.env.PATH;
  try {
    const marker = path.join(fakeDir, 'pwned.txt');
    // Same-named fakes sit FIRST on this process's PATH. The resolver must
    // still answer with an absolute allowlist path (or null) — never the bare
    // name the fakes impersonate — and the spawn-site contract above then
    // guarantees only that resolution is ever spawned.
    fs.writeFileSync(path.join(fakeDir, 'ffmpeg'), '#!/bin/sh\ntouch pwned.txt\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fakeDir, 'ffprobe'), '#!/bin/sh\ntouch pwned.txt\n', { mode: 0o755 });
    process.env.PATH = fakeDir;
    const ffmpeg = resolveFfmpeg();
    const ffprobe = resolveFfprobe();
    assert.ok(ffmpeg === null || FFMPEG_ALLOWLIST.includes(ffmpeg), `polluted PATH changed the ffmpeg resolution: ${ffmpeg}`);
    assert.ok(ffprobe === null || FFPROBE_ALLOWLIST.includes(ffprobe), `polluted PATH changed the ffprobe resolution: ${ffprobe}`);
    assert.notEqual(ffmpeg, 'ffmpeg', "the bare name 'ffmpeg' must never be the resolution");
    assert.notEqual(ffprobe, 'ffprobe', "the bare name 'ffprobe' must never be the resolution");
    assert.ok(!fs.existsSync(marker), 'the fake media binaries planted on PATH must never execute');
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('source preview capability reports an allowlisted binary or null, never a bare name', () => {
  // Own DB sandbox: the service reads only pull-task tables for resolvePullSource,
  // and capability() must work on a fresh database.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-media-bin-'));
  try {
    process.env.DATA_DIR = dataDir;
    process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';
    const db = require('../database');
    const preview = require('../services/source-preview-service');
    const capability = preview.capability();
    assert.ok(capability.binary === null || FFMPEG_ALLOWLIST.includes(capability.binary), `unexpected binary: ${capability.binary}`);
    assert.equal(typeof capability.available, 'boolean');
    if (capability.binary === null) assert.equal(capability.available, false, 'no binary ⇒ capability unavailable');
    db.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
