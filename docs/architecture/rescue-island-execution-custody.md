# Rescue Island execution custody: required before admission

Owner: #3109 — Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)
Parent: #3103 — Rescue Island: two independent proof-gated builders outside Goal Conveyor

## Reproduced failure and admission correction

At source `7fa0693505a450470031a156714071cab41f383c`, the isolated
first-commit engine checked real paths and test hashes, then executed Node
against the mutable worktree. A disposable Git fixture replaced the test after
the last dependency hash read and before Node launched. The replacement wrote
a harmless marker outside the approved source path. Final committed-tree
validation rejected the attempt, after the unapproved code had executed.
This is a check/use custody failure, not a missing final diff check.

The same structural gap affects target-directory replacement, Git refs/index/
objects/configuration, executable dependencies, claims and recovery receipts.
An extra pathname or hash check cannot exclude an original writer that retains
the same account's permissions. Logical non-overlapping claims and a valid
owner approval do not provide physical exclusion.

The production `constructIsolatedRescueIslandPilotV1` export now fails with
`RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED` after task/authority/preflight
validation and before filesystem access, Git, claims, worktree creation, Node,
source writes or pickup receipts. Recovery takes the same admission path.
There is no enabling option, platform exception, environment toggle, native
receipt boolean or caller-selected runner that waives this hold.

Construction regressions retain an explicitly uncommissioned, in-memory test
copy with that single hold removed. Every test-copy stage receipt is marked
`fixtureOnly`; those receipts are not Battle Bridge admission or build proof.
The installed export is tested separately against real disposable Git state:
forged authority flags and recovery cannot invoke Git/Node, create receipt or
worktree roots, change refs, or dirty the original checkout.

## Smallest complete custody implementation

Extend the existing Island one-shot host and existing canonical ownership
interfaces. Do not create another scheduler, queue or source owner. Before
removing the hold, independently review and commission all of the following:

1. **Protected host and execution estate.** Bind the installed host, complete
   executable/module graph and allowed Git/Node binaries to independently
   protected identities. Use a dedicated restricted Windows principal, with
   deny-write/delete/reparse/rename/relaunch probes from every original writer
   principal. Unknown principals, elevated original writers or incomplete
   inventory remain held. Do not revoke general operator access or kill old
   writers by inference.
2. **Isolated Git metadata.** An ordinary linked worktree shares canonical
   `.git` metadata. Qualify an Island-owned isolated Git estate with authenticated
   exact base/tree/object bytes, no alternates/common-directory/reparse/hardlink
   escape, and no canonical metadata mutation rights. If a bounded privileged
   Git broker is reused instead, separately prove its exact transaction/scope
   and original-owner exclusion. A clean linked worktree is insufficient.
3. **Lifetime-bound access.** Keep native no-follow handles and verified parent,
   volume and file identity throughout use; prevent replacement, deletion,
   renaming and mutation of targets, executable bytes, Git metadata and receipt
   roots. Node's pathname-based `writeFile` and child launch alone cannot supply
   this proof on Windows. Final validation remains required after containment.
4. **Authenticated, atomic ownership.** The reviewed host must read complete
   canonical/Seed/Island claims itself, check issue/task/path/branch/worktree
   identities, reserve the same task and owner-comment digest exactly once,
   and recheck admission immediately before execution. Preserve crash-safe
   same-owner replay; no stale empty arrays, caller booleans or duplicate claim.
5. **Fresh scoped resource authority.** Authenticate a CPU-only Island budget
   from the existing gaming governor, bind it to this task/head/host and expiry,
   and prove stop/revocation behavior. Normal idle telemetry is not this grant.
6. **Separate evidence and merge gates.** Bind physical process pickup, scoped
   diff, tests and exact-parent isolated commit to the same installed host and
   task. Require independent exact-head source/Windows review, protected merge
   and live qualification. No source fixture or signed assertion substitutes
   for negative OS enforcement probes and continuing exclusion.

Required adversarial host acceptance includes replacing a target parent/leaf,
Git metadata, test code or any transitive dependency after inspection; writing
through hardlinks/reparse aliases; changing receipts during recovery; racing
owner-comment consumption; and gaming-budget revocation during execution.
Each attempt must be prevented before code execution/source mutation and must
leave authentic typed evidence. Run these under the actual original principals,
not only a mock runner. Retain interruption and same-owner recovery tests.

## Scope and next gates

No existing R7 lease, cancellation, quarantine, witness, CAS or original writer
identity is changed. The Island must never obtain that canonical lease to pass
its own admission. The three-path read-only native boundary probe remains
useful instant-scope evidence and still cannot authorize a worker.

The missing reviewed host adapter, protected OS identity, full claim inventory,
source-write custody and authenticated resource budget are real commissioning
blockers. Island 02 and two unattended refills follow a genuinely qualified
Island 01 build; they remain unproven. Existing Windows review prerequisites
and specialist trust enrollment retain their independent gates.
