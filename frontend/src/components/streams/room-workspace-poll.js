// PHASE-09 room workspace poller: pure module (no React, no DOM) so the
// three protection rules are unit-testable — stale responses are discarded
// when the poller is stopped (room switched / panel closed), and hidden pages
// poll at a lower frequency until resumed.
export function createRoomWorkspacePoller({
  fetchWorkspace,
  onWorkspace,
  onError = () => {},
  intervalMs = 2000,
  backgroundIntervalMs = 20000,
  isHidden = () => false,
  schedule = (...args) => setTimeout(...args),
  cancel = (...args) => clearTimeout(...args)
} = {}) {
  if (typeof fetchWorkspace !== 'function') throw new Error('fetchWorkspace is required');
  let stopped = false;
  let timer = null;
  let inFlight = false;

  function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    fetchWorkspace()
      .then(workspace => { if (!stopped) onWorkspace(workspace); })
      .catch(error => { if (!stopped) onError(error); })
      .finally(() => {
        inFlight = false;
        if (stopped) return;
        timer = schedule(tick, isHidden() ? backgroundIntervalMs : intervalMs);
      });
  }

  return {
    start() {
      if (stopped || timer || inFlight) return;
      tick();
    },
    // Immediate re-poll after a user action (also used to resume from background).
    refresh() {
      if (stopped) return;
      cancel(timer);
      timer = null;
      tick();
    },
    isStopped() {
      return stopped;
    },
    stop() {
      stopped = true;
      cancel(timer);
      timer = null;
    }
  };
}

// React effect wiring shared by any surface embedding the room poller:
// starts polling, resumes immediately when the page becomes visible, and
// disposes cleanly on room switch/unmount. `doc` is injectable for tests.
export function startRoomWorkspacePolling({ roomId, fetchWorkspace, onWorkspace, onError, doc = globalThis.document }) {
  const poller = createRoomWorkspacePoller({ fetchWorkspace, onWorkspace, onError });
  poller.start();
  const onVisibility = () => { if (!doc?.hidden) poller.refresh(); };
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
  return {
    poller,
    dispose() {
      poller.stop();
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
