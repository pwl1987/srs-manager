import rawFlvjs from 'flv.js';

// flv.js 1.6.2's Web Worker bundle is not reliable in the Vite production
// bundle used by the operator console. Keep every preview call on the main
// thread, even when a legacy caller still requests the worker explicitly.
function createMainThreadPlayer(media, config = {}) {
  return rawFlvjs.createPlayer(media, { ...config, enableWorker: false });
}

export const flvjs = { ...rawFlvjs, createPlayer: createMainThreadPlayer };

export function isFlvPreviewSupported() {
  return typeof flvjs?.isSupported === 'function' && flvjs.isSupported();
}

export function createFlvPreviewPlayer(url) {
  return flvjs.createPlayer(
    { type: 'flv', isLive: true, url },
    { enableWorker: true, enableStashBuffer: false, lazyLoad: false }
  );
}
