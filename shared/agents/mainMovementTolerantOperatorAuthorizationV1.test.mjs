import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE,
  MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT,
  evaluateMainMovementTolerantOperatorAuthorizationV1,
} from './mainMovementTolerantOperatorAuthorizationV1.mjs';

const authorizationBase = '1'.repeat(40);
const currentBase = '2'.repeat(40);
const sourceHead = '3'.repeat(40);
const sourceTree = '4'.repeat(40);
const convergedHead = '5'.repeat(40);
const convergedTree = '6'.repeat(40);

const changedFiles = Object.freeze([
  Object.freeze({ path: 'shared/agents/example.mjs', afterBlobSha: 'a'.repeat(40) }),
  Object.freeze({ path: 'shared/agents/example.test.mjs', afterBlobSha: 'b'.repeat(40) }),
]);
const changedPaths = changedFiles.map((file) => file.path);

const authorization = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2200,
  branch: 'fix/example-authorized-change-v1',
  sourceHead,
  sourceTree,
  authorizationBase,
  changedFiles,
  authorityClass: 'EXACT_CHANGE_PROTECTED_SQUASH',
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
    currentBase,
    authorizationBaseToApprovedSourceComparison: compare(
      authorizationBase,
      sourceHead,
      changedPaths,
      { ahead_by: 5 },
    ),
    authorizationBaseToCurrentBaseComparison: compare(
      authorizationBase,
      currentBase,
      ['docs/unrelated.md', 'apps/unrelated/main.js'],
      { ahead_by: 3 },
    ),
    currentHeadBaseRequiredChecksGreen: true,
    currentHeadBaseIndependentReviewClean: true,
    unresolvedReviewThreads: 0,
    mergeable: true,
    ...overrides,
  };
}

function convergence(overrides = {}) {
  return {
    proven: true,
    branch: authorization.branch,
    priorHead: sourceHead,
    priorTree: sourceTree,
    newHead: convergedHead,
    newTree: convergedTree,
    parents: [{ sha: sourceHead }, { sha: currentBase }],
    currentChangedFiles: changedFiles,
    force: false,
    rebase: false,
    reset: false,
    ...overrides,
  };
}

test('unchanged exact head survives disjoint descendant main movement with fresh exact evidence', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({ authorization, observed: observed() });
  assert.equal(result.authorizationReusable, true);
  assert.equal(result.operatorReapprovalRequired, false);
  assert.equal(result.authorizationMode, MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE.EXACT_HEAD);
  assert.equal(result.authorizationBase, authorizationBase);
  assert.equal(result.executionBase, currentBase);
  assert.equal(result.executionHead, sourceHead);
  assert.equal(result.protectedExecutionReady, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.finalVerdict, MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.READY_FOR_PROTECTED_EXECUTION);
});

test('same-base exact-head path remains backward compatible', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({
      currentBase: authorizationBase,
      authorizationBaseToCurrentBaseComparison: compare(authorizationBase, authorizationBase, []),
    }),
  });
  assert.equal(result.authorizationReusable, true);
  assert.equal(result.executionBase, authorizationBase);
  assert.deepEqual(result.interveningMainChangedPaths, []);
});

test('fresh evidence may expire without expiring the operator judgment itself', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({ currentHeadBaseIndependentReviewClean: false }),
  });
  assert.equal(result.authorizationReusable, true);
  assert.equal(result.operatorReapprovalRequired, false);
  assert.equal(result.protectedExecutionReady, false);
  assert.deepEqual(result.blockers, ['fresh-current-head-base-evidence-required']);
  assert.equal(result.finalVerdict, MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.REUSABLE_FRESH_EVIDENCE_REQUIRED);
});

