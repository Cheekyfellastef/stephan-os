import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLandingGoalDashboardProjection, LANDING_GOAL_DASHBOARD_SCHEMA_VERSION } from './landingGoalDashboardProjection.mjs';
import { createCodexQueueRecord } from './codexDispatchQueue.mjs';

test('landing dashboard projection is read-only and shows unknowns without fake proof', () => {
  const projection = buildLandingGoalDashboardProjection({ nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(projection.schemaVersion, LANDING_GOAL_DASHBOARD_SCHEMA_VERSION);
  assert.equal(projection.readOnly, true);
  assert.equal(projection.uiShellAllowed, false);
  assert.equal(projection.uiRepoMutationAllowed, false);
  assert.equal(projection.fakeLiveProofAllowed, false);
  assert.equal(projection.goals.length, 17);
  assert.deepEqual(projection.goals.map((goal) => goal.issue).slice(0, 7), ['#1290', '#1287', '#1291', '#1292', '#1293', '#1284', '#1286']);
  assert.deepEqual(projection.captainsBridge.milestone.implementedGoals, ['G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19']);
  assert.equal(projection.captainsBridge.milestone.status, 'complete_guarded');
  assert.equal(projection.sourceTruth, 'UNKNOWN');
  assert.equal(projection.finalVerdict, 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED');
  assert.match(projection.operatorAttention.exactNextAction, /Publish or refresh missing Shared Workspace/);
});

test('landing dashboard projects queue dispatcher, supervisor, and OpenClaw ladder', () => {
  const now = '2026-07-07T00:00:00.000Z';
  const projection = buildLandingGoalDashboardProjection({
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    timestampUtc: now,
    queueRecords: [createCodexQueueRecord({ issueNumber: 1292, branch: 'codex/dashboard', prompt: 'Wire dashboard', requestedProofCommands: ['node --test shared/agents/*.test.mjs'], createdAt: now })],
    supervisorHealthRecords: [{ serviceId: 'backend', state: 'READY', checkedAtUtc: now, health: { reachable: true, usable: true, browserCompatible: true } }],
  });
  assert.equal(projection.queueDispatcher.queueDepth, 1);
  assert.equal(projection.queueDispatcher.dispatcherState, 'IDLE');
  assert.equal(projection.battleBridgeSupervisor.services.find((service) => service.serviceId === 'backend').state, 'READY');
  assert.deepEqual(projection.openClawCapabilityLadder.needsApproval, ['approval_gated_writer']);
  assert.equal(projection.openClawCapabilityLadder.guardrails.sourceRepositoryWritesAllowed, false);
});


test('landing dashboard consumes build lane manager for Captain Bridge fields', () => {
  const projection = buildLandingGoalDashboardProjection({
    nowMs: Date.parse('2026-07-08T00:00:00.000Z'),
    buildLaneManager: {
      activeLane: { branch: 'feature/captains-bridge', prNumber: 1510, headSha: 'abcdef1234567890', latestProof: { status: 'passed' }, blocker: '', nextAction: 'Review exact head.' },
      latestProofState: 'passed',
      queueState: 'active',
      mergeReadiness: 'READY_FOR_EXACT_HEAD_OPERATOR_REVIEW',
      exactNextAction: 'Review exact head.',
    },
  });
  assert.equal(projection.captainsBridge.currentPr, 1510);
  assert.equal(projection.captainsBridge.branch, 'feature/captains-bridge');
  assert.equal(projection.captainsBridge.exactHead, 'abcdef1234567890');
  assert.equal(projection.captainsBridge.latestProof, 'passed');
  assert.equal(projection.captainsBridge.mergeReadiness, 'READY_FOR_EXACT_HEAD_OPERATOR_REVIEW');
});
