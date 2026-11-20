// Cancellation belongs to a subscriber, not to the shared operation it awaits.
// Always observe settlement, including rejection after the subscriber has left.
export function throwIfWorkspaceReadAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Workspace read cancelled', 'AbortError');
}

export function waitForWorkspaceRead(operation, signal) {
  const pending = Promise.resolve(operation);
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Workspace read cancelled', 'AbortError'));
    };
    pending.then(value => {
      cleanup();
      if (signal.aborted) onAbort();
      else resolve(value);
    }, error => { cleanup(); reject(error); });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
