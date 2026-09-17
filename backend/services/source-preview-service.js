const { spawn, spawnSync } = require('node:child_process');
const db = require('../database');

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const MAX_CONCURRENT = Math.max(1, Math.min(4, Number(process.env.SOURCE_PREVIEW_MAX_CONCURRENT || 2)));
const MAX_DURATION_MS = Math.max(60000, Math.min(30 * 60 * 1000, Number(process.env.SOURCE_PREVIEW_MAX_DURATION_MS || 10 * 60 * 1000)));
const active = new Set();
let ffmpegCapability = null;

function resolvePullSource(streamId, sourceId) {
  const match = String(sourceId || '').match(/^source:in_pull:ptsrc-(\d+)$/);
  if (!match) return null;
  return db.prepare(`
    SELECT pts.id AS pull_task_source_id, pts.external_source_id, pt.id AS pull_task_id,
           pt.stream_id, es.name, es.protocol, es.source_url, es.status
    FROM pull_task_sources pts
    JOIN pull_tasks pt ON pt.id=pts.pull_task_id
    JOIN external_sources es ON es.id=pts.external_source_id
    WHERE pts.id=? AND pt.stream_id=? AND pts.enabled=1 AND es.status='active'
  `).get(Number(match[1]), Number(streamId)) || null;
}

function ffmpegAvailable() {
  if (ffmpegCapability !== null) return ffmpegCapability;
  const result = spawnSync(FFMPEG_BIN, ['-version'], { stdio: 'ignore', timeout: 1500 });
  ffmpegCapability = !result.error && result.status === 0;
  return ffmpegCapability;
}

function buildArgs(source) {
  const protocol = String(source.protocol || '').toLowerCase();
  const beforeInput = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
  if (protocol === 'rtsp') beforeInput.push('-rtsp_transport', 'tcp');
  return [...beforeInput, '-i', source.source_url, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'copy', '-flvflags', 'no_duration_filesize', '-f', 'flv', 'pipe:1'];
}

function start(streamId, sourceId) {
  const source = resolvePullSource(streamId, sourceId);
  if (!source) throw new Error('Source preview is unavailable for this source');
  if (!ffmpegAvailable()) throw new Error('FFmpeg is unavailable for source preview');
  if (active.size >= MAX_CONCURRENT) throw new Error('Source preview concurrency limit reached');
  const previewId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const child = spawn(FFMPEG_BIN, buildArgs(source), { stdio: ['ignore', 'pipe', 'pipe'] });
  active.add(previewId);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString()}`.slice(-1200); });
  const timer = setTimeout(() => { if (!child.killed) child.kill('SIGTERM'); }, MAX_DURATION_MS);
  const cleanup = () => { clearTimeout(timer); active.delete(previewId); };
  child.once('exit', cleanup);
  child.once('error', cleanup);
  return {
    id: previewId,
    child,
    stdout: child.stdout,
    source: { id: sourceId, name: source.name, protocol: source.protocol },
    stop() { if (!child.killed) child.kill('SIGTERM'); },
    getError() { return stderr
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)?([^\s?#]+)(\?[^\s#]*)?/g, '$1$3')
      .replace(/([?&][^=\s]*(?:token|secret|signature|sig|key|auth|password|passphrase)[^=\s]*=)[^&\s]+/gi, '$1***'); }
  };
}

function capability() {
  return { available: ffmpegAvailable(), transport: 'http-flv', max_concurrent: MAX_CONCURRENT, max_duration_seconds: Math.floor(MAX_DURATION_MS / 1000), codec_mode: 'copy-compatible' };
}

module.exports = { resolvePullSource, buildArgs, start, capability, ffmpegAvailable };
