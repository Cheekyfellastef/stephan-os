import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_STATUS,
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

function readyPlatformLoopInput(overrides = {}) {
  return {
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    ...overrides,
  };
}

test('contract ready', () => {
  const contract = buildMissionOrchestratorContract();

  assert.equal(contract.finalVerdict, 'MISSION_ORCHESTRATOR_CONTRACT_READY');
  assert.equal(contract.lifecycle.includes(MISSION_STATUS.ACCEPT_INTENT), true);
  assert.equal(contract.lifecycle.includes(MISSION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION), true);
  assert.equal(contract.requiredSnapshotFields.includes('platformLoop'), true);
});

test('no intent waits', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    platformLoopInput: readyPlatformLoopInput(),
  });

  assert.equal(snapshot.status, MISSION_STATUS.ACCEPT_INTENT);
  assert.equal(snapshot.finalVerdict, 'MISSION_ORCHESTRATOR_WAITING_FOR_INTENT');
  assert.equal(snapshot.nextAction.includes('operator intent'), true);
});

test('valid intent enters BUILDING when platform loop is building', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Build runtime orchestrator v1.',
    exactOperatorApproval: true,
    platformLoopInput: readyPlatformLoopInput(),
  });

  assert.equal(snapshot.platformLoop.status, 'BUILDING');
  assert.equal(snapshot.status, MISSION_STATUS.BUILDING);
  assert.equal(snapshot.finalVerdict, 'MISSION_ORCHESTRATOR_ACTIVE');
});

test('blocked platform loop blocks mission with exact unblock action', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Build runtime orchestrator v1.',
    exactOperatorApproval: true,
    platformLoopInput: readyPlatformLoopInput({
      serviceProbes: [
        { serviceId: 'backend', status: 'PASS' },
        { serviceId: 'mission-orchestrator-worker', status: 'FAIL' },
      ],
    }),
  });

  assert.equal(snapshot.status, MISSION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(snapshot.nextAction.includes('Run supervisor probes'), true);
});

test('done platform loop marks mission done', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Build runtime orchestrator v1.',
    exactOperatorApproval: true,
    platformLoopInput: readyPlatformLoopInput(),
    platformLoopSnapshot: {
      status: 'DONE',
      nextAction: 'Close the integration loop goal or advance to runtime orchestrator.',
    },
  });

  assert.equal(snapshot.platformLoop.status, 'DONE');
  assert.equal(snapshot.status, MISSION_STATUS.DONE);
  assert.equal(snapshot.finalVerdict, 'MISSION_ORCHESTRATOR_DONE');
});

test('validator blocks mutationAllowed true and mergeAllowedWithoutExactApproval true', () => {
  const snapshot = createMissionOrchestrationSnapshot({
    operatorIntent: 'Build runtime orchestrator v1.',
    exactOperatorApproval: true,
    mutationRequested: true,
    mergeAllowedWithoutExactApproval: true,
    platformLoopInput: readyPlatformLoopInput(),
  });
  const validation = validateMissionOrchestrationSnapshot(snapshot);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.includes('mutationAllowed')), true);
  assert.equal(validation.errors.some((error) => error.includes('mergeAllowedWithoutExactApproval')), true);
});
