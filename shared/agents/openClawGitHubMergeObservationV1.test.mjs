import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseOpenClawGitHubMergeObservation } from './openClawGitHubMergeObservationV1.mjs';
import {
  PROTECTED_MERGE_REQUIRED_WORKFLOWS,
  validateProtectedMergeCheckRows,
} from './protectedMergeCheckClassifierV1.mjs';

const HEAD = 'b'.repeat(40);

function view(status = 0, payload = {}) {
  return {
    status,
    stdout: JSON.stringify({
      headRefOid: HEAD,
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      state: 'OPEN',
      ...payload,
    }),
    stderr: '',
    error: null,
  };
}

function successfulRequiredChecks() {
  return PROTECTED_MERGE_REQUIRED_WORKFLOWS.map((workflow, index) => ({
    name: `required-${index}`,
    workflow,
    state: 'SUCCESS',
    ...(workflow === 'Build Stephanos UI' ? { event: 'pull_request' } : {}),
  }));
}

function checks(status, rows) {
  return {
    status,
    stdout: JSON.stringify(rows),
    stderr: '',
    error: null,
  };
}

test('parseable gh checks status 1 reaches canonical classifier', () => {
  const rows = [
    ...successfulRequiredChecks(),
    { name: 'coordinate', workflow: 'Exact-Head Review Dispatch', state: 'SKIPPED' },
  ];
  const observation = parseOpenClawGitHubMergeObservation({
    view: view(),
    checks: checks(1, rows),
  });

  assert.equal(observation.valid, true);
  assert.equal(observation.checksExitCode, 1);
  assert.equal(validateProtectedMergeCheckRows(observation.checkPayload), true);
});

test('intentional pull-request Pages skip is neutral only when its Build Stephanos UI workflow has real successful checks', () => {
  const checks = [
    ...successfulRequiredChecks().map(row => row.workflow === 'Build Stephanos UI'
      ? { ...row, event: 'pull_request' } : row),
    { name: 'pages-deploy', workflow: 'Build Stephanos UI', state: 'SKIPPED', event: 'pull_request' },
    { name: 'coordinate', workflow: 'Exact-Head Review Dispatch', state: 'SKIPPED' },
  ];
  assert.equal(validateProtectedMergeCheckRows(checks), true);
  for (const event of [undefined, 'push', 'workflow_dispatch', 'schedule', 'pull_request_target']) {
    const fromWrongEvent = checks.map(row => row.name === 'pages-deploy'
      ? { ...row, event } : row);
    assert.equal(validateProtectedMergeCheckRows(fromWrongEvent), false,
      'Pages skip must prove pull_request event, not ' + event);
  }
  const fromDispatchBuild = checks.map(row => row.workflow === 'Build Stephanos UI'
    && row.state === 'SUCCESS' ? { ...row, event: 'workflow_dispatch' } : row);
  assert.equal(validateProtectedMergeCheckRows(fromDispatchBuild), false,
    'Pages skip must not borrow Build success from workflow_dispatch');
  const buildWithoutEvent = checks.map(row => row.workflow === 'Build Stephanos UI'
    && row.state === 'SUCCESS' ? { ...row, event: undefined } : row);
  assert.equal(validateProtectedMergeCheckRows(buildWithoutEvent), false,
    'Pages skip requires a genuine PR Build success');
  const dispatchOnly = successfulRequiredChecks().map(row => row.workflow === 'Build Stephanos UI'
    ? { ...row, event: 'workflow_dispatch' } : row);
  assert.equal(validateProtectedMergeCheckRows(dispatchOnly), false,
    'without Pages-skip row, workflow_dispatch Build success still cannot replace PR CI');
  const noBuildEvent = successfulRequiredChecks().map(row => row.workflow === 'Build Stephanos UI'
    ? { ...row, event: undefined } : row);
  assert.equal(validateProtectedMergeCheckRows(noBuildEvent), false,
    'missing Build event alone must never satisfy protected CI');
  assert.equal(validateProtectedMergeCheckRows([...successfulRequiredChecks(),
    { name: 'dispatched-build', workflow: 'Build Stephanos UI', state: 'SUCCESS', event: 'workflow_dispatch' }]), true,
    'non-PR Build must be ignored when authentic PR Build succeeded');
  const missingBuildSuccess = checks.filter(row => row.workflow !== 'Build Stephanos UI'
    || row.name === 'pages-deploy');
  assert.equal(validateProtectedMergeCheckRows(missingBuildSuccess), false);
  const skippedBuild = checks.map(row => row.workflow === 'Build Stephanos UI'
    && row.name !== 'pages-deploy' ? { ...row, state: 'SKIPPED' } : row);
  assert.equal(validateProtectedMergeCheckRows(skippedBuild), false);
  assert.equal(validateProtectedMergeCheckRows([
    ...successfulRequiredChecks(),
    { name: 'build', workflow: 'Build Stephanos UI', state: 'SKIPPED' },
  ]), false);
  assert.equal(validateProtectedMergeCheckRows([
    ...successfulRequiredChecks(),
    { name: 'pages-deploy', workflow: 'PR Clean Guard', state: 'SKIPPED' },
  ]), false);
  assert.equal(validateProtectedMergeCheckRows([
    ...successfulRequiredChecks(),
    { name: 'pages-deploy', workflow: 'Build Stephanos UI', state: 'FAILURE', event: 'pull_request' },
  ]), false);
});

