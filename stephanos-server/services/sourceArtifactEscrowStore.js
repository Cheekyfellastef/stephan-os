import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
  SOURCE_ARTIFACT_KIND,
} from '../../shared/agents/sourceArtifactEscrowContinuityV1.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const SOURCE_ARTIFACT_COMPLETE_FILE_BUNDLE_V1_SCHEMA = 'stephanos.source-artifact-complete-file-bundle.v1';
export const SOURCE_ARTIFACT_ESCROW_MAX_BYTES = 2 * 1024 * 1024;

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ZERO_SHA = '0'.repeat(40);
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const FORBIDDEN_PATH = /(^|\/)(?:\.git|node_modules|runtime|runtime-data|stephanos-server\/data)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i;

function text(value) { return String(value ?? '').trim(); }
function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function gitBlobSha(bytes) {
  const prefix = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(prefix).update(bytes).digest('hex');
}
function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}
function safePath(value) {
  const normalized = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  return SAFE_PATH.test(normalized) && !FORBIDDEN_PATH.test(normalized) ? normalized : '';
}
function exactIso(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}
function canonicalPr(value) {
  if (value === null) return null;
  return positiveInteger(value);
}

function validateArtifactFile(file = {}, changedFile = {}) {
  const path = safePath(file.path);
  const beforeBlobSha = text(file.beforeBlobSha).toLowerCase();
  const afterBlobSha = text(file.afterBlobSha).toLowerCase();
  const digest = text(file.sha256).toLowerCase();
  const mode = text(file.mode);
  const deleted = file.deleted === true;
  if (!path || path !== safePath(changedFile.path)) return { ok: false, reason: 'SOURCE_ARTIFACT_FILE_PATH_INVALID' };
  if (!SHA40.test(beforeBlobSha) || !SHA40.test(afterBlobSha) || !SHA256.test(digest)) return { ok: false, reason: 'SOURCE_ARTIFACT_FILE_IDENTITY_INVALID' };
  if (beforeBlobSha !== text(changedFile.beforeBlobSha).toLowerCase()
      || afterBlobSha !== text(changedFile.afterBlobSha).toLowerCase()
      || digest !== text(changedFile.sha256).toLowerCase()) return { ok: false, reason: 'SOURCE_ARTIFACT_FILE_IDENTITY_MISMATCH' };
  let bytes;
  try { bytes = Buffer.from(text(file.contentBase64), 'base64'); }
  catch { return { ok: false, reason: 'SOURCE_ARTIFACT_FILE_CONTENT_INVALID' }; }
  if (deleted) {
    if (afterBlobSha !== ZERO_SHA || bytes.length !== 0) return { ok: false, reason: 'SOURCE_ARTIFACT_DELETION_INVALID' };
  } else {
    if (!/^(100644|100755|120000)$/.test(mode)) return { ok: false, reason: 'SOURCE_ARTIFACT_FILE_MODE_INVALID' };
    if (sha256(bytes) !== digest || gitBlobSha(bytes) !== afterBlobSha) return { ok: false, reason: 'SOURCE_ARTIFACT_FILE_CONTENT_MISMATCH' };
  }
  return { ok: true, file: Object.freeze({ path, beforeBlobSha, afterBlobSha, sha256: digest, mode: deleted ? '' : mode, deleted, contentBase64: bytes.toString('base64') }), bytes: bytes.length };
}

