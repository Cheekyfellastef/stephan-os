# Canonical CLOSE_READY Goal Retirement V1

Owners: #1556 Mission Scheduler and Goal Flywheel V1, #1557 Autonomous Build Continuity Controller V1, #1903 Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1.

## Problem

The canonical Mission Scheduler already distinguishes a goal that is technically complete from one that may be retired publicly. A `COMPLETE` goal does not become `CLOSE_READY` until its result proof, reusable capability and shared lesson/flywheel output exist. The guarded repair loop can also persist a terminal `complete` receipt.

Before this slice there was no bounded consumer that converted canonical `CLOSE_READY` truth into the narrow GitHub issue-state mutation. The result was bookkeeping debt: implementation and proof could finish while the public durable goal remained open.

## Rule

`CLOSE_READY` is the only automatic goal-retirement admission state. It is consumed from the canonical per-goal scheduler portfolio, not only from the top-level selected action. This matters because an unrelated active build lane intentionally suppresses top-level action selection while completed resource-disjoint goals may still be safely retired.

The consumer reruns the canonical Mission Scheduler from its trusted input and requires all of these to agree:

- scheduler is not fail-closed;
- programme status is `CLOSE_READY`;
- selected lifecycle is `CLOSE_READY`;
- decision receipt status is `CLOSE_READY`;
- selected issue identity matches the decision receipt and exactly one portfolio row;
- the canonical goal record is `COMPLETE`;
- result proof references exist;
- a reusable capability ID exists;
- a shared lesson ID exists;
- no operator-approval route is active.

The GitHub target is then re-read immediately before mutation. It must still be the same open, non-PR issue in `Cheekyfellastef/stephan-os` and must still carry the `goal` label.

Only then may the adapter request:

```text
state=closed
state_reason=completed
mutation_scope=ISSUE_STATE_ONLY
```

## Non-authority

This seam grants no merge, deployment, runtime, arbitrary-command, branch, PR, credential, provider, spending or source-mutation authority. It does not decide whether a goal is complete. It consumes the existing scheduler decision.

A missing proof, missing flywheel output, stale/contradictory scheduler state, approval gate, wrong repository, wrong issue identity, PR-shaped target, missing goal label or unconfirmed close result fails closed.

## Idempotence

If the exact goal issue is already closed, the consumer returns `ALREADY_CLOSED` and performs no mutation.

## Controller integration

The #1557/#1903 work-conserving controller should consume this adapter whenever #1556 contains one or more per-goal `CLOSE_READY` portfolio rows, including while unrelated implementation lanes remain active. After a confirmed `CLOSED_COMPLETED` receipt, the same control cycle must refresh the durable goal estate and ask the canonical scheduler for the next resource-disjoint work. Closing one goal is a refill event, not a reason to end the octopus cycle.

No second scheduler, goal database, queue, controller, worker, receipt store or GitHub mutation plane is introduced.

## Acceptance markers

```text
CANONICAL_CLOSE_READY_GOAL_RETIREMENT_V1
COMPLETE_WITHOUT_FLYWHEEL_OUTPUTS_NEVER_CLOSES
APPROVAL_GATED_OR_CONTRADICTORY_GOALS_NEVER_CLOSE
GITHUB_GOAL_IDENTITY_IS_REPROVEN_IMMEDIATELY_BEFORE_CLOSE
GOAL_CLOSE_IS_IDEMPOTENT_AND_ISSUE_STATE_ONLY
CLOSED_GOAL_RELEASES_CAPACITY_AND_SELECTS_NEXT
```
