# Recursive Fix-to-Outcome Continuation V1

Status: canonical implementation contract for existing Stephanos Flywheel, core daemon and Sovereign Commander machinery.

## Rule

A repair is not completion while the original outcome remains false.

`ORIGINAL_OUTCOME -> observe blocker -> smallest safe repair -> verify -> replay ORIGINAL_OUTCOME -> next blocker -> repeat`

The blocker chain is logically unbounded. It may contain 3, 10, 763 or more layers. Per-cycle resource and time budgets may bound one daemon iteration, but they must never silently terminalize the parent outcome. Continuation state must survive daemon cycles and restarts through the canonical Shared Workspace.

## Persisted continuation truth

Persist the original outcome identity, current blocker, blocker depth, diagnosis and evidence, repair owner/action, repair proof, replay result, newly exposed blocker, operator/authority requirement, next automatic action and freshness.

Every verified `blocker -> diagnosis -> repair -> proof -> replay` transition is a Flywheel learning event and a candidate reusable Sovereign Commander capability.

The existing Core owner must restore its continuation from the canonical status
record **after acquiring its single-instance lock and before its first status
publication**. Background refill can still be awaiting a result when that first
heartbeat is written. Reading saved intent only during later reconciliation
therefore erases the original outcome on restart. Preserve the parent identity
and blocker across source updates and repeated restarts; restoration is advisory
continuation and grants no execution, scheduling or merge authority. The
production-startup regression lives in
`scripts/stephanos-core-daemon-onion-continuation.test.mjs`.
Malformed advisory fields must not crash the already locked owner. A rejected
projection is reported as `CORE_PERSISTED_CONTINUATION_INVALID`, with no restored
outcome or terminal proof and no asserted safe repair. This fallback cannot
clear, release or replace any independently held native execution reservation;
valid recorded operator boundaries remain preserved across startup.
The canonical projection must also retain the selected `boundaryId` or
`noSafeRepairId`: terminal evidence may bind that identity rather than the
displayed blocker. Dropping it during JSON persistence invalidates an otherwise
valid boundary on the next cycle. Retention does not relax the evidence packet;
missing or mismatched identity, proof, owner, action or re-evaluation trigger
still rejects the terminal claim. Previously omitted identities cannot be
invented from historical status and require their original producer's evidence.

Retained state is scoped to its original parent. An explicit different live
`originalOutcomeId` starts a fresh continuation and cannot inherit the previous
parent's blocker depth, terminal flags, identity, owner or evidence, even when
both parents use the same boundary ID. Missing or same-parent live identity is
a patch to the retained parent; a new blocker alone is not proof that its
operator boundary has cleared. The generic automatic-building refill canary
supplies a missing outcome or refreshes its own nonterminal blocker and depth.
It cannot rename a specific Seed outcome or replace that parent's evidence,
and it cannot clear any requested terminal state, including an incomplete or
unproven boundary packet.

### Remaining repair-outcome reconciliation debt under #2961

An unexpected rejection from the background repair can escape the Core's
detached Flywheel cycle before learning reconciliation runs. Containing this
exception must not turn an uncertain native execution into a fresh repair
request on the next cycle or after restart. The current local maintenance
delegation does not forward the Core command ID to the owner, and transport
failure alone does not establish whether the original mutation completed.
Complete this edge through the existing maintenance owner and its durable
reservation/terminal records: retain the original request and parent outcome,
hold uncertain execution, reconcile that exact request, and keep independent
observation and eligible work moving. A generic catch, elapsed cooldown, changed
source head or an empty process report cannot authorize replay. The startup
restoration regression does not claim this execution-reconciliation debt solved.

## Valid terminal states

Only these may stop automatic peeling:

1. `ORIGINAL_OUTCOME_PROVEN`, with end-to-end evidence.
2. A genuine operator, physical or authority boundary, with the exact requested action.
3. `NO_SAFE_REPAIR_CURRENTLY_AVAILABLE`, with precise evidence, canonical owner and an automatic re-evaluation trigger.

Generic failures, `REFILL_BLOCKED`, `ACTION_DISPATCHED`, `running`, an intermediate green test, or successful execution of a repair verb are not parent-outcome proof.

## Automatic-building canary

The first canary is the existing automatic-building/refill chain. Its parent outcome is:

> Safe eligible work is genuinely picked up by a qualified worker, materially executed, evidence returns, freed capacity refills automatically, and the loop continues without operator or ChatGPT prompting.

Reuse existing scheduler, Mission Scheduler / Goal Flywheel, Mission Worker, logical controllers, core daemon, Shared Workspace and Sovereign Commander. Do not create duplicate controllers, schedulers, queues, workers or authority paths.

When a layer exposes the next blocker, immediately preserve the parent outcome and continue through the existing canonical owner. A shove supplied during bootstrap must teach the Flywheel what was missing so the same class of shove is less likely to be required again.
