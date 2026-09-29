import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, realpath as fsRealpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';
import { collectAgentWorkerResult } from './missionOrchestratorWorkerService.js';
import { finalizeSourceArtifactEscrowFromWorktreeV1 } from './sourceArtifactEscrowStore.js';

export const PROVIDER_NEUTRAL_SOURCE_BUILDER_SCHEMA = 'stephanos.provider-neutral-source-builder.v1';
const EXTERNAL_ADAPTERS = Object.freeze(['foundry-forge', 'chatgpt-github']);

// Source context caps
const MAX_PER_FILE_BYTES = 256 * 1024; // 256 KiB
const MAX_TOTAL_BYTES = 768 * 1024; // 768 KiB

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function pathAllowed(path, scopes = []) {
  const normalized = normalizePath(path);
  return scopes.some((scopeValue) => {
    const scope = normalizePath(scopeValue);
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

async function reverseAppliedPatch(worktreePath, patchPath, run, touchedPaths = [], snapshot = []) {
  const check = run('git.exe', ['-C', worktreePath, 'apply', '--check', '--reverse', '--whitespace=error-all', patchPath], { cwd: worktreePath });
  if (check.error || check.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_CHECK_FAILED:${text(check.stderr || check.stdout)}`);
  }
  const reverse = run('git.exe', ['-C', worktreePath, 'apply', '--reverse', '--whitespace=error-all', patchPath], { cwd: worktreePath });
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
  const files = [...new Set(tracked.stdout.trim().split(/\r?\n/).map(normalizePath).filter(Boolean))].sort();
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

function localBuilderPrompt(action = {}, sourceSnapshots = []) {
  const sourceSnapshotsSection = sourceSnapshots.length
    ? `\nSource snapshots:\n${JSON.stringify(sourceSnapshots, null, 2)}\n`
    : '';
  return [
    'You are the bounded Stephanos source builder.',
    `Mission ID: ${text(action.missionId)}`,
    `Operator intent: ${text(action.operatorIntent)}`,
    `Intended outcome: ${text(action.intendedOutcome)}`,
    `Allowed source files: ${JSON.stringify(action.allowedFiles || [])}`,
    `Required tests: ${JSON.stringify(action.requiredTests || [])}`,
    sourceSnapshotsSection,
    'Source snapshots are bounded context and may omit allowed files; do not assume omitted files do not exist.',
    '',
    'Return JSON only with keys patch and summary.',
    'patch must be one git-compatible unified diff relative to the repository root.',
    'Only modify paths allowed by Allowed source files.',
    'Do not modify .git, dependencies, runtime data, secrets, environment files, generated output or protected main.',
    'Do not commit, push, merge or create branches.',
    'Make the smallest implementation that satisfies the intended outcome.',
  ].join('\n');
}

async function callLocalBuilder(action, options = {}) {
  const sourceSnapshots = Array.isArray(options.sourceSnapshots) ? options.sourceSnapshots : [];
  if (typeof options.generatePatch === 'function') return options.generatePatch(action, { sourceSnapshots });
  const env = options.env || process.env;
  const endpoint = text(options.ollamaEndpoint || env.STEPHANOS_OLLAMA_ENDPOINT, 'http://127.0.0.1:11434/api/chat');
  const model = text(options.model || env.STEPHANOS_LOCAL_BUILDER_MODEL, 'qwen:14b');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [{ role: 'user', content: localBuilderPrompt(action, sourceSnapshots) }],
      options: { temperature: 0.1 },
    }),
  });
  if (!response.ok) throw new Error(`PROVIDER_NEUTRAL_MODEL_HTTP_${response.status}`);
  const payload = await response.json();
  let parsed;
  try { parsed = JSON.parse(text(payload?.message?.content)); }
  catch { throw new Error('PROVIDER_NEUTRAL_MODEL_RESULT_INVALID_JSON'); }
  const patch = text(parsed?.patch);
  if (!patch.startsWith('diff --git ')) throw new Error('PROVIDER_NEUTRAL_MODEL_PATCH_MISSING');
  return { patch, summary: text(parsed?.summary) };
}

function parseBoundedTestCommand(command) {
  const normalized = text(command);
  if (!normalized || /[&|><^`\r\n]/.test(normalized)) return null;
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

function runRequiredTests(action, worktreePath, run, options = {}) {
  const tests = Array.isArray(action.requiredTests) ? action.requiredTests.map(text).filter(Boolean) : [];
  if (!tests.length) throw new Error('PROVIDER_NEUTRAL_REQUIRED_TESTS_REQUIRED');
  const receipts = [];
  for (const command of tests) {
    const parsed = parseBoundedTestCommand(command);
    if (!parsed) throw new Error(`PROVIDER_NEUTRAL_TEST_COMMAND_UNSAFE:${command}`);
    const result = run(parsed.executable, parsed.args, { cwd: worktreePath, env: options.env || process.env });
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
  let patchApplied = false;
  let succeeded = false;
  let providerInvoked = false;
  let providerCompleted = false;
  let patchSnapshot = [];
  try {
    if (action.actionKind !== 'agent-handoff' || !EXTERNAL_ADAPTERS.includes(claim.adapter)) {
      throw new Error('PROVIDER_NEUTRAL_ACTION_NOT_SOURCE_BUILD');
    }
    if (!worktreePath || !existsSync(worktreePath)) throw new Error('PROVIDER_NEUTRAL_WORKTREE_REQUIRED');
    if (!Array.isArray(action.allowedFiles) || action.allowedFiles.length === 0) throw new Error('PROVIDER_NEUTRAL_ALLOWED_FILES_REQUIRED');

    const startingChanges = changedFiles(worktreePath, run);
    if (startingChanges.length) throw new Error(`PROVIDER_NEUTRAL_WORKTREE_NOT_CLEAN:${startingChanges.join(',')}`);

    // Collect source snapshots before invoking provider
    const sourceSnapshots = await collectSourceSnapshots(worktreePath, action.allowedFiles, run, options);
    providerInvoked = true;
    const generated = await callLocalBuilder({ ...action }, { ...options, sourceSnapshots });
    patchSnapshot = await snapshotPatchTargets(worktreePath, generated.patch, action.allowedFiles);
    providerCompleted = true;
    patchPath = text(claim.processingPath)
      ? claim.processingPath + '.provider-neutral.patch'
      : resolve(worktreePath, '..', `.stephanos-${text(action.actionId, 'source-build')}.patch`);
    await writeFile(patchPath, generated.patch, { encoding: 'utf8', flag: 'wx' });

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
      applyArgs = ['-C', worktreePath, 'apply', '--recount', '--whitespace=error-all', patchPath];
    }
    const apply = run('git.exe', applyArgs, { cwd: worktreePath });
    if (apply.error || apply.status !== 0) throw new Error(`PROVIDER_NEUTRAL_PATCH_APPLY_FAILED:${text(apply.stderr || apply.stdout)}`);
    patchApplied = true;

    const files = changedFiles(worktreePath, run);
    if (files.length === 0) throw new Error('PROVIDER_NEUTRAL_SOURCE_UNCHANGED');
    const unsafe = files.filter((path) => !pathAllowed(path, action.allowedFiles));
    if (unsafe.length) throw new Error(`PROVIDER_NEUTRAL_SCOPE_VIOLATION:${unsafe.join(',')}`);

    const sourceTestReceipts = runRequiredTests(action, worktreePath, run, options);
    const receipt = Object.freeze({
      receiptId: `provider-neutral-source-${text(action.actionId)}`.slice(0, 128),
      requirement: 'provider-neutral bounded source change',
      source: claim.adapter,
      evidenceType: 'source-mutation',
      verified: true,
      commandOutputHash: createHash('sha256').update(generated.patch).digest('hex'),
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
      receipt,
      evidenceReceipts: sourceTestReceipts,
      error: '',
    }, options);

    succeeded = true;
    return Object.freeze({
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
  } catch (error) {
    let failure = error?.message || 'provider-neutral source build failed';
    if (patchApplied && !succeeded && patchPath) {
      const rollbackPaths = changedFiles(worktreePath, run);
      try { await reverseAppliedPatch(worktreePath, patchPath, run, rollbackPaths, patchSnapshot); }
      catch (rollbackError) { failure = `${failure};${rollbackError?.message || 'PROVIDER_NEUTRAL_PATCH_ROLLBACK_FAILED'}`; }
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
    return Object.freeze({
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
  } finally {
    if (patchPath) await rm(patchPath, { force: true });
  }
}
