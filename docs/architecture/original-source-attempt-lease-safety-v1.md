# Original attempt quarantine and exact lease release (#2961)

## Physical defect and preserved truth

The original #2962 r7 lease has no authentic r7 execution receipt or exact r7 terminal queue pair. Historical intake revision r0 was incorrectly classified as a current-attempt binding mismatch. Recognizing canonical r0 yields five historical terminal records and ORIGINAL_EXACT_TERMINAL_PAIR_NOT_FOUND; it grants no release authority. STOP on PR #2987 and an idle supervised worker do not prove detached-writer nonactivity.

The canonical consumed AGENT_RESULT_RECEIVED event instead identifies the actual original source action. Its authentic completed r1 receipt retains its original head, PR 0 and r1 lease. The pre-PR queue schema carries a null PR, empty PR head and an exact sourceRevision; the authentic receipt encodes that same pre-PR identity as PR 0 and sourceHead. Both representations are checked explicitly. Those identities must never be rewritten to resemble the later r7 PR-head lease. Provider result IDs remain opaque. Missing, duplicate or unprocessed consumed events HOLD.

## Existing authority, one bounded transition

This repair extends the existing owner-authenticated CANCEL_MISSION_ORCHESTRATOR_MISSION command with three indivisible fields: originalLeaseId, originalLeaseDigest and expectedMissionRevision. The canonical mailbox still checks owner identity, repository, expiry and exact current-main head. The handler adds that observed head and request ID to the durable audit. No generic command, path, process-kill, force-release, merge or scheduler authority is added.

Quarantine requires the exact expired canonical mission-worker lease, REPAIR_REQUIRED at its bound revision and complete original source dispatch. It verifies every authenticated execution chain on the held lease is terminal (an empty verified history is recorded as zero, never synthesized as completion); independently resolves the consumed source action; requires its authentic completed receipt and a complete, successful, tests-passed source queue/result pair with all original source identities; and inspects pending/processing in every known and physically present queue adapter. Unknown or active proof HOLD. The source pair is hashed without rewriting either file.

The positive source completion argument is bounded to the provider-neutral synchronous source pipeline: edits, required tests, escrow and authentic completion happen before movement of the source pair to completed. It does **not** prove that an admitted script did not spawn a detached descendant which can mutate source after the direct child exits. Therefore a completed pair and idle queues remain `SAFE_HOLD` unless an existing authority adapter authenticates positive writer-exclusion evidence bound to the exact mission, original source execution, whole lease digest, repository, branch and head. Missing, unauthenticated, replayed or mismatched evidence cannot create a fence. This repair adds only that fail-closed source gate; it does not claim that fleet evidence currently exists or perform a live release.

Under the existing mission lock and canonical lease-operation lock, the entire original lease record is compared again, then the existing mission cancellation event commits originalSourceAttemptFence in canonical storeMetadata. The event contains the same fence, source receipt/pair hashes, original lease hash/revision, source-main head and operator request/command identity. There is no second fence database. State-write/event-write interruption leaves cancellation in force but release blocked by the missing audit. Restart and duplicate-command replay preserve the same fence.

## Writer exclusion and release

Queue claim, processing pickup, action publication, result collection, source construction after provider response, source commit, lease claim and renewal consult the canonical cancellation/fence. Direct Forge publication holds the existing mission lock through all remote mutations, so cancellation cannot race a preflight check. Queue claims racing cancellation must acquire the mission lock before writer invocation. The existing supervised worker reloads after canonical source changes; no additional worker is created.

Only the original expired-lease reconciler consumes the fence. It rechecks canonical cancellation at original revision + 1, the unique consumed cancellation audit, authentic source receipt, unchanged terminal pair, terminal held-lease chains and all original queues, then calls Programme Authority's guarded exact-lease release with the whole original lease digest. The fence itself now durably binds the authenticated writer-exclusion receipt and digest. A changed/renewed lease, incomplete audit, active queue, altered pair, unknown history, or absent/mismatched physical containment proof HOLD. Ordinary STOP, parked phases and plain cancellation retain the strict receipt requirements. Parking can no longer bypass the original-owner guard.

The lease is not force-deleted. The original worktree, dirty source, artifact, outbox, receipt history and superseded PR remain preserved. Releasing this source attempt cannot establish goal acceptance or deployment.

## Goal and retry boundary

The same unfinished #2962 goal remains in existing canonical containment pending verified capability/blocker change and a legal new admission. Already merged #3000 stays accepted work. This patch does not invent automatic goal requeue, mark the goal complete, duplicate a scheduler or establish #2955 material pickup. Capability-aware deferred retry and two unattended refills require separate real conveyor receipts after safe lease release.

## Proof and risks

High-risk runtime authority change: specialist and independent exact-head review plus existing operator-protected merge are required. Focused regressions cover canonical history, opaque result namespace, an actual detached Node descendant, missing/mismatched writer-exclusion evidence, terminal-pair schemas, active exact r7 execution hidden by r1 completion, lease renewal/CAS race, queue uncertainty, canonical cancellation durability/replay, provider-response-to-edit fencing and a remote publisher/cancellation lock race. The complete relevant worker/lease/publication/mailbox suite must pass before publication; the existing symlink receipt test additionally needs the hosted Linux runner because Windows sandbox cannot create that symlink.

Architectural debt: the historical r7 attempt did not record a source execution receipt at its revision. The fix preserves that absence. Before claiming recovery, publish distinct real receipts for STOP acknowledgement, original attempt fenced, exact lease released, same goal deferred/requeued, next claim, material source/test result, protected merge and live proof. Source review is not physical completion.
