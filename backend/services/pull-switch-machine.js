function timestampMs(value) {
  if (!value) return null;
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : String(value).replace(' ', 'T') + 'Z';
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decidePullSwitchStep({
  operation,
  processState,
  publisherObserved,
  nowMs = Date.now(),
  stopTimeoutMs = 10000,
  startupTimeoutMs = 15000
}) {
  if (!operation) return { action: 'none' };
  const targetSourceId = Number(operation.payload?.target_source_id);
  if (!Number.isInteger(targetSourceId) || targetSourceId <= 0) {
    return { action: 'fail', reason: 'Switch operation has no valid target source' };
  }

  const processSourceId = processState ? Number(processState.sourceId) : null;
  const matchesTarget = processState && processSourceId === targetSourceId;

  switch (operation.state) {
    case 'QUEUED':
      if (processState) return { action: 'stop_current', target_source_id: targetSourceId };
      if (publisherObserved) return { action: 'begin_stop_wait', target_source_id: targetSourceId };
      return { action: 'activate_target', target_source_id: targetSourceId };

    case 'STOPPING': {
      if (processState) return { action: 'stop_current', target_source_id: targetSourceId };
      if (publisherObserved) {
        const started = timestampMs(operation.started_at || operation.updated_at || operation.created_at);
        const expired = started != null && nowMs - started > stopTimeoutMs;
        return expired
          ? { action: 'fail', reason: 'Current publisher did not disappear before switch timeout' }
          : { action: 'wait', target_source_id: targetSourceId };
      }
      return { action: 'activate_target', target_source_id: targetSourceId };
    }

    case 'STARTING':
      if (processState && !matchesTarget) {
        return { action: 'fail', reason: 'Managed process source does not match switch target' };
      }
      if (processState) return { action: 'mark_verifying', target_source_id: targetSourceId };
      if (publisherObserved) return { action: 'fail', reason: 'Publisher appeared without managed switch process ownership' };
      return { action: 'start_target', target_source_id: targetSourceId };

    case 'VERIFYING':
      if (processState && !matchesTarget) {
        return { action: 'fail', reason: 'Managed process source does not match switch target' };
      }
      if (processState && publisherObserved) return { action: 'succeed', target_source_id: targetSourceId };
      if (processState) {
        const started = Number(processState.startedAt);
        const expired = Number.isFinite(started) && started > 0 && nowMs - started > startupTimeoutMs;
        return expired
          ? { action: 'fail', reason: 'Timed out waiting for target publisher observation' }
          : { action: 'wait', target_source_id: targetSourceId };
      }
      if (publisherObserved) return { action: 'fail', reason: 'Publisher appeared without managed switch process ownership' };
      // Worker restart / lease takeover may lose the in-memory child map while
      // preserving the operation. If SRS observes no publisher, restarting the
      // selected target is safe and lets the operation resume.
      return { action: 'start_target', target_source_id: targetSourceId };

    default:
      return { action: 'none' };
  }
}

module.exports = { decidePullSwitchStep };
