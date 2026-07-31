#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  createWriteStream,
  existsSync,
  readFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_CODEX_TASK_SCHEMA } from '../shared/agents/localCodexExecIntegration.mjs';
import {
  STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
  STEPHANOS_DIST_MANIFEST_MAX_FILES,
  STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
  STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION,
  computeStephanosDistFingerprint,
  computeStephanosDistManifestFingerprint,
  computeStephanosSourceFingerprint,
  createStephanosDistManifest,
} from './stephanos-build-utils.mjs';
import {
  extractCodexThreadId,
  publishRemoteCodexTaskVisibility,
} from '../shared/agents/remoteCodexTaskVisibility.mjs';
import {
  evaluateMusicRatingPreservesPlaybackScenarioEvidence,
} from './browser-proof-runner.mjs';

const APPROVED_GENERATED_PREFIXES = Object.freeze([
  'apps/stephanos/dist/',
]);
const CANONICAL_BROWSER_PROOF_URL = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';
const EXACT_SOURCE_FINGERPRINT = /^[0-9a-f]{64}$/;
const EXACT_DIST_FINGERPRINT = /^[0-9a-f]{64}$/;
const CANONICAL_RUNTIME_BUILD_TIMEOUT_MS = 15 * 60_000;
const CANONICAL_RUNTIME_WORKTREE_PREFIX = 'stephanos-exact-head-build-';
const CANONICAL_RUNTIME_DEPENDENCY_LINKS = Object.freeze([
  'stephanos-ui/node_modules',
  'node_modules',
]);
const BROWSER_RUNTIME_PROOF_SCHEMA = 'stephanos.browser-runtime-exact-head-proof.v3';
const MUSIC_RATING_PRESERVES_PLAYBACK = 'MUSIC_RATING_PRESERVES_PLAYBACK';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  try {
    renameSync(tempPath, path);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function gitCapture(repoRoot, args, spawnSyncFn = spawnSync) {
  const result = spawnSyncFn('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').replace(/\s+$/, ''),
    stderr: String(result.stderr || '').trim(),
    error: result.error?.message || '',
  };
}

function processCapture(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || '').trim().toLowerCase(),
  };
}

function processTextCapture(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || '').replace(/(?:\r?\n)+$/, ''),
  };
}

export function validateExactHeadAtWorkerStart(task, {
  spawnSyncFn = spawnSync,
  platform = process.platform,
  verificationPhase = 'worker-start',
  checkSourceStatus = true,
} = {}) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const proof = task.exactHeadProof;
  const expectedHead = String(proof.expectedHead || '').trim().toLowerCase();
  const repository = String(proof.repository || '').trim();
  const prNumber = Number(proof.prNumber);
  const expectedBranch = String(proof.branch || task.branch || 'main').trim();
  if (!/^[0-9a-f]{40}$/.test(expectedHead) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(prNumber) || prNumber <= 0 || expectedBranch !== 'main') {
    return Object.freeze({ ok: false, required: true, blocker: 'EXACT_HEAD_PROOF_INVALID', verificationPhase });
  }
  const gh = processCapture(
    spawnSyncFn,
    platform === 'win32' ? 'gh.exe' : 'gh',
    ['api', `repos/${repository}/pulls/${prNumber}`, '--jq', '.head.sha'],
  );
  if (!gh.ok || !/^[0-9a-f]{40}$/.test(gh.stdout)) {
    return Object.freeze({ ok: false, required: true, blocker: 'PR_HEAD_LOOKUP_FAILED', expectedHead, branch: expectedBranch, verificationPhase });
  }
  if (gh.stdout !== expectedHead) {
    return Object.freeze({ ok: false, required: true, blocker: 'PR_HEAD_MISMATCH', expectedHead, pullRequestHead: gh.stdout, branch: expectedBranch, verificationPhase });
  }
  const git = processCapture(
    spawnSyncFn,
    platform === 'win32' ? 'git.exe' : 'git',
    ['rev-parse', 'HEAD'],
    { cwd: task.repoRoot },
  );
  if (!git.ok || !/^[0-9a-f]{40}$/.test(git.stdout)) {
    return Object.freeze({ ok: false, required: true, blocker: 'LOCAL_HEAD_LOOKUP_FAILED', expectedHead, pullRequestHead: gh.stdout, branch: expectedBranch, verificationPhase });
  }
  if (git.stdout !== expectedHead) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'EXPECTED_HEAD_MISMATCH',
      expectedHead,
      pullRequestHead: gh.stdout,
      localHead: git.stdout,
      branch: expectedBranch,
      verificationPhase,
    });
  }
  if (!checkSourceStatus) {
    return Object.freeze({
      ok: true,
      required: true,
      expectedHead,
      pullRequestHead: gh.stdout,
      localHead: git.stdout,
      branch: expectedBranch,
      verificationPhase,
      sourceStatusChecked: false,
    });
  }
  const status = processTextCapture(
    spawnSyncFn,
    platform === 'win32' ? 'git.exe' : 'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: task.repoRoot },
  );
  if (!status.ok) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'LOCAL_SOURCE_STATUS_LOOKUP_FAILED',
      expectedHead,
      pullRequestHead: gh.stdout,
      localHead: git.stdout,
      branch: expectedBranch,
      expectedBranch,
      verificationPhase,
    });
  }
  const dirt = classifyPostTaskDirt(status.stdout);
  if (!dirt.safe) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'PRE_EXISTING_SOURCE_DIRT',
      expectedHead,
      pullRequestHead: gh.stdout,
      localHead: git.stdout,
      branch: expectedBranch,
      verificationPhase,
      sourcePaths: dirt.source,
    });
  }
  return Object.freeze({
    ok: true,
    required: true,
    expectedHead,
    pullRequestHead: gh.stdout,
    localHead: git.stdout,
    branch: expectedBranch,
    expectedBranch,
    verificationPhase,
    sourceDirtClean: true,
    generatedRuntimePaths: dirt.generated,
  });
}

function boundedText(value = '', limit = 4000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

export function parseGitStatusEntries(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const status = line.slice(0, 2);
      const pathText = line.length > 3 ? line.slice(3).trim() : '';
      if (!pathText) return [];
      return pathText.split(' -> ').map((item) => Object.freeze({
        status,
        path: item.replace(/^"|"$/g, '').replace(/\\/g, '/'),
      }));
    });
}

export function parseGitStatusPaths(output = '') {
  return parseGitStatusEntries(output).map((entry) => entry.path);
}

export function classifyPostTaskDirt(output = '') {
  const entries = parseGitStatusEntries(output);
  const paths = [...new Set(entries.map((entry) => entry.path))];
  const generatedEntries = entries.filter((entry) => APPROVED_GENERATED_PREFIXES.some((prefix) => entry.path.startsWith(prefix)));
  const sourceEntries = entries.filter((entry) => !generatedEntries.includes(entry));
  const generated = [...new Set(generatedEntries.map((entry) => entry.path))];
  const source = [...new Set(sourceEntries.map((entry) => entry.path))];
  return Object.freeze({ entries, paths, generatedEntries, sourceEntries, generated, source, safe: source.length === 0 });
}

function stableEntries(entries = []) {
  return entries
    .map((entry) => `${entry.status} ${entry.path}`)
    .sort((a, b) => a.localeCompare(b));
}

