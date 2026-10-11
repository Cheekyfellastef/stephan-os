import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildOfflinePublicationOutboxRecordV1 } from '../../shared/agents/offlinePublicationOutboxV1.mjs';
import { issueOpenClawGitHubAuthorization } from '../../shared/agents/openClawGitHubAuthorization.mjs';
import { publishForgePrePrToGitHub } from './forgePrePrGitHubPublisherService.js';

const NOW = '2026-10-08T07:30:00.000Z';
const sha = (data, type = 'sha256') => createHash(type).update(data).digest('hex');

function fixture() {
  const source = Buffer.from('export const valid = true;\n');
  const blobSha = sha(Buffer.concat([Buffer.from('blob ' + source.length + '\0'), source]), 'sha1');
  const info = {
    repository: 'Cheekyfellastef/stephan-os',
    missionId: 'critical-2732-elastic-goal',
    actionId: 'critical-2732-elastic-goal-r1-proof',
    canonicalIssue: 2732, canonicalPr: null, canonicalBranch: 'openclaw/elastic-goal-2732',
    exactParentHead: 'a'.repeat(40), exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40), executorIdentity: 'mission-worker:foundry-forge:test',
  };
  const file = { path: 'shared/agents/proof.mjs', beforeBlobSha: '0'.repeat(40),
    afterBlobSha: blobSha, sha256: sha(source) };
  const bundleBytes = Buffer.from(JSON.stringify({
    schemaVersion: 'stephanos.source-artifact-complete-file-bundle.v1',
    ...info, changedFiles: [{ ...file, mode: '100644', deleted: false,
      contentBase64: source.toString('base64') }],
    testsRun: ['node --test proof.test.mjs'], testVerdicts: ['PASS'],
    diffCheckVerdict: 'PASS',
  }, null, 2) + '\n');
  const escrow = {
    schemaVersion: 'stephanos.source-artifact-escrow.v1', artifactKind: 'COMPLETE_FILE_BUNDLE',
    ...info, localCommitSha: '', completeArtifactSha256: sha(bundleBytes),
    artifactRef: 'shared-workspace://source-artifacts/' + sha(bundleBytes) + '.json',
    externallyReadable: true, commitMessage: 'Forge verified source',
    createdAtUtc: NOW, expiresAtUtc: '2026-10-09T07:30:00.000Z',
    changedFiles: [file], testsRun: ['node --test proof.test.mjs'],
    testVerdicts: ['PASS'], diffCheckVerdict: 'PASS',
  };
  const outbox = buildOfflinePublicationOutboxRecordV1(escrow, { nowUtc: NOW }).record;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const claims = {
    authorizationId: 'forge-publish-test-1', missionId: info.missionId,
    operation: 'publish-forge-escrow', repository: info.repository, branch: info.canonicalBranch,
    issueNumber: 2732, parentHead: info.exactParentHead, resultTree: info.exactResultTree,
    mergeAuthority: false, forcePushAllowed: false, singleUse: true,
    issuedAt: '2026-10-08T07:29:00.000Z',
    expiresAt: '2026-10-08T07:40:00.000Z',
  };
  const authorization = issueOpenClawGitHubAuthorization(claims, privateKeyPem,
    { now: new Date(NOW) });
  const commitSha = 'd'.repeat(40);
  const calls = [];
  const githubApi = {
    async getMain() { calls.push('getMain'); return { sha: info.exactParentHead,
      treeSha: info.exactParentTree }; },
    async getBranch() { calls.push('getBranch'); return null; },
    async listOpenPulls() { calls.push('listOpenPulls'); return []; },
    async createBlob(_, input) { calls.push('createBlob'); assert.equal(input.encoding, 'base64');
      return { sha: blobSha }; },
    async createTree(_, input) { calls.push('createTree');
      assert.equal(input.base_tree, info.exactParentTree); return { sha: info.exactResultTree }; },
    async createCommit() { calls.push('createCommit'); return { sha: commitSha }; },
    async createBranch(_, input) { calls.push('createBranch');
      assert.equal(input.ref, 'refs/heads/' + info.canonicalBranch);
      return { object: { sha: commitSha } }; },
    async getCommit() { calls.push('getCommit'); return { sha: commitSha,
      tree: { sha: info.exactResultTree }, parents: [{ sha: info.exactParentHead }] }; },
    async createPullRequest(_, input) { calls.push('createPullRequest');
      assert.equal(input.draft, true); return { number: 3000, head: { sha: commitSha } }; },
  };
  return { escrow, outbox, bundleBytes, authorization, publicKeyPem,
    githubApi, nowUtc: NOW, calls };
}

test('signed exact-file escrow creates a draft PR, preserves branch and no-merge boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-publish-authority-'));
  try {
    const input = fixture();
    const result = await publishForgePrePrToGitHub({ ...input, receiptRoot: root });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.prNumber, 3000);
    assert.equal(result.draft, true);
    assert.equal(result.mergeAuthority, false);
    assert.equal(input.calls.at(-1), 'createPullRequest');
    const replay = await publishForgePrePrToGitHub({ ...input, receiptRoot: root });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, 'PUBLICATION_GRANT_ALREADY_USED_OR_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('mismatched signed grant is refused before mutations', async () => {
  const input = fixture();
  input.authorization.claims.resultTree = 'e'.repeat(40);
  const result = await publishForgePrePrToGitHub({ ...input, receiptRoot: '/unused' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SIGNED_PUBLICATION_GRANT_INVALID');
  assert.equal(input.calls.includes('createBlob'), false);
});

test('branch or base drift refuses publication without issuing branch', async () => {
  const input = fixture();
  input.githubApi.getMain = async () => ({ sha: 'e'.repeat(40), treeSha: 'b'.repeat(40) });
  const result = await publishForgePrePrToGitHub({ ...input, receiptRoot: '/unused' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'EXACT_ESCROW_OR_PARENT_INVALID');
  assert.equal(input.calls.includes('createBranch'), false);
});

test('wrong GitHub result tree blocks publication before commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-publish-tree-'));
  try {
    const input = fixture();
    input.githubApi.createTree = async () => ({ sha: 'e'.repeat(40) });
    const result = await publishForgePrePrToGitHub({ ...input, receiptRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'GITHUB_CREATED_TREE_HASH_MISMATCH');
    assert.equal(input.calls.includes('createCommit'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
