import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORCHESTRATOR_STATE,
  buildMissionOrchestratorControlLoopContract,
  createIntentPacket,
  createMissionOrchestratorPacket,
  deriveOrchestratorState,
  validateMissionOrchestratorPacket,
} from './missionOrchestratorControlLoopV1.mjs';

const headSha = '1111111111111111111111111111111111111111';
const completionSha = '2222222222222222222222222222222222222222';

function completedInput() {
  return {
    intent: 'Build the end-to-end Mission Orchestrator V1 control loop.',
    dispatchId: 'dispatch-1263',
    branch: 'feature/mission-orchestrator-control-loop-v1',
    sourceFiles: ['shared/agents/missionOrchestratorControlLoopV1.mjs'],
    resultId: 'result-1263',
    summary: 'Implemented control loop.',
    changedFiles: ['shared/agents/missionOrchestratorControlLoopV1.mjs'],
    proofCommand: 'node --test shared/agents/missionOrchestratorControlLoopV1.test.mjs',
    proofResult: 'passed',
    approval: 'approved',
    prNumber: 1263,
    headSha,
    completionSha,
    missionUpdate: 'Mission operations updated.',
    updateApplied: true,
  };
}

test('contract exposes orchestrator states and hard rules', () => {
  const contract = buildMissionOrchestratorControlLoopContract();
  assert.equal(contract.finalVerdict, 'MISSION_ORCHESTRATOR_CONTROL_LOOP_CONTRACT_READY');
  assert.equal(contract.states.includes('WAITING_FOR_INTENT'), true);
  assert.equal(contract.states.includes('DONE'), true);
  assert.equal(contract.hardRules.some((rule) => /Repair is bounded/.test(rule)), true);
});

test('intent packet requires operator intent', () => {
  assert.equal(createIntentPacket({}).finalVerdict, 'MISSION_ORCHESTRATOR_INTENT_MISSING');
  assert.equal(createIntentPacket({ intent: 'Build orchestration.' }).finalVerdict, 'MISSION_ORCHESTRATOR_INTENT_READY');
});

test('state waits for intent before dispatch', () => {
  assert.equal(deriveOrchestratorState({}), ORCHESTRATOR_STATE.WAITING_FOR_INTENT);
});

test('intent with no dispatch evidence remains intent ready', () => {
  assert.equal(deriveOrchestratorState({ intent: 'Build orchestration.' }), ORCHESTRATOR_STATE.INTENT_READY);
});

test('dispatch evidence waits for result before proof', () => {
  const state = deriveOrchestratorState({
    intent: 'Build orchestration.',
    dispatchId: 'dispatch-1',
    branch: 'feature/x',
  });
  assert.equal(state, ORCHESTRATOR_STATE.WAITING_FOR_RESULT);
});

test('return state drives proof, repair, approval, completion, and runtime update', () => {
  assert.equal(deriveOrchestratorState({ intent: 'x', branch: 'b', summary: 's', changedFiles: ['a'] }), ORCHESTRATOR_STATE.WAITING_FOR_PROOF);
  assert.equal(deriveOrchestratorState({ intent: 'x', branch: 'b', summary: 's', changedFiles: ['a'], proofCommand: 'p', proofResult: 'failed' }), ORCHESTRATOR_STATE.REPAIR_REQUIRED);
  assert.equal(deriveOrchestratorState({ intent: 'x', branch: 'b', summary: 's', changedFiles: ['a'], proofCommand: 'p', proofResult: 'passed' }), ORCHESTRATOR_STATE.WAITING_FOR_APPROVAL);
  assert.equal(deriveOrchestratorState({ ...completedInput(), updateApplied: false }), ORCHESTRATOR_STATE.UPDATING_RUNTIME);
});

test('bounded repair blocks when attempts exceed maximum', () => {
  const packet = createMissionOrchestratorPacket({
    intent: 'Repair after failed proof.',
    branch: 'feature/x',
    summary: 's',
    changedFiles: ['a'],
    proofCommand: 'p',
    proofResult: 'failed',
    repairAttempts: 4,
    maxRepairAttempts: 3,
  });
  assert.equal(packet.state, ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(packet.repair.bounded, false);
  assert.equal(validateMissionOrchestratorPacket(packet).valid, true);
});

test('completed loop reaches done and validates', () => {
  const packet = createMissionOrchestratorPacket(completedInput());
  assert.equal(packet.state, ORCHESTRATOR_STATE.DONE);
  assert.equal(packet.returnState.state, 'DONE');
  assert.equal(packet.operations.state, 'DONE');
  assert.equal(packet.showInMissionOperations, true);
  assert.equal(validateMissionOrchestratorPacket(packet).valid, true);
});

test('validator catches malformed packets', () => {
  const result = validateMissionOrchestratorPacket({
    schemaVersion: 'mission-orchestrator-control-loop.v1',
    kind: 'stephanos.mission_orchestrator.control_loop.packet',
    state: ORCHESTRATOR_STATE.DONE,
    showInMissionOperations: false,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-intent'), true);
  assert.equal(result.errors.includes('missing-mission-operations-visibility'), true);
});
