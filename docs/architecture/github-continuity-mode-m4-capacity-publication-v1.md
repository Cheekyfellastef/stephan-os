# GitHub Continuity Mode M4 — capacity publication V1

## Purpose

M1 decides whether source work may continue when a primary route is unavailable. M2 creates bounded execution grants. M3 binds an admitted grant to the existing external Mission Orchestrator handoff contracts. M4 closes the capacity-evidence seam that previously allowed a healthy non-Codex writer to remain invisible to the router.

The canonical router already accepts `stephanos.build-lane-capacity-receipt.v1` and the canonical Shared Workspace store already exposes `publishBuildLaneCapacityToSharedWorkspace()`. Before M4, those primitives had no narrow GitHub Continuity producer contract. A Codex capacity failure could therefore leave otherwise buildable source work at `WAIT_FOR_PROVEN_CAPACITY` even when a GitHub/Foundry writer existed.

M4 does not create a second scheduler, queue, controller, worker, lease owner or merge path.

## Reused canonical machinery

```text
missionControllerCapacityRouterV1.validateBuildLaneCapacityReceipt()
missionControllerCapacityRouterV1.publishBuildLaneCapacityToSharedWorkspace()
missionControllerCapacityRouterV1.routeMissionControllerCapacity()
sharedAgentWorkspaceStore.writeAtomicJson()
```

The status files remain the existing canonical paths:

```text
status/chatgpt-github-build-capacity-current.json
status/foundry-forge-build-capacity-current.json
```

## M4 producer contract

`buildGitHubContinuityCapacityPublicationV1()` accepts one closed-world, data-only worker observation containing only:

```text
receiptId
route
repository
workerId
supportedTaskClasses
observedAtUtc
expiresAtUtc
queueDepth
p95StartLatencySeconds
authorityReceiptIds
proofRefs
```

It fixes the supported operations to `SOURCE_CONSTRUCTION` and `FOCUSED_TESTS`, and fixes the receipt state to `READY`. A caller cannot use M4 to claim Codex capacity or invent another route.

The observation must be backed by at least one safe proof reference. Route-specific authority receipts are preserved unchanged. GitHub capacity may legitimately have no separate authority receipt, matching the pre-existing router contract; Foundry remains subject to the router's existing M2/M3 authority-receipt checks before selection.

## Freshness and fail-closed behaviour

M4 is deliberately stricter than the base router. A publication may live for at most five minutes. If a production writer stops refreshing the observation, capacity expires naturally and the router returns to `WAIT_FOR_PROVEN_CAPACITY` rather than assuming an unavailable writer is healthy.

M4 rejects unknown/Codex routes, bad identities, malformed or duplicate evidence, missing proof refs, invalid queue/latency values, malformed freshness windows, and accessor-bearing/custom-prototype/symbolic/cyclic/sparse/oversized observations. The resulting canonical receipt is revalidated through `validateBuildLaneCapacityReceipt()` for every advertised task class before publication.

## Publication boundary

`publishGitHubContinuityCapacityPublicationV1(root, observation)` writes only through the existing Shared Workspace capacity publisher. It adds no source-mutation, merge, deploy, runtime, protected-merge, lease-seizure, duplicate-dispatch or arbitrary-command authority.

M4 source admission alone is not a live-writer claim. The production external writer remains responsible for obtaining a real current health/persistence observation and calling this producer on its existing periodic/service boundary. Live acceptance requires an observed fresh status record produced by that real writer and a router decision that selects it while Codex is unavailable.

## Regression fixtures

The focused tests preserve the failure class seen on Music #1624 and previously on VR/Spatial work: construct a fresh canonical ChatGPT-GitHub receipt; prove the router selects `CHATGPT_GITHUB` when Codex is exhausted; prove publication uses the existing Shared Workspace status path; prove stale/overlong, Codex-masquerading, proofless and malformed observations fail closed; and prove accessors are rejected without invocation.

The separate independent-review metadata failure is not conflated with this repair. PR #1859 owns lazy specialist-review enumeration.

## Authority invariant

Every M4 result retains:

```text
sourceMutationAuthorityAdded=false
mergeAuthorityAdded=false
deploymentAuthorityAdded=false
runtimeMutationAuthorityAdded=false
protectedMergeDispatchAllowed=false
leaseSeizureAllowed=false
duplicateDispatchAllowed=false
arbitraryCommandAllowed=false
```

Publishing evidence that a pre-authorized writer is healthy is not authority to merge, deploy or mutate runtime state.

## Stacked dependency

M4 is stacked on GitHub Continuity M3 because the eventual production consumer is the existing M3/Mission Orchestrator external-writer path. It must not be turned into an independent second continuity controller.

## Focused proof

```bash
node --check shared/agents/githubContinuityCapacityPublicationV1.mjs
node --test shared/agents/missionControllerCapacityRouterV1.test.mjs shared/agents/githubContinuityCapacityPublicationV1.test.mjs
```

## Final acceptance for the recurring-stall class

The capacity failure class is not permanently closed until: M2/M3/M4 source is accepted on protected main; the existing production GitHub/Foundry writer refreshes M4 from real health/persistence evidence; freshness expiry fails closed when the writer disappears; a Codex-exhausted non-Windows source mission automatically selects the proven alternative writer; Music #1624 resumes through its existing owner; Stall Sentinel treats a healthy-but-unpublished writer as machine-detectable acceptance failure; and review-history metadata failure remains independently recovered by its existing review-repair owner rather than freezing unrelated source work.

No merge, deployment, Windows/runtime mutation, provider-account mutation or protected-main write is authorized by M4 construction.