test('canonical classifier still blocks a genuine failed required workflow', () => {
  const rows = successfulRequiredChecks().map((row, index) => (
    index === 0 ? { ...row, state: 'FAILURE' } : row
  ));
  const observation = parseOpenClawGitHubMergeObservation({
    view: view(),
    checks: checks(1, rows),
  });

  assert.equal(observation.valid, true);
  assert.equal(validateProtectedMergeCheckRows(observation.checkPayload), false);
});

test('cancelled authentication pending signal and unknown gh exits fail closed', () => {
  const rows = successfulRequiredChecks();
  const cases = [
    { status: 2, blocker: 'github-pr-checks-transport-failed' },
    { status: 4, blocker: 'github-pr-checks-transport-failed' },
    { status: 8, blocker: 'github-pr-checks-pending' },
    { status: null, blocker: 'github-pr-checks-transport-failed' },
    { status: 3, blocker: 'github-pr-checks-transport-failed' },
    { status: 99, blocker: 'github-pr-checks-transport-failed' },
  ];

  for (const { status, blocker } of cases) {
    const observation = parseOpenClawGitHubMergeObservation({
      view: view(),
      checks: checks(status, rows),
    });
    assert.equal(observation.valid, false, `status ${status} must fail closed`);
    assert.equal(observation.checkPayload, null, `status ${status} must not reach the classifier`);
    assert.ok(observation.blockers.includes(blocker), `status ${status} must report ${blocker}`);
  }
});

test('spawn errors fail closed even when stdout contains parseable rows', () => {
  const observation = parseOpenClawGitHubMergeObservation({
    view: view(),
    checks: {
      ...checks(1, successfulRequiredChecks()),
      error: new Error('spawn failed'),
    },
  });

  assert.equal(observation.valid, false);
  assert.equal(observation.checkPayload, null);
  assert.ok(observation.blockers.includes('github-pr-checks-transport-failed'));
});

test('malformed or non-array check JSON fails closed before classification', () => {
  const malformed = parseOpenClawGitHubMergeObservation({
    view: view(),
    checks: { status: 1, stdout: '{', stderr: '', error: null },
  });
  assert.equal(malformed.valid, false);
  assert.match(malformed.blockers.join(' '), /invalid-json/);

  const wrongShape = parseOpenClawGitHubMergeObservation({
    view: view(),
    checks: { status: 1, stdout: '{}', stderr: '', error: null },
  });
  assert.equal(wrongShape.valid, false);
  assert.match(wrongShape.blockers.join(' '), /payload-invalid/);
});

test('view transport failures remain terminal', () => {
  const observation = parseOpenClawGitHubMergeObservation({
    view: { status: 1, stdout: '', stderr: 'failed', error: null },
    checks: checks(0, successfulRequiredChecks()),
  });
  assert.equal(observation.valid, false);
  assert.match(observation.blockers.join(' '), /view-transport-failed/);
});

test('Windows executor delegates only parseable check-state exits instead of blanket-rejecting status 1', () => {
  const source = readFileSync(new URL('../../scripts/openclaw-github-operator.mjs', import.meta.url), 'utf8');
  assert.match(source, /parseOpenClawGitHubMergeObservation/);
  assert.match(source, /mergeObservation\.checkPayload/);
  assert.doesNotMatch(source, /checks\.status\s*!==\s*0/);
});
