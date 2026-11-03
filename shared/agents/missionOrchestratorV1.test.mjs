import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_ORCHESTRATOR_STATUS,
  buildMissionOrchestratorContract,
  createMissionOrchestrationSnapshot,
  validateMissionOrchestrationSnapshot,
} from './missionOrchestratorV1.mjs';

const servicePass = [
  { serviceId: 'backend', status: 'PASS' },
  { serviceId: 'openclaw-gateway', status: 'PASS' },
  { serviceId: 'stephanos-ui', status: 'PASS' },
  { serviceId: 'mission-orchestrator-worker', status: 'PASS' },
  { serviceId: 'shared-agent-workspace', status: 'PASS' },
];

const ignitionReady = [
  { serviceId: 'backend', status: 'READY' },
  { serviceId: 'openclaw-gateway', status: 'READY' },
  { serviceId: 'stephanos-ui', status: 'READY' },
  { serviceId: 'mission-orchestrator-worker', status: 'READY' },
  { serviceId: 'shared-agent-workspace', status: 'READY' },
];

const approvalReceipt = 'operator-approved-exact-head-0123456789abcdef0123456789abcdef01234567';

test('contract ready', () => {
  const contract = buildMissionOrchestratorContract();
  assert.equal(contract.finalVerdict, 'MISSION_ORCHESTRATOR_CONTRACT_READY');
  assert.equal(contract.statuses.includes('ACCEPT_INTENT'), true);
  assert.equal(contract.statuses.includes('DONE'), true);
});

test('no intent waits', () => {
  const snapshot = createMissionOrchestrationSnapshot({});
  assert.equal(snapshot.status, MISSION_ORCHESTRATOR_STATUS.ACCEPT_INTENT);
  assert.equal(snapshot.finalVerdict, 'MISSION_ORCHESTRATOR_WAITING_FOR_INTENT');
});

test('valid intent maps approved building platform loop to building mission', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Integrate the platform loop.',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    approvalReceipt,
    proofPassed: true,
  });
  assert.equal(snapshot.status, MISSION_ORCHESTRATOR_STATUS.BUILDING);
  assert.equal(snapshot.platformLoop.queueItem.history.at(-1).toStatus, 'READY_FOR_MANUAL_DISPATCH');
  assert.equal(snapshot.finalVerdict, 'MISSION_ORCHESTRATOR_ACTIVE');
});

test('valid intent without approval remains visibly approval-gated', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Integrate the platform loop.',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
  });
  assert.equal(snapshot.status, MISSION_ORCHESTRATOR_STATUS.WAITING_FOR_OPERATOR_APPROVAL);
  assert.equal(snapshot.platformLoop.dispatcherDecision.decision, 'BLOCKED_BY_OPERATOR_APPROVAL');
});

test('blocked platform loop blocks mission', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Repair worker recovery.',
    serviceProbes: [{ serviceId: 'mission-orchestrator-worker', status: 'FAIL' }],
    ignitionRoutes: ignitionReady,
    proofPassed: true,
  });
  assert.equal(snapshot.status, MISSION_ORCHESTRATOR_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(snapshot.nextAction.length > 0, true);
});

test('completed canonical queue marks mission done', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Close completed mission.',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    approvalReceipt,
    proofPassed: true,
    queueStatus: 'COMPLETE',
  });
  assert.equal(snapshot.platformLoop.queueItem.status, 'DONE');
  assert.equal(snapshot.status, MISSION_ORCHESTRATOR_STATUS.DONE);
  assert.equal(snapshot.finalVerdict, 'MISSION_ORCHESTRATOR_DONE');
});

test('validator blocks unsafe allowances', () => {
  const snapshot = createMissionOrchestrationSnapshot({ operatorIntent: 'Test validation.' });
  snapshot.mutationAllowed = true;
  snapshot.mergeAllowedWithoutExactApproval = true;
  const result = validateMissionOrchestrationSnapshot(snapshot);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('mutation-must-remain-approval-gated'), true);
  assert.equal(result.errors.includes('merge-without-exact-approval'), true);
});
