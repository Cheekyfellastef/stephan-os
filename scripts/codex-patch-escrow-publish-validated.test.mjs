import test from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedPatchEscrowPrCreation403, validateEscrowBranchOnlyHandoff } from './codex-patch-escrow-publish-validated.mjs';

const BASE = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const BRANCH = 'patch-escrow/issue-1567-0123456789ab';
const exactError = () => Object.assign(
  new Error('GitHub API POST /repos/Cheekyfellastef/stephan-os/pulls failed with 403'),
  { details: { status: 403, payload: { message: 'GitHub Actions is not permitted to create or approve pull requests.' } } },
);
const packet = () => ({
  error: exactError(),
  manifest: { baseSha: BASE, baseBranch: 'main', targetBranch: BRANCH },
  artifact: { baseSha: BASE, expectedTreeSha: TREE },
  currentBaseSha: BASE,
  branchRef: { object: { sha: HEAD } },
  branchCommit: { sha: HEAD, tree: { sha: TREE }, parents: [{ sha: BASE }] },
  pull: null,
});

test('only the exact Actions pull-request permission denial qualifies', () => {
  assert.equal(isVerifiedPatchEscrowPrCreation403(exactError()), true);
  for (const bad of [
    null,
    new Error('403'),
    Object.assign(exactError(), { message: 'GitHub API GET /repos/Cheekyfellastef/stephan-os/pulls failed with 403' }),
    Object.assign(exactError(), { details: { status: 403, payload: { message: 'Resource not accessible by integration' } } }),
    Object.assign(exactError(), { details: { status: 429, payload: { message: 'GitHub Actions is not permitted to create or approve pull requests.' } } }),
  ]) assert.equal(isVerifiedPatchEscrowPrCreation403(bad), false);
});

test('branch-only handoff demands actual exact tree, signed base and remote head', () => {
  const good = validateEscrowBranchOnlyHandoff(packet());
  assert.equal(good.ok, true);
  assert.equal(good.branch, BRANCH);
  assert.equal(good.remoteHeadSha, HEAD);
  assert.equal(good.exactTreeSha, TREE);
});

test('drift, wrong tree, foreign parent, missing remote and duplicate PR remain held', () => {
  for (const altered of [
    { currentBaseSha: 'd'.repeat(40) },
    { branchRef: null },
    { branchRef: { object: { sha: 'd'.repeat(40) } } },
    { branchCommit: { sha: HEAD, tree: { sha: 'd'.repeat(40) }, parents: [{ sha: BASE }] } },
    { branchCommit: { sha: HEAD, tree: { sha: TREE }, parents: [{ sha: 'd'.repeat(40) }] } },
    { branchCommit: { sha: HEAD, tree: { sha: TREE }, parents: [{ sha: BASE }, { sha: BASE }] } },
    { pull: { number: 99 } },
  ]) assert.equal(validateEscrowBranchOnlyHandoff({ ...packet(), ...altered }).ok, false);
});

test('unrelated publication denial never grants a branch-only receipt', () => {
  const bad = packet();
  bad.error = Object.assign(exactError(), { details: { status: 403, payload: { message: 'Unrelated denial' } } });
  const result = validateEscrowBranchOnlyHandoff(bad);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PR_CREATION_DENIAL_NOT_EXACT');
});
