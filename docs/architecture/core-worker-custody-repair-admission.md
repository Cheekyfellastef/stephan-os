# Core worker custody and repair admission

This structural review follows repeated independent source findings on PR #3189.
A missing or stale heartbeat is a dependency fault, not proof that a worker is
absent, and a return from one repair routine does not fence other callers.

## Observed call graph and owners

- Core heartbeat samples worker evidence and runs `maybeRepairCoreDependencies`.
  Its former direct task-start route is removed. Every unhealthy worker reports
  `MISSION_WORKER_CUSTODY_UNPROVEN`; it never authorises a replacement worker.
- The same heartbeat then called `maybeStartPersistentFlywheel` independently.
  Flywheel/Octopus recovery can invoke `repair-goal-builder-flow`, whose fixed
  repair includes worker task start. Holding the dependency routine alone did
  not fence this indirect route.
- Worker-dependent Core work is now admitted at that orchestration entry only
  when the sampled worker is explicitly healthy with a measured fresh age. A
  missing, malformed, contradictory or stale sample holds the entire newly
  requested Flywheel cycle before fingerprints, refill, or repair can run.
- The heartbeat and read-only observations continue. The existing backend
  dependency action is separate; its source does not start the Mission Worker.
  Its proof is retained even when worker custody remains held.
- Existing native worker/watchdog/lease owners retain restart qualification.
  This change neither qualifies an orphan nor releases R7, and direct operator
  actions remain under their own separately guarded authority.

## Model and tests

One shared `coreWorkerDependentWorkAllowed` predicate rejects unknown or stale
evidence, including a forged healthy boolean with no measured age. The actual
Flywheel entry is exercised with missing/stale samples and a forbidden downstream
fingerprint probe. This checks the indirect edge rather than another caller-local
age exception. Separate tests cover direct dependency hold, independent backend
repair, cooldown, gaming and fresh post-action verification.

Guardian health verdicts derive from the computed cycle result: every failed
cycle is BLOCKED, even when the child emits an inconsistent green verdict.
Original typed blockers remain separately visible.

## Deliberately unqualified boundaries

This is admission of a new Core cycle, not cancellation of an already active
Windows child. It does not qualify existing arbitrary/direct task callers,
descendant cleanup, native process exclusion, or a stale historical lease.
Those require their existing independent Windows witness and protected owner.
PR #3188 remains held for its active-child gaming and descendant-custody findings.

## Async boundary follow-up

Cycle-entry admission is not a lease on future worker evidence. A refill or
control-plane action may await long enough for its heartbeat to expire. Every
Octopus maintenance edge now uses the existing shared dispatch function to
re-sample the heartbeat immediately before envelope construction/execution.
Missing, malformed or stale evidence holds initial goal-builder, control-plane
and retry alike. A behavioral test executes that actual function for all three
phases while changing fresh evidence to unknown/stale between invocations.
This remains a freshness admission check, not atomic OS lifecycle exclusion.

The caretaker now projects an observed timeout hold and refuses Commander
recycling/start in its presence, including capability-version mismatch. The
held process remains the custody owner, reports unhealthy, and is never replaced
merely to restore a liveness count. A native PowerShell fixture exercises the
actual health projection and lifecycle branch with all mutations mocked.

This closes the caretaker's automatic recycle path, not persistence across an
external crash/reboot or an independent OS custody certificate. Those remain
unqualified; activation must preserve that hold and the affected Windows estate
requires fresh specialist qualification. Do not clear timeout custody from
heartbeat age, child kill/close, a current source head or this regression.

## Shared lifecycle boundary replaces caller-only fencing

Another full review exposed the guardian -> repair-stephanos -> goal-builder
route bypassing Core entry checks. The structural correction is at the common
goal-builder boundary: it now measures worker heartbeat freshness before its
mutating refill, and the worker task-start step is removed entirely. No Core,
guardian, mailbox or direct goal-builder caller can use heartbeat loss to start
a replacement Mission Worker. Fresh evidence admits the existing refill only;
worker lifecycle recovery belongs to its independently qualified native owner.
Caller observations remain diagnostic defenses, not the lifecycle authority.

Behavioral tests exercise the actual shared function with fresh, missing,
malformed, unreadable and stale evidence; existing repair tests verify that
refill can continue with a fresh worker and never starts a Mission Worker.
