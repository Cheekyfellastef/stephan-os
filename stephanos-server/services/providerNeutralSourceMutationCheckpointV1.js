import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { resolveSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { captureSourceArtifactIdentityFromWorktreeV1 } from './sourceArtifactEscrowStore.js';

export const PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_SCHEMA =
  'stephanos.provider-neutral-source-mutation-checkpoint.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,160}$/i;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const ADAPTERS = new Set(['foundry-forge', 'chatgpt-github']);
const ZERO_SHA = '0'.repeat(40);

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

function sortedChangedFiles(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const path = normalizePath(raw?.path);
    const beforeBlobSha = text(raw?.beforeBlobSha).toLowerCase();
    const afterBlobSha = text(raw?.afterBlobSha).toLowerCase();
    const digest = text(raw?.sha256).toLowerCase();
    if (
      !SAFE_PATH.test(path)
      || seen.has(path)
      || !SHA40.test(beforeBlobSha)
      || !SHA40.test(afterBlobSha)
      || !SHA256.test(digest)
    ) return null;
    seen.add(path);
    out.push(Object.freeze({ path, beforeBlobSha, afterBlobSha, sha256: digest }));
  }
  return Object.freeze(out.sort((a, b) => a.path.localeCompare(b.path)));
}

function fingerprintPayload(input = {}) {
  return {
    schemaVersion: PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_SCHEMA,
    missionId: text(input.missionId).toLowerCase(),
    actionId: text(input.actionId).toLowerCase(),
    adapter: text(input.adapter).toLowerCase(),
    repository: text(input.repository),
    branch: text(input.branch),
    exactParentHead: text(input.exactParentHead).toLowerCase(),
    exactParentTree: text(input.exactParentTree).toLowerCase(),
    exactResultTree: text(input.exactResultTree).toLowerCase(),
    patchSha256: text(input.patchSha256).toLowerCase(),
    changedFiles: sortedChangedFiles(input.changedFiles),
  };
}

function validateCheckpoint(input = {}) {
  const base = fingerprintPayload(input);
  if (
    base.schemaVersion !== PROVIDER_NEUTRAL_SOURCE_MUTATION_CHECKPOINT_SCHEMA
    || !SAFE_ID.test(base.missionId)
    || !SAFE_ID.test(base.actionId)
    || !ADAPTERS.has(base.adapter)
    || base.repository !== 'Cheekyfellastef/stephan-os'
    || !base.branch
    || !SHA40.test(base.exactParentHead)
    || !SHA40.test(base.exactParentTree)
    || !SHA40.test(base.exactResultTree)
    || !SHA256.test(base.patchSha256)
    || !base.changedFiles
    || base.exactResultTree === base.exactParentTree
  ) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_INVALID' });
  }
  const createdAtUtc = text(input.createdAtUtc);
  if (!Number.isFinite(Date.parse(createdAtUtc))) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_TIMESTAMP_INVALID' });
  }
  const fingerprint = sha256(Buffer.from(JSON.stringify(base), 'utf8'));
  return Object.freeze({
    ok: true,
    checkpoint: Object.freeze({
      ...base,
      checkpointId: `provider-neutral-mutation-${fingerprint.slice(0, 32)}`,
      fingerprint,
      createdAtUtc,
      sourceMutationApplied: true,
      testsPassed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      providerReplayAllowed: false,
    }),
  });
}

function checkpointKey(missionId, actionId) {
  const identity = `${text(missionId).toLowerCase()}\n${text(actionId).toLowerCase()}`;
  return sha256(Buffer.from(identity, 'utf8')).slice(0, 40);
}

function checkpointPath(root, missionId, actionId) {
  const directory = resolve(root, 'source-mutation-checkpoints');
  const path = resolve(directory, `${checkpointKey(missionId, actionId)}.json`);
  if (!within(root, directory) || !within(directory, path)) return null;
  return { directory, path };
}

function runtimeRoot(options = {}) {
  const runtime = resolveSharedWorkspaceRuntimeConfig({
    env: options.env || process.env,
    root: options.sharedWorkspaceRoot,
    repoRoot: options.repoRoot || process.cwd(),
  });
  return runtime?.ok === true ? runtime.root : '';
}

function semanticMatch(left, right) {
  return text(left?.fingerprint).toLowerCase() === text(right?.fingerprint).toLowerCase()
    && text(left?.missionId).toLowerCase() === text(right?.missionId).toLowerCase()
    && text(left?.actionId).toLowerCase() === text(right?.actionId).toLowerCase();
}

