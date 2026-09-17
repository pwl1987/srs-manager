function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function videoEncoder(codec) {
  const value = String(codec || 'h264').toLowerCase();
  if (value === 'none') return null;
  if (value === 'h264' || value === 'libx264') return 'libx264';
  if (value === 'h265' || value === 'hevc' || value === 'libx265') return 'libx265';
  throw new Error(`Unsupported transcode video codec for SRS RTMP output: ${codec}`);
}

function audioEncoder(codec) {
  const value = String(codec || 'aac').toLowerCase();
  if (value === 'none') return null;
  if (value === 'aac') return 'aac';
  if (value === 'mp3' || value === 'libmp3lame') return 'libmp3lame';
  throw new Error(`Unsupported transcode audio codec for SRS RTMP output: ${codec}`);
}

function appendVideoArgs(args, template) {
  const encoder = videoEncoder(template.vcodec);
  if (!encoder) {
    args.push('-vn');
    return;
  }
  const config = template.video_config || {};
  args.push('-map', '0:v:0?', '-c:v', encoder);

  const width = finitePositive(config.width);
  const height = finitePositive(config.height);
  if (width || height) args.push('-vf', `scale=${width ? Math.round(width) : -2}:${height ? Math.round(height) : -2}`);

  const fps = finitePositive(config.fps);
  if (fps) args.push('-r', String(fps));

  const bitrate = finitePositive(config.bitrate);
  if (bitrate) args.push('-b:v', `${Math.round(bitrate)}k`);

  const gopSeconds = finitePositive(config.gop_seconds);
  const explicitGop = finitePositive(config.gop ?? config.keyint ?? config.gop_frames);
  const gop = explicitGop || (gopSeconds && fps ? Math.round(gopSeconds * fps) : null);
  if (gop) {
    args.push('-g', String(Math.max(1, Math.round(gop))), '-keyint_min', String(Math.max(1, Math.round(gop))), '-sc_threshold', '0');
  }
  if (gopSeconds) {
    const seconds = Number(gopSeconds.toFixed(3));
    args.push('-force_key_frames', `expr:gte(t,n_forced*${seconds})`);
  }

  const preset = String(config.preset || '').trim();
  if (preset && encoder === 'libx264') args.push('-preset', preset);
}

function appendAudioArgs(args, template) {
  const encoder = audioEncoder(template.acodec);
  if (!encoder) {
    args.push('-an');
    return;
  }
  const config = template.audio_config || {};
  args.push('-map', '0:a:0?', '-c:a', encoder);
  const bitrate = finitePositive(config.bitrate);
  if (bitrate) args.push('-b:a', `${Math.round(bitrate)}k`);
  const sampleRate = finitePositive(config.sample_rate);
  if (sampleRate) args.push('-ar', String(Math.round(sampleRate)));
  const channels = finitePositive(config.channels);
  if (channels) args.push('-ac', String(Math.round(channels)));
}

function buildGroupArgs(sourceUrl, bindings, targetForBinding) {
  if (!sourceUrl) throw new Error('Transcode source URL is required');
  if (!Array.isArray(bindings) || bindings.length === 0) throw new Error('At least one transcode binding is required');
  if (typeof targetForBinding !== 'function') throw new Error('Target resolver is required');

  const args = ['-nostdin', '-hide_banner', '-loglevel', 'warning', '-i', sourceUrl];
  for (const binding of bindings) {
    const target = targetForBinding(binding);
    if (!target) throw new Error(`Missing target for transcode binding ${binding.id}`);
    const template = binding.template || {};
    if (String(template.vcodec || 'h264').toLowerCase() === 'none' && String(template.acodec || 'aac').toLowerCase() === 'none') {
      throw new Error(`Transcode binding ${binding.id} disables both video and audio`);
    }
    appendVideoArgs(args, template);
    appendAudioArgs(args, template);
    args.push('-max_muxing_queue_size', '1024', '-f', 'flv', target);
  }
  return args;
}

function bindingSignature(bindings) {
  return JSON.stringify((bindings || []).map(binding => ({
    id: binding.id,
    output: binding.output_stream_name,
    template_id: binding.template_id,
    template_updated_at: binding.template_updated_at,
    vcodec: binding.template?.vcodec,
    acodec: binding.template?.acodec,
    video_config: binding.template?.video_config || {},
    audio_config: binding.template?.audio_config || {}
  })));
}

module.exports = { buildGroupArgs, bindingSignature, videoEncoder, audioEncoder };
