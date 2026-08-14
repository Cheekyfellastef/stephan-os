# Stephanos Foundry Parallel Production Acceleration V1

Parent goal: #1671

## Purpose

Make the existing Foundry/Forge sidecar useful as measured parallel construction capacity without confusing source-ready Forge M3 contracts with live capacity and without creating a second scheduler, source writer or merge authority.

This V1 slice is a deterministic recommendation layer only. It dispatches no work, mutates no source or branch, runs no command, registers no runner and grants no merge, deployment, runtime or credential authority.

## Existing machinery reused

- `dualForgeConstructionSidecarV1.mjs` remains the settled-packet and single-publication planner.
- `elasticBuildCapacityV1.mjs` and Mission Scheduler resource identities remain the parallel admission boundary.
- GitHub remains the canonical public `main`, protected review and merge boundary.
- Forge M3 remains the existing ordered #1737 → #1738 → #1743 → #1744 → #1745 staircase.

This slice adds the missing decision between eligible work and an execution provider: whether an observed provider is genuinely available and whether using it is predicted to save net critical-path time after start, execution, review, integration, reliability and rework costs.

## Input contract

`planFoundryParallelProductionAcceleration()` consumes:

- exact repository and canonical `main` head;
- an explicit observation time and bounded freshness window;
- dense, bounded provider capacity observations;
- dense, bounded build candidates with exact base head, capabilities, critical-path weight and resource identities;
- resources already protected by active leases;
- the minimum predicted net saving required before work may leave the GitHub baseline.

Every provider needs a fresh, exact-head measured-capacity receipt. Foundry additionally needs a fresh live M3 capacity receipt that explicitly proves:

```text
canCarryRealWork=true
teardownVerdict=ZERO_RESIDUAL_AUTHORITY
exactMainHead=<current canonical main>
```

Historical construction/teardown proof with `canCarryRealWork=false` is non-routable. Missing, stale, wrong-head, malformed or unknown capacity stays unavailable.

## Routing calculation

The modelled provider duration is:

```text
median start delay
+ median execution duration
+ review/integration duration
+ execution × measured rework rate
+ execution × measured failure rate
```

GitHub is the canonical comparison baseline. A non-GitHub provider is recommended only when it satisfies the candidate capability contract, has a free measured slot, and its predicted duration beats the GitHub baseline by at least the configured minimum.

Foundry is not assigned work merely to keep runners busy. If no provider produces positive net acceleration, the candidate stays on the GitHub-first path.

## Parallelism and conflict handling

Candidates are ordered by critical-path weight and stable identity. Each assignment claims its complete resource set within the recommendation. A candidate is held when it conflicts with an active lease or an earlier, higher-priority assignment.

The result may recommend different resource-disjoint candidates to Foundry and another provider in the same planning pass. It cannot dispatch either assignment. The existing scheduler, source lease, provider adapter and exact-head approval boundaries remain authoritative.

## Decisions

```text
FOUNDRY_ACCELERATION_BLOCKED
FOUNDRY_ACCELERATION_IDLE
FOUNDRY_ACCELERATION_WAITING_FOR_M3
FOUNDRY_ACCELERATION_NO_POSITIVE_GAIN
FOUNDRY_ACCELERATION_READY_MODEL_ONLY
```

## Shared truth projection

The result exposes bounded Foundry telemetry suitable for a later Shared Workspace adapter:

- readiness or quarantine state;
- queue depth and available slots;
- recommended active-packet count;
- capacity and runtime receipt references;
- last teardown verdict;
- success and rework rates;
- median start and execution time;
- operator-required state;
- predicted total critical-path seconds saved.

The future adapter must preserve provenance and must not promote modelled recommendations into claims that dispatch or execution occurred.

## Acceptance boundary

This source slice is ready when deterministic and hostile tests prove:

1. Foundry is routable only with fresh exact-head measured capacity and genuine live M3 proof.
2. Historical/non-routable M3 proof cannot become capacity.
3. Stale, wrong-head, sparse, duplicate and hostile evidence fails closed.
4. Resource-disjoint work can be recommended to multiple providers while conflicts remain held.
5. Foundry is selected only for positive net acceleration.
6. Recommendation order is deterministic.
7. Every authority-bearing output remains false.

Live M3 execution, dispatch integration, Shared Workspace publication and protected merge remain separate reviewed continuations.
