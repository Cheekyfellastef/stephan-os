import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { resolveSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { captureSourceArtifactIdentityFromWorktreeV1 } from './sourceArtifactEscrowStore.js';

export const PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA =
  'stephanos.provider-neutral-source-mutation-checkpoint.v2';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,160}$/i;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const ADAPTERS = new Set(['foundry-forge', 'chatgpt-github']);
const MAX_PATCH_BYTES = 4 * 1024 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function safeChangedPaths(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const paths = [...new Set(value.map(normalizePath).filter(Boolean))].sort();
  if (paths.length !== value.length || paths.some((path) => !SAFE_PATH.test(path))) return null;
  return Object.freeze(paths);
}

function runtimeRoot(options = {}) {
  const runtime = resolveSharedWorkspaceRuntimeConfig({
    env: options.env || process.env,
    root: options.sharedWorkspaceRoot,
    repoRoot: options.repoRoot || process.cwd(),
  });
  return runtime?.ok === true ? runtime.root : '';
}

function keyFor(missionId, actionId) {
  return sha256(Buffer.from(`${text(missionId).toLowerCase()}\n${text(actionId).toLowerCase()}`, 'utf8')).slice(0, 40);
}

function pathsFor(root, missionId, actionId) {
  const directory = resolve(root, 'source-mutation-checkpoints-v2');
  const key = keyFor(missionId, actionId);
  const recordPath = resolve(directory, `${key}.json`);
  const patchPath = resolve(directory, `${key}.patch`);
  if (!within(root, directory) || !within(directory, recordPath) || !within(directory, patchPath)) return null;
  return Object.freeze({ directory, key, recordPath, patchPath });
}

function fixedGit(run, worktreePath, args, label, env) {
  const result = run('git.exe', ['-C', worktreePath, ...args], { cwd: worktreePath, env });
  if (result?.error || result?.status !== 0) {
    return Object.freeze({
      ok: false,
      reason: `PROVIDER_NEUTRAL_MUTATION_V2_GIT_FAILED:${label}`,
      detail: text(result?.stderr || result?.stdout || result?.error?.message),
    });
  }
  return Object.freeze({ ok: true, stdout: String(result?.stdout || '') });
}

function preparedRecord(input = {}) {
  const changedPaths = safeChangedPaths(input.changedPaths);
  const record = {
    schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_V2_SCHEMA,
    missionId: text(input.missionId).toLowerCase(),
    actionId: text(input.actionId).toLowerCase(),
    adapter: text(input.adapter).toLowerCase(),
    repository: text(input.repository),
    branch: text(input.branch),
    exactParentHead: text(input.exactParentHead).toLowerCase(),
    exactParentTree: text(input.exactParentTree).toLowerCase(),
    exactResultTree: text(input.exactResultTree).toLowerCase(),
    patchSha256: text(input.patchSha256).toLowerCase(),
    patchByteLength: Number(input.patchByteLength),
    changedPaths,
    createdAtUtc: text(input.createdAtUtc),
    publicationPhase: 'PRE_APPLY',
    providerReplayAllowed: false,
    sourceMutationReplayAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
  };
  if (
    !SAFE_ID.test(record.missionId)
    || !SAFE_ID.test(record.actionId)
    || !ADAPTERS.has(record.adapter)
    || record.repository !== 'Cheekyfellastef/stephan-os'
    || !record.branch
    || !SHA40.test(record.exactParentHead)
    || !SHA40.test(record.exactParentTree)
    || !SHA40.test(record.exactResultTree)
    || record.exactParentTree === record.exactResultTree
    || !SHA256.test(record.patchSha256)
    || !Number.isSafeInteger(record.patchByteLength)
    || record.patchByteLength < 1
    || record.patchByteLength > MAX_PATCH_BYTES
    || !record.changedPaths
    || !Number.isFinite(Date.parse(record.createdAtUtc))
  ) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_RECORD_INVALID' });

  const fingerprintPayload = {
    schemaVersion: record.schemaVersion,
    missionId: record.missionId,
    actionId: record.actionId,
    adapter: record.adapter,
    repository: record.repository,
    branch: record.branch,
    exactParentHead: record.exactParentHead,
    exactParentTree: record.exactParentTree,
    exactResultTree: record.exactResultTree,
    patchSha256: record.patchSha256,
    patchByteLength: record.patchByteLength,
    changedPaths: record.changedPaths,
  };
  const fingerprint = sha256(Buffer.from(JSON.stringify(fingerprintPayload), 'utf8'));
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      ...record,
      checkpointId: `provider-neutral-mutation-v2-${fingerprint.slice(0, 32)}`,
      fingerprint,
    }),
  });
}

