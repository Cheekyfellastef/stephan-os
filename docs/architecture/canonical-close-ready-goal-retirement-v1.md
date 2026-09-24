# Canonical CLOSE_READY Goal Retirement V1

Owners: #1556 Mission Scheduler and Goal Flywheel V1, #1557 Autonomous Build Continuity Controller V1, #1903 Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1.

## Problem

The canonical Mission Scheduler already distinguishes a goal that is technically complete from one that may be retired publicly. A `COMPLETE` goal does not become `CLOSE_READY` until its result proof, reusable capability and shared lesson/flywheel output exist. The guarded repair loop can also persist a terminal `complete` receipt.

Before this slice there was no bounded consumer that converted canonical `CLOSE_READY` truth into the narrow GitHub issue-state mutation. The result was bookkeeping debt: implementation and proof could finish while the public durable goal remained open.

## Rule

`CLOSE_READY` is the only automatic goal-retirement admission state. It is consumed from the canonical per-goal scheduler portfolio, not only from the top-level selected action. This matters because an unrelated active build lane intentionally suppresses top-level action selection while completed resource-disjoint goals may still be safely retired.

The planner reruns the canonical Mission Scheduler and admits a close only when:

- the scheduler and decision receipt are not fail-closed;
- the decision receipt carries no contradiction codes;
- exactly one normalized portfolio row for the target is `CLOSE_READY`;
- that row remains `COMPLETE`;
- result proof references exist;
- a reusable capability ID exists;
- a shared lesson ID exists;
- no operator-approval route is active.

The production Programme Authority then rebinds the planned request to that same source-constructed scheduler row before any authenticated GitHub call. Issue identity, proof refs, capability, lesson and concurrent active-lane identities must still agree.

The GitHub target is re-read immediately before mutation. It must still be the same open, non-PR issue in `Cheekyfellastef/stephan-os` and must still carry the `goal` label.

Only then may the adapter request:

```text
state=closed
state_reason=completed
mutation_scope=ISSUE_STATE_ONLY
```

GitHub must confirm the same issue as `closed` with `state_reason=completed`. A plain closed response, a `not_planned` reason, or an identity mismatch does not produce a completion receipt.

## Production wiring

The existing canonical path is extended rather than duplicated:

```text
Programme Authority
  -> #1556 canonical scheduler portfolio
  -> goalClosurePlan
  -> durableFlywheelControllerVNext
  -> Programme Authority bounded goal-close executor
  -> authenticated GitHub issue re-read
  -> exact completed-state PATCH
  -> durable flywheel cycle receipt
  -> Programme Authority closure-receipt overlay
  -> scheduler sees CLOSED
  -> capacity/refill continues
```

The durable flywheel controller may retire a `CLOSE_READY` goal while an unrelated implementation lane remains active. The issue-state close does not seize the source lane and does not stop the active worker grant.

A successful closure invalidates the GitHub goal-estate cache immediately so a freshly closed issue is not rediscovered as open.

## Durable CLOSED truth

The original rich goal record is not overwritten. Instead, a valid `stephanos.durable-flywheel-cycle-receipt.vnext` from the canonical `durable-flywheel-controller`, bound to the canonical repository and exact issue, overlays the corresponding goal as `CLOSED` during Programme Authority reconciliation.

Forged, wrong-repository, wrong-controller, invalid, or authority-widened receipts are ignored.

This makes the completion transition durable while preserving the original goal history and prevents a completed goal from returning as `CLOSE_READY` on every controller cycle.

## Non-authority

This seam grants no merge, deployment, runtime, arbitrary-command, branch, PR, credential, provider, spending or source-mutation authority. It does not decide whether a goal is complete. It consumes the existing scheduler decision.

A missing proof, missing flywheel output, stale or contradictory scheduler state, approval gate, wrong repository, wrong issue identity, request/scheduler mismatch, PR-shaped target, missing goal label or unconfirmed completed reason fails closed.

## Idempotence

If the exact goal issue is already closed with `state_reason=completed`, the consumer returns `ALREADY_CLOSED` and performs no mutation. A differently closed issue is not reclassified as completed.

## Work-conserving controller behavior

#1557/#1903 consume this adapter whenever #1556 contains a per-goal `CLOSE_READY` portfolio row, including while unrelated implementation lanes remain active.

After a confirmed `CLOSED_COMPLETED` result, the cycle:

1. refreshes the authoritative programme projection;
2. preserves an unrelated active worker grant when present;
3. publishes the closure in the normal durable flywheel cycle receipt;
4. consumes that receipt as durable `CLOSED` truth on the next reconciliation;
5. releases the retired goal from the open-goal estate and continues refill/selection.

Closing one goal is a refill event, not a reason to end the octopus cycle.

No second scheduler, goal database, queue, controller, worker, receipt store or GitHub mutation plane is introduced.

## Acceptance markers

```text
CANONICAL_CLOSE_READY_GOAL_RETIREMENT_V1
COMPLETE_WITHOUT_FLYWHEEL_OUTPUTS_NEVER_CLOSES
APPROVAL_GATED_OR_CONTRADICTORY_GOALS_NEVER_CLOSE
CLOSE_REQUEST_IS_REBOUND_TO_THE_CANONICAL_SCHEDULER_ROW
GITHUB_GOAL_IDENTITY_IS_REPROVEN_IMMEDIATELY_BEFORE_CLOSE
GITHUB_MUST_CONFIRM_STATE_REASON_COMPLETED
GOAL_CLOSE_IS_IDEMPOTENT_AND_ISSUE_STATE_ONLY
DURABLE_CLOSURE_RECEIPT_PROJECTS_THE_GOAL_CLOSED
ACTIVE_OCTOPUS_ARMS_KEEP_MOVING_DURING_GOAL_RETIREMENT
CLOSED_GOAL_RELEASES_CAPACITY_AND_SELECTS_NEXT
```