test('intervening main overlap with an approved path fails closed', () => {
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

test('canonical two-parent preservation convergence may carry unchanged operator judgment to a fresh exact head', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({
      sourceHead: convergedHead,
      sourceTree: convergedTree,
      preservationConvergence: convergence(),
    }),
  });
  assert.equal(result.authorizationReusable, true);
  assert.equal(result.operatorReapprovalRequired, false);
  assert.equal(
    result.authorizationMode,
    MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE.EVIDENCE_EQUIVALENT_PRESERVATION_CONVERGENCE,
  );
  assert.equal(result.executionHead, convergedHead);
  assert.equal(result.executionTree, convergedTree);
  assert.equal(result.protectedExecutionReady, true);
  assert.equal(result.reusableAcrossArbitraryHeads, false);
  assert.equal(result.reusableOnlyAcrossEvidenceEquivalentConvergence, true);
});

test('arbitrary new head or tree cannot inherit authorization without canonical convergence evidence', () => {
  for (const mutation of [
    { sourceHead: convergedHead },
    { sourceTree: convergedTree },
    { sourceHead: convergedHead, sourceTree: convergedTree, preservationConvergence: { proven: false } },
  ]) {
    const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
      authorization,
      observed: observed(mutation),
    });
    assert.equal(result.authorizationReusable, false);
    assert.equal(result.operatorReapprovalRequired, true);
  }
});

test('one changed approved feature blob invalidates preservation convergence', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({
      sourceHead: convergedHead,
      sourceTree: convergedTree,
      preservationConvergence: convergence({
        currentChangedFiles: [
          changedFiles[0],
          { ...changedFiles[1], afterBlobSha: 'c'.repeat(40) },
        ],
      }),
    }),
  });
  assert.equal(result.authorizationReusable, false);
  assert.ok(result.blockers.includes('preservation:convergence-approved-blob-changed:shared/agents/example.test.mjs'));
});

test('hidden extra path invalidates preservation convergence', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({
      sourceHead: convergedHead,
      sourceTree: convergedTree,
      preservationConvergence: convergence({
        currentChangedFiles: [
          ...changedFiles,
          { path: 'shared/agents/hidden-extra.mjs', afterBlobSha: 'd'.repeat(40) },
        ],
      }),
    }),
  });
  assert.equal(result.authorizationReusable, false);
  assert.ok(result.blockers.includes('preservation:convergence-current-path-estate-mismatch'));
});

test('wrong parent order, force, rebase or reset cannot masquerade as preservation convergence', () => {
  for (const mutation of [
    { parents: [{ sha: currentBase }, { sha: sourceHead }] },
    { parents: [{ sha: sourceHead }, { sha: '7'.repeat(40) }] },
    { force: true },
    { rebase: true },
    { reset: true },
  ]) {
    const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
      authorization,
      observed: observed({
        sourceHead: convergedHead,
        sourceTree: convergedTree,
        preservationConvergence: convergence(mutation),
      }),
    });
    assert.equal(result.authorizationReusable, false);
  }
});

test('authority class drift invalidates authorization', () => {
  const result = evaluateMainMovementTolerantOperatorAuthorizationV1({
    authorization,
    observed: observed({ authorityClass: 'BROADER_RUNTIME_AUTHORITY' }),
  });
  assert.equal(result.authorizationReusable, false);
  assert.ok(result.blockers.includes('observed-authority-class-mismatch'));
});

test('non-descendant or diverged protected main fails closed', () => {
  for (const movement of [
    compare(authorizationBase, currentBase, ['docs/unrelated.md'], { status: 'diverged', behind_by: 1 }),
    compare(authorizationBase, currentBase, ['docs/unrelated.md'], { merge_base_commit: { sha: '8'.repeat(40) } }),
    compare(authorizationBase, currentBase, ['docs/unrelated.md'], { base_commit: { sha: '9'.repeat(40) } }),
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

test('authorization evaluator never grants merge, deployment or runtime authority', () => {
  for (const fixture of [
    observed(),
    observed({ sourceHead: convergedHead, sourceTree: convergedTree, preservationConvergence: convergence() }),
  ]) {
    const result = evaluateMainMovementTolerantOperatorAuthorizationV1({ authorization, observed: fixture });
    assert.equal(result.mergeAuthority, false);
    assert.equal(result.deploymentAuthority, false);
    assert.equal(result.runtimeMutationAuthority, false);
  }
});
