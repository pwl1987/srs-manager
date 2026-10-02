import { describe, expect, it } from 'vitest';
import { newWizardState, wizardStateReducer } from './wizard-ui-state';

// The one-time credential lifecycle contract: the token may live in wizard
// state ONLY while the wizard stays open on the completion view. Every close
// path (cancel, stay-after-done, enter-workspace — the component funnels all
// of them through open=false → RESET) must discard it, and reopening starts
// from a brand-new journal. No plaintext ever reaches storage.

const TOKEN = 'tok_plaintext_secret';

function completeCredentialRun() {
  const state = newWizardState();
  state.journal.credential_id = 5;
  state.journal.source_idempotency_key = 'wizard-external-source-run-1';
  state.journal.credential_display = {
    token: TOKEN,
    server_url: 'rtmp://srs.example/live',
    stream_key: '任意社会学?ingest_token=' + TOKEN,
    publish_url: 'rtmp://srs.example/live/任意社会学?ingest_token=' + TOKEN
  };
  const completed = wizardStateReducer(state, { type: 'SUBMIT_OK', journal: state.journal, streamId: 42 });
  expect(completed.completion.journal.credential_display.token).toBe(TOKEN);
  return { before: state, completed };
}

describe('wizard one-time credential lifecycle', () => {
  it('close → reopen: the old token no longer exists anywhere in wizard state', () => {
    const { before, completed } = completeCredentialRun();
    // Close (cancel / stay-after-done / enter-workspace all dispatch RESET).
    const closed = wizardStateReducer(completed, { type: 'RESET' });
    expect(closed.completion).toBeNull();
    expect(closed.failure).toBeNull();
    expect(closed.working).toBe(false);
    expect(closed.step).toBe(0);
    expect(closed.journal).not.toBe(before.journal);
    expect(closed.journal.credential_display).toBeNull();
    expect(closed.journal.credential_id).toBeNull();
    // Fresh run identity: a new idempotency key, not a replay of the old one.
    expect(closed.journal.source_idempotency_key).not.toBe(before.journal.source_idempotency_key);
    expect(JSON.stringify(closed)).not.toContain(TOKEN);
  });

  it('enter-workspace → create again: same RESET path, brand-new journal and form', () => {
    const { before, completed } = completeCredentialRun();
    const reopened = wizardStateReducer(completed, { type: 'RESET' });
    // The user creates another IN_PUSH room in the same session.
    const second = wizardStateReducer(
      wizardStateReducer(reopened, { type: 'PATCH_FORM', patch: form => ({ ...form, name: '第二场' }) }),
      { type: 'SUBMIT_START' }
    );
    expect(second.journal).not.toBe(before.journal);
    expect(JSON.stringify(second)).not.toContain(TOKEN);
    expect(second.form.name).toBe('第二场');
    expect(second.working).toBe(true);
  });

  it('a failure keeps the journal so retry-unfinished can resume the same run', () => {
    const state = newWizardState();
    state.journal.stream_id = 42;
    const failed = wizardStateReducer(state, {
      type: 'SUBMIT_FAIL',
      failure: { step: 'output:1', message: 'network lost', journal: state.journal }
    });
    expect(failed.journal).toBe(state.journal);
    expect(failed.journal.stream_id).toBe(42);
    expect(failed.failure.step).toBe('output:1');
    // Retrying inside the same open session never resets anything.
    const retrying = wizardStateReducer(failed, { type: 'SUBMIT_START' });
    expect(retrying.journal).toBe(state.journal);
    expect(retrying.failure).toBeNull();
  });

  it('a run still in flight when the wizard closed cannot resurrect its credential', () => {
    const { before, completed } = completeCredentialRun();
    const fresh = wizardStateReducer(completed, { type: 'RESET' });
    // The old async run settles AFTER the reset (user closed mid-submit).
    const staleOk = wizardStateReducer(fresh, { type: 'SUBMIT_OK', journal: before.journal, streamId: 42 });
    expect(staleOk.completion).toBeNull();
    expect(JSON.stringify(staleOk)).not.toContain(TOKEN);
    const staleFail = wizardStateReducer(fresh, {
      type: 'SUBMIT_FAIL',
      failure: { step: 'output:0', message: 'late failure', journal: before.journal }
    });
    expect(staleFail.failure).toBeNull();
  });
});

