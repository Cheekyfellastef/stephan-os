# PR #1617 prerequisite authority audit — 2026-07-30

Repository: `Cheekyfellastef/stephan-os`

Audit base: `main` at `21dd7e30db529fea6eed0f0085f1b67fe858891c`

Held PR: #1617, `feat/durable-flywheel-controller-vnext`, observed head
`acd1a57bd8d78d0b85f98a84c3a3d44ecf8cdeff`

## Conclusion

`AUDIT_GATE_CLEAR_MINIMAL_CANONICAL_CONTRACTS_REQUIRED`

The repository already owns nearly all scheduling, worker, queue, dispatch,
watchdog, proof, Shared Workspace and reconciliation machinery needed by PR
#1617. Those components must be composed, not recreated.

Five bounded authority gaps remain:

1. a canonical implementation-lane projection that binds one lane identity to
   fetched GitHub PR truth and exact head;
2. one durable source-mutation lease authority (not an execution-receipt
   correlation key and not a Codex patch-escrow workspace lease);
3. a controller-specific heartbeat, distinct from Mission Worker heartbeat;
4. an idempotent terminal-lane finalizer that validates affirmative exact-PR,
   exact-head merge evidence and releases only the matching mutation lease;
5. one production composition surface and a programme-stall diagnosis handler
   that run through existing source contracts and the existing Monitor
   Multiplexer.

No new scheduler, worker, queue, dispatcher, watchdog, updater, mailbox, proof
runner, monitor runtime or orchestration engine is justified.

## Audit method and searched evidence

The full source tree was searched before source editing. Generated
`apps/stephanos/dist/**` and dependency directories were excluded from
authority conclusions.

Representative search terms:

- `implementation lane`, `activeLane`, `canonicalLane`, `activePr`,
  `headSha`, `prState`, `merged`, `mergedAt`, `mergeCommitSha`;
- `source mutation`, `mutation lease`, `lease owner`, `leaseKey`,
  `acquire`, `claim`, `renew`, `expiry`, `stale`, `release`;
- `controller heartbeat`, `worker heartbeat`, `heartbeatExpiresAtUtc`,
  `runtime health`, `liveness`, `freshness`;
- `stall`, `stalled`, `sentinel`, `anti-stall`, `watchdog`, `monitor`;
- `Shared Workspace`, `proof`, `execution receipt`, `Battle Bridge`;
- `Mission Scheduler`, `critical backlog`, `conveyor`, `exact head review`;
- `Codex dispatch`, `queue`, `dispatcher`, `mailbox`, `unattended sync`;
- `terminal`, `finalize`, `cleanup`, `reconcile`, `PR estate`.

Public exports and production callers were traced with searches for `export`
declarations, import paths and direct function names. The absence of an exact
requested name was not treated as absence of equivalent machinery.

PR #1617 was inspected without checking out or modifying its branch. Its eight
unresolved, non-outdated review threads require:

- active-lane scheduler status and identity binding;
- proof-container validation on the active-lane path;
- execution-receipt binding to the exact PR;
- affirmative GitHub merge evidence;
- encoded/explicit lane identity consistency;
- terminal-lane identity retention;
- a canonical production composition entry point;
- Critical Backlog Conveyor gating before idle dispatch.

The unresolved threads confirm that PR #1617 currently attempts authority
validation inside the controller and relies on injected adapters for production
composition. This prerequisite must move those responsibilities to canonical
owners without editing PR #1617.

## Existing canonical machinery

