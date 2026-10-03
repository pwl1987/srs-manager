import { describe, expect, it, vi } from 'vitest';
import { createSessionCommands, opKey } from './use-session-commands';

function harness({ session = { legacy_session_id: 5 }, postResults = {} } = {}) {
  const calls = { post: [], get: [] };
  const apiClient = {
    post: vi.fn(async (path, body, init) => {
      calls.post.push({ path, body, init });
      const key = Object.keys(postResults).find(k => path.includes(k));
      if (key) { const result = postResults[key]; if (result instanceof Error) throw result; return result; }
      return {};
    }),
    get: vi.fn(async path => { calls.get.push(path); return {}; })
  };
  const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  const onChanged = vi.fn(async () => {});
  const commands = createSessionCommands({
    apiClient,
    notify,
    t: (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
    sleep: async () => {},
    getRoomId: () => 'room:7',
    getSession: () => session,
    onChanged
  });
  return { commands, apiClient, notify, onChanged, calls };
}

describe('shared session commands', () => {
  it('preflight reports blocked, warning and pass outcomes', async () => {
    const blocked = harness({ postResults: { preflight: { status: 'BLOCKED' } } });
    await blocked.commands.runPreflight();
    expect(blocked.notify.error).toHaveBeenCalledWith('streams:sessionCommands.preflightBlocked');

    const warning = harness({ postResults: { preflight: { status: 'READY_WITH_WARNING' } } });
    await warning.commands.runPreflight();
    expect(warning.notify.warning).toHaveBeenCalledWith('streams:sessionCommands.preflightWarning');

    const pass = harness({ postResults: { preflight: { status: 'READY' } } });
    await pass.commands.runPreflight();
    expect(pass.notify.success).toHaveBeenCalledWith('streams:sessionCommands.preflightPass');
    expect(pass.onChanged).toHaveBeenCalled();
  });

  it('preflight surfaces API failures without calling onChanged', async () => {
    const failed = harness({ postResults: { preflight: new Error('网络不可用') } });
    await failed.commands.runPreflight();
    expect(failed.notify.error).toHaveBeenCalledWith('网络不可用');
    expect(failed.onChanged).not.toHaveBeenCalled();
  });

  it('start sends the idempotency key and reports completion', async () => {
    const ok = harness({ postResults: { start: { phase: 'SUCCEEDED' } } });
    await ok.commands.startSession();
    const startCall = ok.calls.post.find(call => call.path.includes('/start'));
    expect(startCall.init.headers['Idempotency-Key']).toMatch(/^session-start-5-/);
    expect(ok.notify.success).toHaveBeenCalledWith('streams:sessionCommands.started');
  });

  it('close adopts a 409 operation, polls it to success and refreshes', async () => {
    const conflict = new Error('conflict');
    conflict.status = 409;
    conflict.detail = { id: 'operation:close:1', phase: 'VERIFYING' };
    const h = harness({ postResults: { close: conflict } });
    h.apiClient.get = vi.fn(async () => ({ id: 'operation:close:1', phase: 'SUCCEEDED' }));
    await h.commands.closeSession();
    expect(h.apiClient.get).toHaveBeenCalledWith('/v3/operations/operation%3Aclose%3A1');
    expect(h.notify.success).toHaveBeenCalledWith('streams:sessionCommands.closeSucceeded');
  });

  it('close reports residue and in-progress outcomes', async () => {
    const residue = harness({ postResults: { close: { id: 'op:1', phase: 'FAILED' } } });
    await residue.commands.closeSession();
    expect(residue.notify.error).toHaveBeenCalledWith('streams:sessionCommands.closeResidual');

    const pending = harness({ postResults: { close: { id: 'op:1', phase: 'VERIFYING' } } });
    pending.apiClient.get = vi.fn(async () => ({ id: 'op:1', phase: 'VERIFYING' }));
    await pending.commands.closeSession();
    expect(pending.notify.warning).toHaveBeenCalledWith('streams:sessionCommands.closeInProgress');
  });

  it('createSession validates the plan, posts and reports success', async () => {
    const h = harness();
    await h.commands.createSession({ planId: '' });
    expect(h.notify.error).toHaveBeenCalledWith('streams:sessionBar.planRequired');
    expect(h.apiClient.post).not.toHaveBeenCalled();

    const ok = await h.commands.createSession({ planId: '3', title: ' 任意社会学 ', fallbackTitle: 'fallback' });
    expect(ok).toBe(true);
    expect(h.calls.post.find(call => call.path.endsWith('/sessions')).body)
      .toEqual({ run_plan_id: 3, title: '任意社会学' });
    expect(h.notify.success).toHaveBeenCalledWith('streams:sessionBar.noSession.sessionCreated');

    const failure = new Error('会话冲突');
    const bad = harness({ postResults: { sessions: failure } });
    expect(await bad.commands.createSession({ planId: '3', title: '', fallbackTitle: '' })).toBe(false);
    expect(bad.notify.error).toHaveBeenCalledWith('会话冲突');
  });

  it('createQuickPlan maps optional flags and reports saved plans', async () => {
    const h = harness({ postResults: { 'run-plans': { run_plan: { id: 9 } } } });
    const created = await h.commands.createQuickPlan({
      name: ' 标准方案 ',
      sourceId: 'source:in_pull:ptsrc-4',
      outputs: [{ id: 'output:push:1', optional: false }, { id: 'output:record:2', optional: true }]
    });
    expect(created).toEqual({ id: 9 });
    expect(h.calls.post.find(call => call.path.endsWith('/run-plans')).body).toEqual({
      name: '标准方案',
      program_source_id: 'source:in_pull:ptsrc-4',
      outputs: [
        { output_ref: 'output:push:1', importance: 'REQUIRED', auto_start: true, sort_order: 10 },
        { output_ref: 'output:record:2', importance: 'OPTIONAL', auto_start: true, sort_order: 20 }
      ]
    });
    expect(h.notify.success).toHaveBeenCalledWith('streams:sessionBar.quickPlan.saved');

    await h.commands.createQuickPlan({ name: '   ' });
    expect(h.notify.error).toHaveBeenCalledWith('streams:sessionBar.quickPlan.nameRequired');
  });

  it('loadPlans reads the room plan list', async () => {
    const h = harness();
    h.apiClient.get = vi.fn(async () => ({ run_plans: [{ id: 1 }] }));
    expect(await h.commands.loadPlans()).toEqual([{ id: 1 }]);
    expect(h.apiClient.get).toHaveBeenCalledWith('/v3/rooms/room:7/run-plans');
  });

  it('commands without a session are no-ops', async () => {
    const h = harness({ session: null });
    await h.commands.runPreflight();
    await h.commands.startSession();
    await h.commands.closeSession();
    expect(h.apiClient.post).not.toHaveBeenCalled();
    expect(h.notify.success).not.toHaveBeenCalled();
  });

  it('reports start failures and non-409 close failures', async () => {
    const startFailed = harness({ postResults: { start: new Error('启动被拒绝') } });
    await startFailed.commands.startSession();
    expect(startFailed.notify.error).toHaveBeenCalledWith('启动被拒绝');

    const closeFailed = new Error('网关错误');
    closeFailed.status = 502;
    const h = harness({ postResults: { close: closeFailed } });
    await h.commands.closeSession();
    expect(h.notify.error).toHaveBeenCalledWith('网关错误');
  });

  it('reports quick plan creation failures', async () => {
    const h = harness({ postResults: { 'run-plans': new Error('方案写入失败') } });
    expect(await h.commands.createQuickPlan({ name: '标准方案', sourceId: '', outputs: [] })).toBeNull();
    expect(h.notify.error).toHaveBeenCalledWith('方案写入失败');
  });

  it('falls back to a random idempotency key without crypto uuid', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: undefined }, configurable: true });
    try {
      expect(opKey('prefix')).toMatch(/^prefix-/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
