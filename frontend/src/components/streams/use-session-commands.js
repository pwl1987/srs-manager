import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../../lib/api';

export function opKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Shared high-frequency session lifecycle commands (PHASE-09: the main entry
// right panel and the workspace SessionCommandBar run the exact same logic —
// plan/session creation, preflight, start, close — including idempotency keys
// and the close operation polling loop). The factory is dependency-injected so
// the behavior is unit-testable without React.
export function createSessionCommands({ apiClient = api, notify = toast, t = (key, opts) => key, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), getRoomId, getSession, onChanged }) {
  async function runPreflight() {
    const session = getSession();
    if (!session) return;
    try {
      const result = await apiClient.post(`/v3/sessions/${session.legacy_session_id}/preflight`, { mark_ready: true });
      if (result.status === 'BLOCKED') notify.error(t('streams:sessionCommands.preflightBlocked'));
      else if (result.status === 'READY_WITH_WARNING' || result.status === 'WARNING') notify.warning(t('streams:sessionCommands.preflightWarning'));
      else notify.success(t('streams:sessionCommands.preflightPass'));
      await onChanged();
    } catch (error) { notify.error(error.message || t('streams:sessionCommands.preflightFailed')); }
  }

  async function startSession() {
    const session = getSession();
    if (!session) return;
    try {
      const op = await apiClient.post(`/v3/sessions/${session.legacy_session_id}/start`, {}, {
        headers: { 'Idempotency-Key': opKey(`session-start-${session.legacy_session_id}`) }
      });
      notify.success(op?.phase === 'SUCCEEDED' ? t('streams:sessionCommands.started') : t('streams:sessionCommands.startSubmitted'));
      await onChanged();
    } catch (error) { notify.error(error.message || t('streams:sessionCommands.startFailed')); }
  }

  async function pollClose(operation) {
    let op = operation;
    for (let i = 0; i < 75 && op && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(op.phase); i += 1) {
      await sleep(1000);
      op = await apiClient.get(`/v3/operations/${encodeURIComponent(op.id)}`);
      if (i % 2 === 0) await onChanged();
    }
    return op;
  }

  async function closeSession() {
    const session = getSession();
    if (!session) return;
    try {
      let op;
      try {
        op = await apiClient.post(`/v3/sessions/${session.legacy_session_id}/close`, {}, { headers: { 'Idempotency-Key': opKey(`session-close-${session.legacy_session_id}`) } });
      } catch (error) {
        if (error.status === 409 && error.detail?.id) op = error.detail;
        else throw error;
      }
      op = await pollClose(op);
      if (op?.phase === 'SUCCEEDED') notify.success(t('streams:sessionCommands.closeSucceeded'));
      else if (op?.phase === 'FAILED') notify.error(op.error || t('streams:sessionCommands.closeResidual'));
      else notify.warning(t('streams:sessionCommands.closeInProgress'));
      await onChanged();
    } catch (error) { notify.error(error.message || t('streams:sessionCommands.closeFailed')); }
  }

  async function loadPlans() {
    const data = await apiClient.get(`/v3/rooms/${getRoomId()}/run-plans`);
    return data?.run_plans || [];
  }

  async function createSession({ planId, title, fallbackTitle }) {
    if (!planId) return notify.error(t('streams:sessionBar.planRequired'));
    try {
      await apiClient.post(`/v3/rooms/${getRoomId()}/sessions`, {
        run_plan_id: Number(planId),
        title: (title || '').trim() || fallbackTitle || 'Live Session'
      });
      notify.success(t('streams:sessionBar.noSession.sessionCreated'));
      await onChanged();
      return true;
    } catch (error) { notify.error(error.message || t('streams:sessionBar.noSession.sessionFailed')); return false; }
  }

  async function createQuickPlan({ name, sourceId, outputs }) {
    if (!String(name || '').trim()) return notify.error(t('streams:sessionBar.quickPlan.nameRequired'));
    try {
      const result = await apiClient.post(`/v3/rooms/${getRoomId()}/run-plans`, {
        name: String(name).trim(),
        program_source_id: sourceId,
        outputs: (outputs || []).map((output, index) => ({
          output_ref: output.id,
          importance: output.optional ? 'OPTIONAL' : 'REQUIRED',
          auto_start: true,
          sort_order: (index + 1) * 10
        }))
      });
      notify.success(t('streams:sessionBar.quickPlan.saved'));
      await onChanged();
      return result?.run_plan || null;
    } catch (error) { notify.error(error.message || t('streams:sessionBar.quickPlan.failed')); return null; }
  }

  return { runPreflight, startSession, closeSession, loadPlans, createSession, createQuickPlan };
}

export default function useSessionCommands({ roomId, session, onChanged }) {
  const { t } = useTranslation('streams');
  const [busy, setBusy] = useState(false);

  const commands = createSessionCommands({
    t,
    getRoomId: () => roomId,
    getSession: () => session,
    onChanged: async () => onChanged()
  });

  // Single busy-tracking wrapper: the body only runs when a command fires.
  const tracked = fn => async (...args) => {
    setBusy(true);
    try { await fn(...args); }
    finally { setBusy(false); }
  };

  return {
    busy,
    roomId,
    runPreflight: tracked(commands.runPreflight),
    startSession: tracked(commands.startSession),
    closeSession: tracked(commands.closeSession),
    createSession: tracked(commands.createSession),
    createQuickPlan: tracked(commands.createQuickPlan),
    loadPlans: commands.loadPlans
  };
}
