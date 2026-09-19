import { describe, expect, it, vi } from 'vitest';

const createPlayer = vi.hoisted(() => vi.fn(() => ({ attachMediaElement: vi.fn() })));

vi.mock('flv.js', () => ({
  default: {
    isSupported: () => true,
    createPlayer
  }
}));

import { createFlvPreviewPlayer, isFlvPreviewSupported } from './flv-preview';

describe('flv preview compatibility', () => {
  it('keeps the production preview player on the main thread', () => {
    expect(isFlvPreviewSupported()).toBe(true);
    createFlvPreviewPlayer('http://example.test/live.flv');
    expect(createPlayer).toHaveBeenCalledWith(
      { type: 'flv', isLive: true, url: 'http://example.test/live.flv' },
      expect.objectContaining({ enableWorker: false, enableStashBuffer: false, lazyLoad: false })
    );
  });
});