export function compareDirtSnapshots(before = {}, after = {}) {
  const sourceBefore = stableEntries(before.sourceEntries || []);
  const sourceAfter = stableEntries(after.sourceEntries || []);
  const generatedBefore = stableEntries(before.generatedEntries || []);
  const generatedAfter = stableEntries(after.generatedEntries || []);
  const sourceMutationDetected = JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter);
  const generatedRuntimeMutationDetected = JSON.stringify(generatedBefore) !== JSON.stringify(generatedAfter);
  const sourcePathsBefore = [...new Set((before.source || []).map(String))].sort();
  const sourcePathsAfter = [...new Set((after.source || []).map(String))].sort();
  return Object.freeze({
    sourceMutationDetected,
    generatedRuntimeMutationDetected,
    sourcePathsBefore,
    sourcePathsAfter,
    newSourcePaths: sourcePathsAfter.filter((path) => !sourcePathsBefore.includes(path)),
    removedSourcePaths: sourcePathsBefore.filter((path) => !sourcePathsAfter.includes(path)),
    preExistingSourceDirt: sourcePathsBefore.length > 0,
    sourceDirtUnchanged: !sourceMutationDetected,
  });
}

export function resolveExpectedSourceFingerprint(
  sourceFingerprintFactory,
  repoRoot,
) {
  try {
    const fingerprint = String(sourceFingerprintFactory(repoRoot) || '').trim().toLowerCase();
    return EXACT_SOURCE_FINGERPRINT.test(fingerprint) ? fingerprint : '';
  } catch {
    return '';
  }
}

export function resolveExpectedDistFingerprint(
  distFingerprintFactory,
  repoRoot,
) {
  try {
    const fingerprint = String(distFingerprintFactory(repoRoot) || '').trim().toLowerCase();
    return EXACT_DIST_FINGERPRINT.test(fingerprint) ? fingerprint : '';
  } catch {
    return '';
  }
}

export function validateExactHeadDistManifest(manifest = {}) {
  try {
    const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
    const totalBytes = entries.reduce((total, entry) => total + Number(entry?.size), 0);
    const fingerprint = computeStephanosDistManifestFingerprint(entries);
    const valid = (
      manifest?.schemaVersion === STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION
      && entries.length > 0
      && entries.length <= STEPHANOS_DIST_MANIFEST_MAX_FILES
      && entries.every((entry) => (
        Number.isSafeInteger(entry?.size)
        && entry.size >= 0
        && entry.size <= STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES
      ))
      && totalBytes <= STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES
      && manifest.fileCount === entries.length
      && manifest.totalBytes === totalBytes
      && manifest.fingerprint === fingerprint
      && EXACT_DIST_FINGERPRINT.test(fingerprint)
    );
    return Object.freeze({
      ok: valid,
      fingerprint: valid ? fingerprint : '',
      entries: valid ? Object.freeze([...entries]) : Object.freeze([]),
    });
  } catch {
    return Object.freeze({
      ok: false,
      fingerprint: '',
      entries: Object.freeze([]),
    });
  }
}

function runtimePath(repoRoot, ...parts) {
  return resolve(repoRoot, ...parts);
}

function runtimePathIsSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function createIsolatedRuntimeBuildWorkspace() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), CANONICAL_RUNTIME_WORKTREE_PREFIX));
  return Object.freeze({
    temporaryRoot,
    buildRoot: join(temporaryRoot, 'repo'),
  });
}

function cleanupIsolatedRuntimeBuildWorkspace({
  workspace,
  repoRoot,
  linkedPaths = [],
  worktreeAdded = false,
  spawnSyncFn,
} = {}) {
  if (!workspace) return Object.freeze({ ok: true });
  let cleanupError = '';
  let worktreeRemoved = !worktreeAdded;
  const temporaryDist = runtimePath(workspace.buildRoot, 'apps', 'stephanos', 'dist');
  try {
    if (existsSync(temporaryDist)) {
      if (runtimePathIsSymlink(temporaryDist)) {
        unlinkSync(temporaryDist);
      } else {
        rmSync(temporaryDist, { recursive: true, force: true });
      }
    }
  } catch (error) {
    cleanupError = `TEMPORARY_DIST_CLEANUP_FAILED:${boundedText(error?.message || error, 800)}`;
  }
  for (const linkedPath of linkedPaths) {
    try {
      if (existsSync(linkedPath) || runtimePathIsSymlink(linkedPath)) unlinkSync(linkedPath);
    } catch (error) {
      cleanupError ||= `DEPENDENCY_LINK_CLEANUP_FAILED:${boundedText(error?.message || error, 800)}`;
    }
  }
  if (worktreeAdded) {
    let removal;
    try {
      removal = spawnSyncFn('git', ['worktree', 'remove', workspace.buildRoot], {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: CANONICAL_RUNTIME_BUILD_TIMEOUT_MS,
      });
    } catch (error) {
      cleanupError ||= `WORKTREE_REMOVE_FAILED:${boundedText(error?.message || error, 800)}`;
    }
    if (removal && (removal.error || removal.status !== 0)) {
      cleanupError ||= `WORKTREE_REMOVE_FAILED:${boundedText(removal.stderr || removal.stdout || removal.error?.message, 800)}`;
    } else if (removal) {
      worktreeRemoved = true;
    }
  }
  try {
    if (worktreeRemoved && existsSync(workspace.temporaryRoot)) {
      rmSync(workspace.temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    cleanupError ||= `TEMPORARY_ROOT_CLEANUP_FAILED:${boundedText(error?.message || error, 800)}`;
  }
  return Object.freeze(cleanupError
    ? { ok: false, blocker: 'CANONICAL_RUNTIME_BUILD_WORKTREE_CLEANUP_FAILED', reason: cleanupError }
    : { ok: true });
}

function linkRuntimeDependencies(repoRoot, buildRoot, platform) {
  const linkedPaths = [];
  for (const relativePath of CANONICAL_RUNTIME_DEPENDENCY_LINKS) {
    const sourcePath = runtimePath(repoRoot, ...relativePath.split('/'));
    const targetPath = runtimePath(buildRoot, ...relativePath.split('/'));
    if (!existsSync(sourcePath) || existsSync(targetPath) || runtimePathIsSymlink(targetPath)) continue;
    mkdirSync(dirname(targetPath), { recursive: true });
    symlinkSync(sourcePath, targetPath, platform === 'win32' ? 'junction' : 'dir');
    linkedPaths.push(targetPath);
  }
  return linkedPaths;
}

function copyVerifiedRuntimeDist({ repoRoot, buildRoot, distManifestFactory }) {
  const sourceDist = runtimePath(buildRoot, 'apps', 'stephanos', 'dist');
  const targetDist = runtimePath(repoRoot, 'apps', 'stephanos', 'dist');
  if (!existsSync(sourceDist) || runtimePathIsSymlink(sourceDist)) {
    return Object.freeze({ ok: false, blocker: 'CANONICAL_RUNTIME_DIST_MISSING_OR_SYMLINK' });
  }
  let sourceStat;
  try {
    sourceStat = lstatSync(sourceDist);
  } catch {
    sourceStat = null;
  }
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    return Object.freeze({ ok: false, blocker: 'CANONICAL_RUNTIME_DIST_MISSING_OR_SYMLINK' });
  }
  if (runtimePathIsSymlink(targetDist)) {
    return Object.freeze({ ok: false, blocker: 'CANONICAL_RUNTIME_DESTINATION_SYMLINK' });
  }
  let sourceManifest;
  try {
    sourceManifest = distManifestFactory(buildRoot);
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: 'CANONICAL_RUNTIME_FINGERPRINT_FAILED',
      reason: boundedText(error?.message || error),
    });
  }
  const validatedSource = validateExactHeadDistManifest(sourceManifest);
  if (!validatedSource.ok) {
    return Object.freeze({ ok: false, blocker: 'CANONICAL_RUNTIME_FINGERPRINT_FAILED' });
  }
  mkdirSync(dirname(targetDist), { recursive: true });
  const stagingRoot = mkdtempSync(join(dirname(targetDist), '.stephanos-exact-head-dist-'));
  const stagedDist = runtimePath(stagingRoot, 'apps', 'stephanos', 'dist');
  const backupDist = `${targetDist}.previous-${randomUUID()}`;
  let previousDistMoved = false;
  let stagedDistInstalled = false;
  try {
    mkdirSync(dirname(stagedDist), { recursive: true });
    cpSync(sourceDist, stagedDist, { recursive: true, force: true, dereference: true });
    const stagedManifest = distManifestFactory(stagingRoot);
    const validatedStaged = validateExactHeadDistManifest(stagedManifest);
    if (!validatedStaged.ok || validatedStaged.fingerprint !== validatedSource.fingerprint) {
      return Object.freeze({ ok: false, blocker: 'CANONICAL_RUNTIME_DIST_BINDING_FAILED' });
    }
    if (existsSync(targetDist)) {
      renameSync(targetDist, backupDist);
      previousDistMoved = true;
    }
    renameSync(stagedDist, targetDist);
    stagedDistInstalled = true;
    const targetManifest = distManifestFactory(repoRoot);
    const validatedTarget = validateExactHeadDistManifest(targetManifest);
    if (!validatedTarget.ok || validatedSource.fingerprint !== validatedTarget.fingerprint) {
      rmSync(targetDist, { recursive: true, force: true });
      stagedDistInstalled = false;
      if (previousDistMoved) {
        renameSync(backupDist, targetDist);
        previousDistMoved = false;
      }
      return Object.freeze({ ok: false, blocker: 'CANONICAL_RUNTIME_DIST_BINDING_FAILED' });
    }
    if (previousDistMoved) {
      rmSync(backupDist, { recursive: true, force: true });
      previousDistMoved = false;
    }
    return Object.freeze({
      ok: true,
      distManifest: targetManifest,
      expectedDistFingerprint: validatedTarget.fingerprint,
    });
  } catch (error) {
    try {
      if (stagedDistInstalled && existsSync(targetDist)) rmSync(targetDist, { recursive: true, force: true });
      if (previousDistMoved && existsSync(backupDist)) {
        renameSync(backupDist, targetDist);
        previousDistMoved = false;
      }
    } catch (rollbackError) {
      return Object.freeze({
        ok: false,
        blocker: 'CANONICAL_RUNTIME_DIST_ROLLBACK_FAILED',
        reason: boundedText(rollbackError?.message || rollbackError),
      });
    }
    return Object.freeze({
      ok: false,
      blocker: 'CANONICAL_RUNTIME_DIST_COPY_FAILED',
      reason: boundedText(error?.message || error),
    });
  }
  finally {
    try {
      if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
      if (!previousDistMoved && existsSync(backupDist)) rmSync(backupDist, { recursive: true, force: true });
    } catch {
      // The caller will fail closed on the next generated-runtime status check.
    }
  }
}

