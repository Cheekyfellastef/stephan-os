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
