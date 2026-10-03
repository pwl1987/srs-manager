// PHASE-09 creation journal: the wizard's multi-POST sequence is not a
// transaction, so every step records what succeeded. Retries only run the
// unfinished steps — never replay from the head. Reconcile rules are frozen in
// PHASE-09-MAIN-ENTRY-AND-WIZARD.md:
//   - intent: the creation intent is SNAPSHOT-FROZEN on the first submit;
//     every retry replays the frozen snapshot, so a form edit after a partial
//     failure can never ride on resources the old intent already created;
//   - stream: reconcile by unique name;
//   - external source: Idempotency-Key replay — the client keeps one key per
//     journal and the server returns the already-created source, covering
//     "POST succeeded but the response was lost" without ever exposing the
//     raw source_url back to the browser;
//   - pull task: 1:1 by stream_id, with the pull_task_sources link captured;
//   - output: Idempotency-Key per output index — the journal keeps one stable
//     key per index for its whole lifetime and the server replays the exact
//     first creation. The workspace listing is NEVER used to guess which
//     output is "ours": name+mode+scene cannot distinguish two outputs that
//     differ only by target_url/format/storage, and PUSH listings only expose
//     target_url_masked;
//   - ingest credential: plaintext token exists ONLY in the create response;
//     a lost response is recovered by adopting the already-issued ACTIVE
//     credential — the token is never re-exposed to solve recovery;
//   - run plan: run_plans.name is NOT unique in the database, so reconcile by
//     the full intent fingerprint (name + program source + ordered outputs +
//     failover, which the wizard never sends) — a same-name plan with
//     different outputs is never adopted;
//   - session: the server allows exactly one active session per room, so a
//     lost create response (or the 409 every later retry answers) recovers by
//     adopting the session that strictly matches room + run plan + title
//     while it is still PREP/READY. Anything else is a real conflict.
export function newJournal() {
  return {
    stream_id: null,
    source_id: null,
    source_idempotency_key: null,
    pull_task_id: null,
    pull_task_source_id: null,
    output_ids: [],
    // One stable Idempotency-Key per output index, generated before the first
    // POST and replayed by every retry. Not a secret, but journal-scoped.
    output_idempotency_keys: [],
    // The intent as it was on the FIRST submit. Frozen once; retries replay
    // it verbatim (see snapshotCreationIntent).
    creation_intent_snapshot: null,
    run_plan_id: null,
    session_id: null,
    credential_id: null,
    // One-time display payload, in-memory only: never persisted, never
    // re-fetchable. null when the response was lost (credential_recovered).
    credential_display: null,
    credential_recovered: false,
    preflight: null,
    steps: {}
  };
}

function markAttempt(journal, step) {
  journal.steps[step] = journal.steps[step] || { attempts: 0 };
  journal.steps[step].attempts += 1;
}

function markDone(journal, step) {
  journal.steps[step] = journal.steps[step] || { attempts: 1 };
  journal.steps[step].status = 'done';
}

const normalize = value => String(value ?? '').trim().toLowerCase();

function toIdOrNull(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function newSourceIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `wizard-external-source-${uuid}`;
}

function newOutputIdempotencyKey(index) {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `wizard-output-${index}-${uuid}`;
}

// The frozen copy of every field that changes what the creation chain builds.
// Deep-cloned through JSON on purpose: the caller may mutate its live intent
// object (or a nested payload) after a partial failure, and the journal must
// keep submitting EXACTLY what the first submit submitted — a partial chain
// is not a transaction, so "new form + old resource ids" is forbidden.
export function snapshotCreationIntent(intent = {}) {
  const outputs = (Array.isArray(intent.outputs) ? intent.outputs : []).map(output => ({ ...output }));
  return JSON.parse(JSON.stringify({
    name: intent.name,
    protocol: intent.protocol,
    remark: intent.remark ?? null,
    businessUnit: intent.businessUnit ?? null,
    inputDirection: intent.inputDirection,
    pullSource: intent.pullSource ? { ...intent.pullSource } : null,
    credentialLabel: intent.credentialLabel ?? null,
    outputs,
    createRunPlan: Boolean(intent.createRunPlan),
    planName: intent.planName ?? null
  }));
}

export class CreationInterrupted extends Error {
  constructor(step, cause, journal) {
    super(`creation interrupted at ${step}: ${cause?.message || cause}`);
    this.name = 'CreationInterrupted';
    this.step = step;
    this.cause = cause;
    this.journal = journal;
  }
}

