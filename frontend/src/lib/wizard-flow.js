import { buildOutputPayload } from './output-payload';
import { runRoomCreation, CreationInterrupted } from './create-room-journal';

// PHASE-09 wizard flow as pure functions: step gating, intent building and the
// journal submit orchestration are unit-testable without React; the wizard
// component only wires state and navigation.
export const WIZARD_STEPS = ['basics', 'direction', 'input', 'outputs', 'run'];

// Curated wizard offer list only — labels for the UI. Scene semantics
// (mode/transports/protections/defaults) come exclusively from the server's
// GET /v3/output/scenes contract and are never redefined here.
export const OUTPUT_SCENES = [
  { id: 'LOCAL_RECORD', labelKey: 'streams:directions.record.label' },
  { id: 'LIVE_PLATFORM_PUSH', labelKey: 'streams:directions.outPush.label' },
  { id: 'PARTNER_PULL', labelKey: 'streams:directions.outPull.label' }
];

export function outputSceneById(sceneId) {
  return OUTPUT_SCENES.find(item => item.id === sceneId) || null;
}

export function makeSceneLabeler(t) {
  return sceneId => {
    const scene = outputSceneById(sceneId);
    return t(scene?.labelKey || 'streams:liveOps.create');
  };
}

export function outputName(sceneId, index, label) {
  return `${label} ${index + 1}`.trim();
}

export function wizardStepValid(form, stepIndex) {
  if (stepIndex === 0) return Boolean(String(form.name || '').trim());
  if (stepIndex === 1) return ['IN_PUSH', 'IN_PULL'].includes(form.inputDirection);
  if (stepIndex === 2) {
    if (form.inputDirection !== 'IN_PULL') return true;
    return Boolean(String(form.pullSource?.name || '').trim() && String(form.pullSource?.source_url || '').trim());
  }
  if (stepIndex === 3) {
    return (form.outputs || []).every(output => output.sceneId !== 'LIVE_PLATFORM_PUSH' || String(output.target_url || '').trim());
  }
  return true;
}

// Builds output intents from the SERVER scene definitions (scenesById maps
// scene id -> GET /v3/output/scenes entry). An unknown scene fails loudly —
// constructing a guessed payload could silently violate the scene contract.
export function buildWizardOutputIntents(form, labelFor, scenesById = {}) {
  return (form.outputs || []).map((output, index) => {
    const scene = scenesById[output.sceneId];
    if (!scene) {
      const error = new Error(`Output scene ${output.sceneId} is not available from the server`);
      error.code = 'WIZARD_SCENE_UNAVAILABLE';
      throw error;
    }
    const name = outputName(output.sceneId, index, labelFor(output.sceneId));
    return {
      name,
      mode: scene.mode,
      scene: output.sceneId,
      payload: buildOutputPayload({
        builderMode: 'scene',
        sceneId: output.sceneId,
        scene,
        name,
        transport: output.transport || scene.default_transport,
        targetUrl: output.target_url,
        recordFormat: output.recordFormat || scene.default_format
      })
    };
  });
}

// Deterministic label for the one-time ingest credential the wizard issues on
// IN_PUSH runs. The backend rejects credential creation without a non-empty
// label (400 V3_INGEST_VALIDATION), so the wizard derives it from the room
// name — stable across retries of the same run and auditable in the room's
// credential list. Empty name yields '' and the journal refuses to POST.
export function wizardCredentialLabel(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  return `wizard-${trimmed.replace(/\s+/g, ' ')}`.slice(0, 80);
}

export function buildWizardIntent(form, outputIntents) {
  return {
    name: String(form.name || '').trim(),
    protocol: form.protocol,
    remark: String(form.remark || '').trim() || null,
    businessUnit: String(form.businessUnit || '').trim() || null,
    inputDirection: form.inputDirection,
    pullSource: form.inputDirection === 'IN_PULL' ? form.pullSource : null,
    credentialLabel: form.inputDirection === 'IN_PUSH' ? wizardCredentialLabel(form.name) : null,
    outputs: outputIntents,
    createRunPlan: Boolean(form.createRunPlan),
    planName: String(form.name || '').trim()
  };
}