| Authority | Classification | Canonical source/public exports | Production callers and ownership |
| --- | --- | --- | --- |
| Shared Workspace records and paths | A | `shared/agents/sharedAgentWorkspaceStore.mjs`: `resolveSharedWorkspacePath`, `ensureSharedWorkspaceLayout`, record builders, validators, atomic JSON and JSONL writers | Used by execution receipts, Battle Bridge publisher, Codex queue/dispatcher, mailbox index, monitor multiplexer, verification harness, worker watchdog and server feeds. Shared Workspace owns durable external state; callers own their schemas. |
| Shared Workspace read projection | A | `shared/agents/shared-workspace-dashboard-feed.mjs`: `readSharedWorkspaceDashboardFeed` | `stephanos-server/services/sharedWorkspaceDashboardFeedService.js` exposes the backend read path. It remains read-only and reports invalid records rather than fabricating current state. |
| GitHub PR truth | A, with projection gap | `stephanos-server/services/githubPrEvidenceService.js`: `fetchGithubPrEvidence`, auth/config resolvers | `stephanos-server/routes/github.js` is the live read-only adapter. It fetches the PR, exact head, state, merge flag, files and checks. It does not currently build a programme-lane identity or expose all terminal merge fields. |
| GitHub portfolio telemetry | A, advisory for lane discovery | `stephanos-server/services/githubTelemetryService.js`: `readGithubTelemetry`, `normalizeGithubTelemetry` | `liveGoalProjectionService.js` consumes the live adapter. It lists open PRs and workflows, but does not own mutation-lane selection. |
| Mission Scheduler | A | `shared/runtime/missionScheduler.mjs`: `buildMissionScheduler`, `answerMissionQuery` | The contract is well tested but has no production caller on `main`; PR #1617 imports it. It owns read-only goal selection and fail-closed scheduler decisions, not lane/lease construction or dispatch. |
| Critical Backlog Conveyor | A | `shared/agents/criticalBacklogConveyor.mjs`: validation, projection and mission-input builders | `stephanos-server/services/criticalBacklogConveyorService.js` owns durable service publication and guarded mission creation; `scripts/battle-bridge-worker-watchdog-runner.mjs` calls it. Idle dispatch must consume its affirmative decision rather than bypass it. |
| Execution receipts | A | `shared/agents/executionReceiptV1.mjs`: create, validate, classify, project, append and read contracts | Used by guarded repair and provider-neutral review. The Shared Workspace history/current projection is canonical worker execution state. |
| Mission Worker heartbeat | A | `scripts/mission-orchestrator-worker-heartbeat.mjs`: record builder, canonical path resolver and writer | `mission-orchestrator-worker-supervised.mjs` publishes it; worker watchdog policy validates it. Ownership is explicitly Mission Worker only. |
| Worker watchdog | A | `scripts/battle-bridge-worker-watchdog-policy.mjs`: `assessMissionOrchestratorWorker`, recovery decision; fixed runner/installer scripts | The watchdog supervises the Mission Orchestrator Worker and may start only its allowlisted fixed task. It is not a controller heartbeat or general programme sentinel. |
| Battle Bridge proof publication | A | `shared/agents/battleBridgePublisher.mjs`: slice/service builders, verification, Shared Workspace publication | `battleBridgePublisherLoop.mjs` owns periodic publication; `captainsBridgeRuntimeHealth.mjs` consumes service records read-only. |
| Runtime health projection | A | `shared/agents/captainsBridgeRuntimeHealth.mjs`: `projectCaptainsBridgeRuntimeHealth`; `backendFreshnessSupervisor.mjs` for exact backend proof | The Goal Dashboard projection consumes runtime health. These surfaces report service health and do not own programme progress or mutation leases. |
| Monitor runtime | A | `shared/agents/monitorMultiplexer.mjs`: definition/registry builders, bounded tick, start/stop loop | Existing canary and tests prove bounded publication and restart continuity. No programme-stall handler or capability registry entry exists. The multiplexer must remain the only monitor runner. |
| Capability registry | A, missing entry | `shared/agents/stephanosCapabilityRegistry.mjs`: static registry, validation, projection and lookup | The mailbox exposes registry reads. It includes workspace, worker, watchdog, verification and dispatch capabilities, but no programme monitoring/monitor-multiplexer capability. |
| Exact-head review dispatch | A | `shared/agents/exactHeadReviewDispatchCoordinator.mjs`: canonical-lane evidence and exact-head review decision contracts | `scripts/exact-head-review-dispatch.mjs` is the production entry. Trusted GitHub comments are review-lane evidence, not mutation-lease authority. |
| Codex queue and dispatcher | A | `shared/agents/codexDispatchQueue.mjs` and `automatedCodexDispatcher.mjs` | `scripts/stephanos-codex-dispatch-mcp.mjs` is the production dispatcher route. These contracts own queue/dispatch state, not programme authority composition. |
| Command mailbox | A | `shared/agents/battleBridgeGitHubCommandMailbox.mjs` plus bounded script and bootstrap | The fixed issue mailbox owns allowlisted operator commands and receipts. It has no free-form source-mutation authority. |
| Unattended updater/refresh | A | `battle-bridge-github-sync-*`, `postSyncRuntimeRefreshCoordinator.mjs`, `stephanosChatUpdate.mjs` | These own safe main fast-forward and exact-head runtime refresh. They are deployment machinery, not controller or lease machinery. |
| PR estate reconciliation | A | `shared/agents/prEstateReconciler.mjs` plus evidence/family contracts | `scripts/pr-estate-reconcile.mjs` is the read-only production entry. It owns capability-family PR disposition, not live mutation-lease release. |
| Durable mission/work queue | A | `missionOrchestratorStore.js`, `missionOrchestratorWorkerService.js`, `missionOrchestratorWorkerConsumer.js` | The service uses immutable queue items and atomic pending-to-processing rename claims. Those claims own queue consumption only and are not source-mutation leases. |

