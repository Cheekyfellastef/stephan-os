import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLogicalGoalBuildTruthV1,
  loadControllerActivityProofRecordsV1,
  loadPinnedWorkerPickupVerifierV1,
  distinctPhysicalWorkerSigningIdentityV1,
  verifyCleanCanonicalTrackedMainV1,
} from './logicalGoalPickupProofV1.mjs';
import { mkdir, mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nowMs = Date.parse('2026-10-18T17:00:00.000Z');
const head = 'a'.repeat(40);
const goal = Object.freeze({
  issue: '#3050', logicalLaneId: 'logical-goal-3050',
  controllerId: 'controller-zero', selectedForAdmission: true,
  state: 'BUILDING',
  lastMaterialProgressAtUtc: new Date(nowMs).toISOString(),
  proofRefs: ['proof/claimed-physical-work'],
});
const truth = Object.freeze({
  schemaVersion: 'stephanos.sovereign-build-truth.v1',
  observedAtUtc: new Date(nowMs).toISOString(),
  goals: [goal],
});
test('uncommissioned public key or missing proof can never authenticate a BUILDING goal', () => {
  const forged = {
    schemaVersion: 'stephanos.logical-goal-pickup-attestation.v1',
    publisherId: 'stephanos-core',
    sourceHead: head,
    signatureBase64: 'a'.repeat(88),
    claims: [{ issue: '#3050', proofRecords: [{ proofRef: 'proof/claimed-physical-work' }] }],
  };
  const result = verifyLogicalGoalBuildTruthV1({
    buildTruth: truth, attestation: forged, proofRecords: [],
    expectedSourceHead: head, nowMs,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOGICAL_GOAL_PINNED_VERIFIER_UNAVAILABLE');
  assert.deepEqual(result.verifiedGoalIds, []);
});
test('a guessed digest or self-described Core identity supplies no independent trust', () => {
  for (const attestation of [null, {}, { sourceHead: head }]) {
    const result = verifyLogicalGoalBuildTruthV1({
      buildTruth: truth, attestation, proofRecords: [],
      expectedSourceHead: head, nowMs,
      trustedPublicKeyPem: 'not-a-public-key',
      trustedPublicKeySha256: 'f'.repeat(64),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.verifiedGoalIds, []);
  }
});

test('the reader finds the derived controller proof, not a fabricated original receipt filename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logical-proof-'));
  await mkdir(join(root, 'proof'));
  const proofId = 'controller-abcdef123456-run-run123';
  const record = {
    kind: 'stephanos.shared_workspace.proof',
    proofId,
    status: 'PASS',
    refs: ['receipts/work-3050-material.json'],
    controllerActivityProof: {
      schemaVersion: 'stephanos.controller-activity-proof.v1',
      controllerId: 'controller-zero', runId: 'run123', materialActionsSucceeded: 1,
    },
  };
  await writeFile(join(root, 'proof', proofId + '.json'), JSON.stringify(record));
  const result = await loadControllerActivityProofRecordsV1({ workspaceRoot: root });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].refs, ['receipts/work-3050-material.json']);
  assert.equal(result.records[0].proofId, proofId);
});
test('uncommissioned separate physical-worker public key fails closed', async () => {
  const result = await loadPinnedWorkerPickupVerifierV1({
    localStateRoot: '/nonexistent',
    env: { STEPHANOS_PHYSICAL_WORKER_TRUSTED_PUBLIC_KEY_SHA256: '',
      STEPHANOS_GOAL_BUILD_GATES_TRUSTED_PUBLIC_KEY_SHA256: '' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WORKER_PICKUP_DISTINCT_PIN_NOT_COMMISSIONED');
});

test('same Ed25519 public key with different PEM line endings is not a distinct worker', () => {
  const key = [
    '-----BEGIN PUBLIC KEY-----',
    'MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
    '-----END PUBLIC KEY-----',
    '',
  ].join('\n');
  const differentlyEncoded = key.replace(/\n/g, '\r\n') + '\r\n';
  assert.notEqual(key, differentlyEncoded);
  assert.equal(distinctPhysicalWorkerSigningIdentityV1(key, differentlyEncoded), false);
  assert.equal(distinctPhysicalWorkerSigningIdentityV1(key, key), false);
  assert.equal(distinctPhysicalWorkerSigningIdentityV1(key, 'not-an-ed25519-key'), false);
});

test('unrelated and historical proof-file growth cannot veto current controller pickups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'controller-history-'));
  const dir = join(root, 'proof');
  await mkdir(dir);
  // Over the previous hard global 1024-file limit, including over 512
  // historical controller records. Only current controller proofs count.
  for (let offset = 0; offset < 1300; offset += 50) {
    await Promise.all(Array.from({ length: Math.min(50, 1300 - offset) }, async (_, index) => {
      const n = offset + index;
      const name = n < 600 ? `controller-old-run-${n}.json` : `unrelated-${n}.json`;
      const filename = join(dir, name);
      await writeFile(filename, '{}');
      if (n < 600) {
        const yesterday = new Date(Date.now() - 86400000);
        await utimes(filename, yesterday, yesterday);
      }
    }));
  }
  const currentId = 'controller-current-run-test';
  await writeFile(join(dir, currentId + '.json'), JSON.stringify({
    kind: 'stephanos.shared_workspace.proof',
    proofId: currentId,
    controllerActivityProof: { schemaVersion: 'stephanos.controller-activity-proof.v1' },
  }));
  const result = await loadControllerActivityProofRecordsV1({ workspaceRoot: root });
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].proofId, currentId);
});

test('canonical pickup proof rejects dirty tracked files, staged edits and stale origin/main', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logical-clean-main-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 12000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  git('init', '--initial-branch=main');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = true;\n');
  git('add', 'proof-module.mjs');
  git('-c', 'user.name=Stephanos Test', '-c', 'user.email=ci@example.invalid',
    'commit', '-m', 'clean fixture');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const clean = verifyCleanCanonicalTrackedMainV1(root);
  assert.equal(clean.ok, true);
  assert.equal(clean.sourceHead, git('rev-parse', 'HEAD'));

  // These index flags bypass porcelain status, even when tracked source is
  // physically modified. They must not bypass the signing/readback gate.
  git('update-index', '--assume-unchanged', 'proof-module.mjs');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
    'LOGICAL_GOAL_TRACKED_INDEX_FLAGS_UNSAFE');
  git('update-index', '--no-assume-unchanged', 'proof-module.mjs');

  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = true;\n');
  git('update-index', '--skip-worktree', 'proof-module.mjs');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
    'LOGICAL_GOAL_TRACKED_INDEX_FLAGS_UNSAFE');
  git('update-index', '--no-skip-worktree', 'proof-module.mjs');

  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  const modified = verifyCleanCanonicalTrackedMainV1(root);
  assert.equal(modified.ok, false);
  assert.equal(modified.blocker, 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');
  git('add', 'proof-module.mjs');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');

  git('-c', 'user.name=Stephanos Test', '-c', 'user.email=ci@example.invalid',
    'commit', '-m', 'unfetched change');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_CANONICAL_MAIN_UNVERIFIED');
});
