const crypto = require('crypto');
const db = require('../database');
const bindingService = require('./transcode-binding-service');
const templateService = require('./transcode-service');

const VIDEO_ALIASES = Object.freeze({ h264: 'h264', libx264: 'h264', h265: 'h265', hevc: 'h265', libx265: 'h265', none: 'none' });
const AUDIO_ALIASES = Object.freeze({ aac: 'aac', mp3: 'mp3', libmp3lame: 'mp3', none: 'none' });

function parseConfig(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

function normalizeScalar(value) {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return normalizeScalar(value);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function canonicalSpec(template) {
  if (!template) throw new Error('Transcode template not found');
  const vcodec = VIDEO_ALIASES[String(template.vcodec || 'h264').toLowerCase()];
  const acodec = AUDIO_ALIASES[String(template.acodec || 'aac').toLowerCase()];
  if (!vcodec || !acodec) throw new Error('Unsupported rendition codec');
  if (vcodec === 'none' && acodec === 'none') throw new Error('Rendition cannot disable both video and audio');
  return stable({
    vcodec,
    acodec,
    video: parseConfig(template.video_config),
    audio: parseConfig(template.audio_config)
  });
}

function signatureForTemplate(template) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalSpec(template))).digest('hex');
}

function signatureForBinding(binding) {
  return signatureForTemplate(binding?.template);
}

function findReusableBinding(streamId, template) {
  const wanted = signatureForTemplate(template);
  return bindingService.listBindingsByStream(streamId).find(binding => signatureForBinding(binding) === wanted) || null;
}

function suffixForSignature(signature) {
  return `r_${String(signature).slice(0, 12)}`;
}
function ensureRendition(streamId, templateId) {
  const stream = db.prepare('SELECT id FROM streams WHERE id = ?').get(Number(streamId));
  if (!stream) throw new Error('Stream not found');
  const template = templateService.getTemplate(Number(templateId));
  if (!template) throw new Error('Transcode template not found');
  if (!template.enabled) throw new Error('Transcode template is disabled');
  const reusable = findReusableBinding(stream.id, template);
  if (reusable) return { binding: reusable, reused: true, signature: signatureForTemplate(template) };

  const signature = signatureForTemplate(template);
  const binding = bindingService.createBinding({
    stream_id: stream.id,
    template_id: template.id,
    role: 'custom',
    output_suffix: suffixForSignature(signature),
    sort_order: 100
  });
  return { binding, reused: false, signature };
}

function runningConsumers(bindingId) {
  const id = Number(bindingId);
  const push = db.prepare(`SELECT COUNT(*) AS count FROM forward_tasks
    WHERE source_binding_id = ? AND execution_mode = 'managed_worker' AND desired_state = 'RUNNING'`)
    .get(id).count;
  const record = db.prepare(`SELECT COUNT(*) AS count FROM record_tasks
    WHERE source_binding_id = ? AND desired_state = 'RUNNING'`).get(id).count;
  return Number(push || 0) + Number(record || 0);
}

function reconcileDesiredState(bindingId) {
  const binding = bindingService.getBinding(bindingId);
  if (!binding) return null;
  const consumers = Number(runningConsumers(binding.id) || 0);
  const target = consumers > 0 ? 'RUNNING' : 'STOPPED';
  if (binding.desired_state === target) return binding;
  return bindingService.setDesiredState(binding.id, target);
}

module.exports = {
  canonicalSpec,
  signatureForTemplate,
  signatureForBinding,
  findReusableBinding,
  ensureRendition,
  runningConsumers,
  reconcileDesiredState,
  suffixForSignature
};