## Internal and compatible partial implementations

### Lane projections

- `scripts/git-branch-intelligence.mjs` exports
  `projectBuildLaneManager`. It projects supplied worktree, PR, queue and proof
  facts for the Captain's Bridge UI. Selection falls back to the first supplied
  lane and therefore is not an authoritative GitHub/lease lane builder.
- `shared/runtime/missionScheduler.mjs` internally normalizes active goal, PR,
  branch and proof bindings. It correctly owns scheduling classification but
  does not expose a reusable lane record and does not fetch durable sources.
- `exactHeadReviewDispatchCoordinator.mjs` validates trusted canonical-review
  lane comments. That is exact-head review coordination, not source-mutation
  ownership.
- `prEstateReconciler.mjs` and `prEstateEvidence.mjs` normalize PR families and
  terminal dispositions. They are estate-wide read-only reconciliation, not a
  current implementation-lane lease.

These partials are compatible inputs to a new lane projection, but none alone
binds lane ID, issue, PR, exact head, merge state, proofs, receipts and mutation
lease.

### Lease-like records

- `executionReceiptV1.mjs` stores a `leaseKey`, validates it as part of an
  execution identity and serializes receipt publication through internal file
  locks. The documentation calls the current projection
  `receipts/<leaseKey>.json`. Both the code and `toSharedWorkspaceExecutionReceipt`
  map `leaseKey` to `correlationId`; no acquisition record grants source
  mutation. The internal lock only serializes receipt history/current
  publication and is released after each append.
- `codexPatchEscrow.mjs` has a renewable `leaseOwner` on a Codex workspace
  attempt. It protects patch-escrow attempt reuse and binds an issue/base
  workspace. It does not bind a PR and exact implementation head, has no
  Shared Workspace source-mutation record, and has no exact-lane release
  contract.
- Mission worker queue claiming atomically renames one pending queue item into
  processing. That grants queue-consumption ownership only.

These similarly named mechanisms are not equivalent to source-mutation
authority and must not be promoted implicitly.

### Heartbeats and health

- Mission Worker heartbeat binds the fixed worker task, canonical `main` source,
  PID and last tick.
- execution receipts carry per-execution heartbeat expiry.
- Battle Bridge publisher and GitHub sync publish service/sync heartbeat-like
  records.
- Monitor Multiplexer publishes its registry and per-monitor `heartbeatUtc`.

No record identifies a programme controller, its controller source revision,
bounded cycle, active lane, last successful reconciliation and last published
controller receipt. Reusing Mission Worker heartbeat would collapse distinct
authority.

### Terminal reconciliation

`missionOrchestrator.mjs` accepts a `PULL_REQUEST_MERGED` event only after its
protected merge phase, and `missionOrchestratorWorkerResult.mjs` requires a
merged state plus merge commit SHA. This is useful affirmative merge evidence,
but it updates a mission state machine and neither validates nor releases a
source-mutation lease.

No public idempotent contract publishes terminal lane evidence and releases
only the exact lane/head lease.

### Stall detection

- Mission Scheduler classifies explicit `STALLED` lifecycle evidence.
- the worker watchdog diagnoses worker-process/heartbeat failure;
- `buildConciergeAntiStallMergeLane` supplies guarded merge fallback guidance;
- Monitor Multiplexer is the canonical bounded monitor execution/publication
  runtime.

