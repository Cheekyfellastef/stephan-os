import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_CODEX_MISSION_DISPATCH_STATUS,
  buildGithubCodexMissionDispatchContract,
  createGithubCodexMissionDispatch,
  validateGithubCodexMissionDispatch,
} from './githubCodexMissionDispatch.mjs';

const PATCH_FILES = Object.freeze([
  'shared/agents/battleBridgeSupervisor.mjs',
  'shared/agents/battleBridgeSupervisor.test.mjs',
  'shared/agents/githubCodexMissionDispatch.mjs',
  'shared/agents/githubCodexMissionDispatch.test.mjs',
]);

const PATCH_TESTS = Object.freeze([
  'node --test shared/agents/battleBridgeSupervisor.test.mjs shared/agents/githubCodexMissionDispatch.test.mjs',
]);

test('GitHub Codex mission dispatch contract forbids origin, push, and PR existence claims', () => {
  const contract = buildGithubCodexMissionDispatchContract();

  assert.equal(contract.finalVerdict, 'GITHUB_CODEX_MISSION_DISPATCH_CONTRACT_READY');
  assert.equal(contract.guardrails.localPatchOnly, true);
  assert.equal(contract.guardrails.originReadsAllowed, false);
  assert.equal(contract.guardrails.pushAllowed, false);
  assert.equal(contract.guardrails.pullRequestClaimAllowed, false);
  assert.equal(contract.requiredFields.includes('filesChanged'), true);
  assert.equal(contract.requiredFields.includes('testsToRun'), true);
});

test('ready dispatch records exact #1291/#1371 local files and proof commands', () => {
  const dispatch = createGithubCodexMissionDispatch({
    goalIds: ['#1291', '#1371'],
    branch: 'hardbuild/1291-1371-supervisor-dispatch',
    summary: 'Apply local supervisor dispatch patch only.',
    filesChanged: PATCH_FILES,
    testsToRun: PATCH_TESTS,
  });

  assert.equal(dispatch.status, GITHUB_CODEX_MISSION_DISPATCH_STATUS.READY);
  assert.deepEqual(dispatch.goalIds, ['#1291', '#1371']);
  assert.deepEqual(dispatch.filesChanged, PATCH_FILES);
  assert.deepEqual(dispatch.testsToRun, PATCH_TESTS);
  assert.equal(dispatch.exactUnblockAction, '');
  assert.equal(dispatch.sharedWorkspaceMessage.requiresOperator, false);
  assert.equal(dispatch.finalVerdict, 'GITHUB_CODEX_MISSION_DISPATCH_READY');
  assert.equal(validateGithubCodexMissionDispatch(dispatch).valid, true);
});

test('dispatch blocks unsafe origin and push proof commands instead of normalizing them into truth', () => {
  const dispatch = createGithubCodexMissionDispatch({
    filesChanged: PATCH_FILES,
    testsToRun: ['git push origin hardbuild/1291-1371-supervisor-dispatch'],
  });

  assert.equal(dispatch.status, GITHUB_CODEX_MISSION_DISPATCH_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.deepEqual(dispatch.testsToRun, []);
  assert.equal(dispatch.exactUnblockAction, 'Provide at least one safe local proof command for the #1291/#1371 patch.');
  assert.equal(validateGithubCodexMissionDispatch(dispatch).valid, false);
});

test('dispatch waits when explicit operator approval is required but missing', () => {
  const dispatch = createGithubCodexMissionDispatch({
    filesChanged: PATCH_FILES,
    testsToRun: PATCH_TESTS,
    requiresOperatorApproval: true,
    operatorApproved: false,
  });

  assert.equal(dispatch.status, GITHUB_CODEX_MISSION_DISPATCH_STATUS.WAITING_FOR_OPERATOR_APPROVAL);
  assert.equal(dispatch.sharedWorkspaceMessage.requiresOperator, true);
  assert.equal(dispatch.exactUnblockAction, 'Collect exact operator approval before dispatching the local #1291/#1371 mission patch.');
});