// Runs the journal sequence; never throws — returns { ok, journal, failure }.
export async function runWizardSubmit({ journal, form, labelFor, scenesById, apiClient, notify, t }) {
  let intent;
  try {
    intent = buildWizardIntent(form, buildWizardOutputIntents(form, labelFor, scenesById));
  } catch (error) {
    notify.error(error.code === 'WIZARD_SCENE_UNAVAILABLE'
      ? t('streams:wizard.scenesUnavailable')
      : error.message);
    return { ok: false, journal, failure: { step: 'outputs', message: error.message, code: error.code, journal } };
  }
  try {
    await runRoomCreation({ journal, intent, api: apiClient });
    notify.success(t('streams:wizard.success'));
    return { ok: true, journal, streamId: journal.stream_id };
  } catch (error) {
    const interrupted = error instanceof CreationInterrupted ? error : null;
    notify.error(t('streams:wizard.failedAt', { step: interrupted?.step || '?' }));
    return {
      ok: false,
      journal,
      failure: {
        step: interrupted?.step || 'unknown',
        message: interrupted?.cause?.message || error.message,
        journal: interrupted?.journal || journal
      }
    };
  }
}

// Decides what the wizard shows after a successful journal run: the one-time
// credential or a preflight warning keep the modal open on the completion
// view; anything else goes straight to the room.
export function wizardCompletionMode(journal) {
  if (journal?.credential_display || journal?.credential_recovered) return 'credential';
  if (journal?.preflight?.status === 'READY_WITH_WARNING') return 'preflight-warning';
  return null;
}

// Full wizard submit used by the component: runs the journal sequence and
// hands the outcome back through callbacks (navigate/close on success,
// failure state on interruption).
export async function submitWizard({ journal, form, labelFor, scenesById, apiClient, notify, t, onSuccess, onFailure }) {
  const result = await runWizardSubmit({ journal, form, labelFor, scenesById, apiClient, notify, t });
  if (result.ok) {
    onSuccess?.(result);
    return result;
  }
  onFailure?.(result.failure);
  return result;
}

// Pure form reducers for the wizard output step. Scene defaults come from the
// server scene definition so the form and the builder cannot drift.
export function toggleSceneInForm(form, sceneId, scene = null) {
  const outputs = form.outputs || [];
  const exists = outputs.some(output => output.sceneId === sceneId);
  return {
    ...form,
    outputs: exists
      ? outputs.filter(output => output.sceneId !== sceneId)
      : [...outputs, {
        sceneId,
        transport: scene?.default_transport || undefined,
        recordFormat: scene?.default_format || undefined,
        target_url: ''
      }]
  };
}

export function patchSceneInForm(form, sceneId, patch) {
  return {
    ...form,
    outputs: (form.outputs || []).map(output => output.sceneId === sceneId ? { ...output, ...patch } : output)
  };
}

// Shared keyboard-selection helper for the main-entry list.
export function nextSelectedRoomId(rooms, currentId, step) {
  if (!rooms.length) return null;
  const currentIndex = rooms.findIndex(room => room.room.id === currentId);
  const nextIndex = currentIndex === -1
    ? (step > 0 ? 0 : rooms.length - 1)
    : Math.min(rooms.length - 1, Math.max(0, currentIndex + step));
  return rooms[nextIndex].room.id;
}

// Keyboard contract of the main-entry list: arrows move selection, Enter opens
// the full workspace. Pure so the contract is unit-testable.
export function handleListKeyDown(event, { moveSelection, openWorkspace }) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
    return true;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    openWorkspace();
    return true;
  }
  return false;
}

// Scene defaults applied when the output builder picks a scene.
export function sceneChoiceDefaults(scene) {
  return {
    mode: scene?.mode || 'PUSH',
    transport: scene?.default_transport || scene?.transports?.[0] || 'rtmp',
    protection: scene?.default_protection || 'none',
    recordFormat: scene?.default_format || 'mp4'
  };
}

// Applies a scene pick onto the builder's setters (shared by any scene UI).
export function applySceneChoice(scenes, nextId, setters) {
  const next = scenes.find(item => item.id === nextId);
  setters.setSceneId(nextId);
  if (!next) return null;
  const defaults = sceneChoiceDefaults(next);
  setters.setMode(defaults.mode);
  setters.setTransport(defaults.transport);
  setters.setProtection(defaults.protection);
  setters.setRecordFormat(defaults.recordFormat);
  return defaults;
}
