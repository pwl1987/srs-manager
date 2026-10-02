import { describe, expect, it, vi } from 'vitest';
import { newJournal, CreationInterrupted } from './create-room-journal';
import {
  applySceneChoice,
  buildWizardIntent,
  buildWizardOutputIntents,
  handleListKeyDown,
  makeSceneLabeler,
  nextSelectedRoomId,
  outputName,
  patchSceneInForm,
  runWizardSubmit,
  sceneChoiceDefaults,
  submitWizard,
  toggleSceneInForm,
  wizardCompletionMode,
  wizardCredentialLabel,
  wizardStepValid
} from './wizard-flow';

const labelFor = sceneId => ({ LOCAL_RECORD: '本地输出', LIVE_PLATFORM_PUSH: '我们推给第三方', PARTNER_PULL: '第三方拉我们的输出' }[sceneId] || sceneId);

// Mirrors GET /v3/output/scenes (backend SCENES contract) — the wizard must
// take semantics from here, never redefine them.
const SERVER_SCENES = {
  LOCAL_RECORD: { id: 'LOCAL_RECORD', mode: 'RECORD', formats: ['mp4', 'ts', 'audio'], default_format: 'mp4', default_protection: 'storage-policy' },
  LIVE_PLATFORM_PUSH: { id: 'LIVE_PLATFORM_PUSH', mode: 'PUSH', transports: ['rtmp', 'rtmps'], default_transport: 'rtmp', default_protection: 'none' },
  PARTNER_PULL: { id: 'PARTNER_PULL', mode: 'SERVE', transports: ['rtmp', 'http-flv'], endpoint_protections: { rtmp: 'access-grant', 'http-flv': 'access-grant' } }
};
const scenesById = SERVER_SCENES;

const form = {
  name: '任意社会学',
  remark: ' 晚间场 ',
  businessUnit: '新闻中心',
  protocol: 'rtmp',
  inputDirection: 'IN_PULL',
  pullSource: { name: '合作方演播室', source_url: 'rtmp://up/live/a', protocol: 'rtmp' },
  outputs: [{ sceneId: 'LOCAL_RECORD' }, { sceneId: 'LIVE_PLATFORM_PUSH', target_url: 'rtmp://cdn/live/x' }],
  createRunPlan: true
};

describe('wizard step gating', () => {
  it('gates each step by the frozen rules', () => {
    expect(wizardStepValid({ name: '  ' }, 0)).toBe(false);
    expect(wizardStepValid({ name: '任意社会学' }, 0)).toBe(true);
    expect(wizardStepValid({ inputDirection: 'BAD' }, 1)).toBe(false);
    expect(wizardStepValid({ inputDirection: 'IN_PUSH' }, 2)).toBe(true);
    expect(wizardStepValid({ inputDirection: 'IN_PULL', pullSource: { name: '', source_url: '' } }, 2)).toBe(false);
    expect(wizardStepValid({ inputDirection: 'IN_PULL', pullSource: { name: 'a', source_url: 'rtmp://x' } }, 2)).toBe(true);
    expect(wizardStepValid({ outputs: [{ sceneId: 'LIVE_PLATFORM_PUSH', target_url: ' ' }] }, 3)).toBe(false);
    expect(wizardStepValid({ outputs: [{ sceneId: 'PARTNER_PULL' }] }, 3)).toBe(true);
    expect(wizardStepValid({}, 4)).toBe(true);
  });

  it('names outputs from the unified direction labels', () => {
    expect(outputName('LOCAL_RECORD', 0, labelFor('LOCAL_RECORD'))).toBe('本地输出 1');
    expect(outputName('LIVE_PLATFORM_PUSH', 1, labelFor('LIVE_PLATFORM_PUSH'))).toBe('我们推给第三方 2');
  });

  it('labels scenes through the shared labeler with a fallback', () => {
    const labeler = makeSceneLabeler(key => key);
    expect(labeler('PARTNER_PULL')).toBe('streams:directions.outPull.label');
    expect(labeler('UNKNOWN_SCENE')).toBe('streams:liveOps.create');
  });
});

