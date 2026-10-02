import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});

const { api } = await import('./api');

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, statusText: 'Status', json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client error surface', () => {
  it('keeps the full response body on thrown errors (preflight 409 BLOCKED)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { status: 'BLOCKED', summary: { blockers: 2 } }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await api.post('/v3/sessions/11/preflight', { mark_ready: true }).catch(err => err);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.body).toEqual({ status: 'BLOCKED', summary: { blockers: 2 } });
  });

  it('maps code/detail and tolerates non-JSON error bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 422, statusText: 'Unprocessable',
      json: async () => { throw new Error('not json'); }
    });
    vi.stubGlobal('fetch', fetchMock);
    const error = await api.post('/v3/rooms/room:1/outputs', {}).catch(err => err);
    expect(error.status).toBe(422);
    expect(error.message).toBe('Unprocessable');
    expect(error.body).toEqual({ error: 'Unprocessable' });
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { scenes: [] })));
    const data = await api.get('/v3/output/scenes');
    expect(data).toEqual({ scenes: [] });
  });
});
