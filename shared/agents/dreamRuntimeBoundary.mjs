import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  defaultOpenClawWorkspaceRoot,
  defaultRuntimeRoot,
  getRuntimePath,
} from './runtimeBoundaryRegistry.mjs';

export const DREAM_RUNTIME_BOUNDARY_SCHEMA = 'stephanos.dream-runtime-boundary.v1';
export const DREAM_RUNTIME_MIGRATION_APPROVAL = 'operator-approved-dream-migration';
export const DREAM_RUNTIME_SECURE_COPY_CAPABILITY = 'stephanos.dream-runtime-secure-copy.v1';

export const DREAM_RUNTIME_LEGACY_MAPPINGS = Object.freeze([
  Object.freeze({
    id: 'hidden-dream-state',
    legacyRelativePath: 'memory/.dreams',
    externalRelativePath: '.dreams',
  }),
  Object.freeze({
    id: 'dream-journals',
    legacyRelativePath: 'memory/dreaming',
    externalRelativePath: 'dreaming',
  }),
]);

function normalizeComparable(value = '') {
  const resolved = path.resolve(String(value || '.'));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function pathIsInside(parent, candidate) {
  const root = normalizeComparable(parent);
  const target = normalizeComparable(candidate);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveDreamRuntimeBoundary({
  repoRoot,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const canonicalRepoRoot = path.resolve(repoRoot || path.join(homeDir, 'Documents', 'GitHub', 'stephan-os'));
  const workspaceRoot = defaultOpenClawWorkspaceRoot({ env, homeDir });
  const dreamMemoryRoot = getRuntimePath('dreams', { env, homeDir });
  const receiptRoot = path.join(defaultRuntimeRoot({ env, homeDir }), 'receipts', 'runtime-boundary');
  const mappings = DREAM_RUNTIME_LEGACY_MAPPINGS.map((mapping) => Object.freeze({
    ...mapping,
    sourcePath: path.resolve(canonicalRepoRoot, mapping.legacyRelativePath),
    destinationPath: path.resolve(dreamMemoryRoot, mapping.externalRelativePath),
  }));
  const unsafePaths = [workspaceRoot, dreamMemoryRoot, receiptRoot, ...mappings.map((mapping) => mapping.destinationPath)]
    .filter((candidate) => pathIsInside(canonicalRepoRoot, candidate));
  const ok = unsafePaths.length === 0;
  return Object.freeze({
    ok,
    schemaVersion: DREAM_RUNTIME_BOUNDARY_SCHEMA,
    blocker: ok ? '' : 'DREAM_RUNTIME_ROOT_INSIDE_REPOSITORY',
    repoRoot: canonicalRepoRoot,
    workspaceRoot,
    dreamMemoryRoot,
    receiptRoot,
    mappings: Object.freeze(mappings),
    unsafePaths: Object.freeze(unsafePaths),
    launchContext: Object.freeze({
      cwd: workspaceRoot,
      env: Object.freeze({
        STEPHANOS_OPENCLAW_WORKSPACE: workspaceRoot,
        STEPHANOS_DREAMS_ROOT: dreamMemoryRoot,
      }),
    }),
  });
}

async function exists(target, fsImpl) {
  try {
    await fsImpl.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertNoSymbolicLinkInPath(target, fsImpl) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const segments = path.relative(parsed.root, resolved).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fsImpl.lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const error = new Error(`Symbolic link not allowed in Dream migration destination: ${current}`);
      error.code = 'DREAM_MIGRATION_DESTINATION_SYMLINK_BLOCKED';
      throw error;
    }
  }
}

async function collectFiles(root, fsImpl, current = root, output = []) {
  if (!(await exists(root, fsImpl))) return output;
  const stat = await fsImpl.lstat(current);
  if (stat.isSymbolicLink()) {
    const error = new Error(`Symbolic link not allowed in Dream migration: ${current}`);
    error.code = 'DREAM_MIGRATION_SYMLINK_BLOCKED';
    throw error;
  }
  if (stat.isFile()) {
    output.push(current);
    return output;
  }
  if (!stat.isDirectory()) {
    const error = new Error(`Unsupported Dream migration entry: ${current}`);
    error.code = 'DREAM_MIGRATION_ENTRY_UNSUPPORTED';
    throw error;
  }
  const entries = await fsImpl.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      const error = new Error(`Symbolic link not allowed in Dream migration: ${child}`);
      error.code = 'DREAM_MIGRATION_SYMLINK_BLOCKED';
      throw error;
    }
    if (entry.isDirectory()) await collectFiles(root, fsImpl, child, output);
    else if (entry.isFile()) output.push(child);
    else {
      const error = new Error(`Unsupported Dream migration entry: ${child}`);
      error.code = 'DREAM_MIGRATION_ENTRY_UNSUPPORTED';
      throw error;
    }
  }
  return output;
}

