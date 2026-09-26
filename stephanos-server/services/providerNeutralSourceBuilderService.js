import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';
import { collectAgentWorkerResult } from './missionOrchestratorWorkerService.js';

export const PROVIDER_NEUTRAL_SOURCE_BUILDER_SCHEMA = 'stephanos.provider-neutral-source-builder.v1';
const EXTERNAL_ADAPTERS = Object.freeze(['foundry-forge', 'chatgpt-github']);

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

function commandResultHash(result = {}) {
  return createHash('sha256')
    .update(`${result.stdout || ''}\n${result.stderr || ''}`, 'utf8')
    .digest('hex');
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
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

function reverseAppliedPatch(worktreePath, patchPath, run) {
  const check = run('git.exe', ['-C', worktreePath, 'apply', '--check', '--reverse', '--whitespace=error-all', patchPath], { cwd: worktreePath });
  if (check.error || check.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_CHECK_FAILED:${text(check.stderr || check.stdout)}`);
  }
  const reverse = run('git.exe', ['-C', worktreePath, 'apply', '--reverse', '--whitespace=error-all', patchPath], { cwd: worktreePath });
  if (reverse.error || reverse.status !== 0) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_FAILED:${text(reverse.stderr || reverse.stdout)}`);
  }
  const remaining = changedFiles(worktreePath, run);
  if (remaining.length) {
    throw new Error(`PROVIDER_NEUTRAL_PATCH_ROLLBACK_LEFT_CHANGES:${remaining.join(',')}`);
  }
}

function localBuilderPrompt(action = {}) {
  return [
    'You are the bounded Stephanos source builder.',
    `Mission ID: ${text(action.missionId)}`,
    `Operator intent: ${text(action.operatorIntent)}`,
    `Intended outcome: ${text(action.intendedOutcome)}`,
    `Allowed source files: ${JSON.stringify(action.allowedFiles || [])}`,
    `Required tests: ${JSON.stringify(action.requiredTests || [])}`,
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
  if (typeof options.generatePatch === 'function') return options.generatePatch(action);
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
      messages: [{ role: 'user', content: localBuilderPrompt(action) }],
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

function runRequiredTests(action, worktreePath, run, options = {}) {
  const tests = Array.isArray(action.requiredTests) ? action.requiredTests.map(text).filter(Boolean) : [];
  const receipts = [];
  for (const command of tests) {
    const result = run('cmd.exe', ['/d', '/s', '/c', command], { cwd: worktreePath, env: options.env || process.env });
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
      finalVerdict: quarantined ? 'PROVIDER_NEUTRAL_PENDING_QUEUE_RECOVERY' : '',
    });
  }
  const action = claim.item?.payload || {};
  const worktreePath = text(action.worktreePath);
  const run = options.runCommand || defaultRun;
  const completedAt = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  let patchPath = '';
  let patchApplied = false;
  let succeeded = false;
  let providerInvoked = false;
  let providerCompleted = false;
  try {
    if (action.actionKind !== 'agent-handoff' || !EXTERNAL_ADAPTERS.includes(claim.adapter)) {
      throw new Error('PROVIDER_NEUTRAL_ACTION_NOT_SOURCE_BUILD');
    }
    if (!worktreePath || !existsSync(worktreePath)) throw new Error('PROVIDER_NEUTRAL_WORKTREE_REQUIRED');
    if (!Array.isArray(action.allowedFiles) || action.allowedFiles.length === 0) throw new Error('PROVIDER_NEUTRAL_ALLOWED_FILES_REQUIRED');

    const startingChanges = changedFiles(worktreePath, run);
    if (startingChanges.length) throw new Error(`PROVIDER_NEUTRAL_WORKTREE_NOT_CLEAN:${startingChanges.join(',')}`);

    providerInvoked = true;
    const generated = await callLocalBuilder(action, options);
    providerCompleted = true;
    patchPath = resolve(worktreePath, `.stephanos-${text(action.actionId, 'source-build')}.patch`);
    await writeFile(patchPath, generated.patch, { encoding: 'utf8', flag: 'wx' });

    const check = run('git.exe', ['-C', worktreePath, 'apply', '--check', '--whitespace=error-all', patchPath], { cwd: worktreePath });
    if (check.error || check.status !== 0) throw new Error(`PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:${text(check.stderr || check.stdout)}`);
    const apply = run('git.exe', ['-C', worktreePath, 'apply', '--whitespace=error-all', patchPath], { cwd: worktreePath });
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

    await collectAgentWorkerResult({
      missionId: action.missionId,
      actionId: action.actionId,
      adapter: claim.adapter,
      success: true,
      resultId: execution.resultId,
      changedFiles: execution.changedFiles,
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
      changedFiles: execution.changedFiles,
      testsPassed: true,
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
    });
  } catch (error) {
    let failure = error?.message || 'provider-neutral source build failed';
    if (patchApplied && !succeeded && patchPath) {
      try { reverseAppliedPatch(worktreePath, patchPath, run); }
      catch (rollbackError) { failure = `${failure};${rollbackError?.message || 'PROVIDER_NEUTRAL_PATCH_ROLLBACK_FAILED'}`; }
    }
    try {
      await collectAgentWorkerResult({
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
