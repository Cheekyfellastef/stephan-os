# Stephanos Goal Building Agent V1

Status: M1 source contract
Canonical goal: #2002
Participant ID: `goal-building-agent`

## Purpose

The Goal Building Agent owns the question:

> Is Stephanos able to build the durable goal estate, and is useful goal progress actually happening now?

It is a first-class Shared Workspace participant and programme-health governor. It does not replace the Mission Scheduler, Goal Flywheel, continuity controller, Guarded Goal Runner, Stall Sentinel, Mission Worker, provider router, review fabric, recovery machinery or operator approval boundary.

The agent exists because process presence is not programme progress. A worker can be running on a stale source head, a mission can remain indefinitely at one phase, capacity can sit idle beside eligible work, or a blocker can exist without an owner. Those conditions must never be painted green.

## Canonical machinery relationship

The agent consumes evidence from the existing machinery:

- #1556 Mission Scheduler and Goal Flywheel V1
- #1557 Autonomous Build Continuity Controller V1
- #1497 Guarded Goal Runner V1
- #1509 Stall Sentinel
- #1568 canonical execution receipts
- #1290 Shared Agent Workspace
- #1282 Goal Dashboard
- #1637 Elastic Five-Lane Build Fabric
- #1858 `UNATTENDED_READY` acceptance
- #1903 governed self-improvement
- #1947 provider-neutral capacity and refill

There remains exactly one scheduler, one programme authority, one continuity controller, one mission/lease plane, one Shared Workspace, one protected merge path and one recovery fabric.

## Identity and authority

```text
participantId=goal-building-agent
agentClass=GOAL_BUILDING_AND_PROGRAMME_CONTINUITY_GOVERNOR
qaCapability=CAN_ASK_AND_ANSWER
lifecycleState=READ_ONLY_CANDIDATE
mutationAuthority=NONE_BY_PARTICIPATION
implementationAuthority=GOVERNED_TASK_CONTRACT_REQUIRED
trustedBuilder=false
mergeAuthority=false
deploymentAuthority=false
arbitraryShellAllowed=false
leaseSeizureAllowed=false
selfPromotionAllowed=false
```

Participation grants no consequential authority. The agent may identify the correct existing route and prepare a bounded request. It cannot merge, deploy, restart a process, mutate Windows, seize a lease, use credentials, spend money or widen its own capability.

## Two separate truths

The V1 evaluator keeps two booleans separate.

### `isCapableOfBuilding`

True only when the required canonical control surfaces are present, fresh, healthy and bound to the expected protected-main identity. Source-only and GitHub-hosted work does not require an installed physical-head receipt. When physical execution is required, the installed head and the physical Battle Bridge surfaces become mandatory and must bind to the expected head.

If optional installed-head or physical evidence is supplied for source-only work, it is still validated. A contradictory supplied physical receipt cannot be hidden by setting `physicalExecutionRequired=false`.

### `isActuallyBuilding`

True only when:

- `isCapableOfBuilding` is true;
- the Mission Worker is fresh and bound to the expected head;
- at least one active mission is in a productive phase;
- that mission has a fresh durable progress timestamp.

A process being `RUNNING` is insufficient.

## Evidence contract

The pure evaluator accepts one normalized evidence packet. M2 adapters will derive this packet from canonical records; callers do not gain authority by supplying it.

```js
{
  expectedHead,
  protectedMainHead,
  installedMainHead,
  physicalExecutionRequired,
  surfaces: [
    { id, state, observedAtUtc, head, blocker }
  ],
  programme: {
    activeMissions: [
      {
        missionId,
        goalId,
        laneId,
        ownerId,
        phase,
        authorityHead,
        observedAtUtc,
        lastProgressAtUtc,
        nextAction
      }
    ],
    eligibleQueuedGoalCount,
    qualifiedCapacity,
    idleQualifiedCapacity
  },
  blockers: [
    {
      blockerId,
      severity,
      ownerId,
      route,
      missionId,
      goalId,
      firstObservedAtUtc,
      nextAction,
      independentWorkContinues
    }
  ],
  operatorAction: {
    required,
    target
  }
}
```

## Required surfaces

Base programme operation requires:

- `sourceSync`
- `scheduler`
- `continuityController`
- `missionWorker`
- `providerRouter`
- `proofRoute`
- `reviewRoute`
- `statusFabric`

When `physicalExecutionRequired=true`, it additionally requires:

- `battleBridge`
- `ignition`
- `recoveryMesh`
- `mailbox`

Each surface has a closed healthy-state set, a fixed freshness window and an explicit head-binding policy. Unknown surfaces, duplicate surfaces, future-dated observations and a healthy state carrying a blocker are contradictions and enter `SAFE_HOLD`.

Optional known surface evidence is still validated when present.

## Mission truth

The evaluator supports bounded parallel operation with at most ten active missions. Every active mission requires a unique:

- mission ID;
- goal ID;
- lane ID;
- owner;
- phase;
- authority head;
- observation timestamp;
- durable progress timestamp;
- next action.

