const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePullSwitchStep } = require('../services/pull-switch-machine');

function op(state, extra = {}) {
  return {
    state,
    payload: { target_source_id: 20 },
    created_at: '2026-09-17 00:00:00',
    started_at: '2026-09-17 00:00:01',
    ...extra
  };
}

test('manual switch uses break-before-make and verifies managed ownership', () => {
  assert.equal(decidePullSwitchStep({ operation: op('QUEUED'), processState: { sourceId: 10 }, publisherObserved: true }).action, 'stop_current');
  assert.equal(decidePullSwitchStep({ operation: op('QUEUED'), processState: null, publisherObserved: true }).action, 'begin_stop_wait');
  assert.equal(decidePullSwitchStep({ operation: op('STOPPING'), processState: null, publisherObserved: false }).action, 'activate_target');
  assert.equal(decidePullSwitchStep({ operation: op('STARTING'), processState: null, publisherObserved: false }).action, 'start_target');
  assert.equal(decidePullSwitchStep({ operation: op('STARTING'), processState: { sourceId: 20 }, publisherObserved: false }).action, 'mark_verifying');
  assert.equal(decidePullSwitchStep({ operation: op('VERIFYING'), processState: { sourceId: 20 }, publisherObserved: true }).action, 'succeed');
});

test('manual switch never claims an unowned publisher and survives worker restart safely', () => {
  assert.equal(decidePullSwitchStep({ operation: op('STARTING'), processState: null, publisherObserved: true }).action, 'fail');
  assert.equal(decidePullSwitchStep({ operation: op('VERIFYING'), processState: null, publisherObserved: true }).action, 'fail');
  assert.equal(decidePullSwitchStep({ operation: op('VERIFYING'), processState: null, publisherObserved: false }).action, 'start_target');
  assert.equal(decidePullSwitchStep({ operation: op('VERIFYING'), processState: { sourceId: 99 }, publisherObserved: false }).action, 'fail');
});

test('manual switch fails if the old publisher never drains', () => {
  const decision = decidePullSwitchStep({
    operation: op('STOPPING'),
    processState: null,
    publisherObserved: true,
    nowMs: Date.parse('2026-09-17T00:00:20Z'),
    stopTimeoutMs: 5000
  });
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /did not disappear/);
});