describe('creation intent integrity (FIX-04: lock on first submit, explicit abandon)', () => {
  function failedRun() {
    const state = newWizardState();
    const form = { ...state.form, name: '任意社会学', inputDirection: 'IN_PULL' };
    const locked = wizardStateReducer({ ...state, form }, { type: 'SUBMIT_START' });
    const journal = locked.journal;
    journal.stream_id = 42;
    journal.source_id = 7;
    // The run burned an output key before failing — abandon must not let the
    // next transaction inherit it (the frozen idempotency state machine makes
    // an abandoned key a tombstone once its output is cleaned up).
    journal.output_idempotency_keys[0] = 'wizard-output-0-abandoned-run';
    journal.creation_intent_snapshot = { name: '任意社会学', inputDirection: 'IN_PULL', outputs: [] };
    journal.credential_display = null;
    const failed = wizardStateReducer(locked, {
      type: 'SUBMIT_FAIL',
      failure: { step: 'output:0', message: 'network lost', journal }
    });
    return { failed, journal };
  }

  it('the first submit locks form edits and step navigation', () => {
    const fresh = newWizardState();
    const started = wizardStateReducer(fresh, { type: 'SUBMIT_START' });
    expect(started.locked).toBe(true);
    const patched = wizardStateReducer(started, { type: 'PATCH_FORM', patch: form => ({ ...form, name: '改名' }) });
    expect(patched.form.name).toBe('');
    const jumped = wizardStateReducer(started, { type: 'SET_STEP', step: 0 });
    expect(jumped.step).toBe(started.step);
    const navigated = wizardStateReducer(started, { type: 'GO_TO_STEP', step: 2 });
    expect(navigated.step).toBe(started.step);
  });

  it('a failed run stays locked: the only paths are retry-unfinished or abandon', () => {
    const { failed } = failedRun();
    expect(failed.locked).toBe(true);
    expect(failed.failure.step).toBe('output:0');
    const patched = wizardStateReducer(failed, { type: 'PATCH_FORM', patch: form => ({ ...form, name: '改名' }) });
    expect(patched.form.name).toBe('任意社会学');
  });

  it('abandon drops the old journal and credential, keeps the form editable, and reports leftover resources', () => {
    const { failed, journal } = failedRun();
    journal.credential_display = { token: TOKEN, server_url: 'rtmp://srs.example/live', stream_key: 'k', publish_url: 'p' };
    const abandoned = wizardStateReducer(failed, { type: 'ABANDON_CREATION' });
    expect(abandoned.journal).not.toBe(journal);
    expect(abandoned.journal.stream_id).toBeNull();
    // The new journal carries NO output idempotency keys from the abandoned
    // run — its next creation generates fresh keys server-side.
    expect(abandoned.journal.output_idempotency_keys).toEqual([]);
    expect(JSON.stringify(abandoned.journal)).not.toContain('wizard-output-0-abandoned-run');
    expect(abandoned.locked).toBe(false);
    expect(abandoned.failure).toBeNull();
    expect(abandoned.step).toBe(0);
    // The form is kept (the user abandons precisely to modify it) and is
    // editable again.
    expect(abandoned.form.name).toBe('任意社会学');
    const patched = wizardStateReducer(abandoned, { type: 'PATCH_FORM', patch: form => ({ ...form, name: '改名之后' }) });
    expect(patched.form.name).toBe('改名之后');
    // The old journal (and its credential plaintext) is gone from state…
    expect(JSON.stringify(abandoned)).not.toContain(TOKEN);
    // …while the notice states exactly which server resources remain.
    expect(abandoned.abandoned).toEqual({
      name: '任意社会学',
      streamId: 42,
      resources: ['stream', 'source']
    });
  });

  it('abandoning a run with no server-side effect leaves no scary notice', () => {
    const state = newWizardState();
    const started = wizardStateReducer(state, { type: 'SUBMIT_START' });
    const failed = wizardStateReducer(started, {
      type: 'SUBMIT_FAIL',
      failure: { step: 'stream', message: 'network lost', journal: started.journal }
    });
    const abandoned = wizardStateReducer(failed, { type: 'ABANDON_CREATION' });
    expect(abandoned.abandoned).toBeNull();
    expect(abandoned.locked).toBe(false);
  });
});
