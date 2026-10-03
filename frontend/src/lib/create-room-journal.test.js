import { describe, expect, it, vi } from 'vitest';
import { CreationInterrupted, newJournal, runRoomCreation } from './create-room-journal';

// Distinct ids on purpose: external_source_id=7, pull_task_id=9,
// pull_task_sources.id=31. Equal-id fixtures once masked the ptsrc mapping bug.
const intent = {
  name: '任意社会学',
  protocol: 'rtmp',
  remark: '晚间场',
  businessUnit: '新闻中心',
  inputDirection: 'IN_PULL',
  pullSource: { name: '合作方演播室', source_url: 'rtmp://up.example/live/a', protocol: 'rtmp' },
  outputs: [
    { name: '我们推给第三方 1', mode: 'PUSH', scene: 'LIVE_PLATFORM_PUSH', payload: { mode: 'PUSH', name: '我们推给第三方 1', scene: 'LIVE_PLATFORM_PUSH' } },
    { name: '本地输出 2', mode: 'RECORD', scene: 'LOCAL_RECORD', payload: { mode: 'RECORD', name: '本地输出 2', scene: 'LOCAL_RECORD' } }
  ],
  createRunPlan: true,
  planName: '任意社会学'
};

const pushIntent = { ...intent, inputDirection: 'IN_PUSH', pullSource: null, credentialLabel: 'wizard-任意社会学' };

// Workspace fixture: the REAL ptsrc source plus a decoy whose ptsrc id equals
// the external_source id (7). Naive id substitution picks the decoy.
const WORKSPACE_SOURCES = [
  { id: 'source:in_pull:ptsrc-31', kind: 'IN_PULL', compatibility: { pull_task_source_id: 31, pull_task_id: 9, external_source_id: 7 } },
  { id: 'source:in_pull:ptsrc-7', kind: 'IN_PULL', compatibility: { pull_task_source_id: 7, pull_task_id: 8, external_source_id: 999 } }
];

const CREDENTIAL_RESPONSE = {
  credential: { id: 5, label: '向导凭据' },
  token: 'tok_abc123',
  server_url: 'rtmp://srs.example/live',
  stream_key: '任意社会学?ingest_token=tok_abc123',
  publish_url: 'rtmp://srs.example/live/任意社会学?ingest_token=tok_abc123'
};

function okApi(overrides = {}) {
  return {
    post: vi.fn(async (path, body) => {
      if (path === '/streams') return { stream: { id: 42, name: body.name } };
      if (path.endsWith('/ingest-credentials')) return { ...CREDENTIAL_RESPONSE };
      if (path === '/external-sources') return { id: 7, ...body };
      if (path === '/pull-tasks') return { id: 9, stream_id: 42, sources: [{ id: 31, external_source_id: 7, priority: 1, enabled: 1 }] };
      if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs')) {
        // Real backend shapes: PUSH/RECORD answer {task, rendition}; SERVE answers with its own id.
        if (body?.mode === 'SERVE') return { output: { id: `output:serve:42` } };
        return { output: { task: { id: body?.mode === 'RECORD' ? 51 : 50 }, rendition: null } };
      }
      if (path.endsWith('/run-plans')) return { run_plan: { id: 3 } };
      if (path.endsWith('/sessions')) return { session: { id: 11 } };
      if (path.includes('/preflight')) return { status: 'READY' };
      return {};
    }),
    get: vi.fn(async path => {
      if (path === '/streams') return [{ id: 42, name: '任意社会学' }];
      if (path.endsWith('/ingest-credentials')) return { credentials: [] };
      if (path === '/external-sources') return [{ id: 999, name: '同名但键不同的源', protocol: 'rtmp', source_url_masked: 'rtmp://***' }];
      if (path === '/pull-tasks') return [];
      if (path.endsWith('/workspace')) return { sources: WORKSPACE_SOURCES, outputs: [] };
      if (path.endsWith('/run-plans')) return { run_plans: [] };
      return {};
    }),
    ...overrides
  };
}

