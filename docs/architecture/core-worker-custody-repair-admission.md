# Core worker custody and repair admission

## Negative supervisor evidence is a completed outcome

The existing coordination task supplied a bounded producer/consumer correction
(source patch SHA256 `81e15a75a82464591dcc314016b2332c93f5c7ab043c7aa72ae94444077dfae5`).
The fixed supervisor exits 2 with a complete BLOCKED report; dropping every
`ok:false` child result erased its original R7 hold and attempted discovery again.
The new real-child regression reproduced this on the combined branch before
adoption, reaching `goal-discovery-heartbeat` under the missing original receipt.

Parsing now retains only a completed exit-2 negative report with exact supervisor
schema, `ok:false`, exact BLOCKED verdict, safe typed blocker and matching child
errorCode when present. This can preserve original-owner HOLD only; existing
success/pickup gates stay separate. Timeout/transport, wrong schema, inconsistent
verdict, exit 1 and contradictory error codes cannot take that shortcut.
Real spawned Node fixtures cover all seven original-owner blockers; no runtime
repair child is executed. The shared validated worker reader and removed worker
bootstrap remain intact. This adopts preparation into the existing branch and
owner rather than creating another source writer or claiming commissioning.

Readonly maintenance classification is based on behavior, never a `status`
name. Review of 8dc97ceee7 identified gaming Status's missing-state reconciliation
and possible process eviction; that action now requires owner admission too.
The opaque OpenClaw status/plugin-inspection CLI likewise gets no observation
bypass without a proved nonmutating closure. The remaining fixed observational
scripts were inspected for stateful fallbacks. A native fixture executes the
actual gaming Status branch with harmless mocked reconciliation to demonstrate
why it must be fenced; the actual common executor proves both maintenance and
START_PROCESS aliases cannot launch it under held, busy or unknown custody.

## Complete worker-dependent source boundary after 582c487f37 review

That review found the same invariant still violated in Core's direct refill:
the repair wrapper validated record bytes, but Core's sampler and maintenance
resampling still used mtime. The structural correction extracts ONE canonical
bounded worker-evidence reader/predicate, reused by repair, Core sample,
post-dependency verification, Octopus maintenance and Flywheel entry. The old
mtime reader is removed. Cached green cycle input cannot replace a fresh
validated canonical record at Flywheel entry.

The mutating `runBattleBridgeGoalDiscoveryHeartbeat` entry itself now checks
this same evidence before any work, before each conveyor attempt and again
after awaited queue/capacity work immediately before each source build. Thus
direct Core verification refill, ordinary Core refill, standalone invocation
and repair invocation cannot bypass the common source-building boundary.
Lost evidence holds the same cycle without manufacturing another owner.
The existing source-builder/lease/governor remain the execution authorities;
heartbeat validation alone still never proves Windows process exclusion.

Native behavioral regressions run the actual Core sampler with corrupt/foreign
records and exercise actual direct refill both before admission and after
capacity/conveyor work expires its evidence. Existing source-only fixtures
explicitly inject worker evidence instead of relying on this machine's heartbeat.
The PR and main workflow path inventories are identical and cover the complete
three-script Windows estate, reviewer composition/child/boundary, shared reader,
publisher, Core, refill and regression sources. A contract test checks isolated
changes against the native Windows job's trigger and fixture inventory.

## Current structural correction after review of 9d09b599dc

The previous mtime gate and custom-workspace acceptance are superseded. Actual
worker heartbeat bytes must be a bounded regular JSON file, validated by the
existing `projectMissionWorkerHeartbeat` against the canonical repository and
its observed main head, task, PID, launch identity, process-start order and tick
verdict. Future/stale/corrupt/unrelated records hold. Filesystem mtime is not
admission evidence. The supervisor itself can reconcile/dispatch, so validation
now precedes its first invocation and repeats before refill and final supervision.
Git identity observation reuses the existing fixed executable, closed environment
and canonical repository arguments, not inherited Git configuration or PATH.

Canonical Windows publishers and witnesses still target the default workspace.
Live repair therefore REFUSES a nondefault workspace rather than pretending its
worker can publish there. The existing refill resolver preserves its configuration
precedence, but no override can inherit live-worker admission until the complete
publisher/witness estate is separately adapted and qualified. This does not add
Windows path authority or silently redirect mutation to the default tree.

Fixed maintenance execution now belongs to the existing authenticated HTTP
guardian owner. Core and stdio callers delegate to that owner; they never use a
health snapshot as permission or launch a local fallback. The owner synchronously
reserves maintenance before awaiting execution, cancels its next scheduled cycle,
and refuses concurrent requests or timer entry. Fixed mutation runs asynchronously
so owner health remains observable while the reservation is held. Receipts retain
the original mission and the authenticated owner's command/proof identity.

Unknown, signalled or timed-out execution retains custody and prevents another
cycle. A late close cannot clear that hold. The native caretaker also refuses to
replace an owner with maintenance in flight, even for a stale capability version.
An absent or old-protocol owner holds delegation without starting a replacement.
This serializes this source owner's direct execution only; protected Windows
roots, descendant exclusion across process crashes/restarts and original R7
reconciliation remain separate commissioning requirements.

