import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETURN_CONVEYOR_STATES,
  classifyReturnConveyor,
  requiredCompletionGaps,
} from './returnConveyorV1.mjs';

const headSha = '1111111111111111111111111111111111111111';
const mergeSha = '2222222222222222222222222222222222222222';

test('return conveyor exposes the required V1 states', () => {
  assert.deepEqual(RETURN_CONVEYOR_STATES, [
    'RECEIVED',
    'NEEDS_SUMMARY',
    'NEEDS_PROOF',
    'PROOF_FAILED',
    'WAITING_FOR_APPROVAL',
    'READY_TO_COMPLETE',
    'DONE',
    'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  ]);
});

test('completed work without summary routes to summary capture', () => {
  const result = classifyReturnConveyor({ changedFiles: ['shared/agents/a.mjs'] });
  assert.equal(result.state, 'NEEDS_SUMMARY');
  assert.match(result.nextAction, /summary/i);
});

test('summarized work without proof routes to proof', () => {
  const result = classifyReturnConveyor({
    summary: 'Implemented source change.',
    changedFiles: ['shared/agents/a.mjs'],
  });

  assert.equal(result.state, 'NEEDS_PROOF');
  assert.match(result.nextAction, /proof/i);
});

test('failing proof routes to repair', () => {
  const result = classifyReturnConveyor({
    summary: 'Implemented source change.',
    changedFiles: ['shared/agents/a.mjs'],
    proofCommand: 'node --test shared/agents/a.test.mjs',
    proofResult: 'failed',
  });

  assert.equal(result.state, 'PROOF_FAILED');
  assert.match(result.nextAction, /repair/i);
});

test('passing proof waits for approval before completion', () => {
  const result = classifyReturnConveyor({
    summary: 'Implemented source change.',
    changedFiles: ['shared/agents/a.mjs'],
    proofCommand: 'node --test shared/agents/a.test.mjs',
    proofResult: 'passed',
  });

  assert.equal(result.state, 'WAITING_FOR_APPROVAL');
  assert.match(result.nextAction, /approval/i);
});

test('approved work with PR and head SHA is ready to complete until merge evidence exists', () => {
  const result = classifyReturnConveyor({
    summary: 'Implemented source change.',
    changedFiles: ['shared/agents/a.mjs'],
    proofCommand: 'node --test shared/agents/a.test.mjs',
    proofResult: 'passed',
    approval: 'approved',
    prNumber: 1294,
    headSha,
  });

  assert.equal(result.state, 'READY_TO_COMPLETE');
  assert.equal(result.completionGaps[0].field, 'completionSha');
});

test('DONE requires summary, changed files, proof, passing result, PR, exact SHAs, and mission update', () => {
  const complete = {
    summary: 'Implemented Return Conveyor V1.',
    changedFiles: ['shared/agents/returnConveyorV1.mjs', 'shared/agents/returnConveyorV1.test.mjs'],
    proofCommand: 'node --test shared/agents/returnConveyorV1.test.mjs',
    proofResult: 'passed',
    approval: 'approved',
    prNumber: 1294,
    headSha,
    completionSha: mergeSha,
    missionUpdate: 'Mission updated with completion evidence.',
  };

  assert.deepEqual(requiredCompletionGaps(complete), []);
  assert.equal(classifyReturnConveyor(complete).state, 'DONE');
});

test('exact unblock action overrides normal routing into blocked state', () => {
  const result = classifyReturnConveyor({ exactUnblockAction: 'Restore the missing base branch before proof.' });
  assert.equal(result.state, 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION');
  assert.equal(result.nextAction, 'Restore the missing base branch before proof.');
});