describe('creation journal happy path', () => {
  it('runs the full sequence in order and records every id', async () => {
    const api = okApi();
    const journal = await runRoomCreation({ journal: newJournal(), intent, api });
    expect(journal.stream_id).toBe(42);
    expect(journal.source_id).toBe(7);
    expect(journal.pull_task_id).toBe(9);
    expect(journal.pull_task_source_id).toBe(31);
    expect(journal.output_ids).toEqual(['output:push:50', 'output:record:51']);
    expect(journal.run_plan_id).toBe('3');
    expect(journal.session_id).toBe(11);
    const postPaths = api.post.mock.calls.map(call => call[0]);
    expect(postPaths[0]).toBe('/streams');
    expect(postPaths).toContain('/external-sources');
    expect(postPaths).toContain('/pull-tasks');
    expect(postPaths).toContain('/v3/rooms/room:42/outputs');
    expect(postPaths).toContain('/v3/rooms/room:42/run-plans');
    expect(postPaths).toContain('/v3/rooms/room:42/sessions');
    expect(postPaths).toContain('/v3/sessions/11/preflight');
    const planBody = api.post.mock.calls.find(call => call[0].endsWith('/run-plans'))[1];
    // ptsrc id (31), never the external_sources id (7) — decoy source excluded.
    expect(planBody.program_source_id).toBe('source:in_pull:ptsrc-31');
    expect(planBody.outputs).toEqual([
      { output_ref: 'output:push:50', importance: 'REQUIRED', auto_start: true, sort_order: 10 },
      { output_ref: 'output:record:51', importance: 'REQUIRED', auto_start: true, sort_order: 20 }
    ]);
  });

  it('allows zero-output monitoring rooms (empty run plan outputs)', async () => {
    const api = okApi();
    const journal = await runRoomCreation({
      journal: newJournal(),
      intent: { ...intent, outputs: [] },
      api
    });
    const planBody = api.post.mock.calls.find(call => call[0].endsWith('/run-plans'))[1];
    expect(planBody.outputs).toEqual([]);
    expect(journal.output_ids).toEqual([]);
  });

  it('never touches ingest credentials for IN_PULL rooms', async () => {
    const api = okApi();
    await runRoomCreation({ journal: newJournal(), intent, api });
    expect(api.post.mock.calls.some(call => call[0].endsWith('/ingest-credentials'))).toBe(false);
  });
});

describe('one-time ingest credential (IN_PUSH)', () => {
  it('issues exactly one credential and captures the one-time display payload', async () => {
    const api = okApi();
    const journal = await runRoomCreation({ journal: newJournal(), intent: pushIntent, api });
    expect(journal.credential_id).toBe(5);
    expect(journal.credential_display).toEqual({
      token: 'tok_abc123',
      server_url: 'rtmp://srs.example/live',
      stream_key: '任意社会学?ingest_token=tok_abc123',
      publish_url: 'rtmp://srs.example/live/任意社会学?ingest_token=tok_abc123'
    });
    expect(journal.credential_recovered).toBe(false);
    expect(journal.steps.credential.status).toBe('done');
    expect(api.post.mock.calls.filter(call => call[0].endsWith('/ingest-credentials'))).toHaveLength(1);
    // The backend rejects label-less creates with 400 V3_INGEST_VALIDATION —
    // the journal must always send the wizard-derived label.
    const credentialCall = api.post.mock.calls.find(call => call[0].endsWith('/ingest-credentials'));
    expect(credentialCall[1]).toEqual({ label: 'wizard-任意社会学' });
  });

  it('refuses to POST a credential when the wizard intent carries no label', async () => {
    const api = okApi();
    const result = await runRoomCreation({ journal: newJournal(), intent: { ...pushIntent, credentialLabel: '' }, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('credential');
    expect(api.post.mock.calls.some(call => call[0].endsWith('/ingest-credentials'))).toBe(false);
  });

  it('adopts the already-issued credential when the create response is lost — no second issuance, no token re-exposure', async () => {
    let committed = false;
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/ingest-credentials')) {
          if (!committed) {
            committed = true; // server committed, response never arrived
            throw new Error('network lost after server accepted the POST');
          }
          throw new Error('must not issue a second credential');
        }
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/ingest-credentials')) {
          return committed
            ? { credentials: [{ id: 5, status: 'ACTIVE', token_hint: 'bc123' }] }
            : { credentials: [] };
        }
        return okApi().get(path);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent: pushIntent, api });
    expect(journal.credential_id).toBe(5);
    expect(journal.credential_recovered).toBe(true);
    expect(journal.credential_display).toBeNull();
    expect(api.post.mock.calls.filter(call => call[0].endsWith('/ingest-credentials'))).toHaveLength(1);
  });

  it('interrupts at credential when the server is unreachable, then adopts on retry without re-issuing', async () => {
    let serverBack = false;
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/ingest-credentials') && !serverBack) throw new Error('connection refused');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/ingest-credentials')) {
          return serverBack
            ? { credentials: [{ id: 5, status: 'ACTIVE', token_hint: 'bc123' }] }
            : { credentials: [] };
        }
        return okApi().get(path);
      })
    });
    const first = await runRoomCreation({ journal: newJournal(), intent: pushIntent, api }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('credential');
    expect(first.journal.stream_id).toBe(42);

    serverBack = true;
    api.post.mockClear();
    const journal = await runRoomCreation({ journal: first.journal, intent: pushIntent, api });
    expect(journal.credential_id).toBe(5);
    expect(journal.credential_recovered).toBe(true);
    // The retry adopted the existing credential — no credential was re-issued.
    expect(api.post.mock.calls.filter(call => call[0].endsWith('/ingest-credentials'))).toHaveLength(0);
  });
});

