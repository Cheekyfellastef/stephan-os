import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatchEscrowBundle,
  renderPatchEscrowChunkComment,
  renderPatchEscrowManifestComment,
  renderPatchEscrowPublishComment,
} from './codexPatchEscrow.mjs';
import {
  clearSensitiveProcessEnvironment,
  sanitizedTestEnvironment,
  selectPatchEscrowFromComments,
  validateExistingPublicationEvidence,
  validatePatchEscrowPublishEvent,
} from '../../scripts/codex-patch-escrow-publisher.mjs';

const BASE_SHA = 'a'.repeat(40);
const BRANCH_SHA = 'b'.repeat(40);
const TREE_SHA = 'c'.repeat(40);

function bundle() {
  return createPatchEscrowBundle({
    issueNumber: 1503,
    baseSha: BASE_SHA,
    patch: 'diff --git a/shared/agents/a.mjs b/shared/agents/a.mjs\n',
    changedFiles: ['shared/agents/a.mjs'],
    testProfile: 'node-changed',
    commitMessage: 'Repair issue #1503',
    prTitle: 'Repair issue #1503',
  });
}

function publishEvent(data = bundle()) {
  return {
    action: 'created',
    repository: { full_name: 'Cheekyfellastef/stephan-os', owner: { login: 'Cheekyfellastef' } },
    issue: { number: 1503, labels: [{ name: 'codex' }] },
    comment: { user: { login: 'Cheekyfellastef' }, body: renderPatchEscrowPublishComment(data.manifest.bundleId) },
  };
}

test('only the repository owner can issue the final publish request', () => {
  const event = publishEvent();
  assert.equal(validatePatchEscrowPublishEvent(event).valid, true);
  event.comment.user.login = 'chatgpt-codex-connector[bot]';
  assert.equal(validatePatchEscrowPublishEvent(event).valid, false);
});

test('publish requests require the codex-labelled issue lane', () => {
  const event = publishEvent();
  event.issue.labels = [];
  assert.equal(validatePatchEscrowPublishEvent(event).valid, false);
});

test('manifest and chunks can be supplied by trusted owner and Codex bot comments', () => {
  const data = bundle();
  const comments = [
    { id: 1, user: { login: 'Cheekyfellastef' }, body: renderPatchEscrowManifestComment(data.manifest) },
    ...data.chunks.map((chunk, index) => ({ id: index + 2, user: { login: 'chatgpt-codex-connector[bot]' }, body: renderPatchEscrowChunkComment(chunk) })),
  ];
  const selected = selectPatchEscrowFromComments(comments, data.manifest.bundleId, 'Cheekyfellastef');
  assert.equal(selected.ok, true);
  assert.equal(selected.patch.toString('utf8'), 'diff --git a/shared/agents/a.mjs b/shared/agents/a.mjs\n');
});

test('untrusted patch comments are ignored and fail closed', () => {
  const data = bundle();
  const comments = [
    { id: 1, user: { login: 'unknown-user' }, body: renderPatchEscrowManifestComment(data.manifest) },
    ...data.chunks.map((chunk, index) => ({ id: index + 2, user: { login: 'unknown-user' }, body: renderPatchEscrowChunkComment(chunk) })),
  ];
  const selected = selectPatchEscrowFromComments(comments, data.manifest.bundleId, 'Cheekyfellastef');
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'manifest-not-found');
});

test('patched-code test environment strips credentials and disables ambient Git config', () => {
  const environment = sanitizedTestEnvironment({
    PATH: '/usr/bin',
    GITHUB_TOKEN: 'write-token',
    GH_TOKEN: 'another-token',
    ACTIONS_RUNTIME_TOKEN: 'runtime-token',
    STEPHANOS_PRIVATE_KEY: 'private-key',
    SAFE_VALUE: 'kept',
  }, '/tmp/safe-home');
  assert.equal(environment.PATH, '/usr/bin');
  assert.equal(environment.SAFE_VALUE, 'kept');
  assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(environment.STEPHANOS_PRIVATE_KEY, undefined);
  assert.equal(environment.HOME, '/tmp/safe-home');
  assert.equal(environment.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
});

test('sensitive variables are removed from the validation process before patched tests run', () => {
  const environment = { PATH: '/usr/bin', GITHUB_TOKEN: 'secret', SAFE_VALUE: 'kept', API_PASSWORD: 'secret' };
  const removed = clearSensitiveProcessEnvironment(environment);
  assert.deepEqual(removed, ['API_PASSWORD', 'GITHUB_TOKEN']);
  assert.deepEqual(environment, { PATH: '/usr/bin', SAFE_VALUE: 'kept' });
});

test('idempotent publication requires exact tree, exact signed base parent, exact PR head and patch receipt', () => {
  const data = bundle();
  const result = validateExistingPublicationEvidence({
    manifest: data.manifest,
    defaultBranch: 'main',
    expectedTreeSha: TREE_SHA,
    branchRef: { object: { sha: BRANCH_SHA } },
    branchCommit: { sha: BRANCH_SHA, tree: { sha: TREE_SHA }, parents: [{ sha: BASE_SHA }] },
    pull: {
      head: { sha: BRANCH_SHA, ref: data.manifest.targetBranch },
      base: { ref: 'main' },
      body: `Patch SHA-256: ${data.manifest.patchSha256}`,
    },
  });
  assert.equal(result.valid, true);
  assert.equal(result.finalVerdict, 'PATCH_ESCROW_EXISTING_PUBLICATION_PASS');
});

test('idempotent publication fails closed when the branch tree moved despite a matching PR body', () => {
  const data = bundle();
  const result = validateExistingPublicationEvidence({
    manifest: data.manifest,
    defaultBranch: 'main',
    expectedTreeSha: TREE_SHA,
    branchRef: { object: { sha: BRANCH_SHA } },
    branchCommit: { sha: BRANCH_SHA, tree: { sha: 'd'.repeat(40) }, parents: [{ sha: BASE_SHA }] },
    pull: {
      head: { sha: BRANCH_SHA, ref: data.manifest.targetBranch },
      base: { ref: 'main' },
      body: `Patch SHA-256: ${data.manifest.patchSha256}`,
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.blockers.includes('remote-tree-does-not-match-signed-patch'), true);
});

test('idempotent publication fails closed when the commit parent is not the signed base', () => {
  const data = bundle();
  const result = validateExistingPublicationEvidence({
    manifest: data.manifest,
    defaultBranch: 'main',
    expectedTreeSha: TREE_SHA,
    branchRef: { object: { sha: BRANCH_SHA } },
    branchCommit: { sha: BRANCH_SHA, tree: { sha: TREE_SHA }, parents: [{ sha: 'e'.repeat(40) }] },
    pull: null,
  });
  assert.equal(result.valid, false);
  assert.equal(result.blockers.includes('remote-commit-parent-does-not-match-signed-base'), true);
});