async function reconcileStream(journal, intent, api) {
  const streams = await api.get('/streams').catch(() => null);
  const match = (Array.isArray(streams) ? streams : []).find(stream => normalize(stream.name) === normalize(intent.name));
  if (match) {
    journal.stream_id = Number(match.id);
    markDone(journal, 'stream');
    return true;
  }
  return false;
}

async function reconcilePullTask(journal, intent, api) {
  const tasks = await api.get('/pull-tasks').catch(() => null);
  const match = (Array.isArray(tasks) ? tasks : []).find(task => Number(task.stream_id) === Number(journal.stream_id));
  if (match) {
    journal.pull_task_id = toIdOrNull(match.id);
    capturePullTaskSource(journal, match);
    markDone(journal, 'pull-task');
    return true;
  }
  return false;
}

// The workspace embeds pull_task_sources.id in `source:in_pull:ptsrc-*` ids —
// external_sources.id is a different table and must never be substituted.
function capturePullTaskSource(journal, task) {
  const link = (task?.sources || []).find(source => Number(source.external_source_id) === Number(journal.source_id));
  journal.pull_task_source_id = toIdOrNull(link?.id) || journal.pull_task_source_id || null;
}

async function fetchWorkspace(journal, api) {
  return api.get(`/v3/rooms/room:${journal.stream_id}/workspace`).catch(() => null);
}

// Output ordering is canonicalized by output_ref (unique inside a plan), so
// two fingerprints only differ when the content differs, never the ordering.
function canonicalRunPlanOutputs(outputs) {
  return (Array.isArray(outputs) ? outputs : [])
    .map(output => ({
      output_ref: normalize(output.output_ref),
      importance: String(output.importance || 'REQUIRED').toUpperCase(),
      auto_start: output.auto_start !== false,
      sort_order: Number(output.sort_order)
    }))
    .sort((a, b) => (a.output_ref < b.output_ref ? -1 : a.output_ref > b.output_ref ? 1 : a.sort_order - b.sort_order));
}

// run_plans.name is not unique in the database — a candidate plan counts as
// "the one this journal created" only when the whole intent fingerprint
// matches. The wizard never sends failover_source_ids, so any plan carrying
// failover can never be adopted by a wizard journal.
function runPlanFingerprint({ name, programSourceId, outputIds }) {
  return JSON.stringify({
    name: normalize(name),
    program_source_id: normalize(programSourceId) || null,
    failover_source_ids: [],
    outputs: canonicalRunPlanOutputs(outputIds.map((outputId, order) => ({
      output_ref: outputId,
      importance: 'REQUIRED',
      auto_start: true,
      sort_order: (order + 1) * 10
    })))
  });
}

function existingRunPlanFingerprint(plan) {
  return JSON.stringify({
    name: normalize(plan.name),
    program_source_id: normalize(plan.program_source_id) || null,
    failover_source_ids: (Array.isArray(plan.failover_source_ids) ? plan.failover_source_ids : []).map(normalize).sort(),
    outputs: canonicalRunPlanOutputs(plan.outputs)
  });
}

