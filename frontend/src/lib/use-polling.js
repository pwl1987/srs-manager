import { useEffect, useRef } from 'react';

// Runs `fn` immediately and again every `intervalMs`. Skips ticks while the
// tab is hidden so background pages stop hammering the API.
export function usePolling(fn, intervalMs, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    fnRef.current();
    const timer = setInterval(() => {
      if (document.hidden) return;
      fnRef.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
}
