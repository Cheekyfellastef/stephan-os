# Temporary Sovereign Lease Rescue Lane V1 (emergency source slice)

Operator authority: 12 October 2026; canonical original repair #2961;
out-of-band recovery owner #1814; full sovereignty #3026.

## Why this exists

The original #2962 r7 source-mutation lease can block the canonical elastic
goal scheduler even when unrelated observational work is safe. Simply adding
another logical controller would replay the same authority blockage, not fix it.

This bounded module is a **separate read-only observer plus a caller of the
existing exact-bound canonical lease reconciler**. It does not claim a new
source-mutation plane. It can gather original-worker queue forensics and retry
the existing canonical recovery authority without depending on elastic goal
admission. It is not an alternate source writer.

## Implementation

- `scripts/temporary-sovereign-lease-rescue.mjs --once` executes one bounded
  cycle; `--watch` repeats no faster than once per 60 seconds.
- Reads the original source lease through existing Programme Authority, the
  original worker queue through `inspectOriginalTerminalWorkerPairV1`, and
  current missions through the existing store.
- Only for a stale, valid, expired canonical lease and a proven exact local
  source HEAD does it invoke **the existing**
  `reconcileExpiredElasticReviewLeaseV1`. The invoked function owns all
  cancellation, original terminal receipt, exact binding, in-flight queue,
  and authoritative release checks. A terminal queue pair alone NEVER permits
  release.
- Persists bounded `status/temporary-sovereign-rescue-lane-current.json`
  using existing safe Shared Workspace writer. The status intentionally stays
  HELD even after release, until physical worker pickup and two unattended
  refills are separately proven by the canonical conveyor.
- If the original queue is mismatched or missing, retain
  `REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN` and direct isolated
  source repair preparation to the existing original owner and PR #3023,
  rather than fabricate a receipt or release a lease.

## What this does NOT do

- No second scheduler, worker, source checkout mutation or global lease.
- No direct `unlink`, force-release, lease seizure, queue deletion, merge,
  deployment, arbitrary shell, PC restart or permission expansion.
- Does not validate or backfill historical evidence by guess.
- No claim that source-level code is installed, supervised or executing on
  Battle Bridge merely because this PR exists or CI passes.
- The `--watch` mode itself does not provide Windows boot persistence or
  single-instance OS supervision. The source integration in the existing
  Windows Recovery Mesh calls the original guarded observer **in process**
  only after canonical task, path, mutex, source and healthy-control-plane
  checks pass. It uses no second process, shell, scheduler or new lease.
  Failure reports remain independent of Recovery Mesh's protected status.
  The existing Recovery Mesh task supervisor remains responsible for overall
  runtime deadlines; no abortable in-process deadline is claimed. This attaches
  to an *existing task*, not a new daemon or Scheduled Task.
- As with all source changes, the new Recovery Mesh attachment does **not**
  become live merely when CI passes. Protected merge, Battle Bridge source
  sync, Windows specialist review and a real task-cycle receipt remain gates.

## Gates to live operation

1. Run `node --test shared/agents/temporarySovereignLeaseRescueV1.test.mjs`
   and relevant lease authority tests; independently review the exact PR head.
2. Protected merge and source-head-safe deployment to Battle Bridge.
3. After protected merge and deployment, prove that the **existing**
   Recovery Mesh Scheduled Task invokes the source-attached guarded observer
   on an eligible Windows cycle; prove single-flight, fault containment and
   task-supervised restart endurance. Do not separately start `--watch` as a second owner.
4. Obtain fresh status for the real #2962 r7 original; reconcile only exact
   terminal/original-owner evidence. If it remains mismatched, repair the
   original source chain using an isolated reviewed branch (PR #3023)
   without touching the occupied canonical checkout.
5. Prove exact canonical release, actual worker pickup, material source
   action, tests, reviewed protected merge, live runtime state, and two
   unattended refill cycles. Deactivate continuous rescue mode after
   recovery and retain its read-only visibility as a standing sovereign
   lifeboat capability.

## Future growth

The rescue observer can become a permanent independent *recovery ingress*
for other authority deadlocks, but it must not become a rival mutation
controller. Each repair class needs its own exact-authority proof and
guarded handback to the canonical worker fabric.
