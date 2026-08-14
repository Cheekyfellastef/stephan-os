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
- a fresh canonical Mission Scheduler projection;
- canonical GitHub and optional Foundry build-lane receipts;
- identity-bound measurement receipts contained inside the build receipts’ validity windows;
- raw Forge sidecar evidence for direct canonical adjudication.

Malformed, sparse, duplicate, stale, future, expired, wrong-repository, wrong-head, wrong-tree or internally contradictory evidence fails closed.

## Capacity evidence

Every lane first passes `validateBuildLaneCapacityReceipt()` for the trusted repository, task class and clock. V1 accepts exactly one `CHATGPT_GITHUB` baseline and at most one `FOUNDRY_FORGE` lane. Duplicate providers, routes, build receipts or metrics receipts fail the inventory.

The metrics receipt is payload-digest bound and repeats the exact build receipt identity, route, repository, worker, state, supported operations, supported task classes, queue depth and p95 start latency. Its authority IDs and proof refs must carry the build receipt chain, and its observation/expiry interval must be contained within the build receipt interval. Execution, integration, success, rework and available-slot measurements are consumed only from this host-provided receipt; root request values never participate.

Foundry is additionally eligible only when a direct call to `adjudicateForgeSidecarCapacity()` proves exact repository/head/tree/mirror parity, fresh valid M2 and M3 receipts, evidence binding, no pending activation and `canCarryRealWork=true`. Both the build and metrics receipts must carry the canonical M2 and M3 receipt identities. The removed legacy six-field “M3 live” object is not authority evidence.

## Scheduler and lease binding

The planner accepts candidates only from `parallelCandidateDetails`. It verifies:

- top-level and decision-receipt fail-closed state is false with zero contradictions;
- the decision receipt has the exact canonical field inventory, an allowed status consistent with its active/selected state, a `LANE_SELECTED`, `MERGE_READY` or `CLOSE_READY` issue/route/lifecycle tuple matching one canonical portfolio row, no candidates while `WAITING` or `APPROVAL_REQUIRED`, and empty contradiction codes;
- decision freshness;
- exact equality between active-goal, active-issue and ACTIVE portfolio inventories;
- exact equality between selected-issue, parallel-candidate and detail inventories;
- one fresh READY portfolio row per selected candidate;
- exact canonical route and complete byte-preserved resource set;
- no active/selected or selected/selected resource overlap.

V1 accelerates only candidates whose canonical scheduler route is `CHATGPT_GITHUB`. Dispatch must re-read the Mission Scheduler/lease projection at action time; this read-only plan never claims a lease.

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

When eligible candidates outnumber measured Foundry slots, unassigned candidates are held with `NO_AVAILABLE_FOUNDRY_SLOT_USE_GITHUB`; this is distinct from nonpositive acceleration and from absent proven Foundry capacity.

A canonically proven Foundry lane with zero current slots remains proof-valid but not assignment-eligible. It reports `FOUNDRY_ACCELERATION_WAITING_FOR_CAPACITY`, `CAPACITY_EXHAUSTED` telemetry and the same explicit slot-exhaustion hold reason; it is not mislabeled as missing proof or nonpositive acceleration.

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

1. caller-shaped clocks, heads, metrics, candidates, resources and legacy M3 objects are ignored;
2. all routing metrics are bound to canonical capacity receipts;
3. only canonical Forge M2/M3 adjudication can make Foundry routable;
4. replayed, stale, future, expired, wrong-head/tree/repository and validity-window evidence fails closed;
5. omitted or partial scheduler resource ownership cannot create unsafe parallel work;
6. zero or negative net savings never route, even when the trusted minimum is zero;
7. every dispatch, mutation, publication, merge, deployment, runtime and credential authority flag remains false.

Live M3 activation, dispatch adapter integration, Shared Workspace publication and protected merge remain separate exact-head-reviewed actions.
