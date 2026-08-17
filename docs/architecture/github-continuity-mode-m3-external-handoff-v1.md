# GitHub Continuity Mode M3 — External Handoff and Completion Adapter V1

## Purpose

M1 decides what may continue while Battle Bridge is unhealthy. M2 converts eligible `CONTINUE` tasks into source-only execution grants. M3 binds one M2 grant to the **existing** Mission Orchestrator worker action, immutable worker-queue item schema, Shared Workspace handoff schema and mission completion event.

M3 does not create or write a queue, create a worker, select a new route, issue a lease, publish Shared Workspace state, mutate source, merge, deploy or touch Battle Bridge runtime state.

## Existing machinery reused

M3 deliberately reuses the machinery admitted through merged #1746:

```text
missionOrchestratorWorker.buildMissionWorkerAction()
stephanos.mission-worker-queue-item.v1
sharedAgentWorkspaceStore.createSharedWorkspaceHandoffRecord()
stephanos.external-build-lane-handoff.v1
missionOrchestrator.applyMissionOrchestratorEvent()
AGENT_RESULT_RECEIVED
```

The production `missionOrchestratorWorkerService` remains the only owner of durable queue publication and Shared Workspace external-lane handoff publication. M3 prepares and preflights candidate records only.

## Grant binding

The public build input contains exactly:

```text
repository
expectedSourceHead
nowUtc
executionGrant
missionState
```

The M2 grant must remain:

- `stephanos.github-continuity-execution-grant.v1`;
- bound to the same repository and 40-character source head;
- source-only and explicitly non-Windows;
- bound to a safe mission/task identity;
- bound to its already-selected route and adapter;
- bound to the existing capacity receipt for GitHub/Foundry routes;
- free of takeover, merge, deploy, runtime, protected-merge, lease-seizure, duplicate-dispatch and arbitrary-command authority.

M3 does not reinterpret unavailable capacity as available.

## Mission binding

M3 accepts only a canonical Mission Orchestrator state for the same repository and mission ID. The state must be in `AGENT_IMPLEMENTATION` or the existing bounded repair transition and must not already have a running dispatch.

For repair work, M3 uses `projectMissionWorkerActionState()` to project the existing canonical `REPAIR_STARTED` transition. It then calls `buildMissionWorkerAction()` with the M2 route/capacity binding.

The returned action must still match the M2 adapter, route, receipt and proof references byte-for-byte before a handoff candidate can exist.

## External routes

Only the external routes already supported by the Mission Orchestrator worker publisher are externalized:

```text
CHATGPT_GITHUB -> chatgpt-github
FOUNDRY_FORGE -> foundry-forge
```

A valid `CODEX` M2 grant is classified `EXISTING_IN_PROCESS_ROUTE_PRESERVED`; M3 creates no external queue or workspace candidate for it. This avoids creating a second Codex dispatch path and allows the existing route to remain dormant when provider capacity is exhausted.

## Candidate records

For an external grant M3 returns two inert candidates:

1. `stephanos.mission-worker-queue-item.v1`
2. the existing Shared Workspace `HANDOFF` record containing `stephanos.external-build-lane-handoff.v1`

Both are derived from the canonical Mission Worker action. They are not written by M3.

The handoff body additionally carries the M2 `grantId`, `taskId` and `expectedSourceHead` so completion evidence can bind back to the exact continuity decision rather than only the mission label.

A deterministic `continuity-handoff-*` identity is derived from the exact M2 grant and canonical Mission Worker `actionId`. Re-evaluating an unchanged mission revision and grant therefore yields the same identity and lets the existing immutable publisher perform its normal idempotency handling.

## Portable completion receipt

M3 defines `stephanos.github-continuity-external-completion.v1` as a portable evidence envelope for an external lane result.

A completion binds:

```text
handoffId
grantId
missionId
taskId
repository
expectedSourceHead
adapter
capacityRoute
success
resultId
changedFiles
receipt
proofRefs
completedAtUtc
```

and explicitly retains all mutation/merge/deploy/runtime/duplicate-dispatch/arbitrary-command authority as false.

Successful completion requires a deterministic Mission Orchestrator-compatible receipt and safe changed-file list. M3 converts it into an existing `AGENT_RESULT_RECEIVED` event candidate and calls `applyMissionOrchestratorEvent()` against the supplied running mission state as a pure preflight.

If the changed-file list exceeds the mission's approved source scope, the canonical Mission Orchestrator blocks it and M3 returns no event candidate.

A reported external failure is not laundered into success. It is preflighted through the same canonical event and must project the mission to `BLOCKED`.

M3 itself does not append the event to the durable mission store.

## Data-only boundary

Before any routing, hashing, Mission Orchestrator call or serialization, the complete public packet is recursively descriptor-snapshotted.

M3 rejects:

- accessors without invoking their values;
- functions and own `toJSON` hooks;
- sparse/custom arrays;
- custom prototypes;
- symbols;
- cycles;
- reserved prototype-shaping keys;
- non-finite numbers;
- oversized strings/arrays/graphs;
- revoked or uninspectable proxies;
- unexpected top-level orchestration fields.

Only the frozen owned snapshot is supplied to canonical downstream functions.

## Authority invariant

Every M3 result keeps:

```text
queueWriteAllowed=false
sharedWorkspaceWriteAllowed=false
existingDispatchTakeoverAllowed=false
sourceMutationAuthorityAdded=false
mergeAuthorityAdded=false
deploymentAuthorityAdded=false
runtimeMutationAuthorityAdded=false
protectedMergeDispatchAllowed=false
leaseSeizureAllowed=false
duplicateDispatchAllowed=false
arbitraryCommandAllowed=false
```

M3 does not convert a source-only continuity grant into source-mutation authority. The external route's existing worker/lease/publication contract remains responsible for any separately admitted source change.

## Focused proof

```bash
node --check shared/agents/githubContinuityExternalHandoffV1.mjs
node --test shared/agents/githubContinuityExecutionGrantV1.test.mjs shared/agents/githubContinuityExternalHandoffV1.test.mjs
```

The M3 suite covers:

- canonical GitHub queue/workspace candidate mapping;
- deterministic handoff identity;
- Foundry route binding;
- Codex non-externalization;
- source-head/Windows/authority drift;
- running-dispatch takeover rejection;
- successful completion event preflight;
- completion identity and allowed-file enforcement;
- external failure propagation;
- accessor, `toJSON` and revoked-proxy rejection;
- zero queue/workspace/merge/deploy/runtime authority.

## Next bounded slice

M4 may connect these candidates to the **existing** durable publisher only after M2/M3 source acceptance. It must preserve immutable queue idempotency, Shared Workspace publication rollback semantics, the current action-grant/source-revision checks, exact worker ownership and completion receipt correlation.

M4 must not create another worker queue or controller and must not bypass protected merge, runtime, Battle Bridge recovery or operator approval gates.
