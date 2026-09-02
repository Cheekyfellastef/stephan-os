import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT,
  evaluateMainMovementTolerantOperatorAuthorizationV1,
} from './mainMovementTolerantOperatorAuthorizationV1.mjs';

const authorizationBase = '1'.repeat(40);
const currentBase = '2'.repeat(40);
const sourceHead = '3'.repeat(40);
const sourceTree = '4'.repeat(40);

const authorization = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2200,
  branch: 'fix/example-authorized-change-v1',
  sourceHead,
  sourceTree,
  authorizationBase,
  changedPaths: [
    'shared/agents/example.mjs',
    'shared/agents/example.test.mjs',
  ],
  authorityClass: 'EXACT_HEAD_PROTECTED_SQUASH',
  reusableAcrossHeads: false,
});

function compare(base, head, files, overrides = {}) {
  return {
    status: base === head ? 'identical' : 'ahead',
    ahead_by: base === head ? 0 : 2,
    behind_by: 0,
    base_commit: { sha: base },
    merge_base_commit: { sha: base },
    head_commit: { sha: head },
    files: files.map((filename) => ({ filename })),
    ...overrides,
  };
}

function observed(overrides = {}) {
  return {
    repository: authorization.repository,
    prNumber: authorization.prNumber,
    branch: authorization.branch,
    sourceHead,
    sourceTree,
    authorityClass: authorization.authorityClass,
    changedPaths: authorization.changedPaths,
    currentBase,
    authorizationBaseToSourceComparison: compare(
      authorizationBase,
      sourceHead,
      authorization.changedPaths,
      { ahead_by: 5 },
    ),
    authorizationBaseToCurrentBaseComparison: compare(
      authorizationBase,
      currentBase,
      ['docs/unrelated.md', 'apps/unrelated/main.js'],
      { ahead_by: 3 },
    ),
    currentBaseRequiredChecksGreen: true,
    currentBaseIndependentReviewClean: true,
    unresolvedReviewThreads: 0,
    mergeable: true,
    ...overrides,
  };
}

test('keeps operator judgment valid across a descendant disjoint main advance while requiring fresh current-base evidence', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed(),
  });

  assert.equal(result.authorizationReusable, true);
  assert.equal(result.operatorReapprovalRequired, false);
  assert.equal(result.reusableAcrossHeads, false);
  assert.equal(result.reusableAcrossCompatibleBases, true);
  assert.equal(result.authorizationBase, authorizationBase);
  assert.equal(result.executionBase, currentBase);
  assert.equal(result.protectedExecutionReady, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(
    result.finalVerdict,
    MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.READY_FOR_PROTECTED_EXECUTION,
  );
});

test('same-base path remains valid and does not manufacture main movement', () => {
  const sameBase = observed({
    currentBase: authorizationBase,
    authorizationBaseToCurrentBaseComparison: compare(authorizationBase, authorizationBase, []),
  });
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({ authorization, observed: sameBase });
  assert.equal(result.authorizationReusable, true);
  assert.equal(result.executionBase, authorizationBase);
  assert.deepEqual(result.interveningMainChangedPaths, []);
  assert.equal(result.operatorReapprovalRequired, false);
});

test('operator judgment can remain reusable while missing fresh current-base evidence blocks protected execution', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({ currentBaseIndependentReviewClean: false }),
  });
  assert.equal(result.authorizationReusable, true);
  assert.equal(result.operatorReapprovalRequired, false);
  assert.equal(result.protectedExecutionReady, false);
  assert.deepEqual(result.blockers, ['fresh-current-base-evidence-required']);
  assert.equal(
    result.finalVerdict,
    MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.REUSABLE_FRESH_EVIDENCE_REQUIRED,
  );
});

test('intervening main change touching an approved path requires fresh operator judgment or governed convergence', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({
      authorizationBaseToCurrentBaseComparison: compare(
        authorizationBase,
        currentBase,
        ['shared/agents/example.mjs', 'docs/unrelated.md'],
      ),
    }),
  });
  assert.equal(result.authorizationReusable, false);
  assert.equal(result.operatorReapprovalRequired, true);
  assert.ok(result.blockers.includes('main-movement:approved-path-overlap:shared/agents/example.mjs'));
});

test('source head or source tree movement invalidates authorization even when main movement is disjoint', () => {
  for (const mutation of [
    { sourceHead: '5'.repeat(40) },
    { sourceTree: '6'.repeat(40) },
  ]) {
    const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
      authorization,
      observed: observed(mutation),
    });
    assert.equal(result.authorizationReusable, false);
    assert.equal(result.operatorReapprovalRequired, true);
  }
});

test('changed-file estate or authority-class drift invalidates authorization', () => {
  const widened = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({ changedPaths: [...authorization.changedPaths, 'shared/agents/extra.mjs'] }),
  });
  assert.equal(widened.authorizationReusable, false);
  assert.ok(widened.blockers.includes('observed-changed-path-estate-mismatch'));

  const widenedAuthority = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({ authorityClass: 'BROADER_RUNTIME_AUTHORITY' }),
  });
  assert.equal(widenedAuthority.authorizationReusable, false);
  assert.ok(widenedAuthority.blockers.includes('observed-authority-class-mismatch'));
});

test('non-descendant or diverged current main fails closed rather than reusing operator judgment', () => {
  for (const movement of [
    compare(authorizationBase, currentBase, ['docs/unrelated.md'], { status: 'diverged', behind_by: 1 }),
    compare(authorizationBase, currentBase, ['docs/unrelated.md'], { merge_base_commit: { sha: '7'.repeat(40) } }),
    compare(authorizationBase, currentBase, ['docs/unrelated.md'], { base_commit: { sha: '8'.repeat(40) } }),
  ]) {
    const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
      authorization,
      observed: observed({ authorizationBaseToCurrentBaseComparison: movement }),
    });
    assert.equal(result.authorizationReusable, false);
    assert.equal(result.operatorReapprovalRequired, true);
    assert.equal(result.finalVerdict, MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.BLOCKED);
  }
});

test('authorization must never become reusable across source heads', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization: { ...authorization, reusableAcrossHeads: true },
    observed: observed(),
  });
  assert.equal(result.authorizationReusable, false);
  assert.ok(result.blockers.includes('authorization-must-not-reuse-across-heads'));
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.deploymentAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});
