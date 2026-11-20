import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTINUITY_TASK_DISPOSITION,
  GITHUB_CONTINUITY_MODE_SCHEMA,
  GITHUB_CONTINUITY_STATE,
} from './githubContinuityModeV1.mjs';
import { MISSION_CONTROLLER_ROUTE } from './missionControllerCapacityRouterV1.mjs';
import {
  GITHUB_CONTINUITY_EXECUTION_BATCH_SCHEMA,
  buildGitHubContinuityExecutionBatch,
} from './githubContinuityExecutionGrantV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'cddcbe940fea2271c38d94df2473af15b0082dea';
const nowUtc = '2026-08-16T20:00:00.000Z';

function plan(tasks) {
  return {
    schemaVersion: GITHUB_CONTINUITY_MODE_SCHEMA,
    repository,
    expectedSourceHead: head,
    evaluatedAtUtc: nowUtc,
    state: GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY,
    battleBridgeAvailability: 'UNAVAILABLE',
    tasks,
    counts: { continue: tasks.filter((task) => task.disposition === CONTINUITY_TASK_DISPOSITION.CONTINUE).length },
    recoveryHandoffRequired: true,
    recoveryGoalIssue: 1814,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    duplicateDispatchAllowed: false,
    protectedMergeDispatchAllowed: false,
    blockers: ['battle-bridge-unavailable'],
    finalVerdict: 'GITHUB_CONTINUITY_ACTIVE',
  };
}

function githubTask(overrides = {}) {
  return {
    missionId: 'goal-1637',
    taskId: 'github-continuity-m2',
    windowsBound: false,
    disposition: CONTINUITY_TASK_DISPOSITION.CONTINUE,
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    adapter: 'chatgpt-github',
    dispatchAllowed: true,
    selectedCapacityReceiptId: 'github-capacity-current-001',
    proofRefs: ['receipts/github-capacity-current-001'],
    blockers: [],
    ...overrides,
  };
}

test('emits only source-only grants while runtime-held work remains held', () => {
  const runtimeHold = {
    missionId: 'forge-runtime',
    taskId: 'forge-m2-live',
    windowsBound: true,
    disposition: CONTINUITY_TASK_DISPOSITION.HOLD_RUNTIME_RECOVERY,
    route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
    adapter: '',
    dispatchAllowed: false,
    selectedCapacityReceiptId: null,
    proofRefs: [],
    blockers: ['battle-bridge-unavailable'],
  };
  const result = buildGitHubContinuityExecutionBatch({
    repository,
    expectedSourceHead: head,
    nowUtc,
    continuityPlan: plan([githubTask(), runtimeHold]),
  });

  assert.equal(result.schemaVersion, GITHUB_CONTINUITY_EXECUTION_BATCH_SCHEMA);
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_EXECUTION_GRANTS_READY');
  assert.equal(result.grantCount, 1);
  assert.equal(result.grants[0].taskId, 'github-continuity-m2');
  assert.equal(result.grants[0].executionScope, 'SOURCE_ONLY_EXISTING_ROUTE');
  assert.equal(result.grants[0].windowsBound, false);
  assert.equal(result.grants[0].selectedCapacityReceiptId, 'github-capacity-current-001');
  assert.equal(result.grants[0].mergeAuthorityAdded, false);
  assert.equal(result.grants[0].runtimeMutationAuthorityAdded, false);
  assert.equal(result.grants[0].duplicateDispatchAllowed, false);
});

test('preserves Codex as an already-proven non-Windows source route without inventing a capacity receipt', () => {
  const codex = githubTask({
    taskId: 'source-repair',
    route: MISSION_CONTROLLER_ROUTE.CODEX,
    adapter: 'codex',
    selectedCapacityReceiptId: null,
    proofRefs: [],
  });
  const result = buildGitHubContinuityExecutionBatch({
    repository,
    expectedSourceHead: head,
    nowUtc,
    continuityPlan: plan([codex]),
  });
  assert.equal(result.grantCount, 1);
  assert.equal(result.grants[0].route, MISSION_CONTROLLER_ROUTE.CODEX);
  assert.equal(result.grants[0].selectedCapacityReceiptId, null);
});

test('rejects identity drift between the continuity plan and execution envelope', () => {
  const result = buildGitHubContinuityExecutionBatch({
    repository,
    expectedSourceHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    nowUtc,
    continuityPlan: plan([githubTask()]),
  });
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_EXECUTION_BLOCKED');
  assert.equal(result.blocker, 'GITHUB_CONTINUITY_PLAN_IDENTITY_MISMATCH');
  assert.equal(result.grantCount, 0);
});

test('rejects a forged CONTINUE task that is Windows-bound', () => {
  const result = buildGitHubContinuityExecutionBatch({
    repository,
    expectedSourceHead: head,
    nowUtc,
    continuityPlan: plan([githubTask({ windowsBound: true })]),
  });
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_EXECUTION_BLOCKED');
  assert.equal(result.blocker, 'GITHUB_CONTINUITY_CONTINUE_TASK_INVALID');
  assert.equal(result.grantCount, 0);
});

test('refuses to execute when continuity mode is not active', () => {
  const normal = { ...plan([githubTask()]), state: GITHUB_CONTINUITY_STATE.NORMAL, recoveryHandoffRequired: false };
  const result = buildGitHubContinuityExecutionBatch({
    repository,
    expectedSourceHead: head,
    nowUtc,
    continuityPlan: normal,
  });
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_EXECUTION_BLOCKED');
  assert.equal(result.blocker, 'GITHUB_CONTINUITY_NOT_ACTIVE');
});

test('rejects authority widening in the parent continuity plan', () => {
  const widened = { ...plan([githubTask()]), mergeAuthorityAdded: true };
  const result = buildGitHubContinuityExecutionBatch({
    repository,
    expectedSourceHead: head,
    nowUtc,
    continuityPlan: widened,
  });
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_EXECUTION_BLOCKED');
  assert.equal(result.blocker, 'GITHUB_CONTINUITY_PLAN_AUTHORITY_INVALID');
});