export function prepareExactHeadRuntimeBundle(repoRoot, {
  spawnSyncFn = spawnSync,
  distManifestFactory = (root) => createStephanosDistManifest({ rootDir: root }),
  expectedHead = '',
  platform = process.platform,
  isolatedBuildWorkspaceFactory = createIsolatedRuntimeBuildWorkspace,
} = {}) {
  const isolated = Boolean(expectedHead);
  if (isolated && !/^[0-9a-f]{40}$/i.test(expectedHead)) {
    return Object.freeze({ ok: false, required: true, blocker: 'EXACT_HEAD_PROOF_INVALID' });
  }
  let workspace = null;
  let worktreeAdded = false;
  let linkedPaths = [];
  let result = null;
  try {
    const buildRoot = isolated
      ? (() => {
        const candidate = isolatedBuildWorkspaceFactory({ repoRoot, expectedHead });
        if (!candidate?.buildRoot || !candidate?.temporaryRoot) throw new Error('isolated workspace factory returned an invalid workspace');
        workspace = candidate;
        return candidate.buildRoot;
      })()
      : repoRoot;
    if (isolated) {
      let worktree;
      try {
        worktree = spawnSyncFn('git', ['worktree', 'add', '--detach', buildRoot, expectedHead], {
          cwd: repoRoot,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
          timeout: CANONICAL_RUNTIME_BUILD_TIMEOUT_MS,
        });
      } catch (error) {
        result = { ok: false, required: true, blocker: 'CANONICAL_RUNTIME_BUILD_WORKTREE_FAILED', reason: boundedText(error?.message || error) };
      }
      if (!result && (worktree?.error || worktree?.status !== 0 || !existsSync(buildRoot))) {
        result = {
          ok: false,
          required: true,
          blocker: 'CANONICAL_RUNTIME_BUILD_WORKTREE_FAILED',
          reason: boundedText(worktree?.stderr || worktree?.stdout || worktree?.error?.message),
        };
      }
      if (!result) {
        worktreeAdded = true;
        try {
          linkedPaths = linkRuntimeDependencies(repoRoot, buildRoot, platform);
        } catch (error) {
          result = { ok: false, required: true, blocker: 'CANONICAL_RUNTIME_BUILD_DEPENDENCY_LINK_FAILED', reason: boundedText(error?.message || error) };
        }
      }
    }
    const steps = [
      {
        name: 'build',
        scriptPath: resolve(isolated ? workspace.buildRoot : repoRoot, 'scripts', 'build-stephanos-ui.mjs'),
        blocker: 'CANONICAL_RUNTIME_BUILD_FAILED',
      },
      {
        name: 'verify',
        scriptPath: resolve(isolated ? workspace.buildRoot : repoRoot, 'scripts', 'verify-stephanos-dist.mjs'),
        blocker: 'CANONICAL_RUNTIME_VERIFY_FAILED',
      },
    ];
    if (!result) {
      for (const step of steps) {
        let execution;
        try {
          execution = spawnSyncFn(process.execPath, [step.scriptPath], {
            cwd: isolated ? workspace.buildRoot : repoRoot,
            encoding: 'utf8',
            shell: false,
            windowsHide: true,
            timeout: CANONICAL_RUNTIME_BUILD_TIMEOUT_MS,
          });
        } catch (error) {
          result = { ok: false, required: true, blocker: step.blocker, failedStep: step.name, reason: boundedText(error?.message || error) };
          break;
        }
        if (execution?.error || execution?.status !== 0) {
          result = {
            ok: false,
            required: true,
            blocker: step.blocker,
            failedStep: step.name,
            status: execution?.status ?? null,
            reason: boundedText(execution?.error?.message || execution?.stderr || execution?.stdout),
          };
          break;
        }
      }
    }
    if (!result) {
      if (isolated) {
        const copied = copyVerifiedRuntimeDist({ repoRoot, buildRoot: workspace.buildRoot, distManifestFactory });
        result = copied.ok
          ? {
            ok: true,
            required: true,
            canonicalBuildPerformed: true,
            canonicalVerifyPerformed: true,
            immutableBuildSource: expectedHead,
            expectedDistFingerprint: copied.expectedDistFingerprint,
            distManifest: copied.distManifest,
          }
          : { ok: false, required: true, blocker: copied.blocker, reason: copied.reason };
      } else {
        let distManifest;
        try {
          distManifest = distManifestFactory(repoRoot);
        } catch {
          distManifest = null;
        }
        const validatedManifest = validateExactHeadDistManifest(distManifest);
        result = validatedManifest.ok
          ? {
            ok: true,
            required: true,
            canonicalBuildPerformed: true,
            canonicalVerifyPerformed: true,
            expectedDistFingerprint: validatedManifest.fingerprint,
            distManifest,
          }
          : { ok: false, required: true, blocker: 'CANONICAL_RUNTIME_FINGERPRINT_FAILED' };
      }
    }
  } catch (error) {
    result ||= { ok: false, required: true, blocker: 'CANONICAL_RUNTIME_BUILD_WORKTREE_FAILED', reason: boundedText(error?.message || error) };
  }
  if (workspace) {
    const cleanup = cleanupIsolatedRuntimeBuildWorkspace({
      workspace,
      repoRoot,
      linkedPaths,
      worktreeAdded,
      spawnSyncFn,
    });
    if (!cleanup.ok) {
      result = { ok: false, required: true, blocker: cleanup.blocker, reason: cleanup.reason };
    }
  }
  return Object.freeze(result || { ok: false, required: true, blocker: 'CANONICAL_RUNTIME_BUILD_FAILED' });
}

