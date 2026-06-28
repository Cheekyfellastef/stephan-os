import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_REPLY_STATUS,
  buildStephanosCommandResponseContract,
  createStephanosCommandResponse,
  summarizeStephanosResponse,
  validateStephanosCommandResponse,
} from './stephanosCommandResponse.mjs';

test('contract blocks generic replies and requires mission shape', () => {
  const contract = buildStephanosCommandResponseContract();

  assert.equal(contract.guardrails.genericReplyAllowed, false);
  assert.equal(contract.guardrails.mustNameActiveGoal, true);
  assert.equal(contract.guardrails.mustNameNextAction, true);
  assert.equal(contract.guardrails.mustNameProofOrBlocker, true);
  assert.equal(contract.finalVerdict, 'STEPHANOS_COMMAND_RESPONSE_CONTRACT_READY');
});

test('build response includes active goal, proof, blocker, and next action', () => {
  const response = createStephanosCommandResponse({
    activeGoal: '#1280',
    status: 'BUILDING',
    missionState: ['#1298 through #1303 are built and queued.'],
    proofState: ['scratch proofs passed for source contracts'],
    blockerState: ['merge connector is blocking draft merge transitions'],
    nextAction: 'Build Lift Stephanos response contract.',
    conciseReply: '#1280 is building.',
  });

  assert.equal(response.status, STEPHANOS_REPLY_STATUS.BUILDING);
  assert.equal(response.generic, false);
  assert.equal(response.sharedWorkspaceMessage.eventKind, 'status');
  assert.equal(validateStephanosCommandResponse(response).valid, true);
});

test('operator approval response requires handoff text', () => {
  const response = createStephanosCommandResponse({
    activeGoal: '#1299',
    status: 'WAITING_FOR_OPERATOR_APPROVAL',
    missionState: ['Codex Dispatch Queue source is built.'],
    proofState: ['scratch proof passed 6/6'],
    blockerState: [],
    nextAction: 'Approve exact-head merge.',
    operatorHandoff: 'APPROVE MERGE PR #1299 EXACT HEAD 96e1b21c2264fb17e14e754e1d1bb13ee10e2c67',
  });

  assert.equal(response.sharedWorkspaceMessage.requiresOperator, true);
  assert.equal(response.operatorHandoff.includes('EXACT HEAD'), true);
  assert.equal(validateStephanosCommandResponse(response).valid, true);
});

test('validator blocks generic or incomplete replies', () => {
  const result = validateStephanosCommandResponse({
    schemaVersion: 'stephanos-command-response.v1',
    kind: 'stephanos.command_response.reply',
    responseId: 'bad-reply',
    activeGoal: '#1280',
    status: 'BUILDING',
    missionState: [],
    proofState: [],
    blockerState: [],
    nextAction: '',
    generic: true,
    sharedWorkspaceMessage: {},
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-mission-state'), true);
  assert.equal(result.errors.includes('missing-next-action'), true);
  assert.equal(result.errors.includes('generic-reply'), true);
});

test('blocked response must name blocker state', () => {
  const response = createStephanosCommandResponse({
    activeGoal: '#1291',
    status: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
    missionState: ['Battle Bridge Supervisor built.'],
    proofState: ['scratch proof passed'],
    blockerState: ['Battle Bridge proof not run.'],
    nextAction: 'Run Battle Bridge proof or merge source-only by operator approval.',
  });

  assert.equal(response.sharedWorkspaceMessage.eventKind, 'blocked-reason');
  assert.equal(validateStephanosCommandResponse(response).finalVerdict, 'STEPHANOS_COMMAND_RESPONSE_PASS');
});

test('summary output is specific and non-generic', () => {
  const summary = summarizeStephanosResponse({
    activeGoal: '#1280',
    status: 'BUILDING',
    missionState: ['Lift contract is being built.'],
    proofState: ['test pending'],
    blockerState: [],
    nextAction: 'Run focused response tests.',
    conciseReply: '#1280 Lift Stephanos is building.',
  });

  assert.equal(summary.includes('Active goal: #1280'), true);
  assert.equal(summary.includes('Next action: Run focused response tests.'), true);
});
