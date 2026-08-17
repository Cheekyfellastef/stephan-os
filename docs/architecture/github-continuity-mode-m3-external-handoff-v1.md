# GitHub Continuity Mode M3 — External Handoff and Completion Adapter V1

## Purpose

M1 decides what may continue while Battle Bridge is unhealthy. M2 converts eligible `CONTINUE` tasks into source-only execution grants. M3 binds one admitted M2 grant to the **existing** Mission Orchestrator external-lane contracts and preflights portable completion evidence back into the existing mission lifecycle.

M3 never writes the worker queue, writes Shared Workspace state, creates a scheduler, starts a worker, selects a new route, issues a lease, mutates source, merges, deploys or touches runtime state.

## Canonical machinery reused

M3 reuses only already-admitted contracts:

```text
missionOrchestratorWorker.buildMissionWorkerAction()
stephanos.mission-worker-queue-item.v1
sharedAgentWorkspaceStore.createSharedWorkspaceHandoffRecord()
sharedAgentWorkspaceStore.validateSharedWorkspaceRecord()
stephanos.external-build-lane-handoff.v1
missionOrchestrator.applyMissionOrchestratorEvent()
AGENT_RESULT_RECEIVED
```

The production `missionOrchestratorWorkerService` remains the sole durable queue and Shared Workspace publisher.

## Durable mission-state boundary

M3 accepts only a canonical Mission Orchestrator state already durably in:

```text
AGENT_IMPLEMENTATION
```

`REPAIR_REQUIRED` is deliberately **not** projected locally. The canonical mission service must first persist its existing `REPAIR_STARTED` transition. Only the resulting durable `AGENT_IMPLEMENTATION` revision may be handed to M3.

This prevents an external queue candidate from being bound to a revision that exists only inside a pure preview function.

A mission with an already-running dispatch is also rejected. M3 cannot take over work owned by another adapter.

## M2 grant binding

The grant must remain:

- `stephanos.github-continuity-execution-grant.v1`;
- bound to the same repository and exact 40-character source head;
- source-only and explicitly non-Windows;
- bound to the same mission/task identity;
- bound to its already-selected route and adapter;
- bound to a capacity receipt and at least one safe proof reference for external routes;
- free of takeover, source, merge, deploy, runtime, protected-merge, lease-seizure, duplicate-dispatch and arbitrary-command authority.

M3 does not reinterpret missing capacity evidence as availability.

## Route boundary

Only routes already supported by the canonical external publisher are externalized:

```text
CHATGPT_GITHUB -> chatgpt-github
FOUNDRY_FORGE -> foundry-forge
```

A valid `CODEX` grant stays on its existing in-process path and produces no external candidate. This prevents M3 from becoming a second Codex dispatch mechanism and allows GitHub Continuity to remain useful while Codex capacity is empty.

## Canonical correlation identity

The production external publisher uses the Mission Worker action ID as the Shared Workspace handoff ID. M3 preserves that identity exactly:

```text
queueItem.actionId
== canonical Mission Worker actionId
== Shared Workspace handoffId
== M3 handoffId
```

M3 does **not** invent a separate continuity handoff identity.

The M2 `grantId`, `taskId` and exact `expectedSourceHead` are carried inside the existing handoff body as additional continuity bindings; they do not replace the canonical action correlation key.

Before exposing a handoff candidate, M3 runs the existing Shared Workspace record validator and verifies the returned record retained the exact canonical action ID, correlation ID, route, receipt and zero-authority body fields. If Shared Workspace ID normalization would change the action ID, M3 fails closed rather than silently publishing under a different identity.

## Candidate records

For an admitted external grant, M3 prepares only:

1. one `stephanos.mission-worker-queue-item.v1` candidate;
2. one existing-kind Shared Workspace `HANDOFF` candidate containing `stephanos.external-build-lane-handoff.v1`.

The canonical production service remains responsible for immutable publication and its existing idempotency/rollback behavior. M3 has no queue path or workspace writer.

## Portable completion receipt

M3 defines `stephanos.github-continuity-external-completion.v1` as a portable result envelope bound to:

```text
handoffId/actionId
grantId
missionId
taskId
repository
expectedSourceHead
adapter
capacityRoute
success/resultId
changedFiles
deterministic receipt
proofRefs
completedAtUtc
```

The supplied M3 handoff is rechecked before completion use. Its top-level handoff/action identity, queue-item action identity, Shared Workspace handoff identity, mission correlation, adapter and serialized body bindings must still agree.

Successful completion is converted into the existing `AGENT_RESULT_RECEIVED` event and preflighted through `applyMissionOrchestratorEvent()`. Canonical Mission Orchestrator allowed-file and event-order checks therefore remain authoritative.

A reported external failure is also preflighted through the same event and must project the mission to `BLOCKED`; M3 never converts failure into success.

M3 does not append the event to the durable mission store.

## Hostile-data boundary

The complete public build and completion packets are recursively descriptor-snapshotted before routing, hashing, serialization or downstream calls.

The adapter rejects:

- accessors without invoking values;
- functions and own `toJSON` hooks;
- sparse or custom arrays;
- custom prototypes;
- symbols and cycles;
- prototype-shaping keys;
- non-finite values;
- oversized strings/arrays/graphs;
- revoked or uninspectable proxies;
- unexpected top-level orchestration fields.

Only the frozen owned snapshot is passed to canonical machinery.

## Authority invariant

Every result retains:

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

A continuity execution grant is routing evidence, not merge/deploy/runtime authority.

## Focused proof

```bash
node --check shared/agents/githubContinuityExternalHandoffV1.mjs
node --test shared/agents/githubContinuityExecutionGrantV1.test.mjs shared/agents/githubContinuityExternalHandoffV1.test.mjs
```

Coverage includes canonical queue/workspace mapping, exact action/handoff correlation, repair-state durable-transition hold, GitHub/Foundry route binding, Codex non-externalization, missing proof/head/Windows/authority drift, running-dispatch rejection, successful completion preflight, fabricated handoff/scope/authority rejection, external failure propagation and hostile caller objects.

## Next bounded slice

M4 may connect these already-preflighted candidates to the **existing** durable publisher only after M2/M3 source acceptance. It must preserve current immutable queue idempotency, Shared Workspace rollback semantics, action-grant/source-revision checks, exact worker ownership and completion correlation.

M4 must not create another queue/controller or bypass protected merge, runtime, Battle Bridge recovery or operator approval gates.