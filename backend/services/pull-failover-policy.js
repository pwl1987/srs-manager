function decidePullFailure({
  attempt,
  maxAttempts,
  sourceMaxAttempts,
  sources = [],
  activeSourceId
}) {
  const tries = Math.max(1, Number(attempt || 0));
  const totalLimit = Math.max(1, Number(maxAttempts || 1));
  const perSourceLimit = Math.max(1, Number(sourceMaxAttempts || 1));
  const enabled = sources
    .filter(source => source.enabled && source.source_status === 'active')
    .sort((a, b) => Number(a.priority) - Number(b.priority));

  if (enabled.length > 1 && tries >= perSourceLimit) {
    const currentIndex = enabled.findIndex(source => Number(source.external_source_id) === Number(activeSourceId));
    const next = currentIndex < 0 ? enabled[0] : enabled[currentIndex + 1];
    if (next) return { action: 'failover', next_source_id: Number(next.external_source_id) };
    return { action: 'failed', reason: 'all_sources_exhausted' };
  }

  if (tries >= totalLimit) return { action: 'failed', reason: 'attempts_exhausted' };
  return { action: 'retry' };
}

module.exports = { decidePullFailure };