export function evaluateWorkerSourceSafety({
  exactHeadRequired = false,
  expectedHead = '',
  expectedDistFingerprint = '',
  runtimeDistFingerprintAfter = '',
  sourceHeadBefore = {},
  sourceHeadAfter = {},
  statusBefore = {},
  statusAfter = {},
  dirtBefore = {},
  dirtAfter = {},
  dirtDelta = {},
  preProofExactHeadValidation = { ok: true },
  postProofExactHeadValidation = { ok: true },
} = {}) {
  const sourceHeadUnchanged = (
    sourceHeadBefore.ok === true
    && sourceHeadAfter.ok === true
    && sourceHeadBefore.stdout === sourceHeadAfter.stdout
  );
  const sourceHeadBound = !exactHeadRequired || (
    sourceHeadBefore.stdout === expectedHead
    && sourceHeadAfter.stdout === expectedHead
  );
  const exactHeadStatusAvailable = !exactHeadRequired || (
    statusBefore.ok === true
    && statusAfter.ok === true
  );
  const exactHeadSourceClean = !exactHeadRequired || (
    dirtBefore.safe === true
    && dirtAfter.safe === true
  );
  const exactHeadRuntimeBound = !exactHeadRequired || (
    exactHeadStatusAvailable
    && EXACT_DIST_FINGERPRINT.test(expectedDistFingerprint)
    && runtimeDistFingerprintAfter === expectedDistFingerprint
    && dirtDelta.generatedRuntimeMutationDetected !== true
  );
  const exactHeadExecutionBound = !exactHeadRequired || (
    preProofExactHeadValidation.ok === true
    && postProofExactHeadValidation.ok === true
  );
  const sourceSafe = (
    sourceHeadUnchanged
    && sourceHeadBound
    && exactHeadStatusAvailable
    && exactHeadSourceClean
    && exactHeadRuntimeBound
    && exactHeadExecutionBound
    && dirtDelta.sourceMutationDetected !== true
  );
  return Object.freeze({
    sourceSafe,
    sourceHeadUnchanged,
    sourceHeadBound,
    exactHeadStatusAvailable,
    exactHeadSourceClean,
    exactHeadRuntimeBound,
    exactHeadExecutionBound,
    preProofExactHeadValidation,
    postProofExactHeadValidation,
  });
}

export function parseCodexJsonEvents(output = '') {
  const events = [];
  const invalidLines = [];
  for (const line of String(output || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidLines.push(line.slice(0, 240));
    }
  }
  return Object.freeze({ events, invalidLines });
}

export function classifyCodexExecution({
  exit = {},
  events = [],
  lastMessage = '',
  stderr = '',
  requiresStructuredVerdict = false,
  expectedProofScenario = '',
} = {}) {
  const failureEvent = events.find((event) => (
    event?.type === 'turn.failed'
    || event?.type === 'error'
    || event?.type === 'item.failed'
    || event?.item?.status === 'failed'
  )) || null;
  const turnCompleted = events.some((event) => event?.type === 'turn.completed');
  const stderrExcerpt = boundedText(stderr);
  const failureText = `${lastMessage}\n${stderrExcerpt}\n${failureEvent ? JSON.stringify(failureEvent) : ''}`;
  const cancelled = /(?:user\s+)?cancel(?:led|ed)(?:\s+by\s+user)?|tool call.*cancel(?:led|ed)/i.test(failureText);
  const exitPassed = exit.code === 0 && !exit.error;
  let structuredVerdict = null;
  let structuredVerdictPresent = false;
  let structuredBlockers = [];
  let structuredProofScenario = '';
  if (requiresStructuredVerdict) {
    try {
      const normalized = String(lastMessage || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const payload = JSON.parse(normalized);
      structuredVerdictPresent = Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'verdict'));
      structuredVerdict = structuredVerdictPresent ? String(payload.verdict || '') : null;
      structuredProofScenario = structuredVerdictPresent ? String(payload.proofScenario || '') : '';
      structuredBlockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
    } catch {}
  }
  const structuredVerdictPassed = !requiresStructuredVerdict || (
    structuredVerdictPresent
    && structuredVerdict === 'PASS'
    && (!expectedProofScenario || structuredProofScenario === expectedProofScenario)
    && structuredBlockers.length === 0
  );
  const passed = exitPassed && turnCompleted && !failureEvent && !cancelled && structuredVerdictPassed;
  let reason = '';
  if (!exitPassed) {
    reason = exit.error || (events.length === 0 ? 'CODEX_CLI_STARTUP_FAILED' : `codex-exit-${exit.code ?? 'unknown'}`);
  } else if (cancelled) {
    reason = 'CODEX_EXEC_CANCELLED';
  } else if (failureEvent) {
    reason = `CODEX_EVENT_${String(failureEvent.type || 'FAILED').toUpperCase().replaceAll('.', '_')}`;
  } else if (!turnCompleted) {
    reason = 'CODEX_TURN_COMPLETION_MISSING';
  } else if (requiresStructuredVerdict && !structuredVerdictPresent) {
    reason = 'CODEX_STRUCTURED_VERDICT_MISSING';
  } else if (requiresStructuredVerdict && structuredVerdict !== 'PASS') {
    reason = 'CODEX_STRUCTURED_VERDICT_FAILED';
  } else if (requiresStructuredVerdict && expectedProofScenario && structuredProofScenario !== expectedProofScenario) {
    reason = 'CODEX_STRUCTURED_PROOF_SCENARIO_MISMATCH';
  } else if (requiresStructuredVerdict && structuredBlockers.length > 0) {
    reason = 'CODEX_STRUCTURED_VERDICT_BLOCKERS_REMAIN';
  }
  return Object.freeze({
    passed,
    exitPassed,
    turnCompleted,
    cancelled,
    failureEventType: failureEvent?.type || '',
    reason,
    structuredVerdictRequired: requiresStructuredVerdict,
    structuredVerdictPresent,
    structuredVerdict,
    structuredProofScenario,
    structuredBlockers,
    eventCount: events.length,
    stderrExcerpt,
  });
}

export function validateBrowserProofVerdict(lastMessage, task = {}, browserRuntimeProof = null) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const expectedScenario = String(task.exactHeadProof.proofScenario || '');
  let payload;
  try {
    const normalized = String(lastMessage || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    payload = JSON.parse(normalized);
  } catch {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_VERDICT_INVALID' });
  }
  if (payload?.verdict !== 'PASS' || payload?.proofScenario !== expectedScenario) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: payload?.verdict === 'FAIL' ? 'BROWSER_PROOF_FAILED' : 'BROWSER_PROOF_VERDICT_INVALID',
    });
  }
  if (!Array.isArray(payload.blockers) || payload.blockers.length > 0) {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_BLOCKERS_REMAIN' });
  }
  const expectedHead = String(task.exactHeadProof.expectedHead || '').trim().toLowerCase();
  if (
    browserRuntimeProof?.required !== true
    || browserRuntimeProof?.ok !== true
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: browserRuntimeProof?.blocker || 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED',
    });
  }
  if (
    browserRuntimeProof.schemaVersion !== BROWSER_RUNTIME_PROOF_SCHEMA
    || browserRuntimeProof.mergeReady !== true
    || !Array.isArray(browserRuntimeProof.blocking)
    || browserRuntimeProof.blocking.length !== 0
    || browserRuntimeProof.proofScenario !== expectedScenario
    || browserRuntimeProof.scenarioEvidenceAccepted !== true
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_MACHINE_SCENARIO_EVIDENCE_MISSING',
    });
  }
  if (expectedScenario !== MUSIC_RATING_PRESERVES_PLAYBACK) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_SCENARIO_INVALID',
    });
  }
  const scenarioEvaluation = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
    browserRuntimeProof.scenarioEvidence,
    { expectedHead },
  );
  if (!scenarioEvaluation.accepted) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: scenarioEvaluation.blocking[0] || 'BROWSER_PROOF_EVIDENCE_INCOMPLETE',
      scenarioEvidenceBlockers: scenarioEvaluation.blocking,
    });
  }
  const runtimeSourceHead = String(browserRuntimeProof.runtimeSourceHead || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(runtimeSourceHead)) {
    return Object.freeze({ ok: false, required: true, blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISSING' });
  }
  if (runtimeSourceHead !== expectedHead) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH',
      expectedHead,
      runtimeSourceHead,
    });
  }
  return Object.freeze({
    ok: true,
    required: true,
    proofScenario: expectedScenario,
    expectedHead,
    runtimeSourceHead,
    evidence: browserRuntimeProof.scenarioEvidence,
    scenarioEvidenceAccepted: true,
    evidenceAuthority: 'worker-owned-playwright-runner',
    modelScenarioEvidenceTrusted: false,
  });
}

