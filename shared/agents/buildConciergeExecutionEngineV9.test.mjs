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

test('Connector Capability Probe V1 classifies read, comment, branch, write, and PR capability without fake proof', () => {
  const probe = buildConnectorCapabilityProbeV1({ github: { read: true, comment: false, branch: true, write: false, pullRequest: true }, lastProbeAtUtc: '2026-07-04T10:00:00Z' });
  assert.equal(probe.schemaVersion, 'stephanos.connector-capability-probe.v1');
  assert.equal(probe.capabilities.read, 'ok');
  assert.equal(probe.capabilities.branch, 'ok');
  assert.equal(probe.capabilities.comment, 'unknown_or_blocked');
  assert.equal(probe.capabilities.write, 'unknown_or_blocked');
  assert.equal(probe.capabilities.pullRequest, 'ok');
  assert.match(probe.proofBoundary, /no fake GitHub\/Codex proof/);
});

test('Build Engine Readiness V1 exposes Codex capacity, retry, resume eligibility, and fallback owner', () => {
  const readiness = buildBuildEngineReadinessV1({
    connectorCapabilities: { github: { read: true, branch: true, write: true, comment: true, pullRequest: true } },
    codex: { dispatchAvailable: true, capacity: 'waiting_for_quota_reset', lastAttemptUtc: '2026-07-04T09:14:00Z', nextRetryUtc: '2026-07-04T12:14:00Z', fallbackOwner: 'openclaw' },
  });
  assert.equal(readiness.schemaVersion, 'stephanos.build-engine-readiness.v1');
  assert.equal(readiness.status, 'waiting_for_codex_capacity');
  assert.equal(readiness.codex.dispatchAvailable, true);
  assert.equal(readiness.codex.capacityState, 'waiting_for_quota_reset');
  assert.equal(readiness.retry.lastAttemptUtc, '2026-07-04T09:14:00.000Z');
  assert.equal(readiness.retry.nextRetryUtc, '2026-07-04T12:14:00.000Z');
  assert.equal(readiness.retry.automaticResumeEligible, false);
  assert.equal(readiness.retry.fallbackOwner, 'openclaw');
  assert.match(readiness.blockers.join(' '), /meter\/quota/);
});

test('V9 surfaces Build Engine Readiness V1 and Connector Capability Probe V1 without allowing commands or merge', () => {
  const engine = buildConciergeExecutionEngineV9({
    receipts: [receipt],
    dispatchAdapterAvailable: true,
    sourceApproved: true,
    connectorCapabilities: { github: { read: true, branch: true, write: true, comment: true, pullRequest: true } },
    codex: { dispatchAvailable: true, capacity: 'available' },
  });
  assert.equal(engine.buildEngineReadiness.schemaVersion, 'stephanos.build-engine-readiness.v1');
  assert.equal(engine.connectorCapabilityProbe.schemaVersion, 'stephanos.connector-capability-probe.v1');
  assert.equal(engine.buildEngineReadiness.status, 'ready_to_resume');
  assert.equal(engine.enrichedCandidates[0].buildEngineReadiness, 'ready_to_resume');
  assert.equal(engine.commandExecutionAllowed, false);
  assert.equal(engine.mergeAllowed, false);
  assert.equal(engine.codexDispatchAllowed, false);
});