The full dispatch inventory includes the late durable reconciliation after awaited
refill/self-heal. Core revalidates canonical worker evidence immediately before
that entry. Both workflow event filters and the native fixture inventory include
the shared Core state model and its tests.

Behavioral regressions exercise corrupt/foreign heartbeat bytes, expiry between
steps, every maintenance alias, authenticated owner delegation with no local child,
a scheduled timer fired during a reserved operation, concurrent requests, responsive
health, timeout/late-close retention and actual PowerShell caretaker decisions.
Earlier sections below retain the source history and are superseded where they
describe numeric mtime-only freshness or usable configured-workspace evidence.

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

Workspace selection is also an authority binding: custody observation and
refill now share `resolveGoalDiscoveryWorkspaceV1`, preserving refill's explicit
builder-root, builder-env, process-env and fallback precedence. The custody
gate cannot consult an unrelated legacy OpenClaw/default tree. Regression
checks precedence and the actual repair admission with stale/fresh configured
evidence, including a fresh default tree that must not authorize that target.

## Composition with the protected reviewer denial repair

The protected merge of PR #3200 supplies a closed, redacted pre-execution
failure for the Windows reviewer. The asynchronous owner introduced here
consumes both synchronous spawn throws and child `error` events before that
outer exception boundary. Without an explicit common failure path, it could
return a raw error code or partial output instead of the fixed denial.

Both async aliases now return the same typed reviewer HOLD with unknown exit
status and empty output. The first terminal result remains authoritative;
a later `close(0)` cannot turn a failed launch green. Other fixed processes
retain their existing error classification. Regression tests exercise actual
async dispatch through both aliases, hostile error fields/partial output and
late close, without a real reviewer/model/process launch. This changes neither
specialist qualification nor source-writer, signing or lease authority.

## Protected-main reconciliation — 23 October 2026

Continue the original #2961 branch from `842c1a0e` with protected main
`5e5765eb`. Two semantic conflicts occur in the Core Windows reviewer and
its pinned composition. Preserve the successor's complete three-script estate
and main's exact v4/v6 capability-generation support together: each source pin
is an immutable array, and membership uses exact array equality. The v6
counterpart differs from the successor v4 runner only in the fixed capability
default. The composition binds the resulting exact child blob. These candidate
pins still require independent specialist and protected bootstrap admission;
they cannot qualify their own PR.

Preserve the original exit-2 BLOCKED supervisor correction byte-for-byte. The
real spawned exit-2 regression and malformed/contradictory negative-report
checks pass on the combined source. The complete regression run also exposed
two newer reviewer-custody tests expecting a nonexistent blocker literal. They
now assert the canonical shared custody constant while retaining no-second-
launch, timeout hold, scheduling and forged-provenance checks. Production
classification and custody are unchanged by that test correction.

This is source reconciliation only. Original R7 custody, independent Windows
commissioning, exact-head protected approval and actual pickup/refill acceptance
remain held. Existing Battle Bridge dirty files are outside this worktree.

After the blocker assertion correction, the real-owner test reached its final
null-close scenario and exposed partial reviewer output escaping an unknown
completion. Redaction previously lived only in the error-event handler. The
shared async terminal boundary now discards reviewer output on unknown exit,
signal or execution error, while preserving known-exit structured HOLD reports.
The same real-owner regression now also tests signal close. Unknown custody
still parks the guardian; no pre-spawn provenance is invented.

## Structural terminal-custody review — nested wrapper failures

The independent f0cd0982 review found a second route to unknown descendants:
a repair wrapper can return exit 2 normally while its internal heartbeat child
timed out. Direct-child status alone therefore cannot authorize another cycle.
The structural invariant is monotone: any nested timeout, abort, unknown step
status or signal retains the original owner's custody, regardless of a parent
exit 0/2, an unrelated top-level blocker or later successful close.

The shared maintenance admission model now owns that classification for both
scheduled repair and manual owner reservation. It scans only bounded structured
terminal step evidence; malformed, repeated or oversized graphs hold. Known
completed ordinary negative supervisor reports still use existing paced retry.
The independently proven pre-spawn reviewer exception remains private and
separate; nested evidence cannot mint it or release an existing custody latch.

The regression executes both actual production wrappers with injected internal
ETIMEDOUT/ABORT_ERR, then supplies their real negative results to both manual
aliases and the actual scheduled guardian. It failed against the previous
candidate before correction and passes after correction. The invariant matrix
varies error fields, nesting depth and positive/negative outer exit, plus cycle,
null-step and budget attacks. No assertion is weakened and no process or lease
exclusion is fabricated. Cross-restart Windows custody remains independently
unqualified; this model does not install a witness or release R7.

## Full fixed-wrapper protocol inventory and control-plane custody

The next exact-head review identified the missing third protocol: control-plane
repair emits bare JSON, not a marker, and its lower reconciler can compact away
native timeout details. The structural review therefore covers all three actual
repair wrappers and their serializer/projection boundaries. The shared parser
now accepts their exact source schemas in the established marker or bare-JSON
formats, with a 64 KiB bound, and the classifier follows bounded repair, task
and execution-evidence records as well as steps. An unknown schema grants no
receipt authority.

