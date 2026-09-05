# Automatic Goal-Building Admission Boundary

Canonical goal: #2002
Canonical implementation PR: #2003

This source note records the final activation boundary for the Goal Building Agent continuity path.

The source lane now contains:

- durable resumable goal checkpoints;
- deterministic cross-chat reconstruction;
- Stephanos continuation projection;
- Shared Workspace HANDOFF publication using the existing canonical record family;
- routing only to existing #1556/#1557/#1947 machinery;
- approval-lane parking and independent-capacity refill intent;
- fail-closed handling for protected-main drift, source-head drift, competing owners, malformed evidence, missing proof and authority widening.

Automatic building is not considered LIVE until all of the following are separately proven:

1. #2003 is preservation-converged to exact protected main and fresh hosted proof/review is green.
2. Exact protected source admission is separately authorized and completed.
3. Installed/Battle Bridge source is proven at the admitted protected head.
4. The existing #1557 continuity controller reads a current Goal Building Agent Shared Workspace handoff.
5. The existing scheduler accepts the same canonical mission/goal/owner identity without creating a duplicate lane.
6. A qualified existing provider executes a material source action and emits a fresh canonical receipt.
7. The Goal Building Agent observes that receipt and advances the durable checkpoint without an open chat.
8. An approval-gated lane parks without occupying construction capacity and #1947 refills a resource-disjoint slot.
9. A closed-chat acceptance proves at least one complete select -> build -> proof/review -> park/refill cycle.

No statement in this file grants protected merge, ready transition, deployment, Windows/runtime/OpenClaw mutation, credentials, spending, destructive Git or authority widening.
