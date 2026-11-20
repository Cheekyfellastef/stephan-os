import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePatchEscrowBundleId } from '../shared/agents/codexPatchEscrow.mjs';
import {
  selectPatchEscrowFromComments,
  validatePatchEscrowPublishEvent,
} from './codex-patch-escrow-publisher.mjs';

export const PREPARED_PATCH_ESCROW_SCHEMA_VERSION = 'stephanos.codex.patch-escrow-prepared.v1';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function fail(message, details = undefined) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function githubRequest(path) {
  const token = text(process.env.GITHUB_TOKEN);
  const apiUrl = text(process.env.GITHUB_API_URL, 'https://api.github.com');
  if (!token) fail('GITHUB_TOKEN is required for tokened escrow preparation');
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) fail(`GitHub API GET ${path} failed with ${response.status}`, { status: response.status, payload });
  return payload;
}

async function fetchAllIssueComments(repository, issueNumber) {
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubRequest(`/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

export function buildPreparedPatchEscrow(input = {}) {
  const publishEvent = input.publishEvent || {};
  const selected = input.selected || {};
  const repositoryMetadata = input.repositoryMetadata || {};
  const currentBase = input.currentBase || {};
  const manifest = selected.manifest || {};
  const expectedBundleId = derivePatchEscrowBundleId(manifest.issueNumber, manifest.patchSha256);

  if (!selected.ok || !Buffer.isBuffer(selected.patch)) fail('verified patch escrow selection is required');
  if (!expectedBundleId || manifest.bundleId !== expectedBundleId) {
    fail('bundle ID is not bound to the manifest issue number and patch SHA-256', {
      expectedBundleId,
      actualBundleId: manifest.bundleId,
    });
  }
  if (manifest.issueNumber !== publishEvent.issueNumber) fail('manifest issue number does not match publish request issue');
  if (manifest.patchSha256 !== publishEvent.patchSha256) fail('manifest patch SHA-256 does not match owner publication authorization');
  if (repositoryMetadata.default_branch !== manifest.baseBranch) fail('manifest base branch does not match repository default branch');
  if (currentBase.sha !== manifest.baseSha) {
    fail('patch base is stale; rebuild or re-export against current main', {
      expectedBaseSha: manifest.baseSha,
      actualBaseSha: currentBase.sha,
    });
  }

  return Object.freeze({
    schemaVersion: PREPARED_PATCH_ESCROW_SCHEMA_VERSION,
    repository: publishEvent.repository,
    ownerLogin: publishEvent.ownerLogin,
    issueNumber: publishEvent.issueNumber,
    publishCommentId: publishEvent.commentId,
    authorizedPatchSha256: publishEvent.patchSha256,
    defaultBranch: repositoryMetadata.default_branch,
    currentBaseSha: currentBase.sha,
    bundleId: manifest.bundleId,
    manifest,
    patchBase64: selected.patch.toString('base64'),
    patchByteLength: selected.patch.length,
    patchSha256: manifest.patchSha256,
    manifestCommentId: selected.manifestCommentId,
    chunkCommentIds: selected.chunkCommentIds,
  });
}

export async function preparePatchEscrow(event, options = {}) {
  const publishEvent = validatePatchEscrowPublishEvent(event);
  if (!publishEvent.valid) fail(`publish event blocked: ${publishEvent.blockers.join(', ')}`, publishEvent);

  const comments = options.comments || await fetchAllIssueComments(publishEvent.repository, publishEvent.issueNumber);
  const selected = selectPatchEscrowFromComments(
    comments,
    publishEvent.bundleId,
    publishEvent.ownerLogin,
    publishEvent.patchSha256,
  );
  if (!selected.ok) fail(`patch escrow selection failed: ${selected.reason}`, selected);

  const repositoryMetadata = options.repositoryMetadata || await githubRequest(`/repos/${publishEvent.repository}`);
  const currentBase = options.currentBase || await githubRequest(
    `/repos/${publishEvent.repository}/commits/${encodeURIComponent(repositoryMetadata.default_branch)}`,
  );
  return buildPreparedPatchEscrow({ publishEvent, selected, repositoryMetadata, currentBase });
}

async function main() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  const outputPath = text(process.argv[2] || process.env.PATCH_ESCROW_PREPARED_PATH);
  if (!eventPath || !outputPath) fail('Usage: node scripts/codex-patch-escrow-prepare.mjs <prepared-output.json>');
  const event = JSON.parse(readFileSync(resolve(eventPath), 'utf8'));
  const prepared = await preparePatchEscrow(event);
  writeFileSync(resolve(outputPath), `${JSON.stringify(prepared, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    finalVerdict: 'PATCH_ESCROW_PREPARE_PASS',
    bundleId: prepared.bundleId,
    patchSha256: prepared.patchSha256,
    patchByteLength: prepared.patchByteLength,
    publishCommentId: prepared.publishCommentId,
    outputPath: resolve(outputPath),
  }, null, 2)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      finalVerdict: 'PATCH_ESCROW_PREPARE_BLOCKED',
      message: text(error.message, 'unknown error'),
      details: error.details,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