describe('wizard intent building', () => {
  it('trims identity fields and keeps pull source only for IN_PULL', () => {
    const intents = buildWizardOutputIntents(form, labelFor, scenesById);
    const intent = buildWizardIntent(form, intents);
    expect(intent.name).toBe('任意社会学');
    expect(intent.remark).toBe('晚间场');
    expect(intent.businessUnit).toBe('新闻中心');
    expect(intent.pullSource).toEqual(form.pullSource);
    expect(intent.outputs).toHaveLength(2);
    expect(intent.outputs[0].payload.mode).toBe('RECORD');
    expect(intent.outputs[0].payload.format).toBe('mp4');
    expect(intent.outputs[1].payload.mode).toBe('PUSH');
    expect(intent.outputs[1].payload.transport).toBe('rtmp');
    expect(intent.outputs[1].payload.destination.target_url).toBe('rtmp://cdn/live/x');

    const pushOnly = buildWizardIntent({ ...form, inputDirection: 'IN_PUSH' }, []);
    expect(pushOnly.pullSource).toBeNull();
    expect(pushOnly.outputs).toEqual([]);
  });

  it('derives a deterministic IN_PUSH credential label from the room name', () => {
    const pushIntent = buildWizardIntent({ ...form, inputDirection: 'IN_PUSH' }, []);
    expect(pushIntent.credentialLabel).toBe('wizard-任意社会学');
    // IN_PULL rooms never carry a credential label — they never issue one.
    expect(buildWizardIntent(form, []).credentialLabel).toBeNull();
    // Deterministic across retries of the same run, collapsed whitespace, capped.
    expect(wizardCredentialLabel('任意 社会学')).toBe(wizardCredentialLabel('任意  社会学'));
    expect(wizardCredentialLabel('x'.repeat(200))).toHaveLength(80);
    expect(wizardCredentialLabel('   ')).toBe('');
  });

  it('builds PARTNER_PULL from the server scene contract (rtmp + http-flv, never hls)', () => {
    const partner = { ...form, outputs: [{ sceneId: 'PARTNER_PULL' }] };
    const [intent] = buildWizardOutputIntents(partner, labelFor, scenesById);
    expect(intent.mode).toBe('SERVE');
    expect(intent.payload).toMatchObject({
      mode: 'SERVE',
      scene: 'PARTNER_PULL',
      transports: ['rtmp', 'http-flv'],
      consumer: { label: '第三方拉我们的输出 1' }
    });
    // Endpoint protections come from the backend scene defaults
    // (access-grant), not from a client-side redefinition.
    expect(intent.payload.endpoint_protections).toBeUndefined();
  });

  it('refuses to build payloads for scenes the server did not return', () => {
    expect(() => buildWizardOutputIntents(
      { ...form, outputs: [{ sceneId: 'PARTNER_PULL' }] },
      labelFor,
      { LOCAL_RECORD: SERVER_SCENES.LOCAL_RECORD }
    )).toThrowError(/PARTNER_PULL/);

    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    return runWizardSubmit({
      journal: newJournal(),
      form: { ...form, outputs: [{ sceneId: 'GHOST_SCENE' }] },
      labelFor,
      scenesById: {},
      apiClient: { post: vi.fn(), get: vi.fn() },
      notify,
      t: key => key
    }).then(result => {
      expect(result.ok).toBe(false);
      expect(result.failure.step).toBe('outputs');
      expect(notify.error).toHaveBeenCalledWith('streams:wizard.scenesUnavailable');
    });
  });
});

