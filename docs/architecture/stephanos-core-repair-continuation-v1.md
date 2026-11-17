# Durable Core repair continuation (#2961)

## Problem and scope

Core previously generated maintenance identities from counters in one process.
Commander and MCP could replace those identities on the way to the native
owner. A lost reply or Core restart therefore left no authenticated way to
distinguish an unstarted request from a request still holding execution custody.
An exception in optional self-repair could also reject the detached Flywheel
cycle before its independent learning and observation work ran.

This continuation keeps one original repair intent across Core persistence,
Commander, the authenticated private MCP session, and the existing maintenance
guardian. It adds no controller, worker, scheduler, native lease, signing root,
process bootstrap, clear-hold endpoint, or arbitrary command path. The ordinary
unrelated maintenance actions retain their established guardian admission.

The four parts are a durable Core fence, original identity through transport,
authenticated native-owner readback, and contained optional failure. They form
one protocol: exception handling alone cannot safely enable full Flywheel work,
because that work can release lanes, close goals, or issue execution grants.

## Original intent and durable preparation

The closed `stephanos.core-repair-continuation.v1` tuple contains:

| Field | Meaning |
| --- | --- |
| `requestId` | One random, bounded original identifier; retry preserves it. |
| `missionId`, `relatedIssue` | Existing Core mission and parent goal `#2961`. |
| `actionId` | One of the existing fixed maintenance actions. |
| `sourceHead` | The original requested source, never rewritten on observation. |
| `enrollmentId` | The original owner's authenticated protocol epoch. |
| `sequence`, `previousRequestId` | The next entry and exact predecessor in that epoch. |

The schema accepts only exact data properties and closed values. It rejects
extra properties, getters, inherited records, malformed identities, and an
unbound predecessor. Correlation is metadata; it cannot add execution authority.

The admission sequence is:

1. Core verifies its existing lock and current source, obtains fresh owner
   status, and applies current action-specific resource and qualification gates.
2. Core durably writes `DISPATCH_FENCED` with the complete original tuple before
   sending any preparation or executable request.
3. `maintenance_request_prepare` atomically binds that tuple as `PREPARED` inside
   the existing signed, OS-anchored custody record. This changes metadata only.
4. Core reads the same original request back through the authenticated owner.
   Only fresh `PREPARED` evidence for the current source and original epoch can
   permit delivery. Core rechecks its lock and current action admission.
5. The existing `maintenance_action` validates the full command/tuple identity
   and synchronously reserves that same prepared tuple before its first await.
   A second delivery cannot create another reservation once it was admitted.
6. Core records `RESULT_UNPROVEN` and reads the original owner again, regardless
   of whether the transport returned success, threw, timed out, or lost a reply.

A process-local serialization boundary covers both this maintenance sequence
and Core's affected refill/Flywheel work. It prevents Core from starting
maintenance halfway through its own grant/release work. Downstream custody
owners still enforce their independent locks and resources; this serialization
is not another native grant or lease.

## Persistence and authority

The Core record lives at the fixed Shared Workspace status path
`status/stephanos-core-repair-attempt-current.json`, under the existing
`stephanos-core` participant. It uses the shared atomic writer with durable
publication. Reads reject links, non-files, multiple hard links, oversized
content, changed identities, and noncanonical records. Reads are bounded to
16 KiB plus one byte and verify both the opened file and its canonical path
after capture. Missing, invalid, unreadable, and expired-looking files never
mean an empty execution history.

The maintenance owner retains one Core slot in its existing signed custody
record. Unrelated guardian reservations and releases preserve that slot. A new
sequence is admitted only after the previous original has an authenticated
terminal disposition and separately proven custody release. The slot cannot
switch between two tuples within one sequence and enrollment.

Initial enrollment requires the existing authenticated successor-full-boot
recovery boundary and its same-machine witness. Ordinary `IDLE`, a restart,
an empty local file, or a replacement audit projection cannot establish an
empty history. Audit-loss and retained-migration uncertainty remain held. An
old tuple cannot bind into a later enrollment, even if an older installed
guardian lost the newer slot and a genuine later recovery established a new
epoch. This source change does not request or perform a reboot.

## Authenticated readback

`maintenance_request_status` accepts either an empty request for the owner's
retained original, or one exact continuation tuple. It exposes closed status,
not caller-selected paths, raw receipts, PIDs, native handles, or release tools.
Both new tools use the existing authenticated private MCP/HTTP surface. Before
correlated executable delivery, the client discovers the protocol and reads
status in the same authenticated MCP session. An older handler that could
silently discard metadata therefore cannot be used as a delivery fallback.

| Owner state | What Core may conclude |
| --- | --- |
| `LEGACY_HISTORY_UNPROVEN` | Existing history is not enrolled; hold mutation. |
| `READY` | An authenticated empty epoch may initialize the local fence. |
| `UNKNOWN` with exact preparation permission | This next tuple has not been prepared; repeat metadata preparation only. |
| `PREPARED` | Original metadata exists; only the same currently admitted tuple may be delivered. |
| `RESERVED` | Native admission happened; observation only, with no replay. |
| `NOT_STARTED` | The owner proved exclusion before launch and signed that disposition. |
| `SUCCEEDED`, `FAILED`, `CANCELLED` | Original execution disposition is authenticated; custody release is still a separate requirement. |
| Other `UNKNOWN`, `CONFLICT`, `SUPERSEDED` | Do not infer absence, release, or replacement permission. |

