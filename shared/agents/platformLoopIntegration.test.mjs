import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_LOOP_STATUS,
  buildPlatformLoopIntegrationContract,
  createPlatformLoopSnapshot,
} from './platformLoopIntegration.mjs';

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

test('contract exposes platform loop lifecycle and required snapshot fields', () => {
  const contract = buildPlatformLoopIntegrationContract();

  assert.equal(contract.lifecycle.includes('BUILDING'), true);
  assert.equal(contract.lifecycle.includes('WAITING_FOR_PROOF'), true);
  assert.equal(contract.lifecycle.includes('DONE'), true);
  assert.equal(contract.requiredSnapshotFields.includes('supervisor'), true);
  assert.equal(contract.requiredSnapshotFields.includes('dispatcherDecision'), true);
  assert.equal(contract.finalVerdict, 'PLATFORM_LOOP_INTEGRATION_CONTRACT_READY');
});

test('healthy service and ignition state with passing proof completes the loop', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    evidence: ['platform loop focused proof passed'],
  });

  assert.equal(snapshot.status, PLATFORM_LOOP_STATUS.DONE);
  assert.equal(snapshot.supervisor.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_PASS');
  assert.equal(snapshot.ignition.finalVerdict, 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS');
  assert.equal(snapshot.verifierResult.status, 'PASS');
  assert.equal(snapshot.finalVerdict, 'PLATFORM_LOOP_INTEGRATION_PASS');
});

test('failed supervisor blocks with exact next action', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: [
      { serviceId: 'backend', status: 'PASS' },
      { serviceId: 'mission-orchestrator-worker', status: 'FAIL' },
    ],
    ignitionRoutes: ignitionReady,
    proofPassed: true,
  });

  assert.equal(snapshot.status, PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(snapshot.supervisor.failedServiceIds.includes('mission-orchestrator-worker'), true);
  assert.equal(snapshot.nextAction.includes('Run supervisor probes'), true);
  assert.equal(snapshot.stephanosResponse.blockerState.length > 0, true);
});

test('missing proof waits for proof when infrastructure is ready', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: false,
    nextAction: 'Run platform loop proof.',
  });

  assert.equal(snapshot.status, PLATFORM_LOOP_STATUS.BUILDING);
  assert.equal(snapshot.dispatcherDecision.decision, 'DISPATCH_READY_ITEM');
  assert.equal(snapshot.sharedWorkspaceMessage.requiresOperator, true);
});

test('operator approval batch can hold the loop', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    operatorDecisions: [
      { decisionKind: 'PROOF_REQUEST', summary: 'Approve platform proof publication.' },
    ],
  });

  assert.equal(snapshot.status, PLATFORM_LOOP_STATUS.WAITING_FOR_OPERATOR_APPROVAL);
  assert.equal(snapshot.operatorBatch.finalVerdict, 'OPERATOR_AUTOMATION_BATCH_WAITING');
  assert.equal(snapshot.stephanosResponse.operatorHandoff.length > 0, true);
});

test('snapshot wires queue, dispatcher, OpenClaw, Stephanos response, and workspace message', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    allowedFiles: ['shared/agents/platformLoopIntegration.mjs'],
    openClawReadPaths: ['shared/agents/platformLoopIntegration.mjs'],
  });

  assert.equal(snapshot.queueValidation.valid, true);
  assert.equal(snapshot.dispatcherDecision.queueItemId, snapshot.queueItem.queueItemId);
  assert.equal(snapshot.openClawFallback.sourceMutationAllowed, false);
  assert.equal(snapshot.stephanosResponse.generic, false);
  assert.equal(snapshot.sharedWorkspaceMessage.eventKind, 'status');
});
