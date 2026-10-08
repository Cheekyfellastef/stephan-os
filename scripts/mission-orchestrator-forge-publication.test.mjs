import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildOfflinePublicationOutboxRecordV1 } from '../shared/agents/offlinePublicationOutboxV1.mjs';
import { executeForgePublicationAction } from './mission-orchestrator-worker.mjs';

const NOW = new Date('2026-10-08T07:30:00.000Z');
const digest = (bytes, algo = 'sha256') => createHash(algo).update(bytes).digest('hex');

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'stephanos-forge-publication-'));
  const workspaceRoot = join(parent, 'workspace');
  const artifactsDir = join(workspaceRoot, 'source-artifacts');
  const outboxDir = join(workspaceRoot, 'publication-outbox', 'pending');
  await Promise.all([mkdir(artifactsDir, { recursive: true }), mkdir(outboxDir, { recursive: true })]);
  const bytes = Buffer.from('export const safe = true;\n');
  const blobSha = digest(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes]), 'sha1');
  const identity = {
    repository: 'Cheekyfellastef/stephan-os',
    missionId: 'critical-2732-elastic-goal',
    actionId: 'forge-source-1',
    canonicalIssue: 2732,
    canonicalPr: null,
    canonicalBranch: 'openclaw/elastic-goal-2732',
    exactParentHead: 'a'.repeat(40), exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    executorIdentity: 'mission-worker:foundry-forge:proof',
  };
  const file = { path: 'shared/agents/newModule.mjs',
    beforeBlobSha: '0'.repeat(40), afterBlobSha: blobSha, sha256: digest(bytes) };
  const bundleBytes = Buffer.from(JSON.stringify({
    schemaVersion: 'stephanos.source-artifact-complete-file-bundle.v1',
    ...identity, commitMessage: 'Safe Forge source', completedAtUtc: NOW.toISOString(),
    changedFiles: [{ ...file, mode: '100644', deleted: false, contentBase64: bytes.toString('base64') }],
    testsRun: ['node --test example.test.mjs'], testVerdicts: ['PASS'], diffCheckVerdict: 'PASS',
  }, null, 2) + '\n');
  const artifactSha256 = digest(bundleBytes);
  const escrow = {
    schemaVersion: 'stephanos.source-artifact-escrow.v1',
    artifactKind: 'COMPLETE_FILE_BUNDLE', ...identity,
    localCommitSha: '', completeArtifactSha256: artifactSha256,
    artifactRef: 'shared-workspace://source-artifacts/' + artifactSha256 + '.json',
    externallyReadable: true, commitMessage: 'Safe Forge source',
    createdAtUtc: NOW.toISOString(), expiresAtUtc: '2026-10-09T07:30:00.000Z',
    changedFiles: [file], testsRun: ['node --test example.test.mjs'],
    testVerdicts: ['PASS'], diffCheckVerdict: 'PASS',
  };
  const outbox = buildOfflinePublicationOutboxRecordV1(escrow, { nowUtc: NOW.toISOString() }).record;
  await Promise.all([
    writeFile(join(artifactsDir, artifactSha256 + '.json'), bundleBytes),
    writeFile(join(artifactsDir, artifactSha256 + '.escrow.json'), JSON.stringify(escrow)),
    writeFile(join(outboxDir, outbox.outboxId + '.json'), JSON.stringify(outbox)),
  ]);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPath = join(parent, 'private.pem');
  const publicKeyPath = join(parent, 'public.pem');
  await Promise.all([
    writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' })),
    writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' })),
  ]);
  const action = {
    actionId: 'forge-draft-pr-1', missionId: identity.missionId,
    actionKind: 'forge-escrow-publication', adapter: 'forge-publication',
    repository: identity.repository, branch: identity.canonicalBranch,
    artifactSha256, outboxId: outbox.outboxId,
    exactParentHead: identity.exactParentHead, exactResultTree: identity.exactResultTree,
  };
  const claim = { item: { actionGrant: { actionId: action.actionId, missionId: action.missionId } } };
  const calls = [];
  const commitSha = 'd'.repeat(40);
  const forgeGithubApi = {
    async getMain() { return { sha: identity.exactParentHead, treeSha: identity.exactParentTree }; },
    async getBranch() { return null; },
    async listOpenPulls() { return []; },
    async createBlob() { calls.push('blob'); return { sha: blobSha }; },
    async createTree() { calls.push('tree'); return { sha: identity.exactResultTree }; },
    async createCommit() { calls.push('commit'); return { sha: commitSha }; },
    async createBranch() { calls.push('branch'); return { object: { sha: commitSha } }; },
    async getCommit() { return { sha: commitSha,
      tree: { sha: identity.exactResultTree }, parents: [{ sha: identity.exactParentHead }] }; },
    async createPullRequest(_, args) { calls.push('draft-pr'); assert.equal(args.draft, true);
      return { number: 3001, head: { sha: commitSha } }; },
  };
  return { workspaceRoot, privateKeyPath, publicKeyPath, action, claim, forgeGithubApi, calls };
}

test('granted Forge worker publishes exact preserved source as draft PR and blocks replay', async () => {
  const fx = await fixture();
  const opts = { sharedWorkspaceRoot: fx.workspaceRoot, privateKeyPath: fx.privateKeyPath,
    publicKeyPath: fx.publicKeyPath, forgeGithubApi: fx.forgeGithubApi, now: NOW };
  const published = await executeForgePublicationAction(fx.action, fx.claim, opts);
  assert.equal(published.ok, true, JSON.stringify(published));
  assert.equal(published.prNumber, 3001);
  assert.equal(published.mergeAuthority, false);
  assert.equal(published.forcePushAllowed, false);
  assert.deepEqual(fx.calls, ['blob', 'tree', 'commit', 'branch', 'draft-pr']);
  const replay = await executeForgePublicationAction(fx.action, fx.claim, opts);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'PUBLICATION_GRANT_ALREADY_USED_OR_UNAVAILABLE');
  assert.equal(fx.calls.filter((x) => x === 'branch').length, 1);
});

test('Forge publisher refuses execution without exact controller action grant', async () => {
  const fx = await fixture();
  await assert.rejects(
    executeForgePublicationAction(fx.action, { item: { actionGrant: { actionId: 'different' } } }, {}),
    /FORGE_PUBLICATION_CONTROLLER_GRANT_REQUIRED/,
  );
  assert.deepEqual(fx.calls, []);
});

test('Forge publisher rejects modified immutable artifact bytes before any GitHub writes', async () => {
  const fx = await fixture();
  const file = join(fx.workspaceRoot, 'source-artifacts', fx.action.artifactSha256 + '.json');
  const original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from(' ')]));
  const published = await executeForgePublicationAction(fx.action, fx.claim, {
    sharedWorkspaceRoot: fx.workspaceRoot, privateKeyPath: fx.privateKeyPath,
    publicKeyPath: fx.publicKeyPath, forgeGithubApi: fx.forgeGithubApi, now: NOW,
  });
  assert.equal(published.ok, false);
  assert.equal(published.reason, 'EXACT_ESCROW_OR_PARENT_INVALID');
  assert.deepEqual(fx.calls, []);
});
