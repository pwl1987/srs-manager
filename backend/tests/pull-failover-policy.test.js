const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePullFailure } = require('../services/pull-failover-policy');

test('pull failover policy advances toward fallbacks and never auto-wraps', () => {
  const sources = [
    { external_source_id: 10, priority: 1, enabled: true, source_status: 'active' },
    { external_source_id: 20, priority: 2, enabled: true, source_status: 'active' }
  ];

  assert.deepEqual(
    decidePullFailure({ attempt: 2, maxAttempts: 8, sourceMaxAttempts: 3, sources, activeSourceId: 10 }),
    { action: 'retry' }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 3, maxAttempts: 8, sourceMaxAttempts: 3, sources, activeSourceId: 10 }),
    { action: 'failover', next_source_id: 20 }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 3, maxAttempts: 8, sourceMaxAttempts: 3, sources, activeSourceId: 20 }),
    { action: 'failed', reason: 'all_sources_exhausted' }
  );
});

test('single-source pull preserves the total retry budget', () => {
  const source = [{ external_source_id: 10, priority: 1, enabled: true, source_status: 'active' }];
  assert.deepEqual(
    decidePullFailure({ attempt: 7, maxAttempts: 8, sourceMaxAttempts: 3, sources: source, activeSourceId: 10 }),
    { action: 'retry' }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 8, maxAttempts: 8, sourceMaxAttempts: 3, sources: source, activeSourceId: 10 }),
    { action: 'failed', reason: 'attempts_exhausted' }
  );
});