export async function persistProviderNeutralSourceMutationCheckpointV1(input = {}, options = {}) {
  const prepared = validateCheckpoint(input);
  if (!prepared.ok) return prepared;
  const root = runtimeRoot(options);
  if (!root) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKSPACE_REQUIRED' });
  const paths = checkpointPath(root, prepared.checkpoint.missionId, prepared.checkpoint.actionId);
  if (!paths) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PATH_INVALID' });
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });

  const payload = Buffer.from(`${JSON.stringify(prepared.checkpoint, null, 2)}\n`, 'utf8');
  const tempPath = resolve(paths.directory, `.${checkpointKey(prepared.checkpoint.missionId, prepared.checkpoint.actionId)}.${process.pid}.${randomUUID()}.tmp`);
  const tempHandle = await open(tempPath, 'wx', 0o600);
  try {
    await tempHandle.writeFile(payload);
    await tempHandle.sync();
  } finally {
    await tempHandle.close();
  }

  try {
    try {
      // Publishing a hard link is an atomic, exclusive directory operation.
      // The target therefore points at the already-fsynced complete temp inode
      // or does not exist; an interrupted byte-copy can never become canonical.
      await link(tempPath, paths.path);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing;
      try {
        existing = JSON.parse(await readFile(paths.path, 'utf8'));
      } catch {
        return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_EXISTING_INVALID' });
      }
      if (!semanticMatch(existing, prepared.checkpoint)) {
        return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_CONFLICT' });
      }
      return Object.freeze({ ok: true, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_IDEMPOTENT', checkpoint: existing, path: paths.path });
    }
  } finally {
    await unlink(tempPath).catch(() => {});
  }

  const readback = await readFile(paths.path);
  if (!readback.equals(payload)) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_READBACK_MISMATCH' });
  }
  return Object.freeze({
    ok: true,
    reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PERSISTED',
    checkpoint: prepared.checkpoint,
    path: paths.path,
  });
}

export async function retireProviderNeutralSourceMutationCheckpointV1(input = {}, options = {}) {
  const prepared = validateCheckpoint(input);
  if (!prepared.ok) {
    return Object.freeze({
      ok: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRE_IDENTITY_INVALID',
    });
  }
  const root = runtimeRoot(options);
  if (!root) {
    return Object.freeze({
      ok: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKSPACE_REQUIRED',
    });
  }
  const paths = checkpointPath(
    root,
    prepared.checkpoint.missionId,
    prepared.checkpoint.actionId,
  );
  if (!paths) {
    return Object.freeze({
      ok: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PATH_INVALID',
    });
  }

  let existing;
  try {
    existing = JSON.parse(await readFile(paths.path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_ALREADY_ABSENT',
        checkpoint: prepared.checkpoint,
        path: paths.path,
      });
    }
    return Object.freeze({
      ok: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRE_READ_FAILED',
    });
  }

  const existingPrepared = validateCheckpoint(existing);
  if (
    !existingPrepared.ok
    || !semanticMatch(existingPrepared.checkpoint, existing)
    || !semanticMatch(existing, prepared.checkpoint)
  ) {
    return Object.freeze({
      ok: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRE_CONFLICT',
      path: paths.path,
    });
  }

  try {
    await unlink(paths.path);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return Object.freeze({
        ok: false,
        reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRE_UNLINK_FAILED',
        path: paths.path,
      });
    }
  }

  return Object.freeze({
    ok: true,
    reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RETIRED',
    checkpoint: prepared.checkpoint,
    path: paths.path,
  });
}

