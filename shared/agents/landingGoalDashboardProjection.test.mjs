import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLandingGoalDashboardProjection, LANDING_GOAL_DASHBOARD_SCHEMA_VERSION } from './landingGoalDashboardProjection.mjs';
import { createCodexQueueRecord } from './codexDispatchQueue.mjs';
import { createSharedWorkspaceProofRecord, createSharedWorkspaceStatusRecord } from './sharedAgentWorkspaceStore.mjs';

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
  assert.equal(projection.operatorAttention.approvals.length, 0);
  assert.ok(projection.operatorAttention.maintenanceActions.length > 0);
  assert.match(projection.operatorAttention.exactNextAction, /Codex and Housekeeper/);
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

test('landing dashboard never projects unrelated latest workspace evidence onto every goal', () => {
  const now = '2026-07-07T00:00:00.000Z';
  const projection = buildLandingGoalDashboardProjection({
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    sharedWorkspace: {
      latest: {
        status: { statusId: 'programme-controller-heartbeat', timestampUtc: now, status: 'HOLD', summary: 'Programme controller is HOLD.' },
        proof: { proofId: 'worker-watchdog-proof', timestampUtc: now, status: 'PASS', summary: 'Worker watchdog is healthy.' },
      },
    },
    statusRecords: [{ statusId: 'programme-controller-heartbeat', timestampUtc: now, status: 'HOLD', summary: 'Programme controller is HOLD.' }],
    proofRecords: [{ proofId: 'worker-watchdog-proof', timestampUtc: now, status: 'PASS', summary: 'Worker watchdog is healthy.' }],
  });

  assert.equal(projection.sourceTruth, 'CURRENT');
  assert.equal(projection.finalVerdict, 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED');
  assert.equal(projection.goals.every((goal) => goal.statusTruth === 'UNKNOWN'), true);
  assert.equal(projection.goals.every((goal) => goal.proofTruth === 'UNKNOWN'), true);
  assert.equal(projection.goals.some((goal) => goal.summary === 'Programme controller is HOLD.'), false);
});

test('landing dashboard matches canonical issue-bound status and proof records', () => {
  const now = '2026-07-07T00:00:00.000Z';
  const status = createSharedWorkspaceStatusRecord({
    statusId: 'verification-current',
    timestampUtc: now,
    relatedIssue: '#1287',
    status: 'CURRENT',
    summary: 'Verification Harness is current.',
    proofRefs: ['proof/verification-status'],
  });
  const proof = createSharedWorkspaceProofRecord({
    proofId: 'verification-proof',
    timestampUtc: now,
    correlationId: 'verification-run',
    relatedIssue: '#1287',
    status: 'PASS',
    summary: 'Verification Harness proof passed.',
    proofRefs: ['proof/verification-run'],
  });

  const projection = buildLandingGoalDashboardProjection({
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    statusRecords: [status],
    proofRecords: [proof],
  });
  const verification = projection.goals.find((goal) => goal.issue === '#1287');
  assert.equal(status.relatedIssue, '#1287');
  assert.equal(verification.statusTruth, 'CURRENT');
  assert.equal(verification.proofTruth, 'CURRENT');
  assert.deepEqual(verification.proofRefs, ['proof/verification-run']);
});

test('landing dashboard issue matching does not accept partial numeric identifiers', () => {
  const now = '2026-07-07T00:00:00.000Z';
  const projection = buildLandingGoalDashboardProjection({
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    statusRecords: [createSharedWorkspaceStatusRecord({ statusId: 'status-12900', timestampUtc: now, status: 'CURRENT' })],
    proofRecords: [createSharedWorkspaceProofRecord({ proofId: 'proof-12900', timestampUtc: now, correlationId: 'issue-12900', relatedIssue: '#12900', status: 'PASS', proofRefs: ['proof/12900'] })],
  });

  const sharedWorkspace = projection.goals.find((goal) => goal.issue === '#1290');
  assert.equal(sharedWorkspace.statusTruth, 'UNKNOWN');
  assert.equal(sharedWorkspace.proofTruth, 'UNKNOWN');
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
