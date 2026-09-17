function decidePullSwitchRecovery({ operation, processState, publisherObserved, activeSourceId }) {
  const fromSourceId = Number(operation?.payload?.from_source_id);
  if (!Number.isInteger(fromSourceId) || fromSourceId <= 0) return { action: 'unrecoverable', source_id: null };

  const processSourceId = processState ? Number(processState.sourceId) : null;
  if (processState && processSourceId === fromSourceId) {
    return { action: 'preserve_current', source_id: fromSourceId };
  }
  if (!processState && publisherObserved && Number(activeSourceId) === fromSourceId) {
    return { action: 'preserve_observed', source_id: fromSourceId };
  }
  return { action: 'rollback', source_id: fromSourceId };
}

module.exports = { decidePullSwitchRecovery };
