# Stephanos Foundry Parallel Production Acceleration V1

Parent goal: #1671

## Purpose

Use the existing Foundry/Forge sidecar as measured, resource-disjoint construction capacity without creating another scheduler, writer, lease authority or merge path. This module produces a recommendation only. It cannot dispatch work, mutate source, publish, merge, deploy, register a runner, touch credentials or alter runtime state.

## Canonical machinery reused

- Mission Scheduler remains the only source of selected candidates, complete resource identities, active ownership, canonical routes and critical-path weights.
- `validateBuildLaneCapacityReceipt()` remains the build-lane capacity validator.
- `adjudicateForgeSidecarCapacity()` remains the only Forge M2/M3 authority adjudicator.
- GitHub `main`, protected checks, independent exact-head review and guarded merge remain the public truth boundary.
- Forge M3 remains the existing #1737 → #1738 → #1743 → #1744 → #1745 staircase.

The planner does not reproduce or replace any of those authorities.

## Trusted host boundary

The public function has two arguments:

```js
planFoundryParallelProductionAcceleration(untrustedRequest, trustedHostContext)
```

The first argument is deliberately never observed. A caller cannot choose the clock, repository, canonical head/tree, candidates, resource scopes, active leases, provider metrics, threshold or Forge proof.

The host context must be assembled from one current canonical snapshot and contains:

- repository, canonical `main` head/tree and explicit current time;
- the trusted task class and minimum net-saving threshold;
- one bounded raw Mission Scheduler source snapshot from the trusted host;
- canonical GitHub and optional Foundry build-lane receipts;
- identity-bound measurement receipts contained inside the build receipts’ validity windows;
- raw Forge sidecar evidence for direct canonical adjudication.

The complete trusted host context is first observed exactly once into a recursively frozen inert snapshot, so stateful provider/metrics receipts cannot diverge between digest validation and routing. The nested scheduler source has one exact root shape and cannot carry `now` or `freshnessMs`; it is independently bounded before the canonical scheduler runs. Accessors, symbols, sparse or widened arrays, cycles, non-plain prototypes and inputs outside the canonical portfolio/evidence/prerequisite bounds fail closed. The adapter then calls `buildMissionScheduler()` directly and forces the trusted host clock and freshness window after the snapshot, so caller-shaped scheduler output, tuple rewrites and capacity rewrites never enter the recommendation path.

Malformed, sparse, duplicate, stale, future, expired, wrong-repository, wrong-head, wrong-tree or internally contradictory evidence fails closed.

## Capacity evidence

Every lane first passes `validateBuildLaneCapacityReceipt()` for the trusted repository, task class and clock. V1 accepts exactly one `CHATGPT_GITHUB` baseline and at most one `FOUNDRY_FORGE` lane. Duplicate providers, routes, build receipts or metrics receipts fail the inventory.

Receipt identities are compared in their canonical trimmed form through one shared build, metrics and adjudicated Forge-stage inventory. Lexically different raw strings, cross-provider reuse and cross-stage reuse—including reuse of an M2 or M3 authority identity—cannot represent the same canonical receipt and evade duplicate detection.

The metrics receipt is payload-digest bound and repeats the exact build receipt identity, route, repository, worker, state, supported operations, supported task classes, queue depth and p95 start latency. Its authority IDs and proof refs must carry the build receipt chain, and its observation/expiry interval must be contained within the build receipt interval. Execution, integration, success, rework and available-slot measurements are consumed only from this host-provided receipt; root request values never participate.

Foundry is additionally eligible only when a direct call to `adjudicateForgeSidecarCapacity()` proves exact repository/head/tree/mirror parity, fresh valid M2 and M3 receipts, evidence binding, no pending activation and `canCarryRealWork=true`. The M2 and M3 receipt identities must be distinct, and both the build and metrics receipts must carry both identities; one shared authority entry cannot collapse the two-stage chain. A failed Forge adjudication makes the final Foundry provider evidence invalid as well as ineligible; provider status cannot report valid evidence alongside Forge blockers. The removed legacy six-field “M3 live” object is not authority evidence.

## Scheduler and lease binding

The planner does not accept a host-authored scheduler projection. It runs the canonical Mission Scheduler from the inert bounded source and accepts candidates only from that invocation's `parallelCandidateDetails`. The canonical producer therefore remains responsible for priority ordering, complete selected/active tuples, resource-disjoint admission and `elasticCapacity.remainingAdmissionSlots`; a caller cannot consistently rewrite several output inventories to manufacture another admissible selection.

