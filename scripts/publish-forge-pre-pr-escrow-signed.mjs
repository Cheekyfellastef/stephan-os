#!/usr/bin/env node
// Single-use signed, exact-tree Forge publication. No local Git mutations.
// An existing authorised controller must supply the signed operation grant.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { publishForgePrePrToGitHub } from '../stephanos-server/services/forgePrePrGitHubPublisherService.js';

function runGh(method, path, body, { allow404 = false } = {}) {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json'];
  if (body !== undefined) args.push('--input', '-');
  const result = spawnSync('gh', args, {
    encoding: 'utf8', shell: false, windowsHide: true,
    input: body === undefined ? undefined : JSON.stringify(body),
    maxBuffer: 8 * 1024 * 1024,
  });
  if (allow404 && result.status !== 0 && /\bHTTP 404\b/.test(result.stderr || '')) return null;
  if (result.error || result.status !== 0)
    throw new Error('GITHUB_API_REQUEST_FAILED:' + method + ':' + result.status);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('GITHUB_API_RESPONSE_NOT_JSON'); }
}
const pathFor = (repository, suffix) => {
  if (repository !== 'Cheekyfellastef/stephan-os') throw new Error('NONCANONICAL_REPOSITORY');
  return '/repos/' + repository + suffix;
};
const githubApi = {
  async getMain(repository) {
    const ref = runGh('GET', pathFor(repository, '/git/ref/heads/main'));
    const commit = runGh('GET', pathFor(repository, '/git/commits/' + ref.object.sha));
    return { sha: ref.object.sha, treeSha: commit.tree.sha };
  },
  async getBranch(repository, branch) {
    return runGh('GET', pathFor(repository, '/git/ref/heads/' + encodeURIComponent(branch)), undefined, { allow404: true });
  },
  async listOpenPulls(repository, branch) {
    const query = '?state=open&base=main&head=' + encodeURIComponent('Cheekyfellastef:' + branch);
    return runGh('GET', pathFor(repository, '/pulls' + query));
  },
  async createBlob(repository, payload) {
    return runGh('POST', pathFor(repository, '/git/blobs'), payload);
  },
  async createTree(repository, payload) {
    return runGh('POST', pathFor(repository, '/git/trees'), payload);
  },
  async createCommit(repository, payload) {
    return runGh('POST', pathFor(repository, '/git/commits'), payload);
  },
  async createBranch(repository, payload) {
    return runGh('POST', pathFor(repository, '/git/refs'), payload);
  },
  async getCommit(repository, commitSha) {
    return runGh('GET', pathFor(repository, '/git/commits/' + commitSha));
  },
  async createPullRequest(repository, payload) {
    return runGh('POST', pathFor(repository, '/pulls'), payload);
  },
};

async function main() {
  const [outboxPath, authorizationPath, publicKeyPath, receiptRoot] = process.argv.slice(2);
  if (![outboxPath, authorizationPath, publicKeyPath, receiptRoot].every(Boolean))
    throw new Error('USAGE: node scripts/publish-forge-pre-pr-escrow-signed.mjs <outbox.json> <signed-grant.json> <public-key.pem> <receipt-root>');
  const outbox = JSON.parse(await readFile(resolve(outboxPath), 'utf8'));
  if (outbox.schemaVersion !== 'stephanos.offline-publication-outbox.v1'
      || !/^[0-9a-f]{64}$/.test(outbox.completeArtifactSha256)
      || outbox.artifactRef !== 'shared-workspace://source-artifacts/' + outbox.completeArtifactSha256 + '.json')
    throw new Error('OUTBOX_ARTIFACT_REFERENCE_INVALID');
  const workspaceRoot = resolve(
    process.env.STEPHANOS_SHARED_WORKSPACE_ROOT
      || join(homedir(), 'Documents', 'Stephanos-openclaw-workspace'),
  );
  const bundleBytes = await readFile(join(workspaceRoot, 'source-artifacts', outbox.completeArtifactSha256 + '.json'));
  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  // The original escrow projection has expiry/authority fields not carried in
  // the immutable bundle. The matching outbox is the only accepted link.
  // A separately grounded escrow receipt is mandatory; never synthesize one.
  const escrowPath = resolve(outboxPath + '.escrow.json');
  const escrow = JSON.parse(await readFile(escrowPath, 'utf8'));
  const authorization = JSON.parse(await readFile(resolve(authorizationPath), 'utf8'));
  const publicKeyPem = await readFile(resolve(publicKeyPath), 'utf8');
  if (bundle.missionId !== escrow.missionId) throw new Error('ESCROW_BUNDLE_MISSION_MISMATCH');
  const result = await publishForgePrePrToGitHub({
    escrow, outbox, bundleBytes, authorization, publicKeyPem, receiptRoot: resolve(receiptRoot),
    githubApi,
  });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 2;
}
main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false, reason: String(error?.message || error),
    finalVerdict: 'FORGE_PRE_PR_GITHUB_PUBLICATION_BLOCKED',
    mergeAuthority: false, forcePushAllowed: false,
  }) + '\n');
  process.exitCode = 2;
});
