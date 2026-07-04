import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBuildEngineReadinessV1,
  buildConciergeExecutionEngineV9,
  buildConnectorCapabilityProbeV1,
  classifyBuildConciergeGoal,
} from './buildConciergeExecutionEngineV9.mjs';

const receipt = { schemaVersion: 'stephanos.build-concierge.goal-request.v1', receiptId: 'r1', goal: { id: 'goal-ui', title: 'Improve Mission Operations panel UI', intent: 'Add dashboard surface rendering for status' } };

test('V9 detects live-created goal receipt, classifies, enriches proof, and emits manual packet', () => {
  const engine = buildConciergeExecutionEngineV9({ receipts: [receipt] });
  assert.equal(engine.watchedGoalCount, 1);
  assert.equal(engine.classifiedGoalCount, 1);
  assert.equal(engine.enrichedCandidateCount, 1);
  assert.equal(engine.manualDispatchRequiredCount, 1);
  assert.equal(engine.enrichedCandidates[0].classification, 'ui_surface_goal');
  assert.deepEqual(engine.enrichedCandidates[0].requiredProofFamilies, ['source-diff', 'local-build', 'browser-proof', 'surface-render']);
  assert.deepEqual(engine.enrichedCandidates[0].declaredAllowlistedProofCommands, ['npm run stephanos:build', 'npm run stephanos:browser-proof']);
  assert.match(engine.dispatchPackets[0].packet, /Build Concierge V9 mission packet/);
});

test('V9 rejects unsafe or unknown goals with exact reasons and preserves one-active-lane guardrail', () => {
  const unknown = { receiptId: 'r2', goal: { id: 'mystery', title: 'Think about stuff', intent: 'Make it better somehow' } };
  const unsafe = { receiptId: 'r3', goal: { id: 'bad', title: 'Merge and push secrets', intent: 'merge deploy token' } };
  assert.equal(classifyBuildConciergeGoal(unknown).classification, 'unknown');
  const engine = buildConciergeExecutionEngineV9({ receipts: [unknown, unsafe], activeExecutionLane: ['a', 'b'] });
  assert.equal(engine.classifiedGoalCount, 0);
  assert.match(engine.blockers.join(' '), /unknown stays unknown/);
  assert.match(engine.blockers.join(' '), /unsafe automation/);
  assert.match(engine.blockers.join(' '), /One active proof lane/);
});

test('V9 exact-head approval boundary is preserved and dispatch is model-only without source approval', () => {
  const engine = buildConciergeExecutionEngineV9({ receipts: [receipt], dispatchAdapterAvailable: true });
  assert.equal(engine.enrichedCandidates[0].dispatchReady, false);
  assert.equal(engine.commandExecutionAllowed, false);
  assert.equal(engine.mergeAllowed, false);
  assert.equal(engine.codexDispatchAllowed, false);
  assert.match(engine.enrichedCandidates[0].blockerReasons.join(' '), /exact source approval/);
});

test('connector capability probe classifies read, write, PR, and Codex dispatch separately', () => {
  const probe = buildConnectorCapabilityProbeV1({
    github: { readAvailable: true, commentAvailable: false, branchCreateAvailable: true, fileWriteAvailable: true, prCreateAvailable: true },
    codex: { dispatchIntegrationAvailable: false, capacityState: 'blocked-by-meter', lastAttemptUtc: '2026-07-04T11:21:00Z', nextRetryUtc: 'unknown' },
  });
  assert.equal(probe.schemaVersion, 'stephanos.connector-capability-probe.v1');
  assert.equal(probe.github.read, 'OK');
  assert.equal(probe.github.comment, 'BLOCKED');
  assert.equal(probe.github.branch, 'OK');
  assert.equal(probe.github.fileWrite, 'OK');
  assert.equal(probe.github.prCreate, 'OK');
  assert.equal(probe.codex.dispatchIntegration, 'BLOCKED');
  assert.match(probe.blockers.join(' '), /Codex dispatch integration is not proven/);
});

test('build engine readiness gives issue classifications and exact next command', () => {
  const readiness = buildBuildEngineReadinessV1({
    github: { readAvailable: true, commentAvailable: true, branchCreateAvailable: true, fileWriteAvailable: true, prCreateAvailable: true },
    codex: { dispatchIntegrationAvailable: false, capacityState: 'blocked-by-no-integration' },
  });
  assert.equal(readiness.schemaVersion, 'stephanos.build-engine-readiness.v1');
  assert.equal(readiness.issueClassifications[0].issue, '#1290');
  assert.equal(readiness.issueClassifications[0].classification, 'READY_TO_BUILD');
  assert.equal(readiness.issueClassifications.find((item) => item.issue === '#1293').classification, 'BLOCKED_BY_MISSING_INTEGRATION');
  assert.equal(readiness.buildingNow, '#1290 Shared Agent Workspace V1');
  assert.equal(readiness.exactNextPromptOrCommand, 'node --test shared/agents/buildConciergeExecutionEngineV9.test.mjs');
});

test('V9 exposes build engine readiness without allowing dispatch or merge execution', () => {
  const engine = buildConciergeExecutionEngineV9({
    receipts: [receipt],
    github: { readAvailable: true, commentAvailable: true, branchCreateAvailable: true, fileWriteAvailable: true, prCreateAvailable: true },
  });
  assert.equal(engine.buildEngineReadiness.schemaVersion, 'stephanos.build-engine-readiness.v1');
  assert.equal(engine.connectorCapabilityProbe.github.read, 'OK');
  assert.equal(engine.codexDispatchAllowed, false);
  assert.equal(engine.mergeAllowed, false);
  assert.equal(engine.commandExecutionAllowed, false);
});