describe('wizard submit orchestration', () => {
  function apiOk() {
    return {
      post: vi.fn(async (path, body) => {
        if (path === '/streams') return { stream: { id: 42 } };
        if (path.endsWith('/ingest-credentials')) return { credential: { id: 5 }, token: 'tok', publish_url: 'rtmp://srs/live' };
        if (path === '/external-sources') return { id: 7 };
        if (path === '/pull-tasks') return { id: 9, sources: [{ id: 31, external_source_id: 7 }] };
        if (path.endsWith('/outputs')) return { output: { id: `output:${Math.random()}` } };
        if (path.endsWith('/run-plans')) return { run_plan: { id: 3 } };
        if (path.endsWith('/sessions')) return { session: { id: 11 } };
        if (path.includes('/preflight')) return { status: 'READY' };
        return {};
      }),
      get: vi.fn(async () => ({ run_plans: [], outputs: [], sources: [{ id: 'source:in_pull:ptsrc-31', kind: 'IN_PULL', compatibility: { pull_task_source_id: 31, pull_task_id: 9, external_source_id: 7 } }] }))
    };
  }

  it('returns ok with the created stream id on success', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const journal = newJournal();
    const result = await runWizardSubmit({ journal, form, labelFor, scenesById, apiClient: apiOk(), notify, t: key => key });
    expect(result.ok).toBe(true);
    expect(result.streamId).toBe(42);
    expect(journal.stream_id).toBe(42);
    expect(notify.success).toHaveBeenCalledWith('streams:wizard.success');
  });

  it('returns a structured failure and keeps the journal for retry', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const api = apiOk();
    api.post.mockImplementation(async path => {
      if (path === '/streams') throw new Error('connection reset');
      return {};
    });
    const journal = newJournal();
    const result = await runWizardSubmit({ journal, form, labelFor, scenesById, apiClient: api, notify, t: key => key });
    expect(result.ok).toBe(false);
    expect(result.failure.step).toBe('stream');
    expect(result.journal.stream_id).toBeNull();
    expect(notify.error).toHaveBeenCalled();
  });

  it('does not throw even for unexpected errors', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const api = { post: vi.fn(async () => { throw new Error('boom'); }), get: vi.fn(async () => { throw new Error('boom'); }) };
    const result = await runWizardSubmit({ journal: newJournal(), form, labelFor, scenesById, apiClient: api, notify, t: key => key });
    expect(result.ok).toBe(false);
    expect(result.failure.message).toBe('boom');
  });

  it('routes success and failure through submitWizard callbacks', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const ok = await submitWizard({ journal: newJournal(), form, labelFor, scenesById, apiClient: apiOk(), notify, t: key => key, onSuccess, onFailure });
    expect(ok.ok).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ streamId: 42 }));
    expect(onFailure).not.toHaveBeenCalled();

    const badApi = { post: vi.fn(async () => { throw new Error('reset'); }), get: vi.fn(async () => null) };
    const failed = await submitWizard({ journal: newJournal(), form, labelFor, scenesById, apiClient: badApi, notify, t: key => key, onSuccess, onFailure });
    expect(failed.ok).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ step: 'stream' }));
  });
});

