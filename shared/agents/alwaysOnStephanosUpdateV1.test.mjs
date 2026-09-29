import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPDATE_ACTION,
  UPDATE_STATE,
  buildAlwaysOnUpdateContract,
  createAlwaysOnUpdateStatus,
  createApplyResult,
  createUpdateObservation,
  deriveUpdatePlan,
  validateAlwaysOnUpdateStatus,
} from './alwaysOnStephanosUpdateV1.mjs';

test('contract exposes states, actions, and safety rule', () => {
  const contract = buildAlwaysOnUpdateContract();
  assert.equal(contract.finalVerdict, 'ALWAYS_ON_UPDATE_CONTRACT_READY');
  assert.equal(contract.updateStates.includes('CURRENT'), true);
  assert.equal(contract.updateActions.includes('REBUILD'), true);
  assert.equal(contract.truthRule.includes('dirty'), true);
});

test('reports current when local, remote, and running heads match', () => {
  const plan = deriveUpdatePlan({
    localHead: 'abc',
    remoteHead: 'abc',
    runningBuildHead: 'abc',
    workingTreeClean: true,
  });
  assert.equal(plan.state, UPDATE_STATE.CURRENT);
  assert.deepEqual(plan.actions, [UPDATE_ACTION.NONE]);
});

test('blocks update when remote changed but working tree is dirty', () => {
  const plan = deriveUpdatePlan({
    localHead: 'abc',
    remoteHead: 'def',
    runningBuildHead: 'abc',
    workingTreeClean: false,
    modifiedFiles: ['apps/stephanos/dist/index.html'],
  });
  assert.equal(plan.state, UPDATE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(plan.finalVerdict, 'ALWAYS_ON_UPDATE_BLOCKED_DIRTY_TREE');
  assert.equal(plan.exactUnblockAction.includes('working tree'), true);
});

test('plans rebuild and service restart for source changes', () => {
  const plan = deriveUpdatePlan({
    localHead: 'abc',
    remoteHead: 'def',
    runningBuildHead: 'abc',
    workingTreeClean: true,
    changedFiles: ['shared/agents/missionRuntimeV1.mjs', 'package.json'],
  });
  assert.equal(plan.state, UPDATE_STATE.REBUILD_REQUIRED);
  assert.equal(plan.actions.includes(UPDATE_ACTION.PULL), true);
  assert.equal(plan.actions.includes(UPDATE_ACTION.REBUILD), true);
  assert.equal(plan.actions.includes(UPDATE_ACTION.RESTART_SERVICES), true);
});

test('plans hot reload for runtime-only changes', () => {
  const plan = deriveUpdatePlan({
    localHead: 'abc',
    remoteHead: 'def',
    runningBuildHead: 'abc',
    workingTreeClean: true,
    changedFiles: ['runtime/status.json'],
  });
  assert.equal(plan.state, UPDATE_STATE.RELOAD_REQUIRED);
  assert.equal(plan.actions.includes(UPDATE_ACTION.HOT_RELOAD), true);
});

test('apply result only completes when required work is done', () => {
  const plan = deriveUpdatePlan({
    localHead: 'abc',
    remoteHead: 'def',
    runningBuildHead: 'abc',
    workingTreeClean: true,
    changedFiles: ['shared/agents/alwaysOnStephanosUpdateV1.mjs'],
  });
  const blocked = createApplyResult({ plan, pullApplied: true, rebuildPassed: false, restartApplied: true });
  const applied = createApplyResult({ plan, pullApplied: true, rebuildPassed: true, restartApplied: true });
  assert.equal(blocked.state, UPDATE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(applied.state, UPDATE_STATE.APPLIED);
});

test('status is visible in splash and Command Deck', () => {
  const status = createAlwaysOnUpdateStatus({
    localHead: 'abc',
    remoteHead: 'def',
    runningBuildHead: 'abc',
    workingTreeClean: true,
    changedFiles: ['shared/agents/alwaysOnStephanosUpdateV1.mjs'],
  });
  assert.equal(status.showInSplash, true);
  assert.equal(status.showInCommandDeck, true);
  assert.equal(validateAlwaysOnUpdateStatus(status).valid, true);
});

test('validator blocks invisible or malformed status packets', () => {
  const result = validateAlwaysOnUpdateStatus({
    schemaVersion: 'always-on-stephanos-update.v1',
    kind: 'stephanos.always_on_update.status',
    currentState: UPDATE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    nextAction: UPDATE_ACTION.OPERATOR_REVIEW,
    showInSplash: false,
    showInCommandDeck: true,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('blocked-without-exact-unblock-action'), true);
  assert.equal(result.errors.includes('missing-visible-surface'), true);
});

test('observation records service list and changed files', () => {
  const observation = createUpdateObservation({
    localHead: 'abc',
    remoteHead: 'def',
    services: ['ui', 'backend', 'worker'],
    changedFiles: ['apps/stephanos/src/App.jsx'],
  });
  assert.equal(observation.services.length, 3);
  assert.equal(observation.changedFiles[0], 'apps/stephanos/src/App.jsx');
});
