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

test('shadow route prefers Sovereign Commander for Battle Bridge work without authorizing execution', () => {
  const route = deriveShadowRoute({
    operatorIntent: 'Fix Battle Bridge VR telemetry and verify the runtime service',
    missionClass: 'build-runtime',
  });
  assert.equal(route.mode, 'shadow');
  assert.equal(route.executionAuthorized, false);
  assert.equal(route.preferredRouteId, 'sovereign-commander');
  assert.equal(route.candidates.some((entry) => entry.routeId === 'guarded-goal-runner'), true);
  assert.equal(route.candidates.some((entry) => entry.routeId === 'shared-workspace-receipts'), true);
});

test('continuation language plus active mission resolves to continue-existing', () => {
  const result = deriveMissionContinuity({
    operatorIntent: 'keep going and get this over the line',
    missionWorkflow: { activeMissionId: 'goal-2643' },
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