No deterministic programme-level diagnosis composes lane, controller
heartbeat, worker heartbeat, receipt, proof and terminal state. A new scheduler
or sentinel runtime would be duplicate machinery. The safe addition is a pure
diagnosis/handler registered for the existing Monitor Multiplexer.

## Authority classification

| Required authority | Classification | Decision |
| --- | --- | --- |
| Authoritative implementation-lane state | C | Compose fetched GitHub PR evidence, exact identity rules, durable mutation lease, execution receipts and proof refs into one public lane builder. |
| GitHub issue/PR/exact-head projection | C | Extend the existing read-only GitHub PR evidence result only as needed; do not add another GitHub client. |
| Source-mutation lease | D | Add one minimal Shared Workspace-backed authority with exact lane/issue/PR/head/owner binding, non-seizing acquisition, validation, renewal, staleness and exact release. |
| Controller heartbeat | D | Add a controller-only Shared Workspace status contract; reject Mission Worker heartbeat schemas. |
| Worker heartbeat | A | Reuse unchanged. |
| Runtime health/liveness | A | Reuse Battle Bridge publisher and Captain's Bridge runtime health unchanged. |
| Terminal merged-lane reconciliation | C/D | Reuse affirmative GitHub evidence validation patterns and Shared Workspace publication, adding only the missing exact-lease idempotent finalizer. |
| Programme Stall Sentinel | E as a new runner; D as a handler | Reuse Monitor Multiplexer. Add only pure programme-stall diagnosis plus one monitor definition/handler and registry entry. |
| Durable programme projection | D | Add a composition surface that calls real GitHub, Shared Workspace, execution receipt, worker heartbeat, scheduler and conveyor contracts. |
| Shared Workspace stores/projections | A | Reuse unchanged except for bounded authority-specific helpers if necessary. |
| Battle Bridge proof/publication | A | Reuse unchanged. |
| Mission Scheduler | A | Reuse unchanged. |
| Critical Backlog Conveyor/service | A | Reuse unchanged and require its decision for idle dispatch. |
| Review dispatch, Codex queue/dispatcher, mailbox, updater, watchdog, proof runner | A/E | Inventory and consume; never recreate or transfer ownership to the flywheel controller. |

## Smallest safe implementation plan

1. Add `shared/agents/programmeAuthorityV1.mjs` with pure public contracts:
   - `buildCanonicalImplementationLaneProjection`;
   - source-mutation lease record creation/validation and exact binding helpers;
   - controller heartbeat creation/validation/freshness projection;
   - `diagnoseProgrammeStall`;
   - `buildProgrammeStallMonitorDefinition` and the bounded handler adapter;
   - `buildAuthoritativeProgrammeProjection`;
   - terminal-finalization input validation and receipt construction.
2. Add `stephanos-server/services/programmeAuthorityService.js` as the only
   production composition/mutation adapter:
   - read and publish the lease and controller heartbeat in the configured
     external Shared Workspace;
   - call `fetchGithubPrEvidence` for the lease-bound PR;
   - read execution receipts, Battle Bridge/current workspace records, Mission
     Worker heartbeat and Critical Backlog Conveyor status;
   - call the existing Mission Scheduler and pure projection;
   - finalize a terminal lane by publishing terminal evidence before releasing
     only the exact matching lease.
3. Extend the existing GitHub PR evidence result with terminal merge fields
   already returned by GitHub. Do not add a second GitHub adapter.
4. Register one programme-monitor capability whose execution route is the
   existing Monitor Multiplexer.
5. Add deterministic tests proving identity conflicts, receipt correlation
   boundaries, exact lease behavior, distinct heartbeats, affirmative merge
   requirements, idempotent finalization, real-source service composition and
   Monitor Multiplexer reuse.

The service may accept dependency overrides only for deterministic tests. Its
default production path must resolve the actual Shared Workspace, GitHub and
existing source contracts.

## Proposed durable records and public locations

