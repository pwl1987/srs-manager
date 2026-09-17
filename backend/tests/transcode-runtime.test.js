const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGroupArgs, bindingSignature, videoEncoder, audioEncoder } = require('../services/transcode-runtime');

function binding(id, suffix, role, template) {
  return {
    id,
    output_stream_name: `news__${suffix}`,
    role,
    template_id: id,
    template_updated_at: '2026-09-17T00:00:00Z',
    template
  };
}

test('transcode pipeline builds aligned multi-output FFmpeg arguments', () => {
  const outputs = [
    binding(1, 'main', 'main', {
      vcodec: 'h264', acodec: 'aac',
      video_config: { width: 1920, height: 1080, fps: 25, bitrate: 6000, gop_seconds: 2, preset: 'veryfast' },
      audio_config: { bitrate: 192, sample_rate: 48000, channels: 2 }
    }),
    binding(2, 'sub', 'secondary', {
      vcodec: 'h264', acodec: 'aac',
      video_config: { width: 1280, height: 720, fps: 25, bitrate: 3000, gop_seconds: 2 },
      audio_config: { bitrate: 128 }
    })
  ];  const args = buildGroupArgs('rtmp://origin/live/news', outputs, row => `rtmp://srs/live/${row.output_stream_name}`);
  assert.equal(args[0], '-nostdin');
  assert.equal(args.filter(value => value === '-g').length, 2);
  assert.equal(args.filter(value => value === '50').length >= 2, true);
  assert.equal(args.filter(value => value === '-force_key_frames').length, 2);
  assert.equal(args.includes('scale=1920:1080'), true);
  assert.equal(args.includes('scale=1280:720'), true);
  assert.equal(args.includes('rtmp://srs/live/news__main'), true);
  assert.equal(args.includes('rtmp://srs/live/news__sub'), true);
});

test('transcode pipeline supports audio-only derived output', () => {
  const audio = binding(3, 'audio', 'audio', {
    vcodec: 'none', acodec: 'aac', video_config: {},
    audio_config: { bitrate: 128, sample_rate: 48000, channels: 2 }
  });
  const args = buildGroupArgs('rtmp://origin/live/news', [audio], row => `rtmp://srs/live/${row.output_stream_name}`);
  assert.equal(args.includes('-vn'), true);
  assert.equal(args.includes('-c:a'), true);
  assert.equal(args.includes('aac'), true);
  assert.equal(args.includes('rtmp://srs/live/news__audio'), true);
});

test('transcode signature changes when mounted template configuration changes', () => {
  const row = binding(1, 'main', 'main', { vcodec: 'h264', acodec: 'aac', video_config: { bitrate: 6000 }, audio_config: {} });
  const before = bindingSignature([row]);
  row.template.video_config.bitrate = 5000;
  assert.notEqual(bindingSignature([row]), before);
});
test('transcode runtime accepts legacy encoder aliases', () => {
  assert.equal(videoEncoder('libx264'), 'libx264');
  assert.equal(videoEncoder('libx265'), 'libx265');
  assert.equal(audioEncoder('libmp3lame'), 'libmp3lame');
});