Productive phases include selection, worktree creation, implementation, testing, publication, repair, protected merge execution and verification.

Waiting phases include hosted proof, independent review, dependency and operator boundaries. Waiting is not active build progress, but it can still be fully governed when the boundary has an owner, route and next action and no independent eligible capacity is stranded.

Terminal missions cannot remain in the active set. Duplicate active goals or lanes are contradictions and enter `SAFE_HOLD`.

## Blocker ownership

Every blocker must have one owner, one closed-world route, one next action and canonical goal or mission lineage.

Allowed routes are:

```text
SELF_RECOVERABLE_BY_EXISTING_BOUNDED_CONTRACT
DELEGATE_BOUNDED_REPAIR
REQUEST_QUALIFIED_REVIEW_OR_PROOF
REQUEST_EXACT_OPERATOR_APPROVAL
EXTERNAL_OR_UNQUALIFIED_SAFE_HOLD
```

The `independentWorkContinues` field is not trusted by itself. It is accepted only when a different productive mission, outside the blocker's mission and goal lineage, proves current useful progress. The blocked mission cannot prove its own continuation, and an all-waiting programme cannot manufacture useful progress from waiting-state records.

An exact operator-approval wait is treated separately: it may remain a fully governed boundary when the operator target is explicit, the waiting mission is correlated and no eligible independent capacity is stranded. It still does not produce `isActuallyBuilding=true`.

A blocker that names an unknown active mission or mismatches the correlated goal enters `SAFE_HOLD`. A waiting or blocked mission without a correlated owned blocker is `GOAL_BUILDING_BLOCKED`.

When more than one blocker has an action, selection is deterministic: severity first, then oldest observation, then the fixed repair-route priority, then blocker identity. Caller array order never selects programme authority.

## Operating states

### `GOAL_BUILDING_100_PERCENT_PROVEN`

All required evidence is current and consistent. No eligible qualified capacity is unnecessarily idle. Every blocker or governed wait is owned and routed. The programme may be actively progressing, correctly idle because no goal is eligible, or waiting at a fully accounted governed boundary.

### `GOAL_BUILDING_DEGRADED`

Useful progress can continue, but throughput or non-critical health is below the full operating definition. Examples include eligible work beside idle qualified capacity or a non-critical evidence surface being stale.

### `GOAL_BUILDING_BLOCKED`

Trusted evidence proves that useful progress cannot currently be claimed. Examples include a stale or wrong-head Mission Worker, eligible goals with no active mission, all active missions lacking recent progress, a critical surface failure or an unowned blocker.

### `SAFE_HOLD`

Evidence is malformed, future-dated, duplicated, contradictory, unknown or otherwise unsafe to reconcile. The agent reports the contradiction and does not guess. `SAFE_HOLD` also overrides ordinary idle/progress labels and caller-supplied next actions until programme evidence is repaired.

## Status and Q&A

The same certificate answers:

- Is Stephanos actually building?
- What is building now?
- What is blocked or slow?
- Who owns each blocker?
- What happens next?
- Does the operator need to act?
- Why is the programme not at 100 percent?

The answer is deterministic and evidence-bound. It does not use chat memory as programme truth.

The M1 participant record publishes a bounded projection through the existing Shared Workspace record schema with proof references and all safety locks closed. M2 will wire canonical readers and the existing Shared Workspace, Stephanos AI Chat and Goal Dashboard projections. It will not create another status store.

## Current bootstrap case

At M1 creation, protected and physical main were `3b4709fc203e055084c668998490d99d4384521b`, while the latest Mission Worker evidence remained bound to predecessor `f60765af26d44f73290e148e882ec13f608a7087` and the active recovery mission remained `critical-1291-worker-watchdog-repair` at `CREATE_WORKTREE`.

The V1 evaluator therefore has regressions proving that a `RUNNING` worker on a predecessor head cannot produce `isActuallyBuilding=true`, a blocked mission cannot count itself as independent progress, and source-only work is not falsely blocked by absence of a physical installed-head receipt.

## M1 boundary

M1 adds:

- the participant capability contract;
- the pure programme-health evaluator;
- the four-state certificate;
- deterministic status Q&A;
- a bounded Shared Workspace participant-status record;
- negative tests for false progress, stale heads, stale progress, idle capacity, ownerless or lineage-free blockers, unknown evidence, future evidence, deterministic blocker priority and unsafe authority widening.

M1 performs no runtime activation and introduces no scheduler, worker, repair or merge authority.

## Follow-on sequence

M2 will add read-only adapters for the canonical scheduler, continuity, execution-receipt, capacity, proof, review and recovery records and publish the derived certificate through existing status surfaces.

M3 will route each classified blocker into the existing repair, specialist, review or operator path and verify the terminal result without duplicating a mission.

M4 will enforce work-conserving capacity, refill/substitution and recurring friction intake through existing provider and self-improvement machinery.

M5 will prove a real closed-chat stall, delegated repair, continued independent work, recovery and resumed scheduler-authorized build with all operator surfaces agreeing.
