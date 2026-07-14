import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatchEscrowBundle,
  renderPatchEscrowChunkComment,
  renderPatchEscrowManifestComment,
} from './codexPatchEscrow.mjs';
import { renderPatchEscrowPublishAuthorizationComment } from './codexPatchEscrowAuthorization.mjs';
import {
  clearSensitiveProcessEnvironment,
  runPatchEscrowPublisher,
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
    comment: {
      id: 42,
      user: { login: 'Cheekyfellastef' },
      body: renderPatchEscrowPublishAuthorizationComment(data.manifest.bundleId, data.manifest.patchSha256),
    },
  };
}

test('only the repository owner can issue the final full-hash publish request', () => {
  const event = publishEvent();
  const validation = validatePatchEscrowPublishEvent(event);
  assert.equal(validation.valid, true);
  assert.equal(validation.patchSha256, bundle().manifest.patchSha256);
  assert.equal(validation.commentId, 42);
  event.comment.user.login = 'chatgpt-codex-connector[bot]';
  assert.equal(validatePatchEscrowPublishEvent(event).valid, false);
});

test('publish request fails closed when the full patch hash is changed or omitted', () => {
  const data = bundle();
  const changed = publishEvent(data);
  changed.comment.body = renderPatchEscrowPublishAuthorizationComment(data.manifest.bundleId, '0'.repeat(64));
  const changedValidation = validatePatchEscrowPublishEvent(changed);
  assert.equal(changedValidation.valid, true);
  assert.notEqual(changedValidation.patchSha256, data.manifest.patchSha256);

  const omitted = publishEvent(data);
  omitted.comment.body = `PATCH_ESCROW_PUBLISH_V1\n${JSON.stringify({ bundleId: data.manifest.bundleId })}\nEND_PATCH_ESCROW_PUBLISH_V1`;
  const omittedValidation = validatePatchEscrowPublishEvent(omitted);
  assert.equal(omittedValidation.valid, false);
  assert.equal(omittedValidation.blockers.includes('invalid-publish-authorization-patch-sha256'), true);
});

test('publish requests require the codex-labelled issue lane', () => {
  const event = publishEvent();
  event.issue.labels = [];
  assert.equal(validatePatchEscrowPublishEvent(event).valid, false);
});

test('manifest and chunks require the exact owner-authorised full patch hash', () => {
  const data = bundle();
  const comments = [
    { id: 1, user: { login: 'Cheekyfellastef' }, body: renderPatchEscrowManifestComment(data.manifest) },
    ...data.chunks.map((chunk, index) => ({ id: index + 2, user: { login: 'chatgpt-codex-connector[bot]' }, body: renderPatchEscrowChunkComment(chunk) })),
  ];
  const selected = selectPatchEscrowFromComments(comments, data.manifest.bundleId, 'Cheekyfellastef', data.manifest.patchSha256);
  assert.equal(selected.ok, true);
  assert.equal(selected.patch.toString('utf8'), 'diff --git a/shared/agents/a.mjs b/shared/agents/a.mjs\n');

  const wrongHash = selectPatchEscrowFromComments(comments, data.manifest.bundleId, 'Cheekyfellastef', '0'.repeat(64));
  assert.equal(wrongHash.ok, false);
  assert.equal(wrongHash.reason, 'manifest-patch-hash-not-authorised');
});

test('untrusted patch comments are ignored and fail closed', () => {
  const data = bundle();
  const comments = [
    { id: 1, user: { login: 'unknown-user' }, body: renderPatchEscrowManifestComment(data.manifest) },
    ...data.chunks.map((chunk, index) => ({ id: index + 2, user: { login: 'unknown-user' }, body: renderPatchEscrowChunkComment(chunk) })),
  ];
  const selected = selectPatchEscrowFromComments(comments, data.manifest.bundleId, 'Cheekyfellastef', data.manifest.patchSha256);
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, 'manifest-not-found');
});

test('legacy direct publication path is disabled even when called explicitly', async () => {
  await assert.rejects(() => runPatchEscrowPublisher(), /validated artifact is required/);
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