| Contract | Location | Durable location |
| --- | --- | --- |
| `stephanos.canonical-implementation-lane.v1` | `shared/agents/programmeAuthorityV1.mjs` | Projection/receipt only; derived from sources, never chat memory |
| `stephanos.source-mutation-lease.v1` | pure contract in shared module; I/O in service | `status/source-mutation-lease-current.json` |
| `stephanos.programme-controller-heartbeat.v1` | pure contract in shared module; I/O in service | `status/programme-controller-heartbeat.json` |
| `stephanos.terminal-lane-finalization.v1` | pure validation/receipt plus service finalizer | `receipts/terminal-lane-<laneId>.json` |
| `stephanos.programme-stall-diagnosis.v1` | shared pure diagnosis and Monitor Multiplexer handler | existing monitor status/proof/event paths |
| `stephanos.authoritative-programme-projection.v1` | shared pure builder plus server composition service | projection receipt returned/published by the controller |

## Duplicate-machinery risks

- Treating `executionReceipt.leaseKey` or its receipt-publication lock as a
  source-mutation grant would allow fabricated ownership.
- Promoting `codexPatchEscrow.leaseOwner` would conflate disposable workspace
  recovery with exact PR/head mutation authority.
- Reusing Mission Worker heartbeat would let worker availability masquerade as
  controller liveness.
- Creating a Programme Stall Sentinel loop would duplicate Monitor Multiplexer.
- Letting PR #1617 call Mission Scheduler directly on injected `goals` would
  create adapter-supplied scheduling authority and bypass the Critical Backlog
  Conveyor.
- Letting terminal finalization reschedule or dispatch would create a second
  scheduler/worker owner.
- Inferring `merged` from `CLOSED`, a truthy `mergedAt`, or a receipt would make
  cleanup destructive under contradictory GitHub evidence.

## Migration and compatibility

- Existing public contracts remain unchanged.
- Existing execution receipts retain `leaseKey`; its documented meaning is
  explicitly correlation/execution-lane identity, not source-mutation
  authority.
- Existing worker heartbeat, watchdog, scheduler, conveyor, monitor, queue,
  dispatcher and mailbox contracts are consumed without schema replacement.
- GitHub PR evidence gains additive terminal fields.
- PR #1617 can replace its internal lane/merge/heartbeat validation and
  test-only adapter-shaped startup input with imports from the prerequisite
  contracts and the production service. It does not need to own lease,
  scheduler, worker, conveyor, sentinel or finalizer machinery.

## Required proof

Targeted tests must demonstrate:

1. canonical components are imported/reused and no duplicate machinery starts;
2. lane ID, issue, PR and exact head are consistent or fail closed;
3. execution receipt `leaseKey` cannot fabricate a mutation lease;
4. lease claim/validation/renewal/release are exact-lane and exact-head bound;
5. controller and worker heartbeats remain schema- and authority-distinct;
6. closed-but-unmerged and contradictory merge evidence cannot finalize;
7. terminal finalization is idempotent and exact-lease only;
8. production composition uses real GitHub/Shared Workspace/receipt/heartbeat/
   conveyor contracts by default, with dependency injection only in tests;
9. missing or ambiguous authority yields `HOLD`;
10. chat memory is explicitly non-authoritative;
11. stall diagnosis is executed by the existing Monitor Multiplexer contract;
12. one projection receipt inventories every source/component consumed.

Affected existing test suites:

- Mission Scheduler;
- Critical Backlog Conveyor and service;
- execution receipts;
- Shared Workspace store/feed;
- Mission Worker heartbeat and watchdog;
- Battle Bridge publisher/runtime health;
- Monitor Multiplexer;
- capability registry;
- GitHub PR evidence and telemetry;
- exact-head review coordinator and PR estate reconciliation where imports or
  additive fields affect them.

## Audit gate evaluation

- Existing active prerequisite PR/branch: **not found**. Open PRs #1620 and
  #1621 are separate bounded-construction and repair-loop candidates and do not
  provide this authority layer. Remote branch searches found only PR #1617's
  flywheel branch for this subject.
- Ambiguous ownership: **no**. Partial lease-like mechanisms have distinct,
  documented scopes.
- Conflicting existing components: **no**.
- Replacement of canonical machinery required: **no**.
- Flywheel controller would own lease/scheduler/worker/sentinel authority:
  **no**; those remain dedicated contracts/services.
- Broad unrelated refactor required: **no**.
- Repository-mandated operator architecture approval: **not found**. The change
  is high risk under `AGENTS.md`, so exact-head proof and fresh independent
  review are required before merge.

Phase 2 may proceed in this same single implementation lane.
