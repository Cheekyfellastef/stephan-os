# Goal Mirror reconciliation state

Continues #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission,
using the existing goal-source-resilience publisher introduced by PR #2432 —
Mirror GitHub goals into Shared Workspace for outage failover.

Serialization and winning-observation fixes did not give every exit path the
same interpretation of a persisted fence. A BUSY publisher never read that
fence, supersession trusted an unvalidated flag, and failed lock release claimed
fallback was disabled unconditionally. These are one invariant failure, not
three independent permissions to weaken validation.

`projectGoalMirrorReconciliationState` is the shared interpretation used by the
publisher and outage consumer:

| Valid persisted state | Publication truth | Outage fallback |
| --- | --- | --- |
| RECONCILING or BLOCKED, explicit false flag | Incomplete | Disabled |
| READY, explicit true flag | Canonical winning publication complete | Existing bounded lease and per-goal checks still required |
| Missing, malformed, foreign, inconsistent or expired | Unknown | Refused |

The model validates the canonical status envelope, participant/schema/identity,
boolean scheduler and deduplication invariants, every produced no-authority flag,
issue identities, timestamp ordering and the existing maximum 24-hour lease.
Historical canonical records have no repository field; their fixed path,
status identity and participant identify the publisher. An explicit foreign
repository binding is rejected. Current observation time is independent of the
record under validation; tests provide their observation clock explicitly.

Publication completion is separate from a closed outage fence. A BUSY caller
may observe either state without writing or acquiring another publisher's lock.
Only a valid canonical READY winner can establish completion. A validated
RECONCILING/BLOCKED fence can remove the false global live-source veto while
continuing to refuse outage pickup. Unknown evidence preserves the veto.

A strict per-record classifier was insufficient: an initially valid READY
observation can be overtaken by a newer fence during the subsequent feed read.
The third repair round therefore introduces one admission snapshot rather than
another condition on an earlier publication flag.

`projectGoalMirrorAdmissionSnapshot` reconciles the publication readback with
the refreshed feed's canonical status, then makes the winning observation,
phase, goal-row selection and admission veto together. A known newer validated
observation dominates an older cached read. A singular later read determines
the phase within the same observation; conflicting phases in one unordered
feed remain fenced. Missing or invalid later canonical evidence cannot borrow
earlier validity.

Only rows matching the winning observation, bounded lease and canonical
identity are eligible. Conflicting same-issue rows are excluded. Rows ahead of
the known fence make the snapshot UNKNOWN. A durable FENCED phase cannot admit
READY rows even in the same observation, since a repeated reconciliation may
still be revoking them. Terminal and non-pickup rows remain visible. A newer
live primary observation remains primary when the held publisher is older;
an older READY cannot certify publication of that newer observation.

The same snapshot supplies selected rows, outage reconciliation input and the
final programme source veto. Earlier `publication.ok` is historical publisher
evidence, not the final admission decision. This is proof as of the last
validated read; it creates no atomic scheduler, lease or execution authority.

Failed lock release also reads the actual canonical state. It never turns a
READY mirror into a disabled-fallback claim or certifies publication. Observation
order is part of the same state model, used by every exit: NEWER_WINNER,
SAME_OBSERVATION, OLDER_PUBLISHER or UNPROVEN. In particular, a failed fence write
followed by failed lock release can leave an older durable fence. That fence
must not displace a newer live CLOSED observation or revive its old READY row.
No new scheduler, writer, queue, lease-release path or runtime authority exists.

Regression evidence includes the actual programme projection with all live
effects intercepted, hostile field mutations, disjoint state properties, and
two real publishers sharing a temporary fixture lock. The latter holds a newer
revocation in progress, proves an older caller cannot project its READY goal,
then verifies that the winning CLOSED goal persists. These are source proofs;
production recovery and material source pickup require separate live receipts.

Interleaving properties cover READY(T1) to FENCED(T2) between reads, subsequent
READY(T2), same-observation phases, newer known fences followed by older cached
reads, missing/foreign/malformed later evidence and mixed/contradictory rows.
The original storage-failure and later-feed races both have preserved RED
counterexamples and GREEN regressions. No clean review or earlier operator
approval can override a newly reproduced authority-bearing failure.
