import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile, readlink, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
  SOURCE_ARTIFACT_KIND,
} from '../../shared/agents/sourceArtifactEscrowContinuityV1.mjs';
import { buildSourceWorkerCompletionProofV1 } from '../../shared/agents/sourceWorkerCompletionProofV1.mjs';
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
function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, { cwd: options.cwd, env: options.env || process.env, encoding: 'utf8', shell: false, windowsHide: true });
}
function requiredGitText(result, label) {
  const value = text(result?.stdout).toLowerCase();
  if (result?.error || result?.status !== 0 || !value) throw new Error(`${label} failed: ${result?.error?.message || result?.stderr || `exit ${result?.status}`}`);
  return value;
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
    if (afterBlobSha !== ZERO_SHA || bytes.length !== 0 || digest !== sha256(bytes)) return { ok: false, reason: 'SOURCE_ARTIFACT_DELETION_INVALID' };
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

function stagedEntry(run, worktreePath, indexEnv, path) {
  const result = run('git.exe', ['-C', worktreePath, 'ls-files', '--stage', '--', path], { cwd: worktreePath, env: indexEnv });
  if (result.error || result.status !== 0) throw new Error(`Staged file inspection failed for ${path}.`);
  const line = String(result.stdout || '').split(/\r?\n/).find(Boolean) || '';
  if (!line) return { mode: '', blobSha: ZERO_SHA, deleted: true };
  const match = /^(100644|100755|120000) ([0-9a-f]{40}) [0-3]\t/.exec(line);
  if (!match) throw new Error(`Unsupported staged source identity for ${path}.`);
  return { mode: match[1], blobSha: match[2], deleted: false };
}

async function sourceArtifactIdentityFromWorktree(action, execution, claim, options = {}) {
  const worktreePath = resolve(text(action?.worktreePath));
  const changedPaths = (Array.isArray(execution?.changedFiles) ? execution.changedFiles : []).map(safePath).filter(Boolean).sort();
  if (!worktreePath || !changedPaths.length || changedPaths.length !== execution.changedFiles.length || new Set(changedPaths).size !== changedPaths.length) throw new Error('SOURCE_ARTIFACT_CHANGED_FILE_SET_INVALID');
  const run = options.runCommand || defaultRun;
  const env = options.env || process.env;
  const exactParentHead = requiredGitText(run('git.exe', ['-C', worktreePath, 'rev-parse', 'HEAD'], { cwd: worktreePath, env }), 'Source parent HEAD inspection');
  const exactParentTree = requiredGitText(run('git.exe', ['-C', worktreePath, 'rev-parse', 'HEAD^{tree}'], { cwd: worktreePath, env }), 'Source parent tree inspection');
  const grantHead = text(options.actionGrant?.headSha || options.actionGrant?.sourceRevision).toLowerCase();
  if (grantHead && grantHead !== exactParentHead) throw new Error('SOURCE_ARTIFACT_PARENT_HEAD_GRANT_MISMATCH');

  const indexPath = `${claim.processingPath}.source-artifact-index`;
  await rm(indexPath, { force: true });
  const indexEnv = { ...env, GIT_INDEX_FILE: indexPath };
  try {
    for (const [args, label] of [
      [['-C', worktreePath, 'read-tree', 'HEAD'], 'Source artifact read-tree'],
      [['-C', worktreePath, 'add', '-A', '--', ...changedPaths], 'Source artifact staged capture'],
    ]) {
      const result = run('git.exe', args, { cwd: worktreePath, env: indexEnv });
      if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
    }
    const diffCheck = run('git.exe', ['-C', worktreePath, 'diff', '--cached', '--check', 'HEAD', '--'], { cwd: worktreePath, env: indexEnv });
    if (diffCheck.error || diffCheck.status !== 0) throw new Error('SOURCE_ARTIFACT_DIFF_CHECK_FAILED');
    const exactResultTree = requiredGitText(run('git.exe', ['-C', worktreePath, 'write-tree'], { cwd: worktreePath, env: indexEnv }), 'Source result tree inspection');
    const changedFiles = [];
    const artifactFiles = [];
    for (const path of changedPaths) {
      const before = run('git.exe', ['-C', worktreePath, 'rev-parse', `HEAD:${path}`], { cwd: worktreePath, env });
      const beforeBlobSha = before.error || before.status !== 0 ? ZERO_SHA : text(before.stdout).toLowerCase();
      const staged = stagedEntry(run, worktreePath, indexEnv, path);
      let bytes = Buffer.alloc(0);
      if (!staged.deleted) {
        const absolutePath = resolve(worktreePath, path);
        if (!within(worktreePath, absolutePath)) throw new Error('SOURCE_ARTIFACT_PATH_ESCAPE_BLOCKED');
        bytes = staged.mode === '120000' ? Buffer.from(await readlink(absolutePath), 'utf8') : await readFile(absolutePath);
        if (gitBlobSha(bytes) !== staged.blobSha) throw new Error(`SOURCE_ARTIFACT_BLOB_CONTENT_MISMATCH:${path}`);
      }
      const digest = sha256(bytes);
      const identity = Object.freeze({ path, beforeBlobSha, afterBlobSha: staged.blobSha, sha256: digest });
      changedFiles.push(identity);
      artifactFiles.push(Object.freeze({ ...identity, mode: staged.mode, deleted: staged.deleted, contentBase64: bytes.toString('base64') }));
    }
    const grant = options.actionGrant || {};
    const hasPrBinding = Object.hasOwn(grant, 'prNumber');
    const canonicalPrValue = hasPrBinding ? (grant.prNumber === null ? null : positiveInteger(grant.prNumber)) : undefined;
    return Object.freeze({
      missionId: text(action.missionId),
      actionId: text(action.actionId),
      repository: text(action.repository),
      canonicalIssue: positiveInteger(grant.issueNumber),
      canonicalPr: canonicalPrValue,
      canonicalBranch: text(action.branch),
      exactParentHead,
      exactParentTree,
      exactResultTree,
      executorIdentity: `mission-worker:${text(action.adapter, 'codex')}:${text(execution.resultId, action.actionId)}`,
      changedFiles: Object.freeze(changedFiles),
      artifactFiles: Object.freeze(artifactFiles),
    });
  } finally {
    await rm(indexPath, { force: true });
  }
}

export async function finalizeSourceArtifactEscrowFromWorktreeV1(action, execution, claim, options = {}) {
  if (execution?.success !== true || !Array.isArray(execution.changedFiles) || execution.changedFiles.length === 0) return execution;
  const identity = await sourceArtifactIdentityFromWorktree(action, execution, claim, options);
  const persist = typeof options.persistSourceArtifactEscrow === 'function'
    ? options.persistSourceArtifactEscrow
    : (input) => persistSourceArtifactEscrowV1(input, {
      env: options.env || process.env,
      sharedWorkspaceRoot: options.sharedWorkspaceRoot,
      repoRoot: options.repoRoot || process.cwd(),
    });
  const completion = await buildSourceWorkerCompletionProofV1({
    ...identity,
    success: true,
    worktreePath: action.worktreePath,
    requiredTests: action.requiredTests || [],
    evidenceReceipts: execution.sourceTestReceipts || [],
    completedAt: execution.completedAt,
    commitMessage: text(options.commitMessage) || `Complete ${action.missionId}`,
    persistSourceArtifactEscrow: persist,
  });
  return Object.freeze({
    ...execution,
    stage: completion.testsPassed ? 'TESTED' : 'SOURCE_CHANGED',
    testsPassed: completion.testsPassed === true,
    sourceArtifactEscrow: completion.sourceArtifactEscrow || null,
    sourceArtifactIdentity: identity,
    completionProofVerdict: completion.finalVerdict,
  });
}