describe('external source recovery via Idempotency-Key', () => {
  it('replays the same key after a lost response instead of reconciling by name', async () => {
    let committed = false;
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path === '/external-sources') {
          if (!committed) {
            committed = true; // server committed the insert, response never arrived
            throw new Error('response lost');
          }
          return { id: 7, idempotent_replay: true, name: body.name };
        }
        return okApi().post(path, body, options);
      })
    });
    const first = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('source');
    const key = first.journal.source_idempotency_key;
    expect(key).toMatch(/^wizard-external-source-/);

    const journal = await runRoomCreation({ journal: first.journal, intent, api });
    expect(journal.source_id).toBe(7);
    const calls = api.post.mock.calls.filter(call => call[0] === '/external-sources');
    expect(calls).toHaveLength(2);
    expect(calls[0][2]?.headers?.['Idempotency-Key']).toBe(key);
    expect(calls[1][2]?.headers?.['Idempotency-Key']).toBe(key);
    // Bare-name reconcile is gone: the client never lists external sources to
    // match by name, so the same-name fixture (id 999) can never be adopted.
    expect(api.get).not.toHaveBeenCalledWith('/external-sources');
    expect(journal.source_id).not.toBe(999);
  });
});

describe('creation journal recovery (retry only unfinished steps)', () => {
  it('does not replay finished steps after an output failure', async () => {
    let failSecondOutput = true;
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs') && body?.mode === 'RECORD' && failSecondOutput) {
          const error = new Error('network lost');
          throw error;
        }
        return okApi().post(path, body, options);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(journal).toBeInstanceOf(CreationInterrupted);
    expect(journal.step).toBe('output:1');
    expect(journal.journal.stream_id).toBe(42);
    expect(journal.journal.output_ids[0]).toBe('output:push:50');
    expect(journal.journal.output_ids[1]).toBeUndefined();

    failSecondOutput = false;
    api.post.mockClear();
    const recovered = await runRoomCreation({ journal: journal.journal, intent, api });
    const postPaths = api.post.mock.calls.map(call => call[0]);
    expect(postPaths).not.toContain('/streams');
    expect(postPaths).not.toContain('/external-sources');
    expect(postPaths).not.toContain('/pull-tasks');
    expect(postPaths.filter(path => path.endsWith('/outputs'))).toHaveLength(1);
    expect(recovered.output_ids[1]).toBe('output:record:51');
    expect(recovered.session_id).toBe(11);
  });

  it('reconciles a stream lost to a network failure by unique name', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path === '/streams') throw new Error('connection reset');
        return okApi().post(path, body, options);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent, api });
    expect(journal.stream_id).toBe(42);
    expect(api.get).toHaveBeenCalledWith('/streams');
    expect(journal.steps.stream.status).toBe('done');
  });

  it('recovers a lost output response by replaying the SAME Idempotency-Key, never by workspace listing', async () => {
    let lostFirst = true;
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs') && body?.mode === 'PUSH' && lostFirst) {
          lostFirst = false;
          throw new Error('timeout');
        }
        return okApi().post(path, body, options);
      })
    });
    const first = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('output:0');
    expect(first.journal.output_ids[0]).toBeUndefined();
    const key = first.journal.output_idempotency_keys[0];
    expect(key).toMatch(/^wizard-output-0-/);

    api.post.mockClear();
    const journal = await runRoomCreation({ journal: first.journal, intent, api });
    // The retry re-POSTs the identical request under the identical key — the
    // server replays the first creation.
    const outputCalls = api.post.mock.calls.filter(call => call[0].endsWith('/outputs'));
    expect(outputCalls).toHaveLength(2); // index 0 (replay) + index 1 (first try)
    expect(outputCalls[0][2]?.headers?.['Idempotency-Key']).toBe(key);
    expect(journal.output_ids[0]).toBe('output:push:50');
    expect(journal.output_ids[1]).toBe('output:record:51');
  });

  it('never adopts a similar workspace output: same name+mode+scene is NOT this journal\'s output', async () => {
    // FIX-04: the name+mode+scene workspace guess is gone. A request that
    // never reached the server stays interrupted even when the workspace
    // contains an output an old weak fingerprint would have matched.
    const api = okApi({
      post: vi.fn(async (path, body) => {
        if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs') && body?.mode === 'PUSH') throw new Error('request never reached the server');
        return okApi().post(path, body);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/workspace')) {
          return {
            sources: WORKSPACE_SOURCES,
            outputs: [
              { id: 'output:push:88', name: '我们推给第三方 1', mode: 'PUSH', scene: 'LIVE_PLATFORM_PUSH' },
              { id: 'output:push:89', name: '名字相同但方向不同', mode: 'SERVE', scene: 'PARTNER_PULL' }
            ]
          };
        }
        return okApi().get(path);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('output:0');
    expect(result.journal.output_ids[0]).toBeUndefined();
  });

  it('reconciles a duplicated pull task and a conflicted run plan by fingerprint', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path === '/pull-tasks') throw new Error('already exists');
        if (path.endsWith('/run-plans')) throw new Error('conflict');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path === '/pull-tasks') return [{
          id: 13,
          stream_id: 42,
          external_source_id: 7,
          sources: [{ id: 47, external_source_id: 7, priority: 1, enabled: 1 }]
        }];
        if (path.endsWith('/run-plans')) {
          // FIX-03: run_plans.name is not unique — adoption requires the FULL
          // intent fingerprint (name + program source + ordered outputs), not
          // the bare name this row would have matched before.
          return {
            run_plans: [{
              id: 5,
              name: '任意社会学',
              program_source_id: 'source:in_pull:ptsrc-47',
              failover_source_ids: [],
              outputs: [
                { output_ref: 'output:push:50', importance: 'REQUIRED', auto_start: true, sort_order: 10 },
                { output_ref: 'output:record:51', importance: 'REQUIRED', auto_start: true, sort_order: 20 }
              ]
            }]
          };
        }
        if (path.endsWith('/workspace')) {
          return {
            sources: [{ id: 'source:in_pull:ptsrc-47', kind: 'IN_PULL', compatibility: { pull_task_source_id: 47, pull_task_id: 13, external_source_id: 7 } }],
            outputs: []
          };
        }
        return okApi().get(path);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent, api });
    expect(journal.pull_task_id).toBe(13);
    expect(journal.pull_task_source_id).toBe(47);
    expect(journal.run_plan_id).toBe('5');
    expect(journal.steps['pull-task'].status).toBe('done');
    expect(journal.steps['run-plan'].status).toBe('done');
    const planBody = api.post.mock.calls.find(call => call[0].endsWith('/run-plans'))[1];
    expect(planBody.program_source_id).toBe('source:in_pull:ptsrc-47');
  });

  it('never adopts a same-name run plan whose outputs differ (name is not unique)', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/run-plans')) throw new Error('response lost');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/run-plans')) {
          return {
            run_plans: [{
              id: 5,
              name: '任意社会学',
              program_source_id: 'source:in_pull:ptsrc-31',
              failover_source_ids: [],
              // Same name, but only one of the two outputs — an older plan,
              // not the one this journal just attempted to create.
              outputs: [
                { output_ref: 'output:push:50', importance: 'REQUIRED', auto_start: true, sort_order: 10 }
              ]
            }]
          };
        }
        return okApi().get(path);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('run-plan');
    expect(result.journal.run_plan_id).toBeNull();
  });

  it('never adopts a same-name run plan carrying failover sources', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/run-plans')) throw new Error('response lost');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/run-plans')) {
          return {
            run_plans: [{
              id: 6,
              name: '任意社会学',
              program_source_id: 'source:in_pull:ptsrc-31',
              // The wizard never sends failover — a plan that has one was
              // created by someone else's intent.
              failover_source_ids: ['source:in_pull:ptsrc-99'],
              outputs: [
                { output_ref: 'output:push:50', importance: 'REQUIRED', auto_start: true, sort_order: 10 },
                { output_ref: 'output:record:51', importance: 'REQUIRED', auto_start: true, sort_order: 20 }
              ]
            }]
          };
        }
        return okApi().get(path);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('run-plan');
  });

  it('adopts the fingerprint-identical run plan after a lost response without re-creating', async () => {
    const serverPlan = {
      id: 5,
      name: '任意社会学',
      program_source_id: 'source:in_pull:ptsrc-31',
      failover_source_ids: [],
      outputs: [
        { output_ref: 'output:push:50', importance: 'REQUIRED', auto_start: true, sort_order: 10 },
        { output_ref: 'output:record:51', importance: 'REQUIRED', auto_start: true, sort_order: 20 }
      ]
    };
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/run-plans')) throw new Error('network lost after the server committed the plan');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/run-plans')) return { run_plans: [serverPlan] };
        return okApi().get(path);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent, api });
    expect(journal.run_plan_id).toBe('5');
    expect(journal.steps['run-plan'].status).toBe('done');
    // Exactly one POST — the lost one; the recovery adopted, never re-created.
    expect(api.post.mock.calls.filter(call => call[0].endsWith('/run-plans'))).toHaveLength(1);
    expect(journal.session_id).toBe(11);
  });

  it('falls back to an IN_PUSH program source after issuing its credential', async () => {
    const api = okApi({
      get: vi.fn(async path => {
        if (path.endsWith('/workspace')) return { sources: [{ id: 'source:in_push:legacy-42', kind: 'IN_PUSH' }], outputs: [] };
        if (path.endsWith('/run-plans')) return { run_plans: [] };
        return okApi().get(path);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent: pushIntent, api });
    const planBody = api.post.mock.calls.find(call => call[0].endsWith('/run-plans'))[1];
    expect(planBody.program_source_id).toBe('source:in_push:legacy-42');
    expect(journal.source_id).toBeNull();
    expect(journal.pull_task_id).toBeNull();
    expect(journal.credential_id).toBe(5);
    expect(journal.credential_display?.token).toBe('tok_abc123');
  });

  it('surfaces session interruption without throwing raw', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/sessions')) throw new Error('会话冲突');
        return okApi().post(path, body, options);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('session');
    expect(result.journal.run_plan_id).toBe('3');
  });

  it('recovers a lost session response in-run: adopt, preflight continues, exactly one session POST', async () => {
    const committed = { id: 17, stream_id: 42, run_plan_id: 3, title: '任意社会学', lifecycle_state: 'PREP' };
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/sessions')) {
          // Server committed the session, the response never arrived.
          throw new Error('network lost after the server accepted the POST');
        }
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/sessions')) return { sessions: [committed] };
        return okApi().get(path);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent, api });
    expect(journal.session_id).toBe(17);
    expect(journal.steps.session.status).toBe('done');
    expect(api.post.mock.calls.filter(call => call[0].endsWith('/sessions'))).toHaveLength(1);
    // Preflight ran on the adopted session — the chain was never stuck.
    expect(api.post).toHaveBeenCalledWith('/v3/sessions/17/preflight', { mark_ready: true });
  });

  it('breaks the 409 retry deadlock: session exists from a lost run, retry reconciles instead of failing forever', async () => {
    // First run: the server created the session but BOTH the create response
    // and the recovery GET were lost — journal interrupts at 'session'.
    const committed = { id: 17, stream_id: 42, run_plan_id: 3, title: '任意社会学', lifecycle_state: 'PREP' };
    let sessionGetLost = true;
    const firstApi = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/sessions')) throw new Error('network lost');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/sessions') && sessionGetLost) throw new Error('network lost');
        if (path.endsWith('/sessions')) return { sessions: [committed] };
        return okApi().get(path);
      })
    });
    const first = await runRoomCreation({ journal: newJournal(), intent, api: firstApi }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('session');
    expect(first.journal.session_id).toBeNull();

    // Retry: POST now answers the server's real 409 (active session exists) —
    // the old code failed here forever; the reconcile adopts and continues.
    sessionGetLost = false;
    const conflict = new Error('Request failed with status code 409');
    conflict.status = 409;
    conflict.body = { code: 'V3_SESSION_CREATE_CONFLICT', message: 'An active Session already exists for this Room' };
    const retryApi = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/sessions')) throw conflict;
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/sessions')) return { sessions: [committed] };
        return okApi().get(path);
      })
    });
    const journal = await runRoomCreation({ journal: first.journal, intent, api: retryApi });
    expect(journal.session_id).toBe(17);
    expect(journal.steps.session.status).toBe('done');
    expect(retryApi.post).toHaveBeenCalledWith('/v3/sessions/17/preflight', { mark_ready: true });
  });

  it('reports a real conflict when the active session does not match the intent', async () => {
    // Someone else's active session: same room, wrong run plan and title.
    const foreign = { id: 23, stream_id: 42, run_plan_id: 999, title: '别人的会话', lifecycle_state: 'PREP' };
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/sessions')) {
          const error = new Error('Request failed with status code 409');
          error.status = 409;
          error.body = { code: 'V3_SESSION_CREATE_CONFLICT', message: 'An active Session already exists for this Room' };
          throw error;
        }
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/sessions')) return { sessions: [foreign] };
        return okApi().get(path);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('session');
    expect(result.journal.session_id).toBeNull();
    expect(result.journal.run_plan_id).toBe('3');
  });

  it('never adopts an ON_AIR session even when room, run plan and title all match', async () => {
    const onAir = { id: 17, stream_id: 42, run_plan_id: 3, title: '任意社会学', lifecycle_state: 'ON_AIR' };
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/sessions')) throw new Error('network lost');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/sessions')) return { sessions: [onAir] };
        return okApi().get(path);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('session');
    expect(result.journal.session_id).toBeNull();
  });

  it('surfaces a taken name as a first-attempt error instead of adopting it', async () => {
    const conflict = new Error('Stream already exists');
    conflict.status = 409;
    const api = okApi({ post: vi.fn(async (path, body, options) => {
      if (path === '/streams') throw conflict;
      return okApi().post(path, body, options);
    }) });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('stream');
    expect(result.journal.stream_id).toBeNull();
  });

  it('recovers a lost output response even while every workspace read fails (Idempotency-Key only)', async () => {
    // FIX-04 negative D at the unit level: output recovery must not depend on
    // GET /workspace at all — the retry replays the stable key instead.
    let lostPushPost = true;
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs') && body?.mode === 'PUSH' && lostPushPost) {
          lostPushPost = false;
          throw new Error('timeout');
        }
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => {
        if (path.endsWith('/workspace')) throw new Error('workspace read failed');
        return okApi().get(path);
      })
    });
    const first = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('output:0');
    const journal = await runRoomCreation({ journal: first.journal, intent, api });
    expect(journal.output_ids[0]).toBe('output:push:50');
    expect(journal.output_ids[1]).toBe('output:record:51');
  });

  it('rejects malformed create responses instead of recording fake ids', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path === '/external-sources') return {};
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => (path.endsWith('/run-plans') ? { run_plans: [] } : []))
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('source');
    expect(result.journal.source_id).toBeNull();
  });
});

