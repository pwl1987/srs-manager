import { newJournal } from './create-room-journal';

// Wizard UI state as a pure reducer so the one-time-credential lifecycle is
// unit-testable without React: every close (cancel, stay-after-done,
// enter-workspace — they all funnel through open=false) discards the whole
// run, including journal.credential_display, and the next open starts from a
// brand-new journal. A retry inside the SAME open session never dispatches
// RESET, so its journal and finished steps survive for retry-unfinished.
//
// PHASE-09-FIX-04 (creation intent integrity, plan A): the FIRST submit
// attempt locks the form and the step navigation. A lost response may have
// committed server-side without the journal knowing, so "edit the form and
// retry" could graft a new intent onto the old journal's resources — the
// journal replays its frozen intent snapshot, and the UI matches by refusing
// edits. Modifying the configuration requires the explicit abandon action:
// new journal + kept form + a notice that the already-created server
// resources still exist (they are never silently deleted).

export function initialWizardForm() {
  return {
    name: '',
    remark: '',
    businessUnit: '',
    protocol: 'rtmp',
    inputDirection: 'IN_PUSH',
    pullSource: { name: '', source_url: '', protocol: 'rtmp' },
    outputs: [],
    createRunPlan: true
  };
}

export function newWizardState({ initialStep = 0, initialForm = null } = {}) {
  return {
    step: initialStep,
    maxReached: initialStep,
    form: initialForm || initialWizardForm(),
    journal: newJournal(),
    working: false,
    failure: null,
    completion: null,
    locked: false,
    abandoned: null
  };
}

// Sanitized handover for the abandon notice: what the discarded journal had
// already created server-side. Deliberately built from non-secret fields —
// the old journal (with any credential plaintext) is dropped, not carried.
function abandonedSummary(journal) {
  if (!journal) return null;
  const snapshot = journal.creation_intent_snapshot || {};
  const resources = [];
  if (journal.stream_id != null) resources.push('stream');
  if (journal.credential_id != null) resources.push('credential');
  if (journal.source_id != null) resources.push('source');
  if (journal.pull_task_id != null) resources.push('pull-task');
  if ((journal.output_ids || []).some(Boolean)) resources.push('outputs');
  if (journal.run_plan_id != null) resources.push('run-plan');
  if (journal.session_id != null) resources.push('session');
  if (!resources.length) return null;
  return { name: snapshot.name || null, streamId: journal.stream_id ?? null, resources };
}

export function wizardStateReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return newWizardState(action.initial || {});
    case 'GO_TO_STEP':
      if (state.locked) return state;
      return { ...state, step: action.step, maxReached: Math.max(state.maxReached, action.step) };
    case 'SET_STEP':
      if (state.locked) return state;
      return { ...state, step: action.step };
    case 'PATCH_FORM':
      // Locked after the first submit: the journal replays its frozen intent
      // snapshot, so form edits would be silently ignored — refuse them.
      if (state.locked) return state;
      return { ...state, form: action.patch(state.form) };
    case 'SUBMIT_START':
      // Lock on the first attempt, not on the first recorded resource: a lost
      // response can commit server-side invisibly, and from that moment "new
      // form + old journal" is exactly the forbidden combination.
      return { ...state, working: true, failure: null, locked: true };
    case 'SUBMIT_SETTLED':
      return { ...state, working: false };
    case 'SUBMIT_OK':
      // Stale-run guard: a run that was still in flight when the wizard closed
      // must not resurrect its discarded credential onto the fresh state.
      if (action.journal !== state.journal) return state;
      return { ...state, working: false, completion: { ok: true, journal: action.journal, streamId: action.streamId } };
    case 'SUBMIT_FAIL':
      if (action.failure?.journal && action.failure.journal !== state.journal) return state;
      return { ...state, working: false, failure: action.failure };
    case 'ABANDON_CREATION': {
      // "Abandon this creation and start anew": the old journal (and any
      // credential plaintext inside it) is dropped, the form is kept and
      // unlocked for editing, and a notice states which server-side resources
      // remain — the multi-POST chain is not a transaction, so there is no
      // silent rollback.
      const summary = abandonedSummary(state.journal);
      return {
        ...newWizardState({ initialForm: state.form }),
        abandoned: summary
      };
    }
    default:
      return state;
  }
}