export function runBrowserRuntimeExactHeadProof(task, {
  spawnSyncFn = spawnSync,
  runnerPath = resolve(fileURLToPath(new URL('./browser-proof-runner.mjs', import.meta.url))),
  expectedSourceFingerprint: suppliedExpectedSourceFingerprint = '',
  expectedDistFingerprint: suppliedExpectedDistFingerprint = '',
  expectedDistManifestPath: suppliedExpectedDistManifestPath = '',
  proofScenario: suppliedProofScenario = '',
} = {}) {
  if (!task?.exactHeadProof) return Object.freeze({ ok: true, required: false });
  const expectedHead = String(task.exactHeadProof.expectedHead || '').trim().toLowerCase();
  const taskProofScenario = String(task.exactHeadProof.proofScenario || '').trim();
  const proofScenario = String(suppliedProofScenario || '').trim();
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    return Object.freeze({ ok: false, required: true, blocker: 'EXACT_HEAD_PROOF_INVALID' });
  }
  if (
    proofScenario
    && (
      proofScenario !== taskProofScenario
      || proofScenario !== MUSIC_RATING_PRESERVES_PLAYBACK
    )
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_SCENARIO_INVALID',
      expectedHead,
      proofScenario,
    });
  }
  const expectedSourceFingerprint = String(suppliedExpectedSourceFingerprint || '').trim().toLowerCase();
  if (!EXACT_SOURCE_FINGERPRINT.test(expectedSourceFingerprint)) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'LOCAL_SOURCE_FINGERPRINT_FAILED',
      expectedHead,
    });
  }
  const expectedDistFingerprint = String(suppliedExpectedDistFingerprint || '').trim().toLowerCase();
  if (!EXACT_DIST_FINGERPRINT.test(expectedDistFingerprint)) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'CANONICAL_RUNTIME_FINGERPRINT_FAILED',
      expectedHead,
      expectedSourceFingerprint,
    });
  }
  const expectedDistManifestPath = String(suppliedExpectedDistManifestPath || '').trim();
  if (!expectedDistManifestPath) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'CANONICAL_RUNTIME_MANIFEST_MISSING',
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
    });
  }
  let execution;
  try {
    execution = spawnSyncFn(process.execPath, [
      runnerPath,
      '--url',
      CANONICAL_BROWSER_PROOF_URL,
      '--expected-head',
      expectedHead,
      '--expected-source-fingerprint',
      expectedSourceFingerprint,
      '--expected-dist-fingerprint',
      expectedDistFingerprint,
      '--expected-dist-manifest',
      expectedDistManifestPath,
      ...(proofScenario ? ['--proof-scenario', proofScenario] : []),
      '--no-artifacts',
      '--machine-json',
    ], {
      cwd: task.repoRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120000,
    });
  } catch {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED',
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      runtimeSourceHead: '',
    });
  }
  let payload = null;
  try {
    payload = JSON.parse(String(execution?.stdout || '').trim());
  } catch {}
  const runtimeUrl = String(payload?.url || '').trim();
  const observedRuntimeUrl = String(payload?.observedUrl || '').trim();
  const runtimeSourceHead = String(payload?.runtimeSourceHead || '').trim().toLowerCase();
  const runtimeSourceFingerprint = String(payload?.runtimeSourceFingerprint || '').trim().toLowerCase();
  const runtimeDistFingerprint = String(payload?.runtimeDistFingerprint || '').trim().toLowerCase();
  const payloadProofScenario = String(payload?.proofScenario || '').trim();
  const scenarioEvidence = payload?.scenarioEvidence || null;
  const scenarioEvaluation = proofScenario
    ? evaluateMusicRatingPreservesPlaybackScenarioEvidence(scenarioEvidence, { expectedHead })
    : null;
  if (runtimeSourceHead && runtimeSourceHead !== expectedHead) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH',
      expectedHead,
      runtimeSourceHead,
    });
  }
  if (
    runtimeSourceFingerprint
    && runtimeSourceFingerprint !== expectedSourceFingerprint
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_RUNTIME_FINGERPRINT_MISMATCH',
      expectedHead,
      expectedSourceFingerprint,
      runtimeSourceFingerprint,
    });
  }
  if (
    runtimeDistFingerprint
    && runtimeDistFingerprint !== expectedDistFingerprint
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_PROOF_RUNTIME_DIST_FINGERPRINT_MISMATCH',
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      runtimeDistFingerprint,
    });
  }
  if (
    runtimeUrl !== CANONICAL_BROWSER_PROOF_URL
    || observedRuntimeUrl !== CANONICAL_BROWSER_PROOF_URL
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_RUNTIME_URL_MISMATCH',
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      runtimeUrl,
      observedRuntimeUrl,
    });
  }
  if (
    execution?.error
    || execution?.status !== 0
    || payload?.schemaVersion !== BROWSER_RUNTIME_PROOF_SCHEMA
    || payload?.accepted !== true
    || payload?.mergeReady !== true
    || !Array.isArray(payload?.blocking)
    || payload.blocking.length !== 0
    || payload?.expectedHead !== expectedHead
    || payload?.expectedHeadMatch !== true
    || runtimeSourceHead !== expectedHead
    || payload?.expectedSourceFingerprint !== expectedSourceFingerprint
    || payload?.expectedSourceFingerprintMatch !== true
    || runtimeSourceFingerprint !== expectedSourceFingerprint
    || payload?.expectedDistFingerprint !== expectedDistFingerprint
    || payload?.expectedDistFingerprintMatch !== true
    || runtimeDistFingerprint !== expectedDistFingerprint
    || (proofScenario && (
      payloadProofScenario !== proofScenario
      || payload?.scenarioEvidenceAccepted !== true
      || scenarioEvaluation?.accepted !== true
    ))
    || (!proofScenario && payloadProofScenario !== '')
  ) {
    return Object.freeze({
      ok: false,
      required: true,
      blocker: 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED',
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      runtimeSourceHead,
      runtimeSourceFingerprint,
      runtimeDistFingerprint,
      proofScenario,
      payloadProofScenario,
      scenarioEvidenceAccepted: payload?.scenarioEvidenceAccepted === true,
      scenarioEvidenceBlockers: scenarioEvaluation?.blocking || [],
    });
  }
  return Object.freeze({
    ok: true,
    required: true,
    expectedHead,
    expectedSourceFingerprint,
    expectedDistFingerprint,
    expectedDistManifestPath,
    runtimeSourceHead,
    runtimeSourceFingerprint,
    runtimeDistFingerprint,
    runtimeUrl,
    observedRuntimeUrl,
    schemaVersion: payload.schemaVersion,
    mergeReady: true,
    blocking: Object.freeze([]),
    proofScenario,
    scenarioEvidenceAccepted: proofScenario ? true : null,
    scenarioEvidence: proofScenario ? scenarioEvidence : null,
  });
}

