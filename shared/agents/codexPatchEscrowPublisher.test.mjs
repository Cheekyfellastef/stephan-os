import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatchEscrowBundle,
  renderPatchEscrowChunkComment,
  renderPatchEscrowManifestComment,
  renderPatchEscrowPublishComment,
} from './codexPatchEscrow.mjs';
import {
  selectPatchEscrowFromComments,
  validatePatchEscrowPublishEvent,
} from '../../scripts/codex-patch-escrow-publisher.mjs';

const BASE_SHA = 'a'.repeat(40);

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

test('only the repository owner can issue the final publish request', () => {
  const data = bundle();
  const event = {
    action: 'created',
    repository: { full_name: 'Cheekyfellastef/stephan-os', owner: { login: 'Cheekyfellastef' } },
    issue: { number: 1503, labels: [{ name: 'codex' }] },
    comment: { user: { login: 'Cheekyfellastef' }, body: renderPatchEscrowPublishComment(data.manifest.bundleId) },
  };
  assert.equal(validatePatchEscrowPublishEvent(event).valid, true);
  event.comment.user.login = 'chatgpt-codex-connector[bot]';
  assert.equal(validatePatchEscrowPublishEvent(event).valid, false);
});

test('publish requests require the codex-labelled issue lane', () => {
  const data = bundle();
  const event = {
    action: 'created',
    repository: { full_name: 'Cheekyfellastef/stephan-os', owner: { login: 'Cheekyfellastef' } },
    issue: { number: 1503, labels: [] },
    comment: { user: { login: 'Cheekyfellastef' }, body: renderPatchEscrowPublishComment(data.manifest.bundleId) },
  };
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
