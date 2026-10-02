# Stephanos Lift 2 — Closed-loop learning from capability gaps

Owner goal: #2647 — Stephanos Lift 2: Closed-loop learning from capability gaps

## Purpose

Close the existing Stephanos learning circuit without creating another controller, scheduler, worker, mailbox, daemon, truth store or merge authority.

The canonical loop is:

`Intent -> Execute -> typed capability gap -> teacher -> exam -> proof -> retained lesson -> bounded retry directive`

## Canonical wiring

- `shared/agents/closedLoopLearningV1.mjs` owns the pure state machine, teacher selection, ten-question capability exam, zero-authority boundary and retry-readiness projection.
- `shared/agents/sharedAgentWorkspaceStore.mjs` automatically attaches the state machine whenever an event carries a typed `capabilityFailure`.
- Existing `flywheelLearningFabricV1` remains the only Shared Workspace lesson promoter. A closed-loop failure does not expose a `learningCandidate` until both the exam and deterministic verification have passed.
- `stephanos-server/services/sharedWorkspaceDashboardFeedService.js` projects the newest closed-loop state through the existing dashboard feed.
- `shared/runtime/flywheelTelemetryModel.mjs` renders that canonical projection in the Flywheel pane. Other Shared Workspace consumers, including the Agents surface, can consume the same `projection.closedLoopLearning` object rather than inventing private telemetry.
- `sovereignCommanderCapabilityCompilerV1` reuses the same ten-question exam contract.

## States

- `NOT_APPLICABLE`: the failure was not explicitly proven to be a genuine capability gap.
- `TEACHING_REQUIRED`: the gap is genuine, a teacher is selected, but no retained method has been produced.
- `EXAM_REQUIRED`: a method exists but the full ten-question exam has not passed with proof.
- `PROOF_REQUIRED`: the exam passed but deterministic/live verification proof is missing.
- `RETRY_READY`: exam and proof passed, a reusable lesson candidate exists, and the original task may be retried only through existing execution authority.

No state grants merge, deployment, runtime mutation, arbitrary shell, destructive Git, approval, duplicate-controller, duplicate-scheduler or duplicate-worker authority.

## Teacher routing

The router prefers the narrowest existing teacher:

- Stephanos product/source/shared-workspace surfaces -> `openclaw-local`
- whole-PC / Windows / Battle Bridge surfaces -> `openclaw-standalone`
- Sovereign Commander parity-specific capability -> `sovereign-commander`
- otherwise -> `flywheel`

An explicit known teacher hint may override automatic selection without widening authority.

## Regression exemplar

The recent landing-page inability is represented as:

`PRODUCT_SURFACE_DISCOVERY_AND_MUTATION`

with Stephanos source targets. The model routes that gap to `openclaw-local`, withholds retention before exam/proof, then emits the durable lesson plus bounded retry directive only after both gates pass.

## Proof commands

```bash
node --test shared/agents/closedLoopLearningV1.test.mjs
node --test shared/agents/flywheelLearningFabricV1.test.mjs
node --test tests/flywheel-live-telemetry.test.mjs
node --test shared/agents/sharedAgentWorkspaceStore.test.mjs
node --test shared/agents/sovereignCommanderCapabilityCompilerV1.test.mjs
node --test tests/shared-workspace-dashboard-api.test.mjs
git diff --check
```

Browser-visible Flywheel acceptance remains bound to the existing served-head/browser proof rules. Source tests prove the projection contract, not that a particular Battle Bridge browser instance is already serving the merged head.
