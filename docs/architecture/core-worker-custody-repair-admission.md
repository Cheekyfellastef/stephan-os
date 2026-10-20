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
