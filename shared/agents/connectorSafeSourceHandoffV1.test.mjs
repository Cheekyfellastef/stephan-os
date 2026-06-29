import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_HANDOFF_STATE,
  buildSourceHandoffContract,
  classifySourceHandoff,
  validateSourceHandoffResult,
} from './connectorSafeSourceHandoffV1.mjs';

const base = {
  goalId: '#1338',
  targetBranch: 'feature/source-handoff-v1',
  proofCommand: 'node --test shared/agents/connectorSafeSourceHandoffV1.test.mjs',
  files: ['shared/agents/connectorSafeSourceHandoffV1.mjs'],
  hasRemote: true,
  branchHasCommits: true,
};

test('contract exposes required states and fields', () => {
  const contract = buildSourceHandoffContract();
  assert.equal(contract.finalVerdict, 'SOURCE_HANDOFF_CONTRACT_READY');
  assert.equal(contract.states.includes(SOURCE_HANDOFF_STATE.EMPTY_BRANCH_BLOCKED), true);
  assert.equal(contract.requiredFields.includes('targetBranch'), true);
});

test('no remote checkout blocks with exact action', () => {
  const result = classifySourceHandoff({ ...base, hasRemote: false });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.NO_REMOTE_BLOCKED);
  assert.match(result.nextAction, /origin/);
});

test('missing fields block before source check', () => {
  const result = classifySourceHandoff({ ...base, goalId: '' });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('empty branch blocks before PR creation', () => {
  const result = classifySourceHandoff({ ...base, branchHasCommits: false, observedFiles: [] });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.EMPTY_BRANCH_BLOCKED);
});

test('missing expected source file blocks exactly', () => {
  const result = classifySourceHandoff({ ...base, observedFiles: [] });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.MISSING_FILE_BLOCKED);
  assert.match(result.nextAction, /connectorSafeSourceHandoffV1/);
});

test('placeholder source blocks before proof', () => {
  const result = classifySourceHandoff({
    ...base,
    observedFiles: [{ path: 'shared/agents/connectorSafeSourceHandoffV1.mjs', content: '<PASTE FIRST FILE CONTENT HERE>', lineCount: 1 }],
  });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.PLACEHOLDER_FILE_BLOCKED);
});

test('complete source still requires focused proof', () => {
  const result = classifySourceHandoff({
    ...base,
    observedFiles: [{ path: 'shared/agents/connectorSafeSourceHandoffV1.mjs', content: 'real source', lineCount: 50 }],
  });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.PROOF_REQUIRED);
});

test('passing proof reaches merge readiness', () => {
  const result = classifySourceHandoff({
    ...base,
    proofResult: '8 passed 0 failed',
    observedFiles: [{ path: 'shared/agents/connectorSafeSourceHandoffV1.mjs', content: 'real source', lineCount: 50 }],
  });
  assert.equal(result.state, SOURCE_HANDOFF_STATE.READY_TO_MERGE);
  assert.equal(validateSourceHandoffResult(result).valid, true);
});