describe('wizard output-step form reducers', () => {
  it('adds scenes with server-provided defaults and removes them', () => {
    const empty = { outputs: [] };
    const withRecord = toggleSceneInForm(empty, 'LOCAL_RECORD', SERVER_SCENES.LOCAL_RECORD);
    expect(withRecord.outputs).toEqual([{ sceneId: 'LOCAL_RECORD', transport: undefined, recordFormat: 'mp4', target_url: '' }]);
    const withPush = toggleSceneInForm(withRecord, 'LIVE_PLATFORM_PUSH', SERVER_SCENES.LIVE_PLATFORM_PUSH);
    expect(withPush.outputs[1]).toEqual({ sceneId: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', recordFormat: undefined, target_url: '' });
    expect(toggleSceneInForm(withPush, 'LOCAL_RECORD').outputs).toEqual([{ sceneId: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', recordFormat: undefined, target_url: '' }]);
    // Without a scene definition nothing is guessed.
    expect(toggleSceneInForm(empty, 'LOCAL_RECORD').outputs[0]).toEqual({ sceneId: 'LOCAL_RECORD', transport: undefined, recordFormat: undefined, target_url: '' });
  });

  it('patches only the matching scene', () => {
    const form2 = { outputs: [{ sceneId: 'LOCAL_RECORD' }, { sceneId: 'LIVE_PLATFORM_PUSH', target_url: '' }] };
    const patched = patchSceneInForm(form2, 'LIVE_PLATFORM_PUSH', { target_url: 'rtmp://cdn/live' });
    expect(patched.outputs[0]).toEqual({ sceneId: 'LOCAL_RECORD' });
    expect(patched.outputs[1].target_url).toBe('rtmp://cdn/live');
  });
});

describe('wizard completion mode', () => {
  it('keeps the modal open for one-time credentials and preflight warnings', () => {
    expect(wizardCompletionMode({ credential_display: { token: 'x' } })).toBe('credential');
    expect(wizardCompletionMode({ credential_recovered: true })).toBe('credential');
    expect(wizardCompletionMode({ preflight: { status: 'READY_WITH_WARNING' } })).toBe('preflight-warning');
    expect(wizardCompletionMode({ preflight: { status: 'READY' } })).toBeNull();
    expect(wizardCompletionMode({})).toBeNull();
    expect(wizardCompletionMode(null)).toBeNull();
  });
});

describe('main-entry keyboard selection', () => {
  const rooms = [
    { room: { id: 'a' } },
    { room: { id: 'b' } },
    { room: { id: 'c' } }
  ];
  it('moves forward, backward and clamps at the edges', () => {
    expect(nextSelectedRoomId(rooms, null, 1)).toBe('a');
    expect(nextSelectedRoomId(rooms, 'a', 1)).toBe('b');
    expect(nextSelectedRoomId(rooms, 'c', 1)).toBe('c');
    expect(nextSelectedRoomId(rooms, 'c', -1)).toBe('b');
    expect(nextSelectedRoomId(rooms, 'a', -1)).toBe('a');
    expect(nextSelectedRoomId(rooms, 'zzz', -1)).toBe('c');
    expect(nextSelectedRoomId([], 'a', 1)).toBeNull();
  });

  it('maps list keyboard events to selection and open actions', () => {
    const moves = [];
    const opened = [];
    const handled = key => handleListKeyDown({ key, preventDefault: () => {} }, {
      moveSelection: step => moves.push(step),
      openWorkspace: () => opened.push(true)
    });
    expect(handled('ArrowDown')).toBe(true);
    expect(handled('ArrowUp')).toBe(true);
    expect(handled('Enter')).toBe(true);
    expect(handled('Tab')).toBe(false);
    expect(moves).toEqual([1, -1]);
    expect(opened).toEqual([true]);
  });

  it('derives output scene defaults with explicit fallbacks', () => {
    expect(sceneChoiceDefaults({ mode: 'SERVE', default_transport: 'hls', default_protection: 'external-proxy' }))
      .toEqual({ mode: 'SERVE', transport: 'hls', protection: 'external-proxy', recordFormat: 'mp4' });
    expect(sceneChoiceDefaults({ mode: 'RECORD', transports: ['ts'], default_format: 'ts' }))
      .toEqual({ mode: 'RECORD', transport: 'ts', protection: 'none', recordFormat: 'ts' });
    expect(sceneChoiceDefaults(null)).toEqual({ mode: 'PUSH', transport: 'rtmp', protection: 'none', recordFormat: 'mp4' });
  });

  it('applies scene choices onto builder setters', () => {
    const setters = { setSceneId: vi.fn(), setMode: vi.fn(), setTransport: vi.fn(), setProtection: vi.fn(), setRecordFormat: vi.fn() };
    const scenes = [{ id: 'LOCAL_RECORD', mode: 'RECORD', default_format: 'ts' }];
    expect(applySceneChoice(scenes, 'LOCAL_RECORD', setters)).toEqual({ mode: 'RECORD', transport: 'rtmp', protection: 'none', recordFormat: 'ts' });
    expect(setters.setSceneId).toHaveBeenCalledWith('LOCAL_RECORD');
    expect(setters.setMode).toHaveBeenCalledWith('RECORD');
    expect(setters.setRecordFormat).toHaveBeenCalledWith('ts');
    expect(applySceneChoice(scenes, 'MISSING', setters)).toBeNull();
    expect(setters.setSceneId).toHaveBeenCalledWith('MISSING');
  });
});