Before calling the existing reconciler, the control-plane wrapper now retains
bounded raw terminal status/signal/error evidence from its existing injected
spawn primitive. After unknown custody or the evidence budget is reached, no
further child launches occur. Native errors and reconciler exceptions return a
fixed custody HOLD without raw diagnostics; this survives lower work-conserving
projection as a top-level typed blocker and structured evidence. Known completed
non-timeout operations retain their original behavior. No installer, executable,
command argument, source root, task, lease or approval authority is enlarged.

The actual wrapper and actual-owner regressions failed on the prior source:
the reconciler launched a second child after a timeout, and the parser ignored
the real bare-JSON receipt. They now pass for timeout, abort, signal, spawn error,
buffer error and reconciler exception, including suppression of subsequent
calls and hostile output. Both PR/main workflow filters and the native Windows
job include this wrapper and its tests. The original #3188 branch remains
untouched; its same-#2961 control-plane changes must be semantically reconciled
by the existing owner if integrated later. These changes stay on #3189 as the
bounded correction to its independently reported current-head finding.

## Requested-operation binding replaces the shared schema set

The third related terminal-custody review round required a structural design
review rather than another local guard. The earlier shared set could accept a
sibling wrapper's receipt after the required parent's receipt disappeared.
The terminal contract is now a closed tagged union keyed by the fixed requested
process identity: exact schema, exact marker versus bare-JSON format, and exact
success/failure exit code. Only the final nonempty record can satisfy it. A
foreign record, wrong format, truncated parent, unknown schema or contradictory
exit remains unknown custody. The scheduled guardian uses the same decoder and
classifier as manual reservation; the former loose scheduled parser is removed.

A protocol matrix covers every wrapper pair, both outer outcomes, marker/bare
format substitutions, foreign records before/after the parent, truncation and
exit contradiction. It fails on the previous source and passes on the corrected
contract. Existing HTTP success fixtures now use the actual source schema and
format, while real pre-spawn exception and completed ordinary HOLD behavior
remain covered. No new process, queue, witness, authority or merge route exists.


### Awaited pre-sweep custody boundary

The owner must not carry an affirmative worker sample through awaited Lane 7
network, capacity, handoff or queue reads. The heartbeat rechecks before each
subsequent pre-sweep provider. Lane 7 receives the owner's canonical age reader
and workspace, samples after handoff validation, and supplies the same synchronous
assertion to the existing queue consumer immediately before its pending-to-processing
rename. The consumer's other callers retain their existing admission policy.
The acknowledgement keeper samples after processing-file reads immediately before
publishing CLAIM_ACCEPTED; missing, stale, nonnumeric or throwing evidence holds.
Receipt and outbox publications sample again at their own boundaries. No new queue,
worker, runtime lease or executable is introduced. Native CI exercises the actual
helpers and queue consumer, including time expiring across awaited reads.


A full Lane 7 side-effect audit also places samples before each capacity proof
and capacity publication, before completion collection, before each of its two
mission events (after the intervening awaited state read/event), and before
finalization's directory, create-only result write and processing rename. Tests
expire custody at each capacity/escrow/collection boundary, including completions
with no progress receipt. An interrupted event pair can resume only the existing
exact-result replay path; a missing receipt is never treated as an affirmative
sample. The existing collector's other adapters retain their admission policy.

A successful pickup retains its processing ownership if custody expires during
subsequent receipt-history work, including legacy claims with no execution receipt.
That hold must never put a proved writer back in pending. Pickup mission-state
publication also checks after its awaited state read; before proof is recorded,
the consumer's existing rollback releases an unproved pickup safely.


The shared Windows inventory also requires a Core-matching Win32_Process row's
ExecutablePath to equal the fixed C:\Program Files\nodejs\node.exe path
(case-insensitive, slash-normalized). Missing, alternate or suffixed executable
paths make the entire inventory incomplete, never zero owners or proved custody.
Both status and caretaker already consume this one helper; neither gets an
independent caller-provided identity override. The helper's exact-source candidate
pin and its parent's child pin are updated together and still require external
qualification and protected bootstrap admission. Native tests retain matching
command lines while substituting executable identities.


Interrupted finalization keeps create-only result publication and the last custody
sample before queue rename. A fresh retry may resume only if the existing bounded,
regular single-link file is byte-identical to the fixed expected result. The open
handle must match the pathname's before/after identity; links, path swaps, partial,
malformed or conflicting results remain held and are never overwritten. The actual
completion regression expires custody after publication, proves processing remains
owned, rejects an unrelated existing result unchanged, and resumes the exact result
through the original rename with fresh evidence. This is not permission to clear
a lease or rerun a source writer.


The canonical heartbeat reader samples production time only after its two bounded
synchronous source-identity Git reads. Both age/freshness projection and future
record rejection use that late admission time. Deterministic native-owner tests
advance the production clock during identity observation across the120-second
boundary and cover fresh, expired and future timestamps without wall-clock sleeps.
Explicit fixed nowMs is only the pre-existing deterministic fixture projection seam;
no production owner supplies it.
