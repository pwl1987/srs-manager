const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePullSwitchRecovery } = require('../services/pull-switch-recovery');

const operation = { payload: { from_source_id: 10, target_source_id: 20 } };

test('failed switch preserves the old managed Program when it is still running', () => {
  assert.deepEqual(decidePullSwitchRecovery({ operation, processState: { sourceId: 10 }, publisherObserved: true, activeSourceId: 10 }), { action: 'preserve_current', source_id: 10 });
});

test('failed switch leaves an observed old publisher untouched when ownership is uncertain', () => {
  assert.deepEqual(decidePullSwitchRecovery({ operation, processState: null, publisherObserved: true, activeSourceId: 10 }), { action: 'preserve_observed', source_id: 10 });
});

test('failed target start rolls back to the previous source after break-before-make', () => {
  assert.deepEqual(decidePullSwitchRecovery({ operation, processState: null, publisherObserved: false, activeSourceId: 20 }), { action: 'rollback', source_id: 10 });
});
