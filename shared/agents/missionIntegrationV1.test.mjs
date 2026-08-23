import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEGRATION_STATE,
  buildMissionIntegrationContract,
  createMissionOperationsPacket,
  deriveIntegrationState,
  validateMissionOperationsPacket,
} from './missionIntegrationV1.mjs';

const headSha = '1111111111111111111111111111111111111111';
const completionSha = '2222222222222222222222222222222222222222';

function doneReturnRecord() {
  return {
    summary: 'Implemented integrated mission loop.',
    changedFiles: ['shared/agents/missionIntegrationV1.mjs'],
    proofCommand: 'node --test shared/agents/missionIntegrationV1.test.mjs',
    proofResult: 'passed',
    approval: 'approved',
    prNumber: 1329,
    headSha,
    completionSha,
    missionUpdate: 'Mission room updated.',
  };
}

test('contract names the merged mission stack', () => {
  const contract = buildMissionIntegrationContract();
  assert.equal(contract.finalVerdict, 'MISSION_INTEGRATION_CONTRACT_READY');
  assert.equal(contract.integratedModules.includes('missionExecutiveV1'), true);
  assert.equal(contract.integratedModules.includes('returnConveyorV1'), true);
  assert.equal(contract.integratedModules.includes('alwaysOnStephanosUpdateV1'), true);
});

test('idea without source evidence remains captured not building', () => {
  const state = deriveIntegrationState({ idea: 'Wire the mission stack together.' });
  assert.equal(state, INTEGRATION_STATE.IDEA_CAPTURED);
});

test('missing idea blocks with exact action', () => {
  const packet = createMissionOperationsPacket({ idea: '', blocker: 'Capture operator idea before integration.' });
  assert.equal(packet.state, INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(packet.blocker, 'Capture operator idea before integration.');
  assert.equal(validateMissionOperationsPacket(packet).valid, true);
});

test('source evidence creates visible operations packet', () => {
  const packet = createMissionOperationsPacket({
    goalId: '#1329',
    idea: 'Wire all merged modules into one mission operations packet.',
    branch: 'feature/mission-integration-v1',
    proofCommand: 'node --test shared/agents/missionIntegrationV1.test.mjs',
    sourceFiles: ['shared/agents/missionIntegrationV1.mjs'],
  });
  assert.equal(packet.showInCommandDeck, true);
  assert.equal(packet.showInSplash, true);
  assert.equal(packet.chatPacket.kind, 'stephanos.chat_to_publish_bridge.packet');
  assert.equal(packet.missionRoom.finalVerdict, 'SHARED_WORKSPACE_MISSION_ROOM_READY');
  assert.equal(validateMissionOperationsPacket(packet).valid, true);
});

test('return conveyor proof and approval states drive integration state', () => {
  assert.equal(deriveIntegrationState({ idea: 'x', branch: 'b', returnRecord: { summary: 's', changedFiles: ['a'] } }), INTEGRATION_STATE.WAITING_FOR_PROOF);
  assert.equal(deriveIntegrationState({ idea: 'x', branch: 'b', returnRecord: { summary: 's', changedFiles: ['a'], proofCommand: 'p', proofResult: 'passed' } }), INTEGRATION_STATE.WAITING_FOR_APPROVAL);
});

test('done return waits for update apply before final done', () => {
  const ready = createMissionOperationsPacket({
    idea: 'Integrate the loop.',
    branch: 'feature/mission-integration-v1',
    returnRecord: doneReturnRecord(),
    sourceMerged: true,
    focusedProofRecorded: true,
    missionStateUpdated: true,
  });
  const done = createMissionOperationsPacket({
    idea: 'Integrate the loop.',
    branch: 'feature/mission-integration-v1',
    returnRecord: doneReturnRecord(),
    updateApplied: true,
    sourceMerged: true,
    focusedProofRecorded: true,
    missionStateUpdated: true,
  });
  assert.equal(ready.state, INTEGRATION_STATE.READY_TO_UPDATE);
  assert.equal(done.state, INTEGRATION_STATE.DONE);
  assert.equal(validateMissionOperationsPacket(done).valid, true);
});

test('validator blocks malformed packets', () => {
  const result = validateMissionOperationsPacket({
    schemaVersion: 'mission-integration.v1',
    kind: 'stephanos.mission_integration.operations_packet',
    state: INTEGRATION_STATE.DONE,
    currentIdea: 'x',
    currentGoal: '#1329',
    showInCommandDeck: true,
    showInSplash: false,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-runtime'), true);
  assert.equal(result.errors.includes('missing-visible-surfaces'), true);
});