As defense in depth, the adapter also verifies:

- top-level and decision-receipt fail-closed state is false with zero contradictions;
- the decision receipt has the exact canonical field inventory, empty contradiction codes, no candidates while `WAITING` or `APPROVAL_REQUIRED`, an allowed status consistent with its active/selected state, a `LANE_SELECTED` issue equal to the first emitted selected candidate with a matching canonical route/lifecycle, a `MERGE_READY` or `CLOSE_READY` tuple matching one canonical portfolio row, and an `ACTIVE_LANE(S)` route matching the primary canonical active row with null selected issue/lifecycle;
- decision freshness;
- exact equality between active-goal, active-issue and ACTIVE portfolio inventories;
- exact ordered equality between selected-issue, parallel-candidate and detail inventories;
- one fresh, resource-scoped READY portfolio row per selected candidate, while unrelated non-authoritative portfolio rows may remain canonically unscoped;
- exact canonical route and complete byte-preserved resource set;
- no active/selected or selected/selected resource overlap.

Candidate admission preserves the canonical order emitted by Mission Scheduler; the planner does not re-rank that authority-bearing sequence from critical-path weights.

V1 validates the complete canonical selected inventory, then accelerates only candidates whose canonical scheduler route is `CHATGPT_GITHUB`. Valid work on other routes remains scheduler-owned and is filtered from this Foundry recommendation without invalidating otherwise eligible GitHub candidates. Dispatch must re-read the Mission Scheduler/lease projection at action time; this read-only plan never claims a lease.

## Routing calculation

Receipt-bound predicted duration is:

```text
p95 start latency
+ median execution duration
+ review/integration duration
+ execution × rework rate
+ execution × failure rate
```

GitHub is the measured duration baseline. A valid zero-slot GitHub lane remains usable as the baseline when it is saturated; only Foundry needs a measured free assignment slot. Foundry is recommended only when:

```text
netSecondsSaved > 0
&& netSecondsSaved >= trustedMinimumNetSavingsSeconds
```

The strict positive check is independent of the configurable minimum, so a zero-second “saving” never routes work merely to keep Foundry busy.

Expected-time reliability and rework terms retain their fractional precision; the planner does not round each penalty into invented whole seconds. When eligible candidates outnumber measured Foundry slots, unassigned candidates are held with `NO_AVAILABLE_FOUNDRY_SLOT_USE_GITHUB`; this is distinct from nonpositive acceleration and from absent proven Foundry capacity.

A canonically proven Foundry lane with zero current slots remains proof-valid but not assignment-eligible. It reports `FOUNDRY_ACCELERATION_WAITING_FOR_CAPACITY` only when at least one candidate has a qualifying positive measured gain; otherwise it truthfully reports `FOUNDRY_ACCELERATION_NO_POSITIVE_GAIN`. Capacity exhaustion telemetry remains distinct from proof validity.

## Decisions

```text
FOUNDRY_ACCELERATION_BLOCKED
FOUNDRY_ACCELERATION_IDLE
FOUNDRY_ACCELERATION_WAITING_FOR_M3
FOUNDRY_ACCELERATION_WAITING_FOR_CAPACITY
FOUNDRY_ACCELERATION_NO_POSITIVE_GAIN
FOUNDRY_ACCELERATION_READY_MODEL_ONLY
```

Telemetry exposes only bounded identities and measurements: lane/worker identity, queue/slots, receipt IDs, canonical M2/M3 receipt IDs, recommended packet count and predicted seconds saved. It does not project raw proof content or claim that execution occurred.

## Acceptance boundary

Focused and hostile tests prove that:

1. caller-shaped clocks, heads, metrics, candidates, resources, scheduler projections and legacy M3 objects are ignored;
2. all routing metrics are consumed from one inert host snapshot and digest-bound to canonical capacity receipts;
3. only canonical Forge M2/M3 adjudication can make Foundry routable;
4. replayed, stale, future, expired, wrong-head/tree/repository and validity-window evidence fails closed;
5. stateful, accessor-bearing, symbolic, sparse, widened or over-bounded scheduler sources fail closed before canonical scheduling;
6. canonical priority, resource-disjoint selection and admission capacity cannot be replaced by consistent output-inventory rewrites;
7. zero or negative net savings never route, even when the trusted minimum is zero;
8. every dispatch, mutation, publication, merge, deployment, runtime and credential authority flag remains false.

Live M3 activation, dispatch adapter integration, Shared Workspace publication and protected merge remain separate exact-head-reviewed actions.