describe('preflight is a journaled, retryable step', () => {
  function blockedError() {
    const error = new Error('Request failed with status code 409');
    error.status = 409;
    error.body = {
      session_id: 11,
      status: 'BLOCKED',
      summary: { blockers: 2, warnings: 0 },
      checks: [{ id: 'outputs', status: 'BLOCKED' }]
    };
    return error;
  }

  it('records a BLOCKED preflight (HTTP 409 body) and retries preflight alone', async () => {
    let mode = 'blocked';
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.includes('/preflight')) {
          if (mode === 'blocked') throw blockedError();
          return { status: 'READY' };
        }
        return okApi().post(path, body, options);
      })
    });
    const first = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('preflight');
    // Everything before preflight survived — retry must not rebuild any of it.
    expect(first.journal.session_id).toBe(11);
    expect(first.journal.output_ids).toEqual(['output:push:50', 'output:record:51']);
    expect(first.journal.preflight).toMatchObject({ status: 'BLOCKED' });
    expect(first.journal.preflight.summary).toEqual({ blockers: 2, warnings: 0 });
    expect(first.journal.steps.preflight.status).toBeUndefined();

    mode = 'ready';
    api.post.mockClear();
    const journal = await runRoomCreation({ journal: first.journal, intent, api });
    expect(api.post.mock.calls.map(call => call[0])).toEqual(['/v3/sessions/11/preflight']);
    expect(journal.preflight.status).toBe('READY');
    expect(journal.steps.preflight.status).toBe('done');
  });

  it('keeps a network-failed preflight interruptible with no fake status', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.includes('/preflight')) throw new Error('connection reset');
        return okApi().post(path, body, options);
      })
    });
    const result = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(result).toBeInstanceOf(CreationInterrupted);
    expect(result.step).toBe('preflight');
    expect(result.journal.preflight).toBeNull();
    expect(result.journal.session_id).toBe(11);
  });

  it('completes with READY_WITH_WARNING recorded, not swallowed', async () => {
    const api = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.includes('/preflight')) {
          return { status: 'READY_WITH_WARNING', summary: { blockers: 0, warnings: 1 }, checks: [] };
        }
        return okApi().post(path, body, options);
      })
    });
    const journal = await runRoomCreation({ journal: newJournal(), intent, api });
    expect(journal.preflight.status).toBe('READY_WITH_WARNING');
    expect(journal.steps.preflight.status).toBe('done');
  });

  it('interrupts each remaining failure path with its own step name', async () => {
    // stream network failure whose name reconcile finds nothing
    const streamMiss = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path === '/streams') throw new Error('connection reset');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => (path === '/streams' ? [{ id: 77, name: '别人的直播间' }] : okApi().get(path)))
    });
    const streamResult = await runRoomCreation({ journal: newJournal(), intent, api: streamMiss }).catch(error => error);
    expect(streamResult).toBeInstanceOf(CreationInterrupted);
    expect(streamResult.step).toBe('stream');

    // pull task failure with no adoptable task
    const pullMiss = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path === '/pull-tasks') throw new Error('boom');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => (path === '/pull-tasks' ? [] : okApi().get(path)))
    });
    const pullResult = await runRoomCreation({ journal: newJournal(), intent, api: pullMiss }).catch(error => error);
    expect(pullResult.step).toBe('pull-task');

    // run plan failure whose name reconcile finds nothing
    const planMiss = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.endsWith('/run-plans')) throw new Error('boom');
        return okApi().post(path, body, options);
      }),
      get: vi.fn(async path => (path.endsWith('/run-plans') ? { run_plans: [{ id: 8, name: '别的方案' }] } : okApi().get(path)))
    });
    const planResult = await runRoomCreation({ journal: newJournal(), intent, api: planMiss }).catch(error => error);
    expect(planResult.step).toBe('run-plan');

    // output creation answering an unusable body (no id and no task)
    const outputMiss = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs') && body?.mode === 'PUSH') return { output: {} };
        return okApi().post(path, body, options);
      })
    });
    const outputResult = await runRoomCreation({ journal: newJournal(), intent, api: outputMiss }).catch(error => error);
    expect(outputResult.step).toBe('output:0');

    // preflight answering 200 with a BLOCKED evaluation body
    const preflightBlocked200 = okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.includes('/preflight')) return { status: 'BLOCKED', summary: { blockers: 1, warnings: 0 }, checks: [] };
        return okApi().post(path, body, options);
      })
    });
    const preflightResult = await runRoomCreation({ journal: newJournal(), intent, api: preflightBlocked200 }).catch(error => error);
    expect(preflightResult.step).toBe('preflight');
    expect(preflightResult.journal.preflight.status).toBe('BLOCKED');
  });
});

