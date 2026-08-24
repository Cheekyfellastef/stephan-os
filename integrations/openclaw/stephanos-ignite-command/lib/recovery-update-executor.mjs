import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Kept as an inert compatibility tombstone so an old scheduled invocation or
// a forged receipt cannot become a disk-triggered mutation consumer. Exact-head
// source/runtime authority exists only inside the already-loaded authenticated
// owner command callback.
export async function executeQueuedOpenClawUpdate() {
  return Object.freeze({
    ok: false,
    status: 'BLOCKED',
    finalVerdict: 'DISK_TRIGGERED_UPDATE_DISABLED',
    blocker: 'DISK_TRIGGERED_UPDATE_DISABLED',
    sourceMutationAttempted: false,
    runtimeMutationAttempted: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await executeQueuedOpenClawUpdate();
  process.exitCode = 86;
}