export async function readProviderNeutralSourceMutationCheckpointV1(missionId, actionId, options = {}) {
  const root = runtimeRoot(options);
  if (!root) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKSPACE_REQUIRED' });
  const paths = checkpointPath(root, missionId, actionId);
  if (!paths) return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_PATH_INVALID' });
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(paths.path, 'utf8'));
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_MISSING'
        : 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_READ_FAILED',
    });
  }
  const prepared = validateCheckpoint(checkpoint);
  if (!prepared.ok || !semanticMatch(prepared.checkpoint, checkpoint)) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_INVALID' });
  }
  return Object.freeze({ ok: true, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_READ', checkpoint, path: paths.path });
}

function fixedGit(run, worktreePath, args, label, env) {
  const result = run('git.exe', ['-C', worktreePath, ...args], { cwd: worktreePath, env });
  if (result?.error || result?.status !== 0) {
    return Object.freeze({ ok: false, reason: `PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_GIT_FAILED:${label}` });
  }
  return Object.freeze({ ok: true, stdout: String(result?.stdout || '') });
}

function actualChangedPaths(run, worktreePath, env) {
  const tracked = fixedGit(run, worktreePath, ['diff', '--name-only', 'HEAD', '--'], 'TRACKED', env);
  if (!tracked.ok) return tracked;
  const untracked = fixedGit(run, worktreePath, ['ls-files', '--others', '--exclude-standard'], 'UNTRACKED', env);
  if (!untracked.ok) return untracked;
  const paths = [...new Set(`${tracked.stdout}\n${untracked.stdout}`
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean))]
    .sort();
  if (!paths.length || paths.some((path) => !SAFE_PATH.test(path))) {
    return Object.freeze({ ok: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_CHANGED_SET_INVALID' });
  }
  return Object.freeze({ ok: true, paths: Object.freeze(paths) });
}

function identityMatchesCheckpoint(identity, checkpoint) {
  if (
    text(identity?.missionId).toLowerCase() !== checkpoint.missionId
    || text(identity?.actionId).toLowerCase() !== checkpoint.actionId
    || text(identity?.repository) !== checkpoint.repository
    || text(identity?.canonicalBranch) !== checkpoint.branch
    || text(identity?.exactParentHead).toLowerCase() !== checkpoint.exactParentHead
    || text(identity?.exactParentTree).toLowerCase() !== checkpoint.exactParentTree
    || text(identity?.exactResultTree).toLowerCase() !== checkpoint.exactResultTree
  ) return false;
  const actual = sortedChangedFiles(identity?.changedFiles);
  const expected = sortedChangedFiles(checkpoint.changedFiles);
  return Boolean(actual && expected && JSON.stringify(actual) === JSON.stringify(expected));
}

export async function inspectProviderNeutralAppliedMutationRecoveryV1(input = {}, options = {}) {
  const item = input.item || input.claim?.item || {};
  const action = item?.payload || {};
  const adapter = text(input.adapter || item?.adapter || action?.adapter).toLowerCase();
  const missionId = text(item?.missionId || action?.missionId).toLowerCase();
  const actionId = text(item?.actionId || action?.actionId).toLowerCase();
  const receiptState = text(input.latestReceipt?.state || input.receiptState).toLowerCase();
  if (!ADAPTERS.has(adapter) || !['started', 'progress'].includes(receiptState)) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RECOVERY_UNSUPPORTED' });
  }
  if (!SAFE_ID.test(missionId) || !SAFE_ID.test(actionId)) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RECOVERY_IDENTITY_INVALID' });
  }
  const read = options.readMutationCheckpoint || readProviderNeutralSourceMutationCheckpointV1;
  const loaded = await read(missionId, actionId, options);
  if (loaded?.ok !== true) {
    return Object.freeze({ allowed: false, reason: loaded?.reason || 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_MISSING' });
  }
  const checkpoint = loaded.checkpoint;
  if (
    checkpoint.adapter !== adapter
    || text(item?.actionGrant?.headSha || item?.actionGrant?.sourceRevision).toLowerCase() !== checkpoint.exactParentHead
    || text(item?.executionBinding?.headSha || item?.executionBinding?.sourceRevision).toLowerCase() !== checkpoint.exactParentHead
  ) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_BINDING_MISMATCH' });
  }

  const worktreePath = text(action?.worktreePath);
  const run = options.runCommand;
  if (!worktreePath || !isAbsolute(worktreePath) || typeof run !== 'function') {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_RECOVERY_RUNTIME_REQUIRED' });
  }
  const env = options.env || process.env;
  const changed = actualChangedPaths(run, resolve(worktreePath), env);
  if (!changed.ok) return Object.freeze({ allowed: false, reason: changed.reason });
  const expectedPaths = checkpoint.changedFiles.map((entry) => entry.path).sort();
  if (JSON.stringify(changed.paths) !== JSON.stringify(expectedPaths)) {
    return Object.freeze({
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_CHANGED_SET_MISMATCH',
      expectedPaths: Object.freeze(expectedPaths),
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
      reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_IDENTITY_REBUILD_FAILED',
      detail: text(error?.message),
    });
  }
  if (!identityMatchesCheckpoint(identity, checkpoint)) {
    return Object.freeze({ allowed: false, reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKTREE_MISMATCH' });
  }

  return Object.freeze({
    allowed: true,
    reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_EXACT_MATCH',
    adapter,
    receiptState,
    resumeStage: 'SOURCE_CHANGED',
    providerReplayMayOccur: false,
    sourceMutationReplayAllowed: false,
    expectedHead: checkpoint.exactParentHead,
    changedFiles: Object.freeze([...expectedPaths]),
    checkpoint: Object.freeze({ ...checkpoint }),
    checkpointPath: loaded.path || '',
  });
}

export function createProviderNeutralSourceMutationCheckpointV1(input = {}) {
  return validateCheckpoint(input);
}

export const PROVIDER_NEUTRAL_MUTATION_ZERO_SHA = ZERO_SHA;