export function resolveCodexExecInvocation({
  platform = process.platform,
  env = process.env,
  lastMessagePath,
} = {}) {
  const codexCommand = String(env.STEPHANOS_CODEX_COMMAND || 'codex').trim();
  const codexArgs = [
    '--ask-for-approval', 'never',
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox', 'read-only',
    '--output-last-message', lastMessagePath,
    '-',
  ];
  if (platform === 'win32') {
    return Object.freeze({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', codexCommand, ...codexArgs],
      codexCommand,
      codexArgs,
    });
  }
  return Object.freeze({ command: codexCommand, args: codexArgs, codexCommand, codexArgs });
}

export function buildGuardedCodexPrompt(task) {
  const verdictContract = task.exactHeadProof
    ? `\nMACHINE-READABLE FINAL VERDICT\nReturn only one JSON object as your final message, using exactly this shape:\n{"verdict":"PASS|FAIL","proofScenario":"${task.exactHeadProof.proofScenario}","blockers":[]}\nDo not self-attest scenario booleans or browser facts. After your bounded diagnostic turn, the worker-owned Playwright runner independently performs the interaction and is the sole authority for scenario evidence. Report FAIL and list blockers when your diagnostics find a problem; PASS is forbidden when blockers remain.`
    : '\nReturn a structured PASS/FAIL report with remaining blockers.';
  return `You are running as the guarded Stephanos Battle Bridge Codex proof worker.\n\nTASK\n${task.prompt}\n\nNON-NEGOTIABLE SAFETY\n- Work only in ${task.repoRoot}.\n- This is a proof and diagnostics task. Do not modify source files.\n- The child Codex run is read-only and non-interactive. Do not request approval.\n- User configuration is not loaded for this child run, so local MCP and app tools are unavailable by construction.\n- Do not call MCP tools, app tools, or dispatch another Codex task. Use bounded shell diagnostics only.\n- Do not create generated output unless the exact requested proof cannot be completed without it.\n- Do not push, merge, delete branches, run git reset --hard, expose secrets, enable public tunnels, or use broad process-kill commands.\n- Stop only positively identified Stephanos-owned processes.\n- Keep backend, OpenClaw, UI, and transport lifecycle truths separate.\n- Capture exact commands, results, browser evidence when available, and uncertainty.${verdictContract}\n\nREQUESTED PROOF COMMANDS\n${task.requestedProofCommands.length ? task.requestedProofCommands.map((command) => `- ${command}`).join('\n') : '- Use the exact bounded proof commands required by the task.'}\n`;
}

function streamToFile(stream, path) {
  const writer = createWriteStream(path, { flags: 'a', mode: 0o600 });
  stream?.pipe?.(writer);
  return writer;
}

function waitForWriter(writer, timeoutMs = 2000) {
  if (!writer || writer.writableFinished || writer.closed) return Promise.resolve();
  return new Promise((resolveWait) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolveWait();
    };
    writer.once('finish', settle);
    writer.once('close', settle);
    writer.once('error', settle);
    const timeout = setTimeout(settle, timeoutMs);
    timeout.unref?.();
  });
}