Native terminal readback binds signed root and terminal archives to original
request, action profile, requested source, enrollment, custody digest, native
record, root identity, and private executor disposition. The archive is bounded
and captured with identity checks. A terminal archive written before a failed
release remains terminal evidence with custody held. A full boot can prove
physical exclusion while the original operation result remains unknown; that
does not make the repair successful or admit the next sequence.

`NOT_STARTED` has a signed proof hash. It is produced only by the owner's
private prelaunch exclusion or fixed internal qualification refusal. Repeating
metadata preparation can also retire an original `PREPARED` request after a
source advance, while the owner is still idle and no reservation exists. Core
does not send an executable request against stale source to manufacture that
proof. The public prepare tool accepts no caller-supplied refusal flag.

If source advances between the local durable fence and native preparation,
authenticated `UNKNOWN` with `CORE_REPAIR_SOURCE_ADVANCED` can retire only that
exact unprepared next tuple under the same idle CAS. Its epoch, sequence, and
settled predecessor are rechecked after acquiring the owner lock. A delayed
preparation for the same original can be retired; a competing tuple or an
intervening reservation stays held. The owner records the actual time it first
binds this metadata refusal, while Core preserves its older local creation time.
Unknown execution outcomes cannot enter this transition.

Core accepts fresh status only from its current observed source. Failed
readback invalidates cached permission. Original requested source and current
observer source remain distinct. A failed operation's authenticated blocker is
preserved for the existing bounded escalation logic even after custody releases.
Child success never proves the parent goal's building outcome.

## Restart, optional failure, and continued observation

Restart restores the local attempt before the first normal Core heartbeat.
If the local record is missing, the authenticated retained original reconstructs
it without inventing creation times. The periodic dependency pass checks the
retained original before today's health-driven choices, so improved health does
not strand an already prepared request. It routes only the original action and
mission through the same existing admission wrapper. Current worker custody,
gaming protection, source, lock, and native qualification still apply. An
unqualified control-plane action remains held; no alternate action substitutes
for its identity.

If an older delayed preparation wins while Core has fenced a new local intent,
Core can adopt the owner's retained original only after repeated fresh readback
proves the local loser conflicts in the same enrollment, sequence, and
predecessor. The owner's immutable slot binding proves that loser was never
prepared or executable. A changed epoch, predecessor, winner, source, owner, or
unavailable readback keeps the hold; no losing tuple is delivered.

Optional dependency repair runs off the heartbeat path with single-flight
containment and cleanup. With no retained intent, dependency eligibility checks
stay outside the repair controller, including health, cooldown, gaming and
unavailable-owner or worker-only holds. Otherwise a slow routine read could win
the mutex before every material Flywheel wake. Retained originals reconcile
first; actual maintenance and Flywheel work authenticate their own admission.
Optional self-heal exceptions cannot abandon the
detached Flywheel cycle or leave its running flag permanently set. Errors in
learning, proof publication, or onion observation are contained and exposed as
degraded status rather than unhandled promise rejections.

While original maintenance is uncertain, the existing Flywheel controller uses
a restrictive branch: heartbeat, bounded incident lesson promotion (at most
two), and a hold receipt. It skips calibration, seed/goal creation, orphan
recovery, goal closure, lane finalization, capacity routing, and worker grants.
Full affected work resumes only after fresh owner readback and the current
existing guards admit it. Learning or heartbeat receipts do not claim building.

## Verification and commissioning limits

Source tests exercise actual Core orchestration and the full production
JavaScript path from durable Core state through Commander, authenticated
loopback HTTP/MCP, guardian, and signed custody store. Test-only module hooks
replace the native platform/adapter boundary for deterministic custody cases;
ordinary Linux qualification refusal is also tested without that replacement.
Fixtures cover lost replies, restart, deleted state, source change, delayed
preparation, enrollment mismatch, uncertain custody, signed terminal before
failed release, action-specific resumption, and concurrent optional work.

The protocol and closed blocker parser live in the existing shared maintenance
source diagnostic module, with the admission module re-exporting the same API.
The custody store uses the already-packaged diagnostic module directly. This
preserves both the 40-member maintenance installer closure and the 300-member
fixed-runtime closure, without expanding either package or its size bounds.
Closure tests capture the complete dependency graph without evaluating
repository modules. Existing exact applicability pins continue to reject
changed profile gates unless their new bytes are independently reassessed.
The existing read-only Node 24 Linux/Windows custody workflow also runs the six
focused continuation suites; its permissions and native fixture policy remain
unchanged.

Passing source fixtures is not native Windows qualification, installation,
current process exclusion, or a successful material build. Activation still
requires the existing protected review, exact-source package/install, owner
enrollment, current governor, and original runtime custody gates. No caller flag,
local status file, successful merge, or child repair result replaces those gates.
The parent remains open until its actual build/refill outcome is observed.
