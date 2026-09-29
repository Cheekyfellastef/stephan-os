# Operator Review Parking and Continuous Capacity Refill V1

## Canonical owners

This is a bounded integration slice of existing machinery, not a new scheduler or control plane:

- #1947 — Goal: Provider-Neutral Execution Compatibility Shims and Continuous Capacity Refill V1
- #1637 — Goal: Elastic Five-Lane Build Fabric and Signed Authority Records V1
- #2002 — Goal: Stephanos Goal Building Agent and 100% Programme Operations V1
- #1858 — Goal: Closed-Chat Autonomy Maturity and UNATTENDED_READY V1
- #1282 — Build Goal Dashboard landing-page tile

The existing #1556 Mission Scheduler remains the work selector. The existing #1557 continuity controller remains the closed-chat controller. The existing protected lifecycle/merge machinery remains the only authority-bearing admission path.

## Operator outcome

A goal should build as far as current authority permits. When the next genuine step requires Stephan's judgment or approval, the completed technical work moves off the construction line and into an exact, drift-watched operator-review parking state.

The released construction slot is immediately reusable for another independent eligible goal. Waiting for operator review is therefore not a construction-capacity state.

```text
BUILD -> TEST -> REPAIR -> REVIEW -> PROVE
  -> OPERATOR_REVIEW_READY_PARKED
  -> RELEASE CONSTRUCTION CAPACITY
  -> REFILL FROM #1556 ELIGIBLE WORK
  -> KEEP PARKED PACKET UNDER EXACT-IDENTITY WATCH
  -> PRESENT CURRENT PACKETS THROUGH EXISTING OPERATOR ATTENTION
```

## Permanent invariant

```text
APPROVAL_WAITING_MUST_NOT_CONSUM_CONSTRUCTION_CAPACITY
```

If a goal has reached the furthest safe state possible and its next action requires operator authority:

1. freeze an exact decision packet;
2. prove the construction/source lease is released;
3. mark the goal `OPERATOR_REVIEW_READY_PARKED`;
4. consume zero builder capacity while parked;
5. emit the existing `LANE_CAPACITY_RELEASED` refill trigger;
6. exclude the parked goal itself and overlapping changed-path work from the refill candidate set;
7. let #1947 select the next resource-disjoint eligible task;
8. keep all merge, deployment, runtime, credential and spending authority false;
9. re-read parked identity before presenting or consuming operator approval;
10. return drifted packets to proof/review work rather than showing stale green.

## Parking packet

The packet binds:

- parking, mission, goal and correlation identities;
- exact goal number and title;
- exact PR number and title;
- repository, branch, head, tree and base;
- complete changed-path estate;
- current checks, review and proof references;
- exact required operator authority class;
- released lease identities;
- parking timestamp;
- exact next operator action;
- explicit zero consequential authority.

A valid packet requires `leaseDisposition=RELEASED`, `constructionCapacityReleased=true` and `builderCapacityConsumed=false`.

## Drift watch

A parked packet remains operator-ready only while current PR evidence still matches its exact repository, PR, branch, head, tree, base and changed estate, required checks/review remain current, and unresolved review-thread count remains zero.

Any material drift produces `OPERATOR_REVIEW_REPROVE_REQUIRED`. The item leaves the ready batch until normal proof/review machinery re-establishes a current packet. Merged or closed PRs terminalize without reoccupying a construction slot.

## Work-conserving refill

The parking adapter composes with the already-merged `planContinuousCapacityRefillV1(...)` contract from #1947. It does not invent a second queue or dispatcher.

Before asking the refill planner for another task, the adapter removes:

- the same parked mission/goal, even if a stale scheduler record still exposes it; and
- tasks in the same repository whose allowed source paths overlap the parked PR changed estate.

Other resource-disjoint eligible work remains available. If none exists, the result is truthfully idle rather than fabricated progress.

## Operator review batch

Current packets are grouped into one deterministic batch. The batch carries exact goal and PR titles, exact head, required authority and next operator action. Drifted packets are separated into a reproving list and do not masquerade as approval-ready.

The existing Goal Dashboard operator-attention projection is the presentation owner. This contract creates no second approval inbox or truth store.

## Safety and authority

This source contract grants no dispatch, source mutation, merge, ready-transition, deployment, runtime mutation, credential/account access, spending, lease seizure, destructive Git, or arbitrary command/shell authority.

Operator approval remains exact-target and separately governed. A parked packet is evidence for a decision, never the decision itself.

## Acceptance

The slice is accepted when deterministic proof establishes:

1. a review-ready goal parks only after lease release and consumes zero builder capacity;
2. the existing #1947 refill planner selects later independent work even when the parked goal appears first in scheduler candidates;
3. overlapping source work remains held while unrelated source work can refill the slot;
4. head/tree/base/estate/check/review/thread drift removes a packet from the ready batch and requests reproof;
5. merged/closed parked work terminalizes without taking a construction slot;
6. duplicate parked identities fail closed;
7. the Goal Dashboard can expose the current parked batch beside existing approvals/maintenance without a new status store;
8. all consequential authority flags remain false.

## Completion direction

This V1 is the source contract and operator-attention composition seam. Runtime activation remains a later exact-head integration step through the existing #1556/#1557/#1637 machinery after protected admission. The intended steady state is that builders continuously manufacture eligible work while operator-ready packets accumulate safely off-line for batch review.
