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
  { serviceId: 'mission-worker', status: 'PASS' },
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

test('healthy service and ignition state with ready dispatch keeps the loop building', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    evidence: ['platform loop focused proof passed'],
  });

  assert.equal(snapshot.status, PLATFORM_LOOP_STATUS.BUILDING);
  assert.equal(snapshot.supervisor.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_PASS');
  assert.equal(snapshot.ignition.finalVerdict, 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS');
  assert.equal(snapshot.dispatcherDecision.decision, 'DISPATCH_READY_ITEM');
  assert.equal(snapshot.verifierResult.status, 'PASS');
  assert.equal(snapshot.finalVerdict, 'PLATFORM_LOOP_INTEGRATION_ACTIVE');
});

test('failed supervisor blocks with exact next action', () => {
  const snapshot = createPlatformLoopSnapshot({
    serviceProbes: [
      { serviceId: 'backend', status: 'PASS' },
      { serviceId: 'mission-worker', status: 'FAIL' },
    ],
    ignitionRoutes: ignitionReady,
    proofPassed: true,
  });

  assert.equal(snapshot.status, PLATFORM_LOOP_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(snapshot.supervisor.failedServiceIds.includes('mission-worker'), true);
  assert.equal(snapshot.nextAction.includes('structured health and recovery receipts'), true);
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

test('snapshot consumes canonical platform status proof flow without live proof invention', () => {
  const snapshot = createPlatformLoopSnapshot({
    goalId: '#1383',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: false,
  });

  assert.equal(snapshot.platformStatusProof.kind, 'stephanos.platform_status_proof_flow.evaluation');
  assert.equal(snapshot.platformStatusProof.status, 'blocked');
  assert.equal(snapshot.platformStatusProof.blockers.includes('MISSING_UI_REALITY_PROOF'), true);
  assert.equal(snapshot.platformStatusProof.blockers.includes('MISSING_COMMAND_PROOF'), true);
  assert.equal(snapshot.liveProofClaims.github, 'not-live-in-browser');
  assert.equal(snapshot.liveProofClaims.windows, 'not-proven');
  assert.equal(snapshot.liveProofClaims.browser, 'not-proven');
});

test('platform proof fields verify only when canonical evidence refs are provided', () => {
  const snapshot = createPlatformLoopSnapshot({
    goalId: '#1291',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    supportSnapshotRefs: ['support/platform-status-1291.json'],
    uiRealityRefs: ['ui/platform-status-1291.png'],
    commandProofRefs: ['proof/platform-status-1291.txt'],
  });

  assert.equal(snapshot.platformStatusProof.finalVerdict, 'PLATFORM_STATUS_PROOF_VERIFIED');
  assert.deepEqual(snapshot.platformStatusProof.proofRefs, [
    'support/platform-status-1291.json',
    'ui/platform-status-1291.png',
    'proof/platform-status-1291.txt',
  ]);
  assert.equal(snapshot.liveProofClaims.browser, 'proof-ref-provided');
});

test('missing integration blocker keeps manual dispatch explicit', () => {
  const snapshot = createPlatformLoopSnapshot({
    goalId: '#1371',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    integration: { capabilities: { launchCodexJob: false, returnDispatchReceipt: false, returnProofMetadata: false } },
  });

  assert.equal(snapshot.dispatcherDecision.decision, 'BLOCKED_BY_MISSING_INTEGRATION');
  assert.equal(snapshot.manualDispatchRequired, true);
  assert.deepEqual(snapshot.dispatcherDecision.missingCapabilities, ['launchCodexJob', 'returnDispatchReceipt', 'returnProofMetadata']);
});

test('exact-head merge hold is preserved even when proof fields pass', () => {
  const snapshot = createPlatformLoopSnapshot({
    goalId: '#1291',
    serviceProbes: servicePass,
    ignitionRoutes: ignitionReady,
    proofPassed: true,
    supportSnapshotRefs: ['support/platform-status-1291.json'],
    uiRealityRefs: ['ui/platform-status-1291.png'],
    commandProofRefs: ['proof/platform-status-1291.txt'],
  });

  assert.equal(snapshot.exactHeadMergeHold.required, true);
  assert.equal(snapshot.exactHeadMergeHold.mergeAllowed, false);
  assert.equal(snapshot.exactHeadMergeHold.state, 'HOLD_FOR_EXACT_HEAD_APPROVAL');
  assert.equal(snapshot.stephanosResponse.missionState.includes('ExactHeadMerge: HOLD_FOR_EXACT_HEAD_APPROVAL'), true);
});
