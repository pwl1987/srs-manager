import { describe, expect, it, vi } from 'vitest';
import { buildOutputPayload, submitOutputDraft } from './output-payload';

describe('buildOutputPayload shared output construction', () => {
  it('builds a scene PUSH payload with target destination', () => {
    const payload = buildOutputPayload({
      builderMode: 'scene',
      sceneId: 'LIVE_PLATFORM_PUSH',
      scene: { mode: 'PUSH', transports: ['rtmp'] },
      name: ' 视频号 ',
      transport: 'rtmp',
      targetUrl: ' rtmp://cdn.example/live/x '
    });
    expect(payload).toEqual({
      mode: 'PUSH',
      name: '视频号',
      scene: 'LIVE_PLATFORM_PUSH',
      transport: 'rtmp',
      protection: 'none',
      processing: { mode: 'PASSTHROUGH' },
      destination: { kind: 'CUSTOM', label: '视频号', target_url: 'rtmp://cdn.example/live/x' }
    });
  });

  it('refuses PUSH without a target URL', () => {
    expect(() => buildOutputPayload({ builderMode: 'pro', mode: 'PUSH', name: 'x', transport: 'rtmp' }))
      .toThrowError(/PUSH_TARGET_REQUIRED/);
    expect(() => buildOutputPayload({ name: '' })).toThrowError(/OUTPUT_NAME_REQUIRED/);
  });

  it('builds RECORD payloads with storage semantics and audio flag', () => {
    const payload = buildOutputPayload({
      builderMode: 'scene', sceneId: 'LOCAL_RECORD', scene: { mode: 'RECORD', formats: ['mp4'] },
      name: '整场录制', recordFormat: 'audio', recordSubdir: ' news/2026 ', segmentSeconds: '12'
    });
    expect(payload.mode).toBe('RECORD');
    expect(payload.protection).toBe('storage-policy');
    expect(payload.audio_format).toBe('aac');
    expect(payload.storage).toEqual({ subdir: 'news/2026', filename_prefix: '整场录制', segment_seconds: 12 });
  });

  it('builds SERVE payloads with scene transports and pro endpoint protections', () => {
    const scene = buildOutputPayload({
      builderMode: 'scene', sceneId: 'PARTNER_PULL', scene: { mode: 'SERVE', transports: ['rtmp', 'hls'] }, name: '合作方'
    });
    expect(scene.transports).toEqual(['rtmp', 'hls']);
    expect(scene.endpoint_protections).toBeUndefined();

    const pro = buildOutputPayload({
      builderMode: 'pro', mode: 'SERVE', name: '合作方', transport: 'hls', protection: 'external-proxy'
    });
    expect(pro.scene).toBe('PROFESSIONAL');
    expect(pro.endpoint_protections).toEqual({ hls: 'external-proxy' });
  });
});

describe('submitOutputDraft shared submit path', () => {
  it('posts the built payload and reports success', async () => {
    const apiClient = { post: vi.fn().mockResolvedValue({}) };
    const notify = { success: vi.fn(), error: vi.fn() };
    const ok = await submitOutputDraft({
      apiClient,
      roomId: 'room:7',
      fields: { builderMode: 'scene', sceneId: 'LOCAL_RECORD', scene: { mode: 'RECORD' }, name: '整场录制' },
      notify,
      t: key => key
    });
    expect(ok).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith('/v3/rooms/room:7/outputs', expect.objectContaining({ mode: 'RECORD' }));
    expect(notify.success).toHaveBeenCalledWith('streams:outputRack.saved');
  });

  it('maps PUSH target errors and generic failures', async () => {
    const notify = { success: vi.fn(), error: vi.fn() };
    const noTarget = await submitOutputDraft({
      apiClient: { post: vi.fn() },
      roomId: 'room:7',
      fields: { mode: 'PUSH', name: 'x' },
      notify,
      t: key => key
    });
    expect(noTarget).toBe(false);
    expect(notify.error).toHaveBeenCalledWith('streams:outputRack.pushTargetRequired');

    notify.error.mockClear();
    const failed = await submitOutputDraft({
      apiClient: { post: vi.fn().mockRejectedValue(new Error('服务不可用')) },
      roomId: 'room:7',
      fields: { mode: 'SERVE', name: 'y' },
      notify,
      t: key => key
    });
    expect(failed).toBe(false);
    expect(notify.error).toHaveBeenCalledWith('服务不可用');
  });
});