describe('creation intent freeze (FIX-04: old journal never carries a new intent)', () => {
  function failingOutputsApi() {
    let fail = true;
    return okApi({
      post: vi.fn(async (path, body, options) => {
        if (path.startsWith('/v3/rooms/') && path.endsWith('/outputs') && fail) {
          fail = false;
          throw new Error('network lost after the server accepted the POST');
        }
        return okApi().post(path, body, options);
      })
    });
  }

  it('freezes the intent on the first submit; a mutated retry replays the snapshot verbatim', async () => {
    const api = failingOutputsApi();
    const first = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    expect(first).toBeInstanceOf(CreationInterrupted);
    expect(first.step).toBe('output:0');
    // stream + source committed before the interruption
    expect(first.journal.stream_id).toBe(42);
    expect(first.journal.source_id).toBe(7);

    // The user edits the form after the failure: new room name, a rewritten
    // push payload (different target), even a different input direction.
    const mutated = JSON.parse(JSON.stringify(intent));
    mutated.name = '改名之后';
    mutated.inputDirection = 'IN_PUSH';
    mutated.pullSource = null;
    mutated.outputs[0].payload = {
      ...mutated.outputs[0].payload,
      destination: { kind: 'CUSTOM', label: '我们推给第三方 1', target_url: 'rtmp://evil.example/live/different' }
    };

    api.post.mockClear();
    const journal = await runRoomCreation({ journal: first.journal, intent: mutated, api });

    // The frozen snapshot wins everywhere:
    const outputCall = api.post.mock.calls.find(call => call[0].endsWith('/outputs'));
    expect(outputCall[1]).toEqual(first.journal.creation_intent_snapshot.outputs[0].payload);
    expect(outputCall[1].destination).toBeUndefined();
    const sessionCall = api.post.mock.calls.find(call => call[0].endsWith('/sessions'));
    expect(sessionCall[1].title).toBe('任意社会学');
    // A mutated IN_PUSH direction must not issue a credential on the old journal
    expect(api.post.mock.calls.some(call => call[0].endsWith('/ingest-credentials'))).toBe(false);
    expect(journal.creation_intent_snapshot.name).toBe('任意社会学');
    expect(journal.output_ids[0]).toBe('output:push:50');
  });

  it('deep-mutating the original intent object after the freeze leaves the snapshot untouched', async () => {
    const live = JSON.parse(JSON.stringify(intent));
    const api = failingOutputsApi();
    const first = await runRoomCreation({ journal: newJournal(), intent: live, api }).catch(error => error);
    expect(first.step).toBe('output:0');
    // Mutate the SAME nested objects the journal seemingly captured
    live.outputs[0].payload.scene = 'CDN_PUSH';
    live.pullSource.source_url = 'rtmp://mutated.example/live/in';
    const journal = await runRoomCreation({ journal: first.journal, intent: live, api });
    const outputCall = api.post.mock.calls.find(call => call[0].endsWith('/outputs'));
    expect(outputCall[1].scene).toBe('LIVE_PLATFORM_PUSH');
    expect(journal.creation_intent_snapshot.pullSource.source_url).toBe('rtmp://up.example/live/a');
  });

  it('an unchanged retry reuses the frozen snapshot and never rebuilds finished steps', async () => {
    const api = failingOutputsApi();
    const first = await runRoomCreation({ journal: newJournal(), intent, api }).catch(error => error);
    const snapshotBefore = first.journal.creation_intent_snapshot;
    api.post.mockClear();
    const journal = await runRoomCreation({ journal: first.journal, intent, api });
    expect(journal.creation_intent_snapshot).toBe(snapshotBefore);
    const paths = api.post.mock.calls.map(call => call[0]);
    expect(paths).not.toContain('/streams');
    expect(paths).not.toContain('/external-sources');
    expect(paths).not.toContain('/pull-tasks');
    expect(journal.steps.stream.attempts).toBe(1);
    expect(journal.steps.source.attempts).toBe(1);
  });
});
