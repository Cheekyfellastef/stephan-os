import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';

export const BATTLE_BRIDGE_DIRTY_DATA_PRESERVATION_SCHEMA = 'stephanos.battle-bridge-dirty-data-preservation.v1';
export const BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE = 'battle-bridge-runtime-data-v1';
export const BATTLE_BRIDGE_RUNTIME_DATA_PATHS = Object.freeze([
  'data/activity/events.json',
  'data/knowledge-graph/edges.json',
  'data/knowledge-graph/nodes.json',
  'data/proposals/proposals.json',
  'data/roadmap/roadmap.json',
  'data/simulations/history.json',
]);

const MAX_PRESERVED_FILE_BYTES = 16 * 1024 * 1024;
const EXACT_HEAD = /^[a-f0-9]{40}$/i;

function isoStamp(value) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function digestFile(filePath) {
  const payload = readFileSync(filePath);
  return Object.freeze({
    byteLength: payload.byteLength,
    sha256: createHash('sha256').update(payload).digest('hex'),
  });
}

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    status: 'BLOCKED',
    verdict: 'FAIL',
    blocker,
    fileMovePerformed: false,
    trackedSourceMutationPerformed: false,
    destructiveCleanupPerformed: false,
    ...details,
  });
}

export function preserveBattleBridgeDirtyData({
  repoRoot,
  workspaceRoot,
  expectedRepoRoot,
  expectedWorkspaceRoot,
  profile = '',
  operatorApproval = '',
  statusLines = [],
  sourceHead = '',
  now = new Date(),
} = {}) {
  if (profile !== BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE) return blocked('PRESERVATION_PROFILE_NOT_ALLOWED');
  if (operatorApproval !== 'operator-approved') return blocked('PRESERVATION_APPROVAL_REQUIRED');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return blocked('PRESERVATION_TIMESTAMP_INVALID');
  if (!EXACT_HEAD.test(String(sourceHead || '').trim())) return blocked('PRESERVATION_SOURCE_HEAD_INVALID');

  const resolvedRepo = path.resolve(String(repoRoot || ''));
  const resolvedWorkspace = path.resolve(String(workspaceRoot || ''));
  if (resolvedRepo !== path.resolve(String(expectedRepoRoot || ''))) return blocked('NON_CANONICAL_REPOSITORY_PATH');
  if (resolvedWorkspace !== path.resolve(String(expectedWorkspaceRoot || ''))) return blocked('NON_CANONICAL_WORKSPACE_PATH');
  if (within(resolvedRepo, resolvedWorkspace) || within(resolvedWorkspace, resolvedRepo)) {
    return blocked('REPOSITORY_WORKSPACE_OVERLAP');
  }
  try {
    const repoInfo = lstatSync(resolvedRepo);
    const workspaceInfo = lstatSync(resolvedWorkspace);
    if (repoInfo.isSymbolicLink() || !repoInfo.isDirectory()) return blocked('REPOSITORY_ROOT_NOT_REGULAR_DIRECTORY');
    if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()) return blocked('WORKSPACE_ROOT_NOT_REGULAR_DIRECTORY');
  } catch {
    return blocked('PRESERVATION_ROOT_READ_FAILED');
  }

  const dirt = classifyDirt(statusLines);
  const expectedUntracked = [...BATTLE_BRIDGE_RUNTIME_DATA_PATHS].sort();
  const observedUntracked = [...dirt.untrackedSource].sort();
  if (dirt.trackedSource.length || dirt.unknown.length || dirt.generatedSource.length
      || JSON.stringify(observedUntracked) !== JSON.stringify(expectedUntracked)) {
    return blocked('PRESERVATION_DIRT_ESTATE_MISMATCH', {
      dirtCounts: Object.freeze({
        trackedSource: dirt.trackedSource.length,
        untrackedSource: dirt.untrackedSource.length,
        runtimeOnly: dirt.runtimeOnly.length,
        generatedSource: dirt.generatedSource.length,
        unknown: dirt.unknown.length,
      }),
    });
  }

  const preflight = [];
  for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
    const sourcePath = path.resolve(resolvedRepo, relativePath);
    if (!within(resolvedRepo, sourcePath)) return blocked('PRESERVATION_SOURCE_PATH_ESCAPE');
    let info;
    try {
      info = lstatSync(sourcePath);
    } catch {
      return blocked('PRESERVATION_SOURCE_READ_FAILED', { relativePath });
    }
    if (info.isSymbolicLink() || !info.isFile()) return blocked('PRESERVATION_SOURCE_NOT_REGULAR', { relativePath });
    if (info.size > MAX_PRESERVED_FILE_BYTES) return blocked('PRESERVATION_SOURCE_TOO_LARGE', { relativePath, byteLength: info.size });
    let digest;
    try {
      digest = digestFile(sourcePath);
    } catch {
      return blocked('PRESERVATION_SOURCE_READ_FAILED', { relativePath });
    }
    if (digest.byteLength !== info.size) return blocked('PRESERVATION_SOURCE_SIZE_CHANGED', { relativePath });
    preflight.push(Object.freeze({ relativePath, sourcePath, ...digest }));
  }

  const preservationBase = path.resolve(resolvedWorkspace, 'preserved-source-dirt');
  const preservationRoot = path.resolve(preservationBase, `${profile}-${isoStamp(now)}`);
  if (!within(resolvedWorkspace, preservationRoot) || preservationRoot === preservationBase) {
    return blocked('PRESERVATION_DESTINATION_PATH_INVALID');
  }
  if (existsSync(preservationRoot)) return blocked('PRESERVATION_DESTINATION_EXISTS', { preservationRoot });

  try {
    mkdirSync(preservationBase, { recursive: true });
    const preservationBaseInfo = lstatSync(preservationBase);
    if (preservationBaseInfo.isSymbolicLink() || !preservationBaseInfo.isDirectory()) {
      return blocked('PRESERVATION_BASE_NOT_REGULAR_DIRECTORY');
    }
    mkdirSync(preservationRoot, { recursive: false });
  } catch {
    return blocked('PRESERVATION_DESTINATION_CREATE_FAILED', { preservationRoot });
  }
  const moved = [];
  try {
    for (const item of preflight) {
      const destinationPath = path.resolve(preservationRoot, item.relativePath);
      if (!within(preservationRoot, destinationPath) || existsSync(destinationPath)) {
        throw new Error(`PRESERVATION_DESTINATION_CONFLICT:${item.relativePath}`);
      }
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      renameSync(item.sourcePath, destinationPath);
      moved.push(Object.freeze({ ...item, destinationPath }));
    }
  } catch (error) {
    return blocked('PRESERVATION_MOVE_FAILED', {
      preservationRoot,
      movedCount: moved.length,
      remainingCount: BATTLE_BRIDGE_RUNTIME_DATA_PATHS.length - moved.length,
      error: String(error?.message || error).slice(0, 240),
      fileMovePerformed: moved.length > 0,
    });
  }

  const items = [];
  for (const item of moved) {
    let verified;
    try {
      verified = digestFile(item.destinationPath);
    } catch {
      return blocked('PRESERVATION_VERIFICATION_READ_FAILED', {
        preservationRoot,
        relativePath: item.relativePath,
        fileMovePerformed: true,
      });
    }
    if (verified.byteLength !== item.byteLength || verified.sha256 !== item.sha256) {
      return blocked('PRESERVATION_VERIFICATION_FAILED', {
        preservationRoot,
        relativePath: item.relativePath,
        fileMovePerformed: true,
      });
    }
    items.push(Object.freeze({
      relativePath: item.relativePath,
      destinationRelativePath: item.relativePath,
      byteLength: item.byteLength,
      sha256: item.sha256,
      verified: true,
    }));
  }

  const receipt = Object.freeze({
    schemaVersion: BATTLE_BRIDGE_DIRTY_DATA_PRESERVATION_SCHEMA,
    profile,
    timestampUtc: now.toISOString(),
    sourceHead: String(sourceHead || '').trim(),
    preservationRoot,
    itemCount: items.length,
    items: Object.freeze(items),
    allHashesVerified: true,
    trackedSourceMutationPerformed: false,
    destructiveCleanupPerformed: false,
  });
  const receiptPath = path.resolve(preservationRoot, 'preservation-receipt.json');
  try {
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch {
    return blocked('PRESERVATION_RECEIPT_WRITE_FAILED', {
      preservationRoot,
      fileMovePerformed: true,
      receipt,
    });
  }

  return Object.freeze({
    ok: true,
    status: 'DONE',
    verdict: 'PASS',
    blocker: '',
    preservationRoot,
    receiptPath,
    receipt,
    fileMovePerformed: true,
    trackedSourceMutationPerformed: false,
    destructiveCleanupPerformed: false,
  });
}
