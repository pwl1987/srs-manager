const sessionService = require('./session-service');
const workspaceV3 = require('./v3-workspace-service');

function severityFor(importance) { return importance === 'REQUIRED' ? 'BLOCKER' : 'WARNING'; }
function check(severity, code, message, subject_ref = null) { return { severity, code, message, subject_ref }; }

async function evaluateSession(sessionId, options = {}) {
  const session = sessionService.getSession(sessionId); if (!session) throw new Error('Session not found');
  const workspace = options.workspace || await workspaceV3.getWorkspace(`room:${session.stream_id}`);
  const checks = [];
  if (!workspace) checks.push(check('BLOCKER', 'ROOM_WORKSPACE_UNAVAILABLE', 'Room Workspace is unavailable.'));
  else {
    if (workspace.evidence?.srs?.available !== true) checks.push(check('BLOCKER', 'SRS_UNOBSERVABLE', 'SRS runtime cannot be observed for this Session.'));
    const sources = workspace.sources || [];
    if (!session.planned_program_source_id) checks.push(check('WARNING', 'PROGRAM_SOURCE_NOT_PLANNED', 'No planned Program source is defined.'));
    else {
      const source = sources.find(x => x.id === session.planned_program_source_id);
      if (!source) checks.push(check('BLOCKER', 'PROGRAM_SOURCE_MISSING', 'Planned Program source no longer exists.', session.planned_program_source_id));
      else if (['OFFLINE', 'FAILED', 'BLOCKED'].includes(String(source.availability || '').toUpperCase())) checks.push(check('BLOCKER', 'PROGRAM_SOURCE_UNAVAILABLE', 'Planned Program source is unavailable.', source.id));
      else if (String(source.availability || '').toUpperCase() === 'UNKNOWN') checks.push(check('WARNING', 'PROGRAM_SOURCE_UNVERIFIED', 'Planned Program source readiness is unknown.', source.id));
      else checks.push(check('INFO', 'PROGRAM_SOURCE_READY', 'Planned Program source is observable.', source.id));
    }
    for (const sourceId of session.failover_source_ids || []) {
      const source = sources.find(x => x.id === sourceId);
      if (!source) checks.push(check('WARNING', 'FAILOVER_SOURCE_MISSING', 'A planned failover source no longer exists.', sourceId));
      else if (['OFFLINE', 'FAILED', 'BLOCKED'].includes(String(source.availability || '').toUpperCase())) checks.push(check('WARNING', 'FAILOVER_SOURCE_UNAVAILABLE', 'A failover source is not ready.', sourceId));
      else checks.push(check('INFO', 'FAILOVER_SOURCE_CONFIGURED', 'Failover source is configured.', sourceId));
    }
    const outputs = workspace.outputs || [];
    for (const planned of session.outputs) {
      const output = outputs.find(x => x.id === planned.output_ref);
      const severity = severityFor(planned.importance);
      if (!output) { checks.push(check(severity, 'PLANNED_OUTPUT_MISSING', `${planned.importance} Output no longer exists.`, planned.output_ref)); continue; }
      if (output.mode === 'PUSH' && workspace.capabilities?.runtime?.push_worker?.available !== true) checks.push(check(severity, 'PUSH_WORKER_UNAVAILABLE', 'Managed Push Worker is unavailable.', output.id));
      if (output.mode === 'RECORD') {
        if (workspace.capabilities?.runtime?.record?.available !== true) checks.push(check(severity, 'RECORD_WORKER_UNAVAILABLE', 'Record Worker is unavailable.', output.id));
        if (workspace.capabilities?.runtime?.record?.storage?.low_space === true) checks.push(check(severity, 'RECORD_STORAGE_LOW', 'Recording storage has no usable capacity above reserve.', output.id));
      }
      if (String(output.media_ref || '').includes(':binding-') && workspace.capabilities?.runtime?.transcode_worker?.available !== true) checks.push(check(severity, 'TRANSCODE_WORKER_UNAVAILABLE', 'Shared Rendition requires Transcode Worker, which is unavailable.', output.id));
      if (output.control_mode === 'LEGACY_UNMANAGED') checks.push(check('WARNING', 'OUTPUT_LEGACY_UNMANAGED', 'Output cannot participate in managed Session orchestration.', output.id));
      if (!checks.some(x => x.subject_ref === output.id && x.severity !== 'INFO')) checks.push(check('INFO', 'OUTPUT_CONFIGURED', `${planned.importance} Output is configured.`, output.id));
    }
  }
  const summary = { blockers: checks.filter(x => x.severity === 'BLOCKER').length, warnings: checks.filter(x => x.severity === 'WARNING').length, info: checks.filter(x => x.severity === 'INFO').length };
  const result = { session_id: session.id, evaluated_at: new Date().toISOString(), status: summary.blockers ? 'BLOCKED' : summary.warnings ? 'READY_WITH_WARNING' : 'READY', summary, checks };
  if (options.persist !== false) sessionService.recordPreflight(session.id, result, { mark_ready: options.mark_ready === true });
  return result;
}

module.exports = { evaluateSession, severityFor };
