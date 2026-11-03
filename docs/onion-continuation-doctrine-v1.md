# Recursive Fix-to-Outcome Continuation V1

Status: canonical implementation contract for existing Stephanos Flywheel, core daemon and Sovereign Commander machinery.

## Rule

A repair is not completion while the original outcome remains false.

`ORIGINAL_OUTCOME -> observe blocker -> smallest safe repair -> verify -> replay ORIGINAL_OUTCOME -> next blocker -> repeat`

The blocker chain is logically unbounded. It may contain 3, 10, 763 or more layers. Per-cycle resource and time budgets may bound one daemon iteration, but they must never silently terminalize the parent outcome. Continuation state must survive daemon cycles and restarts through the canonical Shared Workspace.

## Persisted continuation truth

Persist the original outcome identity, current blocker, blocker depth, diagnosis and evidence, repair owner/action, repair proof, replay result, newly exposed blocker, operator/authority requirement, next automatic action and freshness.

Every verified `blocker -> diagnosis -> repair -> proof -> replay` transition is a Flywheel learning event and a candidate reusable Sovereign Commander capability.

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
