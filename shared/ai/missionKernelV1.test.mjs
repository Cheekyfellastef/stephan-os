import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_MISSION_LIFECYCLE,
  buildMissionKernelProjection,
  deriveMissionContinuity,
  deriveProofRequirements,
  deriveShadowRoute,
} from './missionKernelV1.mjs';

test('canonical lifecycle is the Stephanos Do This V1 eight-stage path', () => {
  assert.deepEqual(CANONICAL_MISSION_LIFECYCLE, [
    'INTENT', 'PLANNED', 'DISPATCHED', 'BUILDING',
    'VERIFYING', 'MERGED', 'LIVE', 'PROVED',
  ]);
});

test('shadow route prefers Sovereign Commander for Battle Bridge work only with capability proof', () => {
  const route = deriveShadowRoute({
    operatorIntent: 'Fix Battle Bridge VR telemetry and verify the runtime service',
    missionClass: 'build-runtime',
    finalRouteTruth: { sovereignCommanderAvailable: true },
  });
  assert.equal(route.mode, 'shadow');
  assert.equal(route.executionAuthorized, false);
  assert.equal(route.preferredRouteId, 'sovereign-commander');
  assert.equal(route.candidates.some((entry) => entry.routeId === 'guarded-goal-runner'), true);
  assert.equal(route.candidates.some((entry) => entry.routeId === 'shared-workspace-receipts'), true);
});

test('continuation language plus canonical active mission resolves to continue-existing', () => {
  const result = deriveMissionContinuity({
    operatorIntent: 'keep going and get this over the line',
    missionLineage: { activeMissionId: 'goal-2643' },
  });
  assert.equal(result.mode, 'continue-existing');
  assert.equal(result.activeMissionId, 'goal-2643');
});

test('new request without active mission remains a new mission candidate', () => {
  const result = deriveMissionContinuity({
    operatorIntent: 'Build a guarded mission kernel for plain English intents',
  });
  assert.equal(result.mode, 'new-mission-candidate');
});

test('build proof is declared before execution and includes exact-head plus runtime evidence when required', () => {
  const proof = deriveProofRequirements({
    operatorIntent: 'Fix Battle Bridge runtime code and merge the PR',
    missionClass: 'build-runtime',
    buildRelevant: true,
  });
  assert.equal(proof.includes('exact-head-source-truth-recorded'), true);
  assert.equal(proof.includes('pr-review-and-exact-head-consistency-recorded'), true);
  assert.equal(proof.includes('runtime-or-battle-bridge-proof-required-before-live-or-proved'), true);
});

test('kernel fails closed at INTENT when blocked and never claims dispatch in shadow mode', () => {
  const kernel = buildMissionKernelProjection({
    operatorIntent: 'anything maybe idk',
    intent: { buildRelevant: false },
    missionClass: 'analysis',
    executionMode: 'blocked',
    blocked: true,
  });
  assert.equal(kernel.canonicalLifecycleState, 'INTENT');
  assert.equal(kernel.shadowRoutingOnly, true);
  assert.equal(kernel.shadowRoute.executionAuthorized, false);
  assert.equal(kernel.recoveryPlan.scopeWideningAllowed, false);
  assert.equal(kernel.proofDeclaredBeforeExecution, true);
  assert.equal(kernel.flywheelUpliftHandoff.enabled, true);
  assert.equal(kernel.flywheelUpliftHandoff.brainAccess, 'stephanos-model-router-when-evidence-requires-diagnosis-or-design');
  assert.equal(kernel.flywheelUpliftHandoff.dispatchAllowed, false);
  assert.equal(kernel.flywheelUpliftHandoff.authorityWideningAllowed, false);
});


test('plain demonstratives do not bind unrelated new work to the active mission', () => {
  const result = deriveMissionContinuity({
    operatorIntent: 'Build this unrelated new feature',
    missionLineage: { activeMissionId: 'goal-2643' },
  });
  assert.notEqual(result.mode, 'continue-existing');
  assert.equal(result.mode, 'continuation-candidate');
});

test('exact referenced active mission identity is accepted as explicit continuation', () => {
  const result = deriveMissionContinuity({
    operatorIntent: 'Take goal #2643 over the line',
    missionLineage: { activeMissionId: 'goal-2643' },
  });
  assert.equal(result.mode, 'continue-existing');
  assert.equal(result.activeMissionId, 'goal-2643');
});

test('Battle Bridge work does not prefer Sovereign Commander when capability truth is unknown', () => {
  const route = deriveShadowRoute({
    operatorIntent: 'Fix Battle Bridge VR telemetry and verify the runtime service',
    missionClass: 'build-runtime',
  });
  const commander = route.candidates.find((entry) => entry.routeId === 'sovereign-commander');
  assert.equal(commander.availability, 'UNKNOWN');
  assert.equal(commander.executionCandidate, false);
  assert.equal(route.preferredRouteId, 'guarded-goal-runner');
});

test('analysis with no execution candidate falls back to Mission Bridge instead of receipt storage', () => {
  const route = deriveShadowRoute({
    operatorIntent: 'Summarize the proposal',
    missionClass: 'analysis',
  });
  assert.equal(route.preferredRouteId, 'mission-bridge');
  assert.equal(route.candidates.find((entry) => entry.routeId === 'shared-workspace-receipts').executionCandidate, false);
});