function numericRunPlanId(value) {
  const id = Number(String(value ?? '').replace(/^.*:/, ''));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function reconcileRunPlan(journal, intent, workspace, api) {
  if (!journal.stream_id) return false;
  const expected = runPlanFingerprint({
    name: intent.planName || intent.name,
    programSourceId: pickProgramSourceId(workspace, journal, intent),
    outputIds: journal.output_ids.filter(Boolean)
  });
  const plans = await api.get(`/v3/rooms/room:${journal.stream_id}/run-plans`).catch(() => null);
  const match = (plans?.run_plans || []).find(plan => existingRunPlanFingerprint(plan) === expected);
  if (!match) return false;
  journal.run_plan_id = String(match.id);
  markDone(journal, 'run-plan');
  return true;
}

// A session can only be "the one this journal started" while it is still in a
// creatable lifecycle stage — PREP, or READY after mark_ready flipped it during
// preflight. ON_AIR/CLOSING sessions are someone's live broadcast.
const ADOPTABLE_SESSION_LIFECYCLE = new Set(['PREP', 'READY']);

// Recover the session step after a lost create response, or after the 409
// "An active Session already exists for this Room" that every retry answers
// while the created session stays active. Only the session that strictly
// matches this creation intent (room + run plan + title) is adoptable; an
// active session failing any check is a real conflict and must surface.
async function reconcileSession(journal, intent, api) {
  if (!journal.stream_id || !journal.run_plan_id) return false;
  const room = await api.get(`/v3/rooms/room:${journal.stream_id}/sessions`).catch(() => null);
  const expectedRunPlanId = numericRunPlanId(journal.run_plan_id);
  const match = (Array.isArray(room?.sessions) ? room.sessions : []).find(session => {
    if (!ADOPTABLE_SESSION_LIFECYCLE.has(String(session.lifecycle_state || '').toUpperCase())) return false;
    if (Number(session.stream_id) !== Number(journal.stream_id)) return false;
    if (numericRunPlanId(session.run_plan_id) !== expectedRunPlanId) return false;
    return normalize(session.title) === normalize(intent.name);
  });
  if (!match) return false;
  journal.session_id = match.id;
  markDone(journal, 'session');
  return true;
}

// Resolve the run plan's program_source_id from workspace compatibility data.
// IN_PULL ids embed pull_task_sources.id; the journal's external source id is
// matched via compatibility.external_source_id, never by string substitution.
export function pickProgramSourceId(workspace, journal, intent) {
  const sources = workspace?.sources || [];
  if (intent.inputDirection === 'IN_PULL') {
    const inPull = sources.filter(source => source.kind === 'IN_PULL');
    const byTaskSource = journal.pull_task_source_id != null
      ? inPull.find(source => Number(source.compatibility?.pull_task_source_id) === Number(journal.pull_task_source_id))
      : null;
    const byExternal = journal.source_id != null
      ? inPull.find(source => Number(source.compatibility?.external_source_id) === Number(journal.source_id))
      : null;
    const byTask = journal.pull_task_id != null
      ? inPull.find(source => Number(source.compatibility?.pull_task_id) === Number(journal.pull_task_id))
      : null;
    const resolved = byTaskSource || byExternal || byTask || inPull[0];
    if (resolved) return resolved.id;
  }
  const inPush = sources.find(source => source.kind === 'IN_PUSH');
  return inPush?.id || null;
}

function preflightRecord(result) {
  if (!result || !result.status) return null;
  return {
    status: result.status,
    summary: result.summary || null,
    checks: Array.isArray(result.checks) ? result.checks : []
  };
}

async function listActiveCredential(journal, api) {
  const room = await api.get(`/v3/rooms/room:${journal.stream_id}/ingest-credentials`).catch(() => null);
  return (room?.credentials || []).find(credential => credential.status === 'ACTIVE') || null;
}

function adoptExistingCredential(journal, credential) {
  journal.credential_id = toIdOrNull(credential.id);
  journal.credential_recovered = true;
  journal.credential_display = null;
  markDone(journal, 'credential');
}

// One-time ingest credential (IN_PUSH). The plaintext token exists only in the
// create response; when that response is lost the recovery adopts the already
// issued ACTIVE credential without ever re-exposing its token.
async function runCredentialStep(journal, intent, api) {
  if (intent.inputDirection !== 'IN_PUSH' || journal.credential_id) return;
  markAttempt(journal, 'credential');
  const existing = await listActiveCredential(journal, api);
  if (existing) {
    adoptExistingCredential(journal, existing);
    return;
  }
  // The backend answers 400 V3_INGEST_VALIDATION without a non-empty label —
  // never issue the POST (which would create nothing and burn the attempt).
  const label = String(intent.credentialLabel || '').trim();
  if (!label) {
    throw new CreationInterrupted('credential', new Error('wizard intent is missing the ingest credential label'), journal);
  }
  try {
    const created = await api.post(`/v3/rooms/room:${journal.stream_id}/ingest-credentials`, { label });
    journal.credential_id = toIdOrNull(created?.credential?.id);
    if (!journal.credential_id) throw new Error('create credential returned no id');
    journal.credential_display = created.token
      ? {
        token: created.token,
        server_url: created.server_url || null,
        stream_key: created.stream_key || null,
        publish_url: created.publish_url || null
      }
      : null;
    markDone(journal, 'credential');
  } catch (error) {
    // The POST may have succeeded while the response was lost — adopt the
    // credential the server already issued instead of failing or re-issuing.
    const recovered = await listActiveCredential(journal, api);
    if (recovered) {
      adoptExistingCredential(journal, recovered);
      return;
    }
    throw new CreationInterrupted('credential', error, journal);
  }
}

// POST /v3/rooms/:id/outputs answers differently per mode: SERVE returns the
// projection with its own `id` (`output:serve:N`), while PUSH and RECORD return
// `{task, rendition}` and the canonical output id must be composed from the
// task id using the same grammar the run-plan validator expects.
function createdOutputId(created, payload) {
  const output = created?.output || created;
  if (output?.id) return output.id;
  if (output?.task?.id) {
    return payload.mode === 'RECORD' ? `output:record:${output.task.id}` : `output:push:${output.task.id}`;
  }
  return null;
}

export async function runRoomCreation({ journal, intent, api }) {
  // The first submit freezes the intent. From here on the journal replays the
  // frozen snapshot — a mutated live intent (name, direction, source URL,
  // output target…) must never ride on the resources the original intent
  // already created. Changing the configuration requires a NEW journal.
  if (!journal.creation_intent_snapshot) {
    journal.creation_intent_snapshot = snapshotCreationIntent(intent);
  }
  const frozen = journal.creation_intent_snapshot;

  // step 1 — stream
  if (!journal.stream_id) {
    markAttempt(journal, 'stream');
    try {
      const result = await api.post('/streams', {
        name: frozen.name,
        protocol: frozen.protocol,
        remark: frozen.remark ?? null,
        business_unit: frozen.businessUnit ?? null
      });
      journal.stream_id = toIdOrNull(result?.stream?.id ?? result?.id);
      if (!journal.stream_id) throw new Error('create stream returned no id');
      markDone(journal, 'stream');
    } catch (error) {
      const retried = journal.steps.stream.attempts > 1;
      if ((error.status === 409 && retried) || error.status === undefined) {
        if (await reconcileStream(journal, frozen, api)) return runRoomCreation({ journal, intent, api });
      }
      throw new CreationInterrupted('stream', error, journal);
    }
  }

  // step 2 — one-time ingest credential (IN_PUSH only)
  await runCredentialStep(journal, frozen, api);

  // step 3 — external source (IN_PULL only), Idempotency-Key replayable
  if (frozen.inputDirection === 'IN_PULL' && frozen.pullSource && !journal.source_id) {
    markAttempt(journal, 'source');
    if (!journal.source_idempotency_key) journal.source_idempotency_key = newSourceIdempotencyKey();
    try {
      const created = await api.post('/external-sources', {
        name: frozen.pullSource.name.trim(),
        source_url: frozen.pullSource.source_url.trim(),
        protocol: frozen.pullSource.protocol,
        pull_mode: 'pull'
      }, { headers: { 'Idempotency-Key': journal.source_idempotency_key } });
      journal.source_id = toIdOrNull(created?.id);
      if (!journal.source_id) throw new Error('create source returned no id');
      markDone(journal, 'source');
    } catch (error) {
      // Retry re-POSTs with the same key and the server replays the original
      // creation, so a lost first response cannot fork a duplicate source.
      throw new CreationInterrupted('source', error, journal);
    }
  }

  // step 4 — managed pull task (IN_PULL only)
  if (frozen.inputDirection === 'IN_PULL' && journal.source_id && !journal.pull_task_id) {
    markAttempt(journal, 'pull-task');
    try {
      const task = await api.post('/pull-tasks', {
        stream_id: journal.stream_id,
        external_source_id: journal.source_id
      });
      journal.pull_task_id = toIdOrNull(task?.id);
      if (!journal.pull_task_id) throw new Error('create pull task returned no id');
      capturePullTaskSource(journal, task);
      markDone(journal, 'pull-task');
    } catch (error) {
      if (await reconcilePullTask(journal, frozen, api)) {
        // adopted
      } else {
        throw new CreationInterrupted('pull-task', error, journal);
      }
    }
  }

  // step 5 — outputs (each index recovers independently). Every output POST
  // carries the journal's stable Idempotency-Key for that index: after a lost
  // response the retry re-POSTs the SAME request under the SAME key and the
  // server answers with the output it already created. The workspace listing
  // is never consulted — name+mode+scene cannot tell two same-named outputs
  // apart and PUSH listings only expose target_url_masked.
  const payloads = frozen.outputs || [];
  journal.output_ids.length = payloads.length;
  journal.output_idempotency_keys.length = payloads.length;
  for (let index = 0; index < payloads.length; index++) {
    if (journal.output_ids[index]) continue;
    markAttempt(journal, `output:${index}`);
    if (!journal.output_idempotency_keys[index]) {
      journal.output_idempotency_keys[index] = newOutputIdempotencyKey(index);
    }
    try {
      const created = await api.post(`/v3/rooms/room:${journal.stream_id}/outputs`, payloads[index].payload, {
        headers: { 'Idempotency-Key': journal.output_idempotency_keys[index] }
      });
      journal.output_ids[index] = createdOutputId(created, payloads[index].payload);
      if (!journal.output_ids[index]) throw new Error('create output returned no id');
      markDone(journal, `output:${index}`);
    } catch (error) {
      throw new CreationInterrupted(`output:${index}`, error, journal);
    }
  }

  // step 6 — run plan (optional; zero outputs allowed per PHASE-09). The
  // server cannot deduplicate run plan creates (name is not unique and there
  // is no idempotency key): a retrying journal reconciles the full intent
  // fingerprint BEFORE posting again, and a lost POST response recovers the
  // same way inside the catch.
  if (frozen.createRunPlan && !journal.run_plan_id) {
    const retried = (journal.steps['run-plan']?.attempts || 0) > 0;
    markAttempt(journal, 'run-plan');
    const workspace = await fetchWorkspace(journal, api);
    if (retried && await reconcileRunPlan(journal, frozen, workspace, api)) {
      // adopted the plan a previous attempt already created
    } else {
      try {
        const result = await api.post(`/v3/rooms/room:${journal.stream_id}/run-plans`, {
          name: frozen.planName || frozen.name,
          program_source_id: pickProgramSourceId(workspace, journal, frozen),
          outputs: journal.output_ids.filter(Boolean).map((outputId, order) => ({
            output_ref: outputId,
            importance: 'REQUIRED',
            auto_start: true,
            sort_order: (order + 1) * 10
          }))
        });
        journal.run_plan_id = result?.run_plan?.id ? String(result.run_plan.id) : (result?.id ? String(result.id) : null);
        if (!journal.run_plan_id) throw new Error('create run plan returned no id');
        markDone(journal, 'run-plan');
      } catch (error) {
        if (await reconcileRunPlan(journal, frozen, workspace, api)) {
          // adopted the plan this POST already created server-side
        } else {
          throw new CreationInterrupted('run-plan', error, journal);
        }
      }
    }
  }

  // step 7 — session (optional). The server allows exactly one active session
  // per room: a lost create response — or the 409 any later retry answers —
  // recovers by adopting the session this intent strictly matches.
  if (frozen.createRunPlan && journal.run_plan_id && !journal.session_id) {
    markAttempt(journal, 'session');
    try {
      const result = await api.post(`/v3/rooms/room:${journal.stream_id}/sessions`, {
        run_plan_id: numericRunPlanId(journal.run_plan_id),
        title: frozen.name
      });
      journal.session_id = result?.session?.id || null;
      if (!journal.session_id) throw new Error('create session returned no id');
      markDone(journal, 'session');
    } catch (error) {
      if (await reconcileSession(journal, frozen, api)) {
        // adopted — preflight continues below
      } else {
        throw new CreationInterrupted('session', error, journal);
      }
    }
  }

  // step 8 — preflight (optional; BLOCKED/WARNING/READY per preflight contract).
  // A failure here interrupts at 'preflight' only — retrying re-runs this step
  // alone, never stream/source/output/session.
  if (frozen.createRunPlan && journal.session_id && journal.steps.preflight?.status !== 'done') {
    markAttempt(journal, 'preflight');
    try {
      const result = await api.post(`/v3/sessions/${journal.session_id}/preflight`, { mark_ready: true });
      journal.preflight = preflightRecord(result);
      if (journal.preflight?.status === 'BLOCKED') {
        throw Object.assign(new Error('preflight blocked'), { preflightBlocked: true });
      }
      markDone(journal, 'preflight');
    } catch (error) {
      // BLOCKED answers HTTP 409 with the full evaluation body — surface the
      // concrete status instead of swallowing it.
      if (error.status === 409 && error.body?.status) {
        journal.preflight = preflightRecord(error.body);
      }
      throw new CreationInterrupted('preflight', error, journal);
    }
  }

  return journal;
}