async function publishVisibilitySafely(publisher, task, snapshot) {
  try {
    return await publisher(task.workspaceRoot, {
      ...snapshot,
      jobId: task.jobId,
      taskId: task.taskId,
      issueNumber: task.issueNumber,
      proofRefs: task.proofRefs,
    }, { repoRoot: task.repoRoot });
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

export async function runCodexWorker(taskPath, {
  spawnFn = spawn,
  now = () => new Date().toISOString(),
  platform = process.platform,
  env = process.env,
  heartbeatIntervalMs = 15_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  visibilityPublisher = publishRemoteCodexTaskVisibility,
  spawnSyncFn = spawnSync,
  sourceFingerprintFactory = (repoRoot) => computeStephanosSourceFingerprint({ rootDir: repoRoot }),
  distFingerprintFactory = (repoRoot) => computeStephanosDistFingerprint({ rootDir: repoRoot }),
  distManifestFactory = (repoRoot) => createStephanosDistManifest({ rootDir: repoRoot }),
  runtimeBundleFactory = prepareExactHeadRuntimeBundle,
} = {}) {
  const task = readJson(taskPath);
  if (task?.schemaVersion !== LOCAL_CODEX_TASK_SCHEMA) throw new Error('Unsupported local Codex task schema.');
  if (task?.taskType !== 'battle-bridge-proof') throw new Error(`Unsupported local Codex task type: ${task?.taskType || 'missing'}`);

  const taskRoot = dirname(taskPath);
  const statusPath = join(taskRoot, 'status.json');
  const resultPath = join(taskRoot, 'result.json');
  const stdoutPath = join(taskRoot, 'codex.stdout.jsonl');
  const stderrPath = join(taskRoot, 'codex.stderr.log');
  const lastMessagePath = join(taskRoot, 'codex-last-message.txt');
  const currentPath = join(dirname(dirname(taskRoot)), 'current.json');
  const exactHeadValidation = validateExactHeadAtWorkerStart(task, { spawnSyncFn, platform });
  if (!exactHeadValidation.ok) {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'BLOCKED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt: completedAt,
      completedAt,
      exactHeadValidation,
      blocker: exactHeadValidation.blocker,
      nextOperatorAction: `Repair the exact-head blocker before retrying: ${exactHeadValidation.blocker}.`,
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const expectedSourceFingerprint = exactHeadValidation.required
    ? resolveExpectedSourceFingerprint(sourceFingerprintFactory, task.repoRoot)
    : '';
  let exactHeadRuntimeBundle = Object.freeze({ ok: true, required: false });
  if (exactHeadValidation.required && expectedSourceFingerprint) {
    try {
      exactHeadRuntimeBundle = runtimeBundleFactory(task.repoRoot, {
        spawnSyncFn,
        distManifestFactory,
        expectedHead: exactHeadValidation.expectedHead,
        platform,
      });
    } catch (error) {
      exactHeadRuntimeBundle = Object.freeze({
        ok: false,
        required: true,
        blocker: 'CANONICAL_RUNTIME_BUILD_FAILED',
        reason: boundedText(error?.message || error),
      });
    }
  }
  let expectedDistManifestPath = '';
  if (exactHeadValidation.required && exactHeadRuntimeBundle?.ok === true) {
    const validatedManifest = validateExactHeadDistManifest(
      exactHeadRuntimeBundle.distManifest,
    );
    if (!validatedManifest.ok) {
      exactHeadRuntimeBundle = Object.freeze({
        ok: false,
        required: true,
        blocker: 'CANONICAL_RUNTIME_FINGERPRINT_FAILED',
      });
    } else {
      expectedDistManifestPath = join(taskRoot, 'canonical-dist-manifest.json');
      try {
        writeJson(expectedDistManifestPath, exactHeadRuntimeBundle.distManifest);
      } catch (error) {
        exactHeadRuntimeBundle = Object.freeze({
          ok: false,
          required: true,
          blocker: 'CANONICAL_RUNTIME_MANIFEST_PERSIST_FAILED',
          reason: boundedText(error?.message || error),
        });
        expectedDistManifestPath = '';
      }
    }
  }
  const expectedDistFingerprint = exactHeadValidation.required
    ? String(exactHeadRuntimeBundle?.expectedDistFingerprint || '').trim().toLowerCase()
    : '';
  const sourceHeadBefore = gitCapture(task.repoRoot, ['rev-parse', 'HEAD'], spawnSyncFn);
  const statusBefore = gitCapture(task.repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'], spawnSyncFn);
  const dirtBefore = classifyPostTaskDirt(statusBefore.stdout);
  let preExecutionBlocker = '';
  if (exactHeadValidation.required) {
    if (!expectedSourceFingerprint) preExecutionBlocker = 'LOCAL_SOURCE_FINGERPRINT_FAILED';
    else if (exactHeadRuntimeBundle?.ok !== true) {
      preExecutionBlocker = exactHeadRuntimeBundle?.blocker || 'CANONICAL_RUNTIME_BUILD_FAILED';
    }
    else if (!EXACT_DIST_FINGERPRINT.test(expectedDistFingerprint)) {
      preExecutionBlocker = 'CANONICAL_RUNTIME_FINGERPRINT_FAILED';
    }
    else if (!sourceHeadBefore.ok) preExecutionBlocker = 'LOCAL_HEAD_LOOKUP_FAILED';
    else if (sourceHeadBefore.stdout !== exactHeadValidation.expectedHead) preExecutionBlocker = 'EXPECTED_HEAD_MISMATCH';
    else if (!statusBefore.ok) preExecutionBlocker = 'LOCAL_SOURCE_STATUS_LOOKUP_FAILED';
    else if (!dirtBefore.safe) preExecutionBlocker = 'PRE_EXISTING_SOURCE_DIRT';
  }
  if (preExecutionBlocker) {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'BLOCKED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt: completedAt,
      completedAt,
      exactHeadValidation,
      exactHeadRuntimeBundle,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      sourceHeadBefore: sourceHeadBefore.stdout,
      statusBeforeOk: statusBefore.ok,
      dirtBefore,
      blocker: preExecutionBlocker,
      nextOperatorAction: `Repair the exact-head source blocker before retrying: ${preExecutionBlocker}.`,
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const exactHeadBeforePreProof = exactHeadValidation.required
    ? validateExactHeadAtWorkerStart(task, { spawnSyncFn, platform, verificationPhase: 'pre-browser-proof', checkSourceStatus: false })
    : Object.freeze({ ok: true, required: false });
  const browserRuntimeProofBefore = exactHeadBeforePreProof.ok
    ? runBrowserRuntimeExactHeadProof(task, {
      spawnSyncFn,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
    })
    : Object.freeze({
      ok: false,
      required: true,
      blocker: exactHeadBeforePreProof.blocker || 'EXACT_HEAD_TARGET_NOT_BOUND',
      exactHeadValidation: exactHeadBeforePreProof,
    });
  if (!browserRuntimeProofBefore.ok) {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'BLOCKED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt: completedAt,
      completedAt,
      exactHeadValidation,
      exactHeadBeforePreProof,
      exactHeadRuntimeBundle,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      sourceHeadBefore: sourceHeadBefore.stdout,
      statusBeforeOk: statusBefore.ok,
      dirtBefore,
      browserRuntimeProofBefore,
      blocker: browserRuntimeProofBefore.blocker,
      nextOperatorAction: `Repair the browser runtime exact-head blocker before retrying: ${browserRuntimeProofBefore.blocker}.`,
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const startedAt = now();
  const invocation = resolveCodexExecInvocation({ platform, env, lastMessagePath });
  let running = {
    ...task,
    status: 'RUNNING',
    startedAt,
    heartbeatUtc: startedAt,
    workerAlive: true,
    resultAvailable: false,
    workerPid: process.pid,
    sourceHeadBefore: sourceHeadBefore.stdout,
    expectedSourceFingerprint,
    expectedDistFingerprint,
    expectedDistManifestPath,
    exactHeadValidation,
    exactHeadBeforePreProof,
    exactHeadRuntimeBundle,
    browserRuntimeProofBefore,
    dirtBefore,
    executionPolicy: {
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      ignoreUserConfig: true,
      nestedDispatchMcpEnabled: false,
      isolationMechanism: 'ignore-user-config',
    },
    invocation: {
      command: invocation.command,
      codexCommand: invocation.codexCommand,
      codexArgs: invocation.codexArgs,
    },
    logPaths: { stdoutPath, stderrPath, lastMessagePath },
  };
  writeJson(statusPath, running);
  writeJson(currentPath, running);
  const startedVisibility = await publishVisibilitySafely(visibilityPublisher, task, running);
  running = {
    ...running,
    visibilityPublication: {
      ok: startedVisibility.ok === true,
      reason: startedVisibility.reason || '',
    },
  };
  writeJson(statusPath, running);
  writeJson(currentPath, running);

  const prompt = buildGuardedCodexPrompt(task);
  let child;
  try {
    child = spawnFn(invocation.command, invocation.args, {
      cwd: resolve(task.repoRoot),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    if (!child || typeof child.once !== 'function') throw new Error('Codex child process unavailable');
  } catch {
    const completedAt = now();
    const result = {
      ...task,
      kind: 'stephanos.codex_dispatch.local_result',
      status: 'FAILED',
      verdict: 'FAIL',
      resultAvailable: true,
      resultVerdict: 'FAIL',
      workerAlive: false,
      heartbeatUtc: completedAt,
      startedAt,
      completedAt,
      exactHeadValidation,
      browserRuntimeProofBefore,
      sourceHeadBefore: sourceHeadBefore.stdout,
      blocker: 'CODEX_CLI_STARTUP_FAILED',
      nextOperatorAction: 'Repair the local Codex CLI launch path, then submit a fresh bounded request.',
    };
    writeJson(resultPath, result);
    writeJson(statusPath, result);
    writeJson(currentPath, result);
    await publishVisibilitySafely(visibilityPublisher, task, result);
    return result;
  }
  const stdoutWriter = streamToFile(child.stdout, stdoutPath);
  const stderrWriter = streamToFile(child.stderr, stderrPath);
  child.stdin?.end?.(prompt);

  let heartbeatChain = Promise.resolve();
  const queueHeartbeat = () => {
    heartbeatChain = heartbeatChain.then(async () => {
      let stdoutEvents = '';
      try { stdoutEvents = readFileSync(stdoutPath, 'utf8'); } catch {}
      const parsedEvents = parseCodexJsonEvents(stdoutEvents);
      const heartbeatUtc = now();
      running = {
        ...running,
        heartbeatUtc,
        workerAlive: true,
        codexThreadId: extractCodexThreadId(parsedEvents.events),
        eventCount: parsedEvents.events.length,
      };
      writeJson(statusPath, running);
      writeJson(currentPath, running);
      const publication = await publishVisibilitySafely(visibilityPublisher, task, {
        ...running,
        events: parsedEvents.events,
      });
      running = {
        ...running,
        visibilityPublication: {
          ok: publication.ok === true,
          reason: publication.reason || '',
        },
      };
      writeJson(statusPath, running);
      writeJson(currentPath, running);
    }).catch(() => {});
    return heartbeatChain;
  };
  const heartbeatTimer = Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
    ? setIntervalFn(() => { void queueHeartbeat(); }, heartbeatIntervalMs)
    : null;
  heartbeatTimer?.unref?.();

  const exit = await new Promise((resolveExit) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveExit(value);
    };
    child.once?.('error', (error) => settle({ code: null, signal: null, error: error?.message || String(error) }));
    child.once?.('exit', (code, signal) => settle({ code, signal, error: '' }));
  });
  if (heartbeatTimer) clearIntervalFn(heartbeatTimer);
  await heartbeatChain;
  await Promise.all([waitForWriter(stdoutWriter), waitForWriter(stderrWriter)]);

  let lastMessage = '';
  let stdoutEvents = '';
  let stderrText = '';
  try { lastMessage = readFileSync(lastMessagePath, 'utf8').trim(); } catch {}
  try { stdoutEvents = readFileSync(stdoutPath, 'utf8'); } catch {}
  try { stderrText = readFileSync(stderrPath, 'utf8'); } catch {}
  const parsedEvents = parseCodexJsonEvents(stdoutEvents);
  const execution = classifyCodexExecution({
    exit,
    events: parsedEvents.events,
    lastMessage,
    stderr: stderrText,
    requiresStructuredVerdict: exactHeadValidation.required,
    expectedProofScenario: task.exactHeadProof?.proofScenario || '',
  });
  const exactHeadBeforeFinalProof = exactHeadValidation.required
    ? validateExactHeadAtWorkerStart(task, { spawnSyncFn, platform, verificationPhase: 'post-codex-pre-browser-proof', checkSourceStatus: false })
    : Object.freeze({ ok: true, required: false });
  const browserRuntimeProofAfter = exactHeadBeforeFinalProof.ok
    ? runBrowserRuntimeExactHeadProof(task, {
      spawnSyncFn,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      proofScenario: task.exactHeadProof?.proofScenario || '',
    })
    : Object.freeze({
      ok: false,
      required: true,
      blocker: exactHeadBeforeFinalProof.blocker || 'EXACT_HEAD_TARGET_NOT_BOUND',
      exactHeadValidation: exactHeadBeforeFinalProof,
    });
  const exactHeadAfterFinalProof = exactHeadValidation.required
    ? validateExactHeadAtWorkerStart(task, { spawnSyncFn, platform, verificationPhase: 'post-browser-proof', checkSourceStatus: false })
    : Object.freeze({ ok: true, required: false });
  const sourceHeadAfter = gitCapture(task.repoRoot, ['rev-parse', 'HEAD'], spawnSyncFn);
  const statusAfter = gitCapture(task.repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'], spawnSyncFn);
  const dirtAfter = classifyPostTaskDirt(statusAfter.stdout);
  const dirtDelta = compareDirtSnapshots(dirtBefore, dirtAfter);
  const runtimeDistFingerprintAfter = exactHeadValidation.required
    ? resolveExpectedDistFingerprint(distFingerprintFactory, task.repoRoot)
    : '';
  const completedAt = now();
  const browserProof = validateBrowserProofVerdict(lastMessage, task, browserRuntimeProofAfter);
  const expectedHead = exactHeadValidation.required ? exactHeadValidation.expectedHead : '';
  const sourceSafety = evaluateWorkerSourceSafety({
    exactHeadRequired: exactHeadValidation.required,
    expectedHead,
    expectedDistFingerprint,
    runtimeDistFingerprintAfter,
    sourceHeadBefore,
    sourceHeadAfter,
    statusBefore,
    statusAfter,
    dirtBefore,
    dirtAfter,
    dirtDelta,
    preProofExactHeadValidation: exactHeadBeforePreProof,
    postProofExactHeadValidation: exactHeadAfterFinalProof,
  });
  const {
    sourceSafe,
    sourceHeadUnchanged,
    sourceHeadBound,
  } = sourceSafety;
  const passed = execution.passed && browserProof.ok && sourceSafe;
  const finalStatus = passed ? 'DONE' : (sourceSafe ? 'FAILED' : 'BLOCKED');
  const safetyBlocker = !sourceSafety.exactHeadStatusAvailable
    ? 'LOCAL_SOURCE_STATUS_LOOKUP_FAILED'
    : (!sourceSafety.exactHeadExecutionBound
      ? 'EXACT_HEAD_TARGET_CHANGED_DURING_PROOF'
      : (!sourceSafety.sourceHeadBound || !sourceSafety.sourceHeadUnchanged
        ? 'LOCAL_HEAD_CHANGED_DURING_PROOF'
        : (!sourceSafety.exactHeadRuntimeBound
          ? 'GENERATED_RUNTIME_INTEGRITY_MISMATCH'
          : 'SOURCE_MUTATION_DETECTED')));
  const finalBlocker = passed
    ? ''
    : (sourceSafe
      ? (browserProof.blocker || execution.reason || 'CODEX_EXEC_FAILED')
      : safetyBlocker);
  let result = {
    schemaVersion: LOCAL_CODEX_TASK_SCHEMA,
    kind: 'stephanos.codex_dispatch.local_result',
    taskId: task.taskId,
    jobId: task.jobId,
    issueNumber: task.issueNumber,
    status: finalStatus,
    verdict: passed ? 'PASS' : 'FAIL',
    blocker: finalBlocker,
    resultAvailable: true,
    resultVerdict: passed ? 'PASS' : 'FAIL',
    workerAlive: false,
    heartbeatUtc: completedAt,
    codexThreadId: extractCodexThreadId(parsedEvents.events),
    startedAt,
    completedAt,
    sourceHeadBefore: sourceHeadBefore.stdout,
    sourceHeadAfter: sourceHeadAfter.stdout,
    sourceHeadUnchanged,
    sourceHeadBound,
    sourceSafety,
    exactHeadRuntimeBundle,
    expectedDistFingerprint,
    expectedDistManifestPath,
    runtimeDistFingerprintAfter,
    browserRuntimeProofBefore,
    exactHeadBeforePreProof,
    exactHeadBeforeFinalProof,
    exactHeadAfterFinalProof,
    browserRuntimeProofAfter,
    browserProof,
    exit,
    execution,
    eventParsing: {
      eventCount: parsedEvents.events.length,
      invalidLineCount: parsedEvents.invalidLines.length,
      invalidLines: parsedEvents.invalidLines,
    },
    invocation: {
      command: invocation.command,
      codexCommand: invocation.codexCommand,
      codexArgs: invocation.codexArgs,
    },
    dirtBefore,
    dirtAfter,
    dirtDelta,
    lastMessage,
    logs: {
      stdout: basename(stdoutPath),
      stderr: basename(stderrPath),
      lastMessage: basename(lastMessagePath),
      stderrExcerpt: execution.stderrExcerpt,
    },
    safety: {
      mergePerformed: false,
      pushPerformed: false,
      sourceMutationDetected: dirtDelta.sourceMutationDetected,
      generatedRuntimeMutationDetected: dirtDelta.generatedRuntimeMutationDetected,
      exactHeadRuntimeBound: sourceSafety.exactHeadRuntimeBound,
      exactHeadExecutionBound: sourceSafety.exactHeadExecutionBound,
      preExistingSourceDirt: dirtDelta.preExistingSourceDirt,
      sourceHeadChanged: !sourceHeadUnchanged,
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      nestedDispatchMcpEnabled: false,
      isolationMechanism: 'ignore-user-config',
    },
    nextOperatorAction: passed
      ? 'Review the returned proof and decide whether the owning goal may advance.'
      : (!sourceSafe
        ? 'Inspect the task logs and source dirt. Do not auto-discard changes.'
        : `Inspect the task logs and repair the precise runtime blocker: ${browserProof.blocker || execution.reason || 'CODEX_EXEC_FAILED'}.`),
  };
  writeJson(resultPath, result);
  writeJson(statusPath, result);
  writeJson(currentPath, result);
  const finalVisibility = await publishVisibilitySafely(visibilityPublisher, task, {
    ...result,
    events: parsedEvents.events,
    sourceHead: sourceHeadAfter.stdout || sourceHeadBefore.stdout,
  });
  result = {
    ...result,
    visibilityPublication: {
      ok: finalVisibility.ok === true,
      reason: finalVisibility.reason || '',
    },
  };
  writeJson(resultPath, result);
  writeJson(statusPath, result);
  writeJson(currentPath, result);
  return result;
}

function taskArg(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--task');
  return index >= 0 ? argv[index + 1] : '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const taskPath = taskArg();
  if (!taskPath) {
    console.error('Usage: node scripts/stephanos-codex-dispatch-worker.mjs --task <task.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await runCodexWorker(taskPath);
      process.exitCode = result.verdict === 'PASS' ? 0 : 1;
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
