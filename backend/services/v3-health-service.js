function reason(code, severity, message, subject_id = null, impact = 'room') {
  return { code, severity, message, subject_id, impact };
}

function expectedProgram(workspace) {
  if ((workspace.sources || []).some(source => source.compatibility?.desired_state === 'RUNNING')) return true;
  if ((workspace.renditions || []).some(r => r.desired_state === 'RUNNING')) return true;
  if ((workspace.outputs || []).some(o => o.desired_state === 'RUNNING')) return true;
  return false;
}

function evaluateWorkspace(workspace) {
  const reasons = [];
  const state = workspace.program?.state || 'UNKNOWN';
  if (state === 'UNKNOWN') {
    return { status: 'UNKNOWN', reasons: [reason('PROGRAM_EVIDENCE_UNKNOWN', 'INFO', 'Program state cannot be verified because SRS evidence is unavailable.', workspace.program?.id)] };
  }

  if (state === 'NO_PROGRAM' && expectedProgram(workspace)) {
    reasons.push(reason('PROGRAM_EXPECTED_NOT_OBSERVED', 'CRITICAL', 'Program is expected to run but no current media is observed.', workspace.program?.id, 'all_outputs'));
  }

  if (state === 'LIVE' && String(workspace.program?.attribution || '').startsWith('UNATTRIBUTED')) {
    reasons.push(reason('PROGRAM_SOURCE_UNATTRIBUTED', 'WARNING', 'Program is live but the publisher cannot be attributed to a configured ingest source.', workspace.program?.id, 'program'));
  }

  const programEvidence = workspace.program?.evidence;
  if (state === 'LIVE' && programEvidence?.freshness === 'STALE') {
    reasons.push(reason('PROGRAM_EVIDENCE_STALE', 'WARNING', 'Program evidence is stale.', workspace.program?.id, 'program'));
  }

  for (const rendition of workspace.renditions || []) {
    if (rendition.kind !== 'TRANSCODE' || rendition.desired_state !== 'RUNNING') continue;
    if (rendition.runtime_state === 'FAILED') {
      reasons.push(reason('RENDITION_RUNTIME_FAILED', 'WARNING', 'A requested rendition runtime has failed.', rendition.id, 'dependent_outputs'));
    } else if (rendition.runtime_state === 'RUNNING' && rendition.observed?.online === false) {
      reasons.push(reason('RENDITION_MEDIA_NOT_OBSERVED', 'WARNING', 'Rendition runtime is running but derived media is not observed.', rendition.id, 'dependent_outputs'));
    }
  }

  for (const output of workspace.outputs || []) {
    if (output.mode !== 'PUSH' || output.control_mode === 'LEGACY_UNMANAGED' || output.desired_state !== 'RUNNING') continue;
    if (output.runtime_state === 'FAILED') {
      reasons.push(reason('OUTPUT_RUNTIME_FAILED', 'WARNING', 'A requested PUSH output has failed.', output.id, 'single_output'));
    } else if (['RUNNING', 'STARTING', 'RETRYING'].includes(output.runtime_state) && ['STALE', 'UNKNOWN'].includes(output.evidence?.local?.freshness)) {
      reasons.push(reason('OUTPUT_RUNTIME_EVIDENCE_UNTRUSTED', 'WARNING', 'Output runtime is requested but its local evidence is stale or unavailable.', output.id, 'single_output'));
    }
  }

  const pushExpected = (workspace.outputs || []).some(o => o.mode === 'PUSH' && o.control_mode !== 'LEGACY_UNMANAGED' && o.desired_state === 'RUNNING');
  const pushWorker = workspace.evidence?.workers?.push;
  if (pushExpected && pushWorker && !pushWorker.available) {
    reasons.push(reason('PUSH_WORKER_UNAVAILABLE', 'WARNING', 'Managed PUSH is requested but its worker heartbeat is unavailable.', null, 'outputs'));
  }
  const transcodeExpected = (workspace.renditions || []).some(r => r.kind === 'TRANSCODE' && r.desired_state === 'RUNNING');
  const transcodeWorker = workspace.evidence?.workers?.transcode;
  if (transcodeExpected && transcodeWorker && !transcodeWorker.available) {
    reasons.push(reason('TRANSCODE_WORKER_UNAVAILABLE', 'WARNING', 'A rendition is requested but the Transcode Worker heartbeat is unavailable.', null, 'dependent_outputs'));
  }

  const pullWorker = workspace.evidence?.workers?.pull;
  const pullExpected = (workspace.sources || []).some(s => s.kind === 'IN_PULL' && s.compatibility?.desired_state === 'RUNNING');
  if (pullExpected && pullWorker && !pullWorker.available) {
    reasons.push(reason('PULL_WORKER_UNAVAILABLE', state === 'NO_PROGRAM' ? 'CRITICAL' : 'WARNING', 'Managed Pull is requested but its worker heartbeat is unavailable.', null, state === 'NO_PROGRAM' ? 'program' : 'redundancy'));
  }

  if (reasons.some(r => r.severity === 'CRITICAL')) return { status: 'CRITICAL', reasons };
  if (reasons.some(r => r.severity === 'WARNING')) return { status: 'DEGRADED', reasons };
  return { status: 'NORMAL', reasons: state === 'NO_PROGRAM' ? [reason('OFF_AIR_EXPECTED', 'INFO', 'No Program is observed and no current desired runtime requires one.', workspace.program?.id, 'none')] : [] };
}

module.exports = { evaluateWorkspace, expectedProgram };
