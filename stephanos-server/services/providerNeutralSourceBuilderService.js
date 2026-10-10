import { createHash } from 'node:crypto';
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { lstat, readFile, realpath as fsRealpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  appendMissionWorkerExecutionReceiptTransition,
  beginMissionWorkerExecutionReceiptChain,
  claimNextMissionWorkerItem,
  finalizeMissionWorkerQueueClaim,
} from './missionOrchestratorWorkerConsumer.js';
import { collectAgentWorkerResult } from './missionOrchestratorWorkerService.js';
import { finalizeSourceArtifactEscrowFromWorktreeV1 } from './sourceArtifactEscrowStore.js';
import {
  readGithubGoalIssue,
  resolveGithubTokenConfig,
} from './githubPrEvidenceService.js';

export const PROVIDER_NEUTRAL_SOURCE_BUILDER_SCHEMA = 'stephanos.provider-neutral-source-builder.v1';
const EXTERNAL_ADAPTERS = Object.freeze(['foundry-forge', 'chatgpt-github', 'sovereign-commander']);

// Source context caps
const MAX_PER_FILE_BYTES = 64 * 1024; // 64 KiB
const MAX_TOTAL_BYTES = 64 * 1024; // keep local-builder prompts inside a bounded coding context
const MAX_STRUCTURED_EDITS = 64;
const MAX_STRUCTURED_EDIT_BYTES = 512 * 1024;
const MAX_GOAL_CONTEXT_BYTES = 24 * 1024;
const MAX_LOCAL_MODEL_ATTEMPTS = 2;
const FORBIDDEN_SOURCE_PATH_PATTERN = /^(?:apps\/stephanos\/dist|stephanos-server\/data|runtime|runtime-data|root-data|root data|data|tmp)(?:\/|$)|(^|\/)(?:\.git|node_modules)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;
const SOURCE_CONTEXT_STOP_WORDS = new Set([
  'about', 'after', 'again', 'agent', 'agents', 'allow', 'authoritative', 'before', 'build',
  'builder', 'canonical', 'complete', 'create', 'current', 'durable', 'every', 'from', 'goal',
  'implementation', 'into', 'mission', 'must', 'only', 'operator', 'required', 'safe', 'should',
  'source', 'state', 'status', 'stephanos', 'that', 'their', 'through', 'when', 'where', 'with',
  'workspace',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function sourceContextTokens(value) {
  const tokens = String(value ?? '').toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
  return [...new Set(tokens.filter((token) => !SOURCE_CONTEXT_STOP_WORDS.has(token)))].slice(0, 96);
}

function rankSourceContextPaths(paths, hint = '') {
  const tokens = sourceContextTokens(hint);
  if (!tokens.length) return [...paths];
  return paths
    .map((path, index) => {
      const lower = path.toLowerCase();
      const score = tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
      return { path, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ path }) => path);
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function forbiddenSourcePath(path) {
  const normalized = normalizePath(path);
  return !normalized
    || normalized.startsWith('/')
    || /^[a-z]:\//i.test(normalized)
    || normalized.split('/').includes('..')
    || FORBIDDEN_SOURCE_PATH_PATTERN.test(normalized)
    || /secret|token/i.test(normalized);
}

function pathAllowed(path, scopes = []) {
  const normalized = normalizePath(path);
  return scopes.some((scopeValue) => {
    const scope = normalizePath(scopeValue);
    if (scope === '**') return !forbiddenSourcePath(normalized);
    if (scope === normalized) return true;
    if (!scope.endsWith('/**')) return false;
    const root = scope.slice(0, -3);
    return normalized === root || normalized.startsWith(`${root}/`);
  });
}

function patchTargetPaths(patch = '') {
  const paths = [];
  for (const line of String(patch).split(/\r?\n/)) {
    if (!line.startsWith('diff --git ')) continue;
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!match) throw new Error('PROVIDER_NEUTRAL_PATCH_HEADER_INVALID');
    const left = normalizePath(match[1]);
    const right = normalizePath(match[2]);
    if (!left || !right || left !== right || left.includes('..')) {
      throw new Error('PROVIDER_NEUTRAL_PATCH_TARGET_INVALID');
    }
    paths.push(right);
  }
  const unique = [...new Set(paths)].sort();
  if (!unique.length) throw new Error('PROVIDER_NEUTRAL_PATCH_TARGET_MISSING');
  return unique;
}

async function snapshotPatchTargets(worktreePath, patch, allowedFiles) {
  const targets = patchTargetPaths(patch);
  const snapshot = [];
  let totalBytes = 0;
  for (const path of targets) {
    if (!pathAllowed(path, allowedFiles)) {
      throw new Error(`PROVIDER_NEUTRAL_SCOPE_VIOLATION:${path}`);
    }
    const absolutePath = resolve(worktreePath, path);
    const existed = existsSync(absolutePath);
    const bytes = existed ? await readFile(absolutePath) : Buffer.alloc(0);
    totalBytes += bytes.length;
    if (totalBytes > 2 * 1024 * 1024) {
      throw new Error('PROVIDER_NEUTRAL_PATCH_SNAPSHOT_TOO_LARGE');
    }
    snapshot.push(Object.freeze({ path, existed, bytes }));
  }
  return Object.freeze(snapshot);
}

function commandResultHash(result = {}) {
  return createHash('sha256')
    .update(`${result.stdout || ''}\n${result.stderr || ''}`, 'utf8')
    .digest('hex');
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function changedFiles(worktreePath, run) {
  const tracked = run('git.exe', ['-C', worktreePath, 'diff', '--name-only', 'HEAD', '--'], { cwd: worktreePath });
  const untracked = run('git.exe', ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard'], { cwd: worktreePath });
  if (tracked.error || tracked.status !== 0 || untracked.error || untracked.status !== 0) {
    throw new Error('PROVIDER_NEUTRAL_CHANGED_FILE_INSPECTION_FAILED');
  }
  return [...new Set(`${tracked.stdout || ''}\n${untracked.stdout || ''}`
    .split(/\r?\n/).map(normalizePath).filter(Boolean))].sort();
}

function resolveTrackedScopeCase(worktreePath, allowedFiles, run) {
  const scopes = [...new Set((Array.isArray(allowedFiles) ? allowedFiles : []).map(normalizePath).filter(Boolean))];
  if (scopes.includes('**')) return Object.freeze(scopes);

  const tracked = run('git.exe', ['-C', worktreePath, 'ls-files'], { cwd: worktreePath });
  if (tracked.error || tracked.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_SOURCE_SCOPE_INDEX_ENUMERATION_FAILED:${text(tracked.stderr || tracked.stdout)}`);
  }
  const trackedPaths = [...new Set(
    String(tracked.stdout || '').split(/\r?\n/).map(normalizePath).filter(Boolean),
  )].sort();

  const exactByIdentity = new Map();
  for (const path of trackedPaths) {
    const identity = path.toLowerCase();
    const matches = exactByIdentity.get(identity) || [];
    matches.push(path);
    exactByIdentity.set(identity, matches);
  }

  const resolved = scopes.map((scope) => {
    const recursive = scope.endsWith('/**');
    const root = recursive ? scope.slice(0, -3) : scope;
    const identity = root.toLowerCase();
    const exactMatches = exactByIdentity.get(identity) || [];
    if (exactMatches.length > 1) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_SCOPE_CASE_AMBIGUOUS:${root}`);
    }
    if (exactMatches.length === 1) return recursive ? `${exactMatches[0]}/**` : exactMatches[0];
    if (!recursive) return scope;

    const prefix = `${identity}/`;
    const segmentCount = root.split('/').length;
    const canonicalRoots = [...new Set(
      trackedPaths
        .filter((path) => path.toLowerCase().startsWith(prefix))
        .map((path) => path.split('/').slice(0, segmentCount).join('/')),
    )];
    if (canonicalRoots.length > 1) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_SCOPE_CASE_AMBIGUOUS:${root}`);
    }
    return canonicalRoots.length === 1 ? `${canonicalRoots[0]}/**` : scope;
  });

  return Object.freeze([...new Set(resolved)]);
}

async function reverseAppliedPatch(worktreePath, patchPath, run, touchedPaths = [], snapshot = [], recount = false) {
  const recountArgs = recount ? ['--recount'] : [];
  const check = run('git.exe', ['-C', worktreePath, 'apply', ...recountArgs, '--check', '--reverse', '--whitespace=error-all', patchPath], { cwd: worktreePath });
  if (check.error || check.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_CHECK_FAILED:${text(check.stderr || check.stdout)}`);
  }
  const reverse = run('git.exe', ['-C', worktreePath, 'apply', ...recountArgs, '--reverse', '--whitespace=error-all', patchPath], { cwd: worktreePath });
  if (reverse.error || reverse.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_FAILED:${text(reverse.stderr || reverse.stdout)}`);
  }
  const candidates = [...new Set(
    (Array.isArray(touchedPaths) && touchedPaths.length ? touchedPaths : changedFiles(worktreePath, run))
      .map(normalizePath).filter(Boolean),
  )];
  const snapshotByPath = new Map((Array.isArray(snapshot) ? snapshot : []).map((item) => [normalizePath(item.path), item]));
  for (const path of candidates) {
    const saved = snapshotByPath.get(path);
    if (saved) {
      const absolutePath = resolve(worktreePath, path);
      if (saved.existed) await writeFile(absolutePath, saved.bytes);
      else await rm(absolutePath, { force: true });
      continue;
    }
    const tracked = run('git.exe', ['-C', worktreePath, 'ls-files', '--error-unmatch', '--', path], { cwd: worktreePath });
    if (tracked.status === 0 && !tracked.error) {
      const restore = run('git.exe', ['-C', worktreePath, 'restore', '--worktree', '--source=HEAD', '--', path], { cwd: worktreePath });
      if (restore.error || restore.status !== 0) {
        throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_RESTORE_FAILED:${path}`);
      }
      run('git.exe', ['-C', worktreePath, 'update-index', '--really-refresh', '--', path], { cwd: worktreePath });
    } else {
      await rm(resolve(worktreePath, path), { force: true });
    }
  }
  const status = run(
    'git.exe',
    ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all', ...(candidates.length ? ['--', ...candidates] : [])],
    { cwd: worktreePath },
  );
  if (status.error || status.status !== 0) {
    throw new Error('PROVIDER_NEUTRAL_PATCH_ROLLBACK_STATUS_FAILED');
  }
  if (text(status.stdout)) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_LEFT_CHANGES:${text(status.stdout)}`);
  }
}

async function collectSourceSnapshots(worktreePath, allowedFiles, run, options = {}) {
  const tracked = run('git.exe', ['-C', worktreePath, 'ls-files', '--', ...allowedFiles], { cwd: worktreePath });
  if (tracked.error || tracked.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_SOURCE_CONTEXT_ENUMERATION_FAILED:${text(tracked.stderr || tracked.stdout)}`);
  }
  const enumeratedFiles = [...new Set(tracked.stdout.trim().split(/\r?\n/).map(normalizePath).filter(Boolean))].sort();
  const repositoryWide = allowedFiles.some((scope) => normalizePath(scope) === '**');
  const scopedFiles = repositoryWide
    ? enumeratedFiles.filter((path) => pathAllowed(path, allowedFiles))
    : enumeratedFiles;
  const files = rankSourceContextPaths(scopedFiles, options.sourceContextHint);
  if (!files.length) return Object.freeze([]);

  const lstatImpl = options.sourceContextLstatImpl || lstat;
  const realpathImpl = options.sourceContextRealpathImpl || fsRealpath;
  const readFileImpl = options.sourceContextReadFileImpl || readFile;
  const worktreeRealpath = await realpathImpl(worktreePath);
  let totalBytes = 0;
  const snapshot = [];
  for (const path of files) {
    if (!pathAllowed(path, allowedFiles)) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_CONTEXT_SCOPE_VIOLATION:${path}`);
    }
    const absolutePath = resolve(worktreePath, path);
    const fileStat = await lstatImpl(absolutePath);
    if (fileStat?.isSymbolicLink?.() === true) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_CONTEXT_SYMLINK_REJECTED:${path}`);
    }
    const fileRealpath = await realpathImpl(absolutePath);
    const rel = relative(worktreeRealpath, fileRealpath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_CONTEXT_PATH_ESCAPE:${path}`);
    }
    const bytes = await readFileImpl(absolutePath);
    if (bytes.length > MAX_PER_FILE_BYTES) continue;
    if (totalBytes + bytes.length > MAX_TOTAL_BYTES) continue;
    totalBytes += bytes.length;
    snapshot.push(Object.freeze({ path, content: bytes.toString('utf8') }));
  }
  return Object.freeze(snapshot);
}

async function hydrateStructuredEditTargetSnapshots(worktreePath, edits, allowedFiles, sourceSnapshots, options = {}) {
  const hydrated = [...(Array.isArray(sourceSnapshots) ? sourceSnapshots : [])];
  const known = new Set(hydrated.map((entry) => normalizePath(entry?.path)).filter(Boolean));
  const requested = [...new Set((Array.isArray(edits) ? edits : [])
    .map((edit) => normalizePath(edit?.path))
    .filter(Boolean))].sort();
  const missing = requested.filter((path) => !known.has(path));
  if (!missing.length) return Object.freeze(hydrated);
  const outsideScope = missing.find((path) => path.includes('..') || !pathAllowed(path, allowedFiles));
  if (outsideScope) {
    throw new Error(`PROVIDER_NEUTRAL_SCOPE_VIOLATION:${outsideScope || 'invalid-path'}`);
  }

  const run = options.runCommand || defaultRun;
  const tracked = run(
    'git.exe',
    ['-C', worktreePath, 'ls-files', '-z', '--', ...missing],
    { cwd: worktreePath },
  );
  if (tracked.error || tracked.status !== 0) {
    throw new Error('PROVIDER_NEUTRAL_SOURCE_CONTEXT_TRACKED_QUERY_FAILED');
  }
  const trackedPaths = new Set(String(tracked.stdout || '').split('\0').map(normalizePath).filter(Boolean));
  const untracked = missing.find((path) => !trackedPaths.has(path)
    && edits.some((edit) => normalizePath(edit?.path) === path && edit?.old !== ''));
  if (untracked) {
    throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_TARGET_NOT_TRACKED:${untracked}`);
  }

  const lstatImpl = options.sourceContextLstatImpl || lstat;
  const realpathImpl = options.sourceContextRealpathImpl || fsRealpath;
  const readFileImpl = options.sourceContextReadFileImpl || readFile;
  const worktreeRealpath = await realpathImpl(worktreePath);

  // Absent new-file targets use the existing scoped creation path. Hydrate
  // tracked replacement targets without reclassifying existing ignored files.
  for (const path of missing.filter((entry) => trackedPaths.has(entry))) {
    if (path.includes('..') || !pathAllowed(path, allowedFiles)) {
      throw new Error(`PROVIDER_NEUTRAL_SCOPE_VIOLATION:${path || 'invalid-path'}`);
    }
    const absolutePath = resolve(worktreePath, path);
    const fileStat = await lstatImpl(absolutePath);
    if (fileStat?.isSymbolicLink?.() === true) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_CONTEXT_SYMLINK_REJECTED:${path}`);
    }
    const fileRealpath = await realpathImpl(absolutePath);
    const rel = relative(worktreeRealpath, fileRealpath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`PROVIDER_NEUTRAL_SOURCE_CONTEXT_PATH_ESCAPE:${path}`);
    }
    const bytes = await readFileImpl(absolutePath);
    if (bytes.length > MAX_PER_FILE_BYTES) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTEXT_TOO_LARGE:${path}`);
    }
    hydrated.push(Object.freeze({ path, content: bytes.toString('utf8') }));
    known.add(path);
  }
  return Object.freeze(hydrated);
}

function normalizeStructuredEdits(edits, allowedFiles, sourceSnapshots) {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_STRUCTURED_EDITS) {
    throw new Error('PROVIDER_NEUTRAL_STRUCTURED_EDITS_INVALID');
  }
  const snapshots = new Map(
    (Array.isArray(sourceSnapshots) ? sourceSnapshots : [])
      .map((entry) => [normalizePath(entry?.path), entry]),
  );
  let totalBytes = 0;
  const normalized = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
      throw new Error('PROVIDER_NEUTRAL_STRUCTURED_EDIT_INVALID');
    }
    const keys = Object.keys(edit).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['new', 'old', 'path'])) {
      throw new Error('PROVIDER_NEUTRAL_STRUCTURED_EDIT_SHAPE_INVALID');
    }
    const path = normalizePath(edit.path);
    const oldText = typeof edit.old === 'string' ? edit.old : null;
    const newText = typeof edit.new === 'string' ? edit.new : null;
    if (!path || path.includes('..') || !pathAllowed(path, allowedFiles)) {
      throw new Error(`PROVIDER_NEUTRAL_SCOPE_VIOLATION:${path || 'invalid-path'}`);
    }
    const snapshotBacked = snapshots.has(path);
    if (oldText === null || newText === null || oldText === newText) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID:${path}`);
    }
    if (snapshotBacked && oldText.length === 0) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID:${path}`);
    }
    if (!snapshotBacked && oldText.length > 0) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTEXT_REQUIRED:${path}`);
    }
    if (!snapshotBacked && newText.length === 0) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID:${path}`);
    }
    totalBytes += Buffer.byteLength(oldText, 'utf8') + Buffer.byteLength(newText, 'utf8');
    if (totalBytes > MAX_STRUCTURED_EDIT_BYTES) {
      throw new Error('PROVIDER_NEUTRAL_STRUCTURED_EDIT_TOO_LARGE');
    }
    normalized.push(Object.freeze({ path, old: oldText, new: newText }));
  }
  return Object.freeze(normalized);
}

async function applyStructuredEdits(worktreePath, edits, sourceSnapshots, options = {}) {
  const lstatImpl = options.sourceContextLstatImpl || lstat;
  const realpathImpl = options.sourceContextRealpathImpl || fsRealpath;
  const readFileImpl = options.sourceContextReadFileImpl || readFile;
  const writeFileImpl = options.sourceContextWriteFileImpl || writeFile;
  const worktreeResolved = resolve(worktreePath);
  const worktreeRealpath = await realpathImpl(worktreeResolved);
  const snapshotByPath = new Map(
    (Array.isArray(sourceSnapshots) ? sourceSnapshots : [])
      .map((entry) => [normalizePath(entry?.path), entry]),
  );
  const targetPaths = [...new Set(edits.map((edit) => edit.path))].sort();
  const originalByPath = new Map();
  const rollbackSnapshot = [];

  for (const path of targetPaths) {
    const expected = snapshotByPath.get(path);
    const absolutePath = resolve(worktreeResolved, path);
    const lexicalRel = relative(worktreeResolved, absolutePath);
    if (lexicalRel.startsWith('..') || isAbsolute(lexicalRel)) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_PATH_ESCAPE:${path}`);
    }
    if (!expected) {
      if (existsSync(absolutePath)) {
        throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_NEW_FILE_ALREADY_EXISTS:${path}`);
      }
      const parentRealpath = await realpathImpl(dirname(absolutePath));
      const parentRel = relative(worktreeRealpath, parentRealpath);
      if (parentRel.startsWith('..') || isAbsolute(parentRel)) {
        throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_PATH_ESCAPE:${path}`);
      }
      originalByPath.set(path, '');
      rollbackSnapshot.push(Object.freeze({ path, existed: false, bytes: Buffer.alloc(0) }));
      continue;
    }
    const fileStat = await lstatImpl(absolutePath);
    if (fileStat?.isSymbolicLink?.() === true) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_SYMLINK_REJECTED:${path}`);
    }
    const fileRealpath = await realpathImpl(absolutePath);
    const rel = relative(worktreeRealpath, fileRealpath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_PATH_ESCAPE:${path}`);
    }
    const bytes = await readFileImpl(absolutePath);
    const current = bytes.toString('utf8');
    if (current !== String(expected.content ?? '')) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_SOURCE_STALE:${path}`);
    }
    originalByPath.set(path, current);
    rollbackSnapshot.push(Object.freeze({ path, existed: true, bytes }));
  }

  const nextByPath = new Map(originalByPath);
  for (const edit of edits) {
    const current = nextByPath.get(edit.path);
    if (edit.old === '') {
      if (current !== '') {
        throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_ANCHOR_MISMATCH:${edit.path}`);
      }
      nextByPath.set(edit.path, edit.new);
      continue;
    }
    const first = current.indexOf(edit.old);
    const last = current.lastIndexOf(edit.old);
    if (first < 0 || first !== last) {
      throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_ANCHOR_MISMATCH:${edit.path}`);
    }
    nextByPath.set(
      edit.path,
      current.slice(0, first) + edit.new + current.slice(first + edit.old.length),
    );
  }

  try {
    for (const path of targetPaths) {
      const saved = rollbackSnapshot.find((entry) => entry.path === path);
      await writeFileImpl(
        resolve(worktreePath, path),
        nextByPath.get(path),
        saved?.existed === false ? { encoding: 'utf8', flag: 'wx' } : 'utf8',
      );
    }
  } catch (error) {
    for (const saved of rollbackSnapshot) {
      if (saved.existed === true) {
        await writeFile(resolve(worktreePath, saved.path), saved.bytes);
      } else {
        await rm(resolve(worktreePath, saved.path), { force: true });
      }
    }
    throw error;
  }
  return Object.freeze(rollbackSnapshot);
}

async function restoreStructuredEditSnapshot(worktreePath, snapshot, run) {
  const candidates = [...new Set((Array.isArray(snapshot) ? snapshot : [])
    .map((entry) => normalizePath(entry?.path))
    .filter(Boolean))].sort();
  for (const saved of Array.isArray(snapshot) ? snapshot : []) {
    if (!saved?.path || ![true, false].includes(saved.existed) || !Buffer.isBuffer(saved.bytes)) {
      throw new Error('PROVIDER_NEUTRAL_STRUCTURED_EDIT_ROLLBACK_SNAPSHOT_INVALID');
    }
    if (saved.existed === true) {
      await writeFile(resolve(worktreePath, saved.path), saved.bytes);
    } else {
      await rm(resolve(worktreePath, saved.path), { force: true });
    }
  }
  const status = run(
    'git.exe',
    ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all', ...(candidates.length ? ['--', ...candidates] : [])],
    { cwd: worktreePath },
  );
  if (status.error || status.status !== 0) {
    throw new Error('PROVIDER_NEUTRAL_STRUCTURED_EDIT_ROLLBACK_STATUS_FAILED');
  }
  if (text(status.stdout)) {
    throw new Error(`PROVIDER_NEUTRAL_STRUCTURED_EDIT_ROLLBACK_LEFT_CHANGES:${text(status.stdout)}`);
  }
}

async function loadAuthoritativeGoalContext(action = {}, claim = {}, options = {}) {
  if (typeof options.loadGoalContext === 'function') {
    return text(await options.loadGoalContext(action, claim)).slice(0, MAX_GOAL_CONTEXT_BYTES);
  }
  const issueNumber = Number(claim?.item?.actionGrant?.issueNumber);
  const repositoryMatch = text(action.repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || !repositoryMatch) return '';
  const auth = options.githubAuth || await resolveGithubTokenConfig({
    env: options.env || process.env,
    ghTokenProvider: options.ghTokenProvider,
  });
  // Scheduler resource IDs are normalized to lowercase, while the existing
  // canonical GitHub goal reader requires the repository's exact display casing.
  // Verify the allowlisted identity before restoring that casing; never let a
  // lookalike repository supply authoritative goal instructions to Forge.
  if (`${repositoryMatch[1]}/${repositoryMatch[2]}`.toLowerCase() !== 'cheekyfellastef/stephan-os') return '';
  const issue = await readGithubGoalIssue({
    owner: 'Cheekyfellastef',
    repo: 'stephan-os',
    issueNumber,
    auth,
    ghTokenProvider: options.ghTokenProvider,
    fetchImpl: options.githubFetchImpl || fetch,
  });
  const labels = Array.isArray(issue?.labels)
    ? issue.labels.map((label) => text(typeof label === 'string' ? label : label?.name).toLowerCase())
    : [];
  const authorityCurrent = issue?.ok !== false
    && Number(issue?.number) === issueNumber
    && text(issue?.state).toLowerCase() === 'open'
    && !issue?.pull_request
    && labels.includes('goal');
  if (!authorityCurrent) return '';
  return text(issue?.body).slice(0, MAX_GOAL_CONTEXT_BYTES);
}

function localBuilderPrompt(action = {}, sourceSnapshots = []) {
  const sourceSnapshotsSection = sourceSnapshots.length
    ? `\nSource snapshots:\n${JSON.stringify(sourceSnapshots, null, 2)}\n`
    : '';
  const mutationInstructions = sourceSnapshots.length
    ? [
        'Return JSON only with keys edits and summary.',
        'edits must be a non-empty array of objects with exactly path, old, and new string fields.',
        'Prefer structured edits for paths present in the supplied Source snapshots.',
        'For an existing file, each path must be one of the supplied Source snapshots and old must be copied exactly from that snapshot, be non-empty, and occur exactly once at the point it is applied.',
        'To create a new allowed file that is absent from Source snapshots, use old as the empty string and new as the complete file contents.',
        'new is the exact replacement text or complete new-file contents.',
        'Do not return a unified diff when Source snapshots are supplied.',
      ]
    : [
        'Return JSON only with keys edits and summary.',
        'edits must be a non-empty array with exactly path, old, and new string fields.',
        'There are no tracked source snapshots for this scope. Prefer creating one genuinely absent allowed file.',
        'For each new file use old as the empty string and new as its complete, literal contents.',
        'Never invent old contents or overwrite an existing, ignored, or protected file.',
        'Do not hand-write a unified diff for a new file; the guarded structured-edit path handles creation.',
        'A legacy JSON object with patch and summary is accepted only as a fallback for a valid git diff.',
      ];
  const goalContextSection = text(action.goalContext)
    ? `\nAuthoritative GitHub goal context:\n${text(action.goalContext)}\n`
    : '';
  return [
    'You are the bounded Stephanos source builder.',
    `Mission ID: ${text(action.missionId)}`,
    `Operator intent: ${text(action.operatorIntent)}`,
    `Intended outcome: ${text(action.intendedOutcome)}`,
    `Allowed source files: ${JSON.stringify(action.allowedFiles || [])}`,
    `Required tests: ${JSON.stringify(action.requiredTests || [])}`,
    goalContextSection,
    sourceSnapshotsSection,
    'Source snapshots are bounded context and may omit allowed files; do not assume omitted files do not exist.',
    '',
    ...mutationInstructions,
    'Only modify paths allowed by Allowed source files.',
    'Do not modify .git, dependencies, runtime data, secrets, environment files, generated output or protected main.',
    'Do not commit, push, merge or create branches.',
    'Make the smallest implementation that satisfies the intended outcome.',
  ].join('\n');
}

function modelStructuredEditsContractValid(edits) {
  return Array.isArray(edits)
    && edits.length > 0
    && edits.length <= MAX_STRUCTURED_EDITS
    && edits.every((edit) => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return false;
      const keys = Object.keys(edit).sort();
      if (keys.length !== 3 || keys[0] !== 'new' || keys[1] !== 'old' || keys[2] !== 'path') return false;
      return typeof edit.path === 'string'
        && text(edit.path).length > 0
        && typeof edit.old === 'string'
        && typeof edit.new === 'string'
        && (edit.old.length > 0 || edit.new.length > 0);
    });
}

function modelPatchFallbackAllowed(_action = {}, sourceSnapshots = []) {
  return sourceSnapshots.length === 0;
}

async function callLocalBuilder(action, options = {}) {
  const sourceSnapshots = Array.isArray(options.sourceSnapshots) ? options.sourceSnapshots : [];
  if (typeof options.generatePatch === 'function') return options.generatePatch(action, { sourceSnapshots });
  const env = options.env || process.env;
  const endpoint = text(options.ollamaEndpoint || env.STEPHANOS_OLLAMA_ENDPOINT, 'http://127.0.0.1:11434/api/chat');
  const model = text(options.model || env.STEPHANOS_LOCAL_BUILDER_MODEL, 'qwen3-coder:30b');
  const fetchImpl = options.localModelFetchImpl || fetch;
  const patchFallbackAllowed = modelPatchFallbackAllowed(action, sourceSnapshots);
  let finalError = sourceSnapshots.length
    ? 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING'
    : 'PROVIDER_NEUTRAL_MODEL_PATCH_MISSING';

  for (let attempt = 1; attempt <= MAX_LOCAL_MODEL_ATTEMPTS; attempt += 1) {
    const retryReason = text(finalError).replace(/[\r\n]/g, ' ').slice(0, 240);
    const retryInstruction = attempt > 1
      ? '\nYour previous response did not satisfy the required machine-readable mutation contract. Validator reason: ' + retryReason + '. Return only the requested JSON object with a corrected mutation. Do not explain, apologize, or wrap it in Markdown.\n'
      : '';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: localBuilderPrompt(action, sourceSnapshots) + retryInstruction }],
        options: { temperature: 0.1 },
      }),
    });
    if (!response.ok) throw new Error(`PROVIDER_NEUTRAL_MODEL_HTTP_${response.status}`);
    const payload = await response.json();
    let parsed;
    try {
      parsed = JSON.parse(text(payload?.message?.content));
    } catch {
      finalError = 'PROVIDER_NEUTRAL_MODEL_RESULT_INVALID_JSON';
      continue;
    }
    // An empty snapshot set usually means a scoped file-creation goal, not a
    // reason to force brittle model-authored unified diffs. The guarded
    // structured-edit path already verifies absent targets, scope and rollback.
    if (modelStructuredEditsContractValid(parsed?.edits)) {
      try {
        normalizeStructuredEdits(parsed.edits, action.allowedFiles, sourceSnapshots);
        return { edits: parsed.edits, summary: text(parsed?.summary) };
      } catch (error) {
        finalError = text(error?.message, 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_INVALID');
        continue;
      }
    }
    const patch = typeof parsed?.patch === 'string' ? parsed.patch : '';
    if (patchFallbackAllowed && patch.startsWith('diff --git ')) return { patch, summary: text(parsed?.summary) };
    finalError = sourceSnapshots.length
      ? 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING'
      : 'PROVIDER_NEUTRAL_MODEL_PATCH_MISSING';
  }
  throw new Error(finalError);
}

function parseBoundedTestCommand(command) {
  const normalized = text(command);
  if (!normalized || /[&|><^`\r\n]/.test(normalized)) return null;
  if (normalized === 'npm run stephanos:verify') {
    return {
      executable: 'node.exe',
      args: ['scripts/verify-stephanos-dist.mjs'],
      command: normalized,
    };
  }
  const parts = normalized.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!parts?.length) return null;
  const tokens = parts.map((part) => (
    (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))
      ? part.slice(1, -1)
      : part
  ));
  const requested = tokens.shift().toLowerCase();
  if (!['node', 'node.exe'].includes(requested)) return null;
  if (!tokens.length || !['--test', '--check'].includes(tokens[0])) return null;
  return { executable: 'node.exe', args: tokens, command: normalized };
}

function generatedDistStatus(worktreePath, run) {
  return run(
    'git.exe',
    ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all', '--', 'apps/stephanos/dist'],
    { cwd: worktreePath },
  );
}

function restoreEphemeralGeneratedDist(worktreePath, run) {
  const tracked = run(
    'git.exe',
    ['-C', worktreePath, 'ls-files', '--', 'apps/stephanos/dist'],
    { cwd: worktreePath },
  );
  if (tracked.error || tracked.status !== 0) {
    return { ok: false, reason: 'PROVIDER_NEUTRAL_VERIFY_DIST_TRACKED_PATHS_UNPROVEN', result: tracked };
  }
  if (text(tracked.stdout)) {
    const restore = run(
      'git.exe',
      ['-C', worktreePath, 'restore', '--worktree', '--', 'apps/stephanos/dist'],
      { cwd: worktreePath },
    );
    if (restore.error || restore.status !== 0) {
      return { ok: false, reason: 'PROVIDER_NEUTRAL_VERIFY_DIST_RESTORE_FAILED', result: restore };
    }
  }
  const clean = run(
    'git.exe',
    ['-C', worktreePath, 'clean', '-fd', '--', 'apps/stephanos/dist'],
    { cwd: worktreePath },
  );
  if (clean.error || clean.status !== 0) {
    return { ok: false, reason: 'PROVIDER_NEUTRAL_VERIFY_DIST_CLEAN_FAILED', result: clean };
  }
  const status = generatedDistStatus(worktreePath, run);
  if (status.error || status.status !== 0 || text(status.stdout)) {
    return { ok: false, reason: 'PROVIDER_NEUTRAL_VERIFY_DIST_CLEANUP_UNPROVEN', result: status };
  }
  return { ok: true, reason: '', result: status };
}

function prepareEphemeralUiDependencyLink(worktreePath, options = {}) {
  const worktreeModules = resolve(worktreePath, 'stephanos-ui', 'node_modules');
  if (existsSync(worktreeModules)) return { created: false, path: worktreeModules };

  const canonicalRepoRoot = text(options.repoRoot);
  if (!canonicalRepoRoot || resolve(canonicalRepoRoot) === resolve(worktreePath)) {
    return { created: false, path: '' };
  }
  const canonicalModules = resolve(canonicalRepoRoot, 'stephanos-ui', 'node_modules');
  if (!existsSync(canonicalModules)) return { created: false, path: '' };

  symlinkSync(canonicalModules, worktreeModules, process.platform === 'win32' ? 'junction' : 'dir');
  return { created: true, path: worktreeModules };
}

function runEphemeralStephanosVerify(worktreePath, run, options = {}) {
  const before = generatedDistStatus(worktreePath, run);
  if (before.error || before.status !== 0) {
    return {
      status: 1,
      stdout: before.stdout || '',
      stderr: `PROVIDER_NEUTRAL_VERIFY_DIST_STATUS_FAILED:${text(before.stderr || before.stdout)}`,
      error: before.error || null,
    };
  }
  if (text(before.stdout)) {
    return {
      status: 1,
      stdout: before.stdout || '',
      stderr: `PROVIDER_NEUTRAL_VERIFY_DIST_PREEXISTING_DIRT:${text(before.stdout)}`,
      error: null,
    };
  }

  let dependencyLink = { created: false, path: '' };
  let result = { status: 1, stdout: '', stderr: 'PROVIDER_NEUTRAL_STEPHANOS_VERIFY_NOT_RUN', error: null };
  try {
    dependencyLink = prepareEphemeralUiDependencyLink(worktreePath, options);
    const build = run('node.exe', ['scripts/build-stephanos-ui.mjs'], {
      cwd: worktreePath,
      env: options.env || process.env,
    });
    if (build.error || build.status !== 0) {
      result = {
        status: Number.isInteger(build.status) ? build.status : 1,
        stdout: build.stdout || '',
        stderr: `PROVIDER_NEUTRAL_STEPHANOS_BUILD_FAILED:${text(build.stderr || build.stdout)}`,
        error: build.error || null,
      };
    } else {
      const verify = run('node.exe', ['scripts/verify-stephanos-dist.mjs'], {
        cwd: worktreePath,
        env: options.env || process.env,
      });
      result = {
        status: Number.isInteger(verify.status) ? verify.status : 1,
        stdout: `${build.stdout || ''}\n${verify.stdout || ''}`,
        stderr: `${build.stderr || ''}\n${verify.stderr || ''}`,
        error: verify.error || null,
      };
    }
  } catch (error) {
    result = {
      status: 1,
      stdout: '',
      stderr: `PROVIDER_NEUTRAL_STEPHANOS_VERIFY_SETUP_FAILED:${text(error?.message || error)}`,
      error,
    };
  } finally {
    const cleanup = restoreEphemeralGeneratedDist(worktreePath, run);
    if (!cleanup.ok) {
      result = {
        status: 1,
        stdout: result.stdout || '',
        stderr: `${result.stderr || ''}\n${cleanup.reason}:${text(cleanup.result?.stderr || cleanup.result?.stdout)}`,
        error: result.error || cleanup.result?.error || null,
      };
    }
    if (dependencyLink.created && dependencyLink.path) {
      try {
        rmSync(dependencyLink.path, { recursive: true, force: true });
      } catch (error) {
        result = {
          status: 1,
          stdout: result.stdout || '',
          stderr: `${result.stderr || ''}\nPROVIDER_NEUTRAL_VERIFY_DEPENDENCY_LINK_CLEANUP_FAILED:${text(error?.message || error)}`,
          error: result.error || error,
        };
      }
    }
  }
  return result;
}

function runRequiredTests(action, worktreePath, run, options = {}) {
  const tests = Array.isArray(action.requiredTests) ? action.requiredTests.map(text).filter(Boolean) : [];
  if (!tests.length) throw new Error('PROVIDER_NEUTRAL_REQUIRED_TESTS_REQUIRED');
  const receipts = [];
  for (const command of tests) {
    const parsed = parseBoundedTestCommand(command);
    if (!parsed) throw new Error(`PROVIDER_NEUTRAL_TEST_COMMAND_UNSAFE:${command}`);
    const result = command === 'npm run stephanos:verify'
      ? runEphemeralStephanosVerify(worktreePath, run, options)
      : run(parsed.executable, parsed.args, { cwd: worktreePath, env: options.env || process.env });
    if (result.error || result.status !== 0) {
      const error = new Error(`PROVIDER_NEUTRAL_TEST_FAILED:${command}`);
      error.command = command;
      error.stdout = result.stdout || '';
      error.stderr = result.stderr || '';
      throw error;
    }
    receipts.push(Object.freeze({
      receiptId: `provider-neutral-test-${createHash('sha256').update(command).digest('hex').slice(0, 20)}`,
      requirement: 'source deterministic test',
      testCommand: command,
      source: 'provider-neutral-local-builder',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: commandResultHash(result),
      createdAt: new Date().toISOString(),
    }));
  }
  return Object.freeze(receipts);
}

async function claimExternal(options = {}) {
  const claimNext = options.claimNext || claimNextMissionWorkerItem;
  const preferred = text(options.preferredAdapter || options.actionGrant?.adapter).toLowerCase();
  const adapters = preferred && EXTERNAL_ADAPTERS.includes(preferred)
    ? [preferred]
    : [...EXTERNAL_ADAPTERS];
  for (const adapter of adapters) {
    const claim = await claimNext(adapter, options);
    if (claim) return claim;
  }
  return null;
}

export async function processNextProviderNeutralSourceBuild(options = {}) {
  const pendingQueueDiagnostics = [];
  const claim = await claimExternal({
    ...options,
    onPendingQueueDiagnostic: async (diagnostic) => {
      pendingQueueDiagnostics.push(diagnostic);
      if (typeof options.onPendingQueueDiagnostic === 'function') {
        await options.onPendingQueueDiagnostic(diagnostic);
      }
    },
  });
  if (!claim) {
    const quarantined = pendingQueueDiagnostics.find(
      (diagnostic) => diagnostic?.reason === 'MISSION_WORKER_PENDING_ITEM_QUARANTINED',
    );
    return Object.freeze({
      processed: false,
      success: false,
      reason: quarantined?.reason || 'queue-empty',
      pendingQueueDiagnostics: Object.freeze([...pendingQueueDiagnostics]),
      failureStage: quarantined ? 'CLAIM' : '',
      finalVerdict: quarantined ? 'PROVIDER_NEUTRAL_PENDING_QUEUE_RECOVERY' : '',
    });
  }
  const action = claim.item?.payload || {};
  const worktreePath = text(action.worktreePath);
  const run = options.runCommand || defaultRun;
  const collectResult = options.collectAgentWorkerResult || collectAgentWorkerResult;
  const completedAt = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  let patchPath = '';
  let mutationApplied = false;
  let structuredEditsApplied = false;
  let patchRecountUsed = false;
  let succeeded = false;
  let providerInvoked = false;
  let providerCompleted = false;
  let executionReceipt = null;
  let mutationSnapshot = [];
  let mutationEvidence = '';
  try {
    if (action.actionKind !== 'agent-handoff' || !EXTERNAL_ADAPTERS.includes(claim.adapter)) {
      throw new Error('PROVIDER_NEUTRAL_ACTION_NOT_SOURCE_BUILD');
    }
    if (!worktreePath || !existsSync(worktreePath)) throw new Error('PROVIDER_NEUTRAL_WORKTREE_REQUIRED');
    if (!Array.isArray(action.allowedFiles) || action.allowedFiles.length === 0) throw new Error('PROVIDER_NEUTRAL_ALLOWED_FILES_REQUIRED');

    executionReceipt = await beginMissionWorkerExecutionReceiptChain(claim, options);

    const startingChanges = changedFiles(worktreePath, run);
    if (startingChanges.length) throw new Error(`PROVIDER_NEUTRAL_WORKTREE_NOT_CLEAN:${startingChanges.join(',')}`);

    const effectiveAllowedFiles = resolveTrackedScopeCase(worktreePath, action.allowedFiles, run);
    const sourceBuildAction = Object.freeze({ ...action, allowedFiles: effectiveAllowedFiles });

    // Hydrate the canonical GitHub goal before source construction. Elastic goal missions must not
    // ask a local model to infer an issue body from the title alone.
    const goalContext = typeof options.generatePatch === 'function'
      ? text(options.goalContext)
      : await loadAuthoritativeGoalContext(action, claim, options);
    if (/^critical-[1-9]\d*-elastic-goal(?:$|[-_.])/i.test(text(action.missionId)) && !goalContext) {
      throw new Error('PROVIDER_NEUTRAL_AUTHORITATIVE_GOAL_CONTEXT_UNAVAILABLE');
    }

    // Collect bounded source snapshots, ranking repository-wide context toward the actual goal language.
    const sourceContextHint = [
      action.intendedOutcome,
      action.operatorIntent,
      goalContext,
    ].map(text).filter(Boolean).join('\n');
    const sourceSnapshots = await collectSourceSnapshots(
      worktreePath,
      sourceBuildAction.allowedFiles,
      run,
      { ...options, sourceContextHint },
    );
    providerInvoked = true;
    const generated = await callLocalBuilder(
      { ...sourceBuildAction, goalContext },
      { ...options, sourceSnapshots },
    );
    providerCompleted = true;

    if (Array.isArray(generated.edits)) {
      const structuredEditSnapshots = await hydrateStructuredEditTargetSnapshots(
        worktreePath,
        generated.edits,
        sourceBuildAction.allowedFiles,
        sourceSnapshots,
        options,
      );
      const edits = normalizeStructuredEdits(generated.edits, sourceBuildAction.allowedFiles, structuredEditSnapshots);
      mutationSnapshot = await applyStructuredEdits(worktreePath, edits, structuredEditSnapshots, options);
      mutationEvidence = JSON.stringify(edits);
      structuredEditsApplied = true;
      mutationApplied = true;
    } else {
      const patch = typeof generated.patch === 'string' ? generated.patch : '';
      mutationSnapshot = await snapshotPatchTargets(worktreePath, patch, sourceBuildAction.allowedFiles);
      patchPath = text(claim.processingPath)
        ? claim.processingPath + '.provider-neutral.patch'
        : resolve(worktreePath, '..', `.stephanos-${text(action.actionId, 'source-build')}.patch`);
      await writeFile(patchPath, patch, { encoding: 'utf8', flag: 'wx' });

      let applyArgs = ['-C', worktreePath, 'apply', '--whitespace=error-all', patchPath];
      let check = run('git.exe', ['-C', worktreePath, 'apply', '--check', '--whitespace=error-all', patchPath], { cwd: worktreePath });
      if (check.error || check.status !== 0) {
        const recountCheck = run(
          'git.exe',
          ['-C', worktreePath, 'apply', '--recount', '--check', '--whitespace=error-all', patchPath],
          { cwd: worktreePath },
        );
        if (recountCheck.error || recountCheck.status !== 0) {
          throw new Error(`PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:${text(recountCheck.stderr || recountCheck.stdout || check.stderr || check.stdout)}`);
        }
        check = recountCheck;
        patchRecountUsed = true;
        applyArgs = ['-C', worktreePath, 'apply', '--recount', '--whitespace=error-all', patchPath];
      }
      const apply = run('git.exe', applyArgs, { cwd: worktreePath });
      if (apply.error || apply.status !== 0) throw new Error(`PROVIDER_NEUTRAL_PATCH_APPLY_FAILED:${text(apply.stderr || apply.stdout)}`);
      mutationEvidence = patch;
      mutationApplied = true;
    }

    const files = changedFiles(worktreePath, run);
    if (files.length === 0) throw new Error('PROVIDER_NEUTRAL_SOURCE_UNCHANGED');
    const unsafe = files.filter((path) => !pathAllowed(path, sourceBuildAction.allowedFiles));
    if (unsafe.length) throw new Error(`PROVIDER_NEUTRAL_SCOPE_VIOLATION:${unsafe.join(',')}`);

    const sourceTestReceipts = runRequiredTests(action, worktreePath, run, options);
    const receipt = Object.freeze({
      receiptId: `provider-neutral-source-${text(action.actionId)}`.slice(0, 128),
      requirement: 'provider-neutral bounded source change',
      source: claim.adapter,
      evidenceType: 'source-mutation',
      verified: true,
      commandOutputHash: createHash('sha256').update(mutationEvidence).digest('hex'),
      createdAt: completedAt,
    });

    const execution = Object.freeze({
      success: true,
      resultId: text(action.actionId),
      changedFiles: Object.freeze(files),
      completedAt,
      receipt,
      evidenceReceipts: sourceTestReceipts,
      sourceTestReceipts,
      stage: 'TESTED',
      testsPassed: true,
      summary: generated.summary,
    });
    const finalized = await finalizeSourceArtifactEscrowFromWorktreeV1(
      action,
      execution,
      claim,
      {
        ...options,
        actionGrant: claim.item?.actionGrant || options.actionGrant,
        runCommand: run,
        repoRoot: options.repoRoot || action.repositoryRoot,
      },
    );
    if (!finalized.sourceArtifactEscrow || !finalized.offlinePublicationOutbox) {
      throw new Error('PROVIDER_NEUTRAL_OFFLINE_PUBLICATION_PRESERVATION_REQUIRED');
    }

    await collectResult({
      missionId: action.missionId,
      actionId: action.actionId,
      adapter: claim.adapter,
      success: true,
      resultId: finalized.resultId,
      changedFiles: finalized.changedFiles,
      sourceArtifactEscrow: finalized.sourceArtifactEscrow,
      offlinePublicationOutbox: finalized.offlinePublicationOutbox,
      receipt,
      evidenceReceipts: sourceTestReceipts,
      error: '',
    }, options);

    const completedResult = Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_SOURCE_BUILDER_SCHEMA,
      processed: true,
      success: true,
      adapter: claim.adapter,
      providerAdapter: claim.adapter,
      providerInvoked,
      providerCompleted,
      failureStage: '',
      missionId: text(action.missionId),
      actionId: text(action.actionId),
      changedFiles: finalized.changedFiles,
      testsPassed: finalized.testsPassed === true,
      sourceArtifactRef: finalized.sourceArtifactEscrow.artifactRef,
      offlinePublicationOutboxId: finalized.offlinePublicationOutbox.outboxId,
      preservationVerdict: 'PROVIDER_NEUTRAL_SOURCE_ESCROWED_FOR_OFFLINE_PUBLICATION',
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
    });
    if (executionReceipt) {
      executionReceipt = await appendMissionWorkerExecutionReceiptTransition(
        executionReceipt,
        'completed',
        options,
        {
          phase: 'provider-neutral-result-validated',
          timestampUtc: completedAt,
          proofRefs: [receipt.receiptId, ...sourceTestReceipts.map((item) => item.receiptId)],
          expectedNextAction: 'Release/refill may consume this terminal receipt after canonical completion gates pass.',
        },
      );
    }
    if (claim.paths) await finalizeMissionWorkerQueueClaim(claim, completedResult, true);
    succeeded = true;
    return completedResult;
  } catch (error) {
    let failure = error?.message || 'provider-neutral source build failed';
    if (mutationApplied && !succeeded) {
      const rollbackPaths = changedFiles(worktreePath, run);
      try {
        if (structuredEditsApplied) {
          await restoreStructuredEditSnapshot(worktreePath, mutationSnapshot, run);
        } else if (patchPath) {
          await reverseAppliedPatch(worktreePath, patchPath, run, rollbackPaths, mutationSnapshot, patchRecountUsed);
        }
      } catch (rollbackError) {
        failure = `${failure};${rollbackError?.message || 'PROVIDER_NEUTRAL_MUTATION_ROLLBACK_FAILED'}`;
      }
    }
    try {
      await collectResult({
        missionId: action.missionId,
        actionId: action.actionId,
        adapter: claim.adapter,
        success: false,
        changedFiles: [],
        error: failure,
      }, options);
    } catch { /* Preserve original failure. */ }
    const failedResult = Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_SOURCE_BUILDER_SCHEMA,
      processed: true,
      success: false,
      adapter: claim.adapter,
      providerAdapter: claim.adapter,
      providerInvoked,
      providerCompleted,
      failureStage: providerInvoked && !providerCompleted
        ? 'PROVIDER'
        : providerCompleted
          ? 'SOURCE_OR_TEST'
          : 'WORKER_PRE_PROVIDER',
      missionId: text(action.missionId),
      actionId: text(action.actionId),
      error: failure,
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED',
    });
    if (executionReceipt) {
      try {
        executionReceipt = await appendMissionWorkerExecutionReceiptTransition(
          executionReceipt,
          'failed',
          options,
          {
            phase: 'provider-neutral-result-blocked',
            blocker: failure,
            expectedNextAction: 'Surface blocker and keep mutation authority closed until a new bounded execution is admitted.',
          },
        );
      } catch (receiptError) {
        failure = `${failure};${receiptError?.message || 'PROVIDER_NEUTRAL_EXECUTION_RECEIPT_FINALIZATION_FAILED'}`;
      }
    }
    if (claim.paths) {
      try { await finalizeMissionWorkerQueueClaim(claim, failedResult, false); }
      catch (claimError) { failure = `${failure};${claimError?.message || 'PROVIDER_NEUTRAL_QUEUE_FINALIZATION_FAILED'}`; }
    }
    return failedResult;
  } finally {
    if (patchPath) await rm(patchPath, { force: true });
  }
}