function semanticallySame(left, right) {
  return text(left?.fingerprint).toLowerCase() === text(right?.fingerprint).toLowerCase()
    && text(left?.missionId).toLowerCase() === text(right?.missionId).toLowerCase()
    && text(left?.actionId).toLowerCase() === text(right?.actionId).toLowerCase();
}

async function verifyPatchFile(path, expectedHash, expectedBytes) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_MISSING'
        : 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_READ_FAILED',
    });
  }
  if (bytes.length !== expectedBytes || sha256(bytes) !== expectedHash) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_IDENTITY_MISMATCH' });
  }
  return Object.freeze({ ok: true, bytes });
}

async function persistPreparedRecord(record, sourcePatchPath, options = {}) {
  const root = runtimeRoot(options);
  if (!root) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_WORKSPACE_REQUIRED' });
  const paths = pathsFor(root, record.missionId, record.actionId);
  if (!paths) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATH_INVALID' });
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });

  const sourcePatch = await readFile(sourcePatchPath);
  if (sourcePatch.length !== record.patchByteLength || sha256(sourcePatch) !== record.patchSha256) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_SOURCE_PATCH_CHANGED' });
  }

  try {
    await copyFile(sourcePatchPath, paths.patchPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingPatch = await verifyPatchFile(paths.patchPath, record.patchSha256, record.patchByteLength);
    if (!existingPatch.ok) return existingPatch;
  }
  const durablePatch = await verifyPatchFile(paths.patchPath, record.patchSha256, record.patchByteLength);
  if (!durablePatch.ok) return durablePatch;

  const payload = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
  const tempRecordPath = resolve(paths.directory, `.${paths.key}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tempRecordPath, payload, { flag: 'wx', mode: 0o600 });
  try {
    try {
      await copyFile(tempRecordPath, paths.recordPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing;
      try {
        existing = JSON.parse(await readFile(paths.recordPath, 'utf8'));
      } catch {
        return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_EXISTING_RECORD_INVALID' });
      }
      if (!semanticallySame(existing, record)) {
        return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_CONFLICT' });
      }
      const existingPatch = await verifyPatchFile(paths.patchPath, record.patchSha256, record.patchByteLength);
      if (!existingPatch.ok) return existingPatch;
      return Object.freeze({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_MUTATION_V2_IDEMPOTENT',
        checkpoint: Object.freeze(existing),
        checkpointPath: paths.recordPath,
        durablePatchPath: paths.patchPath,
      });
    }
  } finally {
    await unlink(tempRecordPath).catch(() => {});
  }

  const readback = await readFile(paths.recordPath);
  if (!readback.equals(payload)) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_RECORD_READBACK_MISMATCH' });
  }
  return Object.freeze({
    ok: true,
    reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PREPARED',
    checkpoint: record,
    checkpointPath: paths.recordPath,
    durablePatchPath: paths.patchPath,
  });
}

export async function prepareProviderNeutralSourceMutationCheckpointV2(input = {}, options = {}) {
  const action = input.action || {};
  const claim = input.claim || {};
  const patchPath = text(input.patchPath);
  const run = options.runCommand;
  const worktreePath = text(action.worktreePath);
  if (!patchPath || !worktreePath || !isAbsolute(worktreePath) || typeof run !== 'function') {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PREPARE_RUNTIME_REQUIRED' });
  }

  const patchBytes = await readFile(patchPath);
  if (patchBytes.length < 1 || patchBytes.length > MAX_PATCH_BYTES) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_SIZE_INVALID' });
  }
  const patchSha256 = sha256(patchBytes);
  const env = options.env || process.env;
  const resolvedWorktree = resolve(worktreePath);

  const parentHeadProbe = fixedGit(run, resolvedWorktree, ['rev-parse', 'HEAD'], 'PARENT_HEAD', env);
  const parentTreeProbe = fixedGit(run, resolvedWorktree, ['rev-parse', 'HEAD^{tree}'], 'PARENT_TREE', env);
  if (!parentHeadProbe.ok) return parentHeadProbe;
  if (!parentTreeProbe.ok) return parentTreeProbe;
  const exactParentHead = text(parentHeadProbe.stdout).toLowerCase();
  const exactParentTree = text(parentTreeProbe.stdout).toLowerCase();
  const grantHead = text(claim?.item?.actionGrant?.headSha || claim?.item?.actionGrant?.sourceRevision).toLowerCase();
  const bindingHead = text(claim?.item?.executionBinding?.headSha || claim?.item?.executionBinding?.sourceRevision).toLowerCase();
  if (!SHA40.test(exactParentHead) || !SHA40.test(exactParentTree) || grantHead !== exactParentHead || bindingHead !== exactParentHead) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PARENT_BINDING_MISMATCH' });
  }

  const root = runtimeRoot(options);
  if (!root) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_WORKSPACE_REQUIRED' });
  const tempIndex = resolve(root, `.provider-neutral-plan-index-${process.pid}-${randomUUID()}`);
  const indexEnv = { ...env, GIT_INDEX_FILE: tempIndex };
  try {
    for (const [args, label] of [
      [['read-tree', 'HEAD'], 'READ_TREE'],
      [['apply', '--cached', '--check', '--whitespace=error-all', patchPath], 'PATCH_CHECK'],
      [['apply', '--cached', '--whitespace=error-all', patchPath], 'PATCH_APPLY_INDEX'],
    ]) {
      const result = fixedGit(run, resolvedWorktree, args, label, indexEnv);
      if (!result.ok) return result;
    }
    const changedProbe = fixedGit(run, resolvedWorktree, ['diff', '--cached', '--name-only', 'HEAD', '--'], 'CHANGED_PATHS', indexEnv);
    const treeProbe = fixedGit(run, resolvedWorktree, ['write-tree'], 'RESULT_TREE', indexEnv);
    if (!changedProbe.ok) return changedProbe;
    if (!treeProbe.ok) return treeProbe;
    const changedPaths = safeChangedPaths(String(changedProbe.stdout || '').split(/\r?\n/).map(normalizePath).filter(Boolean));
    const exactResultTree = text(treeProbe.stdout).toLowerCase();
    if (!changedPaths || !SHA40.test(exactResultTree) || exactResultTree === exactParentTree) {
      return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_EXPECTED_TREE_INVALID' });
    }

    const prepared = preparedRecord({
      missionId: action.missionId || claim?.item?.missionId,
      actionId: action.actionId || claim?.item?.actionId,
      adapter: claim.adapter || action.adapter || claim?.item?.adapter,
      repository: action.repository || claim?.item?.actionGrant?.repository,
      branch: action.branch || claim?.item?.actionGrant?.branch,
      exactParentHead,
      exactParentTree,
      exactResultTree,
      patchSha256,
      patchByteLength: patchBytes.length,
      changedPaths,
      createdAtUtc: input.createdAtUtc || (options.now instanceof Date ? options.now.toISOString() : new Date().toISOString()),
    });
    if (!prepared.ok) return prepared;
    return persistPreparedRecord(prepared.record, patchPath, options);
  } finally {
    await rm(tempIndex, { force: true });
  }
}

export async function readProviderNeutralSourceMutationCheckpointV2(missionId, actionId, options = {}) {
  const root = runtimeRoot(options);
  if (!root) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_WORKSPACE_REQUIRED' });
  const paths = pathsFor(root, missionId, actionId);
  if (!paths) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATH_INVALID' });
  let record;
  try {
    record = JSON.parse(await readFile(paths.recordPath, 'utf8'));
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'PROVIDER_NEUTRAL_MUTATION_V2_MISSING'
        : 'PROVIDER_NEUTRAL_MUTATION_V2_READ_FAILED',
    });
  }
  const prepared = preparedRecord(record);
  if (!prepared.ok || !semanticallySame(prepared.record, record)) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_RECORD_INVALID' });
  }
  const patch = await verifyPatchFile(paths.patchPath, record.patchSha256, record.patchByteLength);
  if (!patch.ok) return patch;
  return Object.freeze({
    ok: true,
    reason: 'PROVIDER_NEUTRAL_MUTATION_V2_READ',
    checkpoint: Object.freeze(record),
    checkpointPath: paths.recordPath,
    durablePatchPath: paths.patchPath,
  });
}

function actualChangedPaths(run, worktreePath, env) {
  const tracked = fixedGit(run, worktreePath, ['diff', '--name-only', 'HEAD', '--'], 'TRACKED', env);
  const untracked = fixedGit(run, worktreePath, ['ls-files', '--others', '--exclude-standard'], 'UNTRACKED', env);
  if (!tracked.ok) return tracked;
  if (!untracked.ok) return untracked;
  const paths = safeChangedPaths(`${tracked.stdout}\n${untracked.stdout}`
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean));
  if (!paths) {
    const none = !String(tracked.stdout || '').trim() && !String(untracked.stdout || '').trim();
    return none
      ? Object.freeze({ ok: true, paths: Object.freeze([]) })
      : Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_CHANGED_SET_INVALID' });
  }
  return Object.freeze({ ok: true, paths });
}

export async function inspectProviderNeutralSourceMutationCheckpointV2Recovery(input = {}, options = {}) {
  const item = input.item || input.claim?.item || {};
  const action = item?.payload || {};
  const missionId = text(item?.missionId || action?.missionId).toLowerCase();
  const actionId = text(item?.actionId || action?.actionId).toLowerCase();
  const adapter = text(input.adapter || item?.adapter || action?.adapter).toLowerCase();
  const receiptState = text(input.latestReceipt?.state || input.receiptState).toLowerCase();
  if (!ADAPTERS.has(adapter) || !['started', 'progress'].includes(receiptState)) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_RECOVERY_UNSUPPORTED' });
  }

  const read = options.readMutationCheckpointV2 || readProviderNeutralSourceMutationCheckpointV2;
  const loaded = await read(missionId, actionId, options);
  if (loaded?.ok !== true) return Object.freeze({ allowed: false, reason: loaded?.reason || 'PROVIDER_NEUTRAL_MUTATION_V2_MISSING' });
  const checkpoint = loaded.checkpoint;
  if (
    checkpoint.adapter !== adapter
    || text(item?.actionGrant?.headSha || item?.actionGrant?.sourceRevision).toLowerCase() !== checkpoint.exactParentHead
    || text(item?.executionBinding?.headSha || item?.executionBinding?.sourceRevision).toLowerCase() !== checkpoint.exactParentHead
  ) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_BINDING_MISMATCH' });
  }

  const worktreePath = text(action.worktreePath);
  const run = options.runCommand;
  if (!worktreePath || !isAbsolute(worktreePath) || typeof run !== 'function') {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_RECOVERY_RUNTIME_REQUIRED' });
  }
  const env = options.env || process.env;
  const resolvedWorktree = resolve(worktreePath);
  const headProbe = fixedGit(run, resolvedWorktree, ['rev-parse', 'HEAD'], 'RECOVERY_HEAD', env);
  const treeProbe = fixedGit(run, resolvedWorktree, ['rev-parse', 'HEAD^{tree}'], 'RECOVERY_PARENT_TREE', env);
  if (!headProbe.ok) return Object.freeze({ allowed: false, reason: headProbe.reason });
  if (!treeProbe.ok) return Object.freeze({ allowed: false, reason: treeProbe.reason });
  if (text(headProbe.stdout).toLowerCase() !== checkpoint.exactParentHead || text(treeProbe.stdout).toLowerCase() !== checkpoint.exactParentTree) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PARENT_DRIFT' });
  }

  const changed = actualChangedPaths(run, resolvedWorktree, env);
  if (!changed.ok) return Object.freeze({ allowed: false, reason: changed.reason });
  if (changed.paths.length === 0) {
    const patchCheck = fixedGit(
      run,
      resolvedWorktree,
      ['apply', '--check', '--whitespace=error-all', loaded.durablePatchPath],
      'RECOVERY_PREPARED_PATCH_CHECK',
      env,
    );
    if (!patchCheck.ok) return Object.freeze({ allowed: false, reason: patchCheck.reason });
    return Object.freeze({
      allowed: true,
      reason: 'PROVIDER_NEUTRAL_MUTATION_V2_PATCH_PREPARED',
      resumeStage: 'PATCH_PREPARED',
      providerReplayMayOccur: false,
      sourceMutationReplayAllowed: false,
      expectedHead: checkpoint.exactParentHead,
      expectedResultTree: checkpoint.exactResultTree,
      changedFiles: checkpoint.changedPaths,
      durablePatchPath: loaded.durablePatchPath,
      checkpoint,
    });
  }

  if (JSON.stringify(changed.paths) !== JSON.stringify(checkpoint.changedPaths)) {
    return Object.freeze({
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_V2_CHANGED_SET_MISMATCH',
      expectedPaths: checkpoint.changedPaths,
      observedPaths: changed.paths,
    });
  }

  let identity;
  try {
    identity = await captureSourceArtifactIdentityFromWorktreeV1(
      action,
      {
        success: true,
        changedFiles: [...changed.paths],
        resultId: actionId,
        completedAt: checkpoint.createdAtUtc,
      },
      {
        item,
        processingPath: input.processingPath || input.claim?.processingPath || '',
      },
      {
        ...options,
        actionGrant: item.actionGrant,
      },
    );
  } catch (error) {
    return Object.freeze({
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_V2_IDENTITY_REBUILD_FAILED',
      detail: text(error?.message),
    });
  }
  if (
    text(identity?.exactParentHead).toLowerCase() !== checkpoint.exactParentHead
    || text(identity?.exactParentTree).toLowerCase() !== checkpoint.exactParentTree
    || text(identity?.exactResultTree).toLowerCase() !== checkpoint.exactResultTree
    || JSON.stringify((identity?.changedFiles || []).map((entry) => entry.path).sort()) !== JSON.stringify(checkpoint.changedPaths)
  ) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_V2_WORKTREE_MISMATCH' });
  }

  return Object.freeze({
    allowed: true,
    reason: 'PROVIDER_NEUTRAL_MUTATION_V2_SOURCE_CHANGED',
    resumeStage: 'SOURCE_CHANGED',
    providerReplayMayOccur: false,
    sourceMutationReplayAllowed: false,
    expectedHead: checkpoint.exactParentHead,
    expectedResultTree: checkpoint.exactResultTree,
    changedFiles: checkpoint.changedPaths,
    durablePatchPath: loaded.durablePatchPath,
    checkpoint,
  });
}
