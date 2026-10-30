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

A concurrent winner may be newer than the caller's GitHub observation. When its
observation is at least as recent, the programme refreshes the durable workspace
and selects only mirror rows from that winning observation, preserving their
terminal state. Old caller memory and old durable READY rows cannot become
current again. An incomplete winner can therefore expose fewer runnable goals;
it does not grant permission to rebuild stale ones. A newer live primary
observation remains the primary source when the held publisher is older.

Failed lock release also reads the actual canonical state. It never turns a
READY mirror into a disabled-fallback claim or certifies caller-memory records.
No new scheduler, writer, queue, lease-release path or runtime authority exists.

Regression evidence includes the actual programme projection with all live
effects intercepted, hostile field mutations, disjoint state properties, and
two real publishers sharing a temporary fixture lock. The latter holds a newer
revocation in progress, proves an older caller cannot project its READY goal,
then verifies that the winning CLOSED goal persists. These are source proofs;
production recovery and material source pickup require separate live receipts.