export async function sha256File(filePath, { fsImpl = fs } = {}) {
  const buffer = await fsImpl.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

export async function planDreamRuntimeMigration({
  repoRoot,
  env = process.env,
  homeDir = os.homedir(),
  fsImpl = fs,
} = {}) {
  const boundary = resolveDreamRuntimeBoundary({ repoRoot, env, homeDir });
  if (!boundary.ok) return Object.freeze({ ...boundary, mode: 'plan', entries: Object.freeze([]), copyRequired: 0, alreadyVerified: 0, conflicts: 0 });
  const entries = [];
  try {
    for (const mapping of boundary.mappings) {
      const sourceFiles = await collectFiles(mapping.sourcePath, fsImpl);
      for (const sourcePath of sourceFiles) {
        const relativePath = path.relative(mapping.sourcePath, sourcePath);
        const destinationPath = path.resolve(mapping.destinationPath, relativePath);
        if (!pathIsInside(mapping.destinationPath, destinationPath)) {
          return Object.freeze({ ...boundary, ok: false, blocker: 'DREAM_MIGRATION_DESTINATION_ESCAPE', mode: 'plan', entries: Object.freeze(entries), copyRequired: 0, alreadyVerified: 0, conflicts: 0 });
        }
        await assertNoSymbolicLinkInPath(destinationPath, fsImpl);
        const sourceStat = await fsImpl.stat(sourcePath);
        const sourceSha256 = await sha256File(sourcePath, { fsImpl });
        let state = 'copy-required';
        let destinationSha256 = '';
        if (await exists(destinationPath, fsImpl)) {
          destinationSha256 = await sha256File(destinationPath, { fsImpl });
          state = destinationSha256 === sourceSha256 ? 'already-verified' : 'destination-conflict';
        }
        entries.push(Object.freeze({
          mappingId: mapping.id,
          relativePath: relativePath.replaceAll('\\', '/'),
          sourcePath,
          destinationPath,
          bytes: sourceStat.size,
          sourceSha256,
          destinationSha256,
          state,
        }));
      }
    }
  } catch (error) {
    return Object.freeze({
      ...boundary,
      ok: false,
      blocker: error?.code || 'DREAM_MIGRATION_SCAN_FAILED',
      error: error?.message || String(error),
      mode: 'plan',
      entries: Object.freeze(entries),
      copyRequired: 0,
      alreadyVerified: 0,
      conflicts: 0,
    });
  }
  const conflicts = entries.filter((entry) => entry.state === 'destination-conflict').length;
  return Object.freeze({
    ...boundary,
    ok: conflicts === 0,
    blocker: conflicts ? 'DREAM_MIGRATION_DESTINATION_CONFLICT' : '',
    mode: 'plan',
    entries: Object.freeze(entries),
    copyRequired: entries.filter((entry) => entry.state === 'copy-required').length,
    alreadyVerified: entries.filter((entry) => entry.state === 'already-verified').length,
    conflicts,
  });
}

function safeTimestamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

async function writeReceipt(receipt, { fsImpl, receiptRoot }) {
  await fsImpl.mkdir(receiptRoot, { recursive: true });
  const filename = `dream-migration-${safeTimestamp(new Date(receipt.completedAtUtc))}.json`;
  const receiptPath = path.join(receiptRoot, filename);
  await fsImpl.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return receiptPath;
}

function sourceSnapshotMatches(initialPlan, finalPlan) {
  if (initialPlan.entries.length !== finalPlan.entries.length) return false;
  const initial = new Map(initialPlan.entries.map((entry) => [`${entry.mappingId}:${entry.relativePath}`, entry.sourceSha256]));
  return finalPlan.entries.every((entry) => initial.get(`${entry.mappingId}:${entry.relativePath}`) === entry.sourceSha256);
}

function secureCopyCapabilityIsValid(capability) {
  return capability?.schemaVersion === DREAM_RUNTIME_SECURE_COPY_CAPABILITY
    && capability?.descriptorBound === true
    && capability?.noFollowAncestors === true
    && typeof capability?.copyFileExclusive === 'function';
}

function secureCopyEvidenceIsValid(evidence, entry, approvedRoot) {
  return evidence?.ok === true
    && evidence?.schemaVersion === DREAM_RUNTIME_SECURE_COPY_CAPABILITY
    && evidence?.descriptorBound === true
    && evidence?.noFollowAncestors === true
    && normalizeComparable(evidence?.sourcePath) === normalizeComparable(entry.sourcePath)
    && normalizeComparable(evidence?.destinationPath) === normalizeComparable(entry.destinationPath)
    && normalizeComparable(evidence?.approvedRoot) === normalizeComparable(approvedRoot);
}

export async function executeDreamRuntimeMigration({
  repoRoot,
  env = process.env,
  homeDir = os.homedir(),
  fsImpl = fs,
  operatorApproval = '',
  secureCopyCapability = null,
  now = () => new Date(),
} = {}) {
  if (operatorApproval !== DREAM_RUNTIME_MIGRATION_APPROVAL) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_APPROVAL_REQUIRED',
      blocker: 'DREAM_MIGRATION_APPROVAL_REQUIRED',
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  const plan = await planDreamRuntimeMigration({ repoRoot, env, homeDir, fsImpl });
  if (!plan.ok) {
    return Object.freeze({
      ...plan,
      status: 'BLOCKED',
      finalVerdict: plan.blocker || 'DREAM_MIGRATION_PLAN_BLOCKED',
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  if (plan.copyRequired > 0 && !secureCopyCapabilityIsValid(secureCopyCapability)) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SECURE_COPY_UNAVAILABLE',
      blocker: 'DREAM_MIGRATION_SECURE_COPY_UNAVAILABLE',
      boundary: plan,
      copied: Object.freeze([]),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
      nextOperatorAction: 'Run read-only plan mode only. Copy mode remains disabled until a descriptor-bound no-follow copier is supplied and verified.',
    });
  }
  const copied = [];
  try {
    for (const entry of plan.entries) {
      if (entry.state !== 'copy-required') continue;
      const destinationParent = path.dirname(entry.destinationPath);
      await assertNoSymbolicLinkInPath(destinationParent, fsImpl);
      await fsImpl.mkdir(destinationParent, { recursive: true });
      await assertNoSymbolicLinkInPath(entry.destinationPath, fsImpl);
      const secureCopyEvidence = await secureCopyCapability.copyFileExclusive({
        sourcePath: entry.sourcePath,
        destinationPath: entry.destinationPath,
        approvedRoot: plan.dreamMemoryRoot,
        expectedSourceSha256: entry.sourceSha256,
      });
      if (!secureCopyEvidenceIsValid(secureCopyEvidence, entry, plan.dreamMemoryRoot)) {
        const error = new Error(`Secure Dream copy evidence was invalid for ${entry.destinationPath}`);
        error.code = 'DREAM_MIGRATION_SECURE_COPY_EVIDENCE_INVALID';
        throw error;
      }
      await assertNoSymbolicLinkInPath(entry.destinationPath, fsImpl);
      const destinationSha256 = await sha256File(entry.destinationPath, { fsImpl });
      if (destinationSha256 !== entry.sourceSha256) {
        return Object.freeze({
          ok: false,
          status: 'BLOCKED',
          finalVerdict: 'DREAM_MIGRATION_HASH_MISMATCH',
          blocker: 'DREAM_MIGRATION_HASH_MISMATCH',
          failedEntry: entry,
          copied: Object.freeze(copied),
          sourceRemovalPerformed: false,
          destructiveGitOperationPerformed: false,
        });
      }
      copied.push(Object.freeze({
        ...entry,
        destinationSha256,
        state: 'copied-and-verified',
        secureCopy: Object.freeze({
          schemaVersion: secureCopyEvidence.schemaVersion,
          descriptorBound: true,
          noFollowAncestors: true,
        }),
      }));
    }
  } catch (error) {
    const destinationRace = error?.code === 'EEXIST';
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: destinationRace ? 'DREAM_MIGRATION_DESTINATION_RACE' : (error?.code || 'DREAM_MIGRATION_COPY_FAILED'),
      blocker: destinationRace ? 'DREAM_MIGRATION_DESTINATION_RACE' : (error?.code || 'DREAM_MIGRATION_COPY_FAILED'),
      error: error?.message || String(error),
      copied: Object.freeze(copied),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }

  const finalPlan = await planDreamRuntimeMigration({ repoRoot, env, homeDir, fsImpl });
  if (!finalPlan.ok && finalPlan.blocker !== 'DREAM_MIGRATION_DESTINATION_CONFLICT') {
    const blocker = finalPlan.blocker || 'DREAM_MIGRATION_FINAL_PLAN_BLOCKED';
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: blocker,
      blocker,
      boundary: plan,
      revalidation: finalPlan,
      copied: Object.freeze(copied),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }

  const sourceStable = sourceSnapshotMatches(plan, finalPlan);
  if (!sourceStable) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'DREAM_MIGRATION_SOURCE_CHANGED_DURING_COPY',
      blocker: 'DREAM_MIGRATION_SOURCE_CHANGED_DURING_COPY',
      boundary: plan,
      revalidation: finalPlan,
      copied: Object.freeze(copied),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }
  if (finalPlan.copyRequired !== 0 || finalPlan.conflicts !== 0) {
    const blocker = finalPlan.blocker || 'DREAM_MIGRATION_DESTINATION_CHANGED_DURING_COPY';
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: blocker,
      blocker,
      boundary: plan,
      revalidation: finalPlan,
      copied: Object.freeze(copied),
      sourceRemovalPerformed: false,
      destructiveGitOperationPerformed: false,
    });
  }

  const copiedKeys = new Set(copied.map((entry) => `${entry.mappingId}:${entry.relativePath}`));
  const receiptFiles = finalPlan.entries.map((entry) => Object.freeze({
    ...entry,
    state: copiedKeys.has(`${entry.mappingId}:${entry.relativePath}`) ? 'copied-and-verified' : 'already-verified',
  }));
  const completedAtUtc = now().toISOString();
  const receipt = Object.freeze({
    schemaVersion: DREAM_RUNTIME_BOUNDARY_SCHEMA,
    kind: 'dream-runtime-migration-receipt',
    completedAtUtc,
    repoRoot: plan.repoRoot,
    workspaceRoot: plan.workspaceRoot,
    dreamMemoryRoot: plan.dreamMemoryRoot,
    copiedCount: copied.length,
    alreadyVerifiedCount: finalPlan.entries.length - copied.length,
    sourceRemovalPerformed: false,
    destructiveGitOperationPerformed: false,
    files: Object.freeze(receiptFiles),
    finalVerdict: 'DREAM_RUNTIME_COPY_HASH_VERIFIED',
  });
  const receiptPath = await writeReceipt(receipt, { fsImpl, receiptRoot: plan.receiptRoot });
  return Object.freeze({
    ok: true,
    status: 'DONE',
    finalVerdict: 'DREAM_RUNTIME_COPY_HASH_VERIFIED',
    blocker: '',
    boundary: finalPlan,
    copied: Object.freeze(copied),
    receipt,
    receiptPath,
    launchContext: plan.launchContext,
    sourceRemovalPerformed: false,
    destructiveGitOperationPerformed: false,
    nextOperatorAction: 'Use the external OpenClaw workspace launch context. Legacy source remains preserved until the separate rollback-proven reconciliation milestone.',
  });
}
