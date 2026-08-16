import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPatchEscrowBundle,
  derivePatchEscrowBundleId,
  validatePatchEscrowManifest,
} from './codexPatchEscrow.mjs';

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

test('bundle identity is deterministically derived from issue number and full patch hash', () => {
  const data = bundle();
  assert.equal(
    data.manifest.bundleId,
    derivePatchEscrowBundleId(data.manifest.issueNumber, data.manifest.patchSha256),
  );
  assert.equal(validatePatchEscrowManifest(data.manifest).valid, true);
});

test('manifest validation rejects a well-shaped bundle ID from another patch hash', () => {
  const data = bundle();
  const validation = validatePatchEscrowManifest({
    ...data.manifest,
    bundleId: 'patch-issue-1503-000000000000',
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('bundle-id-patch-mismatch'), true);
});

test('manifest validation rejects a bundle ID advertising another issue', () => {
  const data = bundle();
  const validation = validatePatchEscrowManifest({
    ...data.manifest,
    bundleId: `patch-issue-1504-${data.manifest.patchSha256.slice(0, 12)}`,
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('bundle-id-patch-mismatch'), true);
});