function validatedBundleInput(input = {}) {
  const repository = text(input.repository);
  const canonicalIssue = positiveInteger(input.canonicalIssue);
  const prWasExplicitNull = input.canonicalPr === null;
  const pr = canonicalPr(input.canonicalPr);
  const canonicalBranch = text(input.canonicalBranch);
  const exactParentHead = text(input.exactParentHead).toLowerCase();
  const exactParentTree = text(input.exactParentTree).toLowerCase();
  const exactResultTree = text(input.exactResultTree).toLowerCase();
  const missionId = text(input.missionId);
  const actionId = text(input.actionId);
  const executorIdentity = text(input.executorIdentity);
  const completedAt = exactIso(input.completedAt);
  const commitMessage = text(input.commitMessage);
  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  const artifactFiles = Array.isArray(input.artifactFiles) ? input.artifactFiles : [];
  const requiredTests = Array.isArray(input.requiredTests) ? input.requiredTests.map(text).filter(Boolean) : [];
  const evidenceReceipts = Array.isArray(input.evidenceReceipts) ? input.evidenceReceipts : [];
  if (repository !== 'Cheekyfellastef/stephan-os' || !missionId || !actionId || !executorIdentity || !canonicalBranch || !commitMessage || !completedAt) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_IDENTITY_INVALID' };
  if (!SHA40.test(exactParentHead) || !SHA40.test(exactParentTree) || !SHA40.test(exactResultTree)) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_TREE_IDENTITY_INVALID' };
  if (!(pr || (prWasExplicitNull && canonicalIssue))) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_OWNER_INVALID' };
  if (!changedFiles.length || changedFiles.length !== artifactFiles.length || requiredTests.length === 0) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_CONTENT_REQUIRED' };
  const evidenceCommands = new Set(evidenceReceipts.filter((item) => item?.verified === true).map((item) => text(item.testCommand)).filter(Boolean));
  if (!requiredTests.every((command) => evidenceCommands.has(command))) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_TEST_PROOF_REQUIRED' };
  const byPath = new Map(artifactFiles.map((file) => [safePath(file?.path), file]));
  if (byPath.size !== artifactFiles.length || byPath.has('')) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_FILE_SET_INVALID' };
  const files = [];
  let byteLength = 0;
  for (const changed of changedFiles) {
    const path = safePath(changed?.path);
    const validation = validateArtifactFile(byPath.get(path), changed);
    if (!validation.ok) return validation;
    files.push(validation.file);
    byteLength += validation.bytes;
  }
  if (byteLength < 1 || byteLength > SOURCE_ARTIFACT_ESCROW_MAX_BYTES) return { ok: false, reason: 'SOURCE_ARTIFACT_ESCROW_SIZE_INVALID' };
  return {
    ok: true,
    bundle: Object.freeze({
      schemaVersion: SOURCE_ARTIFACT_COMPLETE_FILE_BUNDLE_V1_SCHEMA,
      repository,
      missionId,
      actionId,
      canonicalIssue,
      canonicalPr: prWasExplicitNull ? null : pr,
      canonicalBranch,
      exactParentHead,
      exactParentTree,
      exactResultTree,
      executorIdentity,
      commitMessage,
      completedAtUtc: completedAt,
      changedFiles: Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path))),
      testsRun: Object.freeze([...requiredTests]),
      testVerdicts: Object.freeze(requiredTests.map(() => 'PASS')),
      diffCheckVerdict: 'PASS',
    }),
  };
}

export async function persistSourceArtifactEscrowV1(input = {}, options = {}) {
  const prepared = validatedBundleInput(input);
  if (!prepared.ok) return null;
  const runtime = resolveSharedWorkspaceRuntimeConfig({ env: options.env || process.env, root: options.sharedWorkspaceRoot, repoRoot: options.repoRoot || process.cwd() });
  if (!runtime.ok) return null;
  const artifactRoot = resolve(runtime.root, 'source-artifacts');
  if (!within(runtime.root, artifactRoot)) return null;
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });

  const payload = Buffer.from(`${JSON.stringify(prepared.bundle, null, 2)}\n`, 'utf8');
  const completeArtifactSha256 = sha256(payload);
  const artifactName = `${completeArtifactSha256}.json`;
  const artifactPath = resolve(artifactRoot, artifactName);
  if (!within(artifactRoot, artifactPath)) return null;
  const tempPath = resolve(artifactRoot, `${artifactName}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, payload, { flag: 'wx', mode: 0o600 });
  try {
    try { await copyFile(tempPath, artifactPath, fsConstants.COPYFILE_EXCL); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  const readback = await readFile(artifactPath);
  if (sha256(readback) !== completeArtifactSha256 || !readback.equals(payload)) return null;

  const createdAtUtc = prepared.bundle.completedAtUtc;
  const expiresAtUtc = new Date(Date.parse(createdAtUtc) + 30 * 24 * 60 * 60 * 1000).toISOString();
  return Object.freeze({
    schemaVersion: SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
    artifactKind: SOURCE_ARTIFACT_KIND.COMPLETE_FILE_BUNDLE,
    missionId: prepared.bundle.missionId,
    actionId: prepared.bundle.actionId,
    repository: prepared.bundle.repository,
    canonicalIssue: prepared.bundle.canonicalIssue,
    canonicalPr: prepared.bundle.canonicalPr,
    canonicalBranch: prepared.bundle.canonicalBranch,
    exactParentHead: prepared.bundle.exactParentHead,
    exactParentTree: prepared.bundle.exactParentTree,
    exactResultTree: prepared.bundle.exactResultTree,
    localCommitSha: '',
    completeArtifactSha256,
    artifactRef: `shared-workspace://source-artifacts/${artifactName}`,
    externallyReadable: true,
    commitMessage: prepared.bundle.commitMessage,
    executorIdentity: prepared.bundle.executorIdentity,
    createdAtUtc,
    expiresAtUtc,
    changedFiles: Object.freeze(prepared.bundle.changedFiles.map(({ path, beforeBlobSha, afterBlobSha, sha256: digest }) => Object.freeze({ path, beforeBlobSha, afterBlobSha, sha256: digest }))),
    testsRun: prepared.bundle.testsRun,
    testVerdicts: prepared.bundle.testVerdicts,
    diffCheckVerdict: 'PASS',
  });
}
