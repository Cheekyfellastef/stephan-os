import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  runBattleBridgeDiagnostics,
  syncCodexDispatchBridge,
} from './codexDispatchHostOps.mjs';

export const STEPHANOS_CHAT_UPDATE_SCHEMA = 'stephanos.chat-update.v1';
export const DEFAULT_RUNTIME_PROOF_ATTEMPTS = 5;
export const DEFAULT_RUNTIME_PROOF_DELAY_MS = 2000;

const MAX_RUNTIME_PROOF_ATTEMPTS = 8;
const MAX_RUNTIME_PROOF_DELAY_MS = 10000;
const APPROVED_RUNTIME_PREFIXES = Object.freeze([
  'apps/stephanos/dist/',
  'data/',
  'stephanos-server/data/memory/durable-memory.json',
  'memory/.dreams/',
  'memory/dreaming/deep/',
  'memory/dreaming/light/',
  'memory/dreaming/rem/',
]);

function bounded(value = '', limit = 8000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capture(spawnSyncFn, command, args, { cwd, timeout = 900000 } = {}) {
  const result = spawnSyncFn(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
  });
  return Object.freeze({
    command,
    args: [...args],
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: bounded(result?.stdout),
    stderr: bounded(result?.stderr),
    error: result?.error?.message || '',
  });
}

function parsePorcelain(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3).trim().split(' -> ').at(-1)?.replace(/^"|"$/g, '').replace(/\\/g, '/') || '',
    }))
    .filter((entry) => entry.path);
}

function stableEntries(entries = []) {
  return entries.map((entry) => `${entry.status} ${entry.path}`).sort((a, b) => a.localeCompare(b));
}

export function classifyUpdateDirt(output = '') {
  const entries = parsePorcelain(output);
  const runtimeEntries = entries.filter((entry) => APPROVED_RUNTIME_PREFIXES.some((prefix) => (
    prefix.endsWith('/') ? entry.path.startsWith(prefix) : entry.path === prefix
  )));
  const sourceEntries = entries.filter((entry) => !runtimeEntries.includes(entry));
  return Object.freeze({
    entries,
    runtimeEntries,
    sourceEntries,
    runtime: runtimeEntries.map((entry) => entry.path),
    source: sourceEntries.map((entry) => entry.path),
  });
}

export function compareUpdateDirt(before = {}, after = {}) {
  const sourceBefore = stableEntries(before.sourceEntries || []);
  const sourceAfter = stableEntries(after.sourceEntries || []);
  const runtimeBefore = stableEntries(before.runtimeEntries || []);
  const runtimeAfter = stableEntries(after.runtimeEntries || []);
  return Object.freeze({
    sourceMutationDetected: JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter),
    runtimeMutationDetected: JSON.stringify(runtimeBefore) !== JSON.stringify(runtimeAfter),
    sourceDirtBefore: sourceBefore,
    sourceDirtAfter: sourceAfter,
    runtimeDirtBefore: runtimeBefore,
    runtimeDirtAfter: runtimeAfter,
  });
}

function extractJsonString(text = '', key = '') {
  const match = String(text || '').match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  return match?.[1] || '';
}

function servedUiProof(diagnostics = {}) {
  const ui = Array.isArray(diagnostics.health)
    ? diagnostics.health.find((entry) => String(entry?.url || '').includes('127.0.0.1:4173'))
    : null;
  const body = String(ui?.body || '');
  let payload = null;
  try { payload = body ? JSON.parse(body) : null; } catch {
    payload = {
      gitCommit: extractJsonString(body, 'gitCommit'),
      runtimeMarker: extractJsonString(body, 'runtimeMarker'),
      intendedMode: extractJsonString(body, 'intendedMode'),
    };
  }
  const sourceHead = String(diagnostics.fullHead || '');
  const servedCommit = String(payload?.gitCommit || '');
  return Object.freeze({
    healthOk: ui?.ok === true,
    httpStatus: ui?.status ?? null,
    sourceHead,
    servedCommit,
    runtimeMarker: String(payload?.runtimeMarker || ''),
    exactHead: Boolean(sourceHead && servedCommit && sourceHead.toLowerCase().startsWith(servedCommit.toLowerCase())),
    intendedMode: payload?.intendedMode || '',
    endpoint: String(ui?.url || 'http://127.0.0.1:4173/__stephanos/health'),
    error: ui?.error || '',
  });
}

function endpointEvidence(diagnostics = {}) {
  return Object.freeze((Array.isArray(diagnostics?.health) ? diagnostics.health : []).map((entry) => Object.freeze({
    url: String(entry?.url || ''),
    ok: entry?.ok === true,
    status: entry?.status ?? null,
    error: String(entry?.error || ''),
  })));
}

export function evaluateRuntimeProofAttempt(diagnostics = {}, {
  preSourceHead = '',
  expectedSourceHead = '',
  attemptNumber = 1,
} = {}) {
  const servedUi = servedUiProof(diagnostics);
  const observedSourceHead = String(diagnostics?.fullHead || '');
  const sourceHeadObserved = /^[0-9a-f]{40}$/i.test(observedSourceHead);
  const preHeadObserved = /^[0-9a-f]{40}$/i.test(String(preSourceHead || ''));
  const expectedHeadObserved = /^[0-9a-f]{40}$/i.test(String(expectedSourceHead || ''));
  const sourceHeadUnchangedDuringRefresh = Boolean(
    preHeadObserved && sourceHeadObserved && observedSourceHead === preSourceHead
  );
  const sourceMatchesSync = Boolean(
    expectedHeadObserved && sourceHeadObserved && observedSourceHead === expectedSourceHead
  );
  const predicates = Object.freeze([
    Object.freeze({ name: 'POST_DIAGNOSTICS_OK', passed: diagnostics?.ok === true }),
    Object.freeze({ name: 'SOURCE_HEAD_OBSERVED', passed: sourceHeadObserved }),
    Object.freeze({ name: 'SOURCE_HEAD_UNCHANGED_DURING_REFRESH', passed: sourceHeadUnchangedDuringRefresh }),
    Object.freeze({ name: 'SOURCE_MATCHES_SYNC', passed: sourceMatchesSync }),
    Object.freeze({ name: 'SERVED_UI_HEALTH_OK', passed: servedUi.healthOk }),
    Object.freeze({ name: 'SERVED_UI_EXACT_HEAD', passed: servedUi.exactHead }),
  ]);
  const failedPredicates = predicates.filter((predicate) => !predicate.passed).map((predicate) => predicate.name);
  return Object.freeze({
    attemptNumber,
    passed: failedPredicates.length === 0,
    observedSourceHead,
    sourceHeadObserved,
    sourceHeadUnchangedDuringRefresh,
    sourceMatchesSync,
    sourceHeadChangedDuringRefresh: Boolean(preHeadObserved && sourceHeadObserved && observedSourceHead !== preSourceHead),
    sourceHeadMismatch: Boolean(expectedHeadObserved && sourceHeadObserved && observedSourceHead !== expectedSourceHead),
    servedUiProof: servedUi,
    predicates,
    failedPredicates,
    endpointEvidence: endpointEvidence(diagnostics),
  });
}

async function collectRuntimeProof({
  diagnosticsFn,
  preSourceHead,
  expectedSourceHead,
  attempts,
  delayMs,
  sleepFn,
}) {
  const records = [];
  let finalDiagnostics = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      finalDiagnostics = await diagnosticsFn();
    } catch (error) {
      finalDiagnostics = {
        ok: false,
        status: 'FAILED',
        verdict: 'FAIL',
        fullHead: '',
        health: [],
        error: error?.message || String(error),
      };
    }
    const evaluation = evaluateRuntimeProofAttempt(finalDiagnostics, {
      preSourceHead,
      expectedSourceHead,
      attemptNumber: index + 1,
    });
    records.push(evaluation);
    if (evaluation.passed) break;
    if (index + 1 < attempts) await sleepFn(delayMs);
  }
  const finalAttempt = records.at(-1);
  return Object.freeze({
    passed: finalAttempt?.passed === true,
    exhausted: finalAttempt?.passed !== true && records.length >= attempts,
    attemptCount: records.length,
    maxAttempts: attempts,
    delayMs,
    attempts: Object.freeze(records),
    finalAttempt,
    finalDiagnostics,
  });
}

export async function updateStephanosFromChat({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  expectedBranch = 'main',
  expectedHead = '',
  operatorApproval = '',
  platform = process.platform,
  spawnSyncFn = spawnSync,
  syncFn = syncCodexDispatchBridge,
  diagnosticsFn = runBattleBridgeDiagnostics,
  runtimeProofAttempts = DEFAULT_RUNTIME_PROOF_ATTEMPTS,
  runtimeProofDelayMs = DEFAULT_RUNTIME_PROOF_DELAY_MS,
  sleepFn = sleep,
} = {}) {
  if (operatorApproval !== 'operator-approved') {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      finalVerdict: 'OPERATOR_APPROVAL_REQUIRED',
      blocker: 'OPERATOR_APPROVAL_REQUIRED',
      nextOperatorAction: 'Ask Stephan to explicitly approve updating the canonical Battle Bridge checkout and refreshing the Stephanos runtime.',
    });
  }

  const sync = await syncFn({ repoRoot, expectedBranch, expectedHead, operatorApproval, platform, spawnSyncFn });
  if (!sync?.ok) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: sync?.status || 'BLOCKED',
      verdict: 'FAIL',
      finalVerdict: sync?.blocker || 'SOURCE_SYNC_FAILED',
      blocker: sync?.blocker || 'SOURCE_SYNC_FAILED',
      sync,
      sourceInstalled: false,
      runtimeRefreshAttempted: false,
      operatorPowerShellRequired: false,
      nextOperatorAction: 'Inspect the exact bounded sync blocker. No local work was discarded and no runtime refresh was attempted.',
    });
  }

  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  const normalizedAfterHead = String(sync.afterHead || '').trim().toLowerCase();
  const expectedHeadSupplied = /^[0-9a-f]{40}$/i.test(normalizedExpectedHead);
  const expectedHeadMatch = expectedHeadSupplied && normalizedAfterHead === normalizedExpectedHead;
  if (expectedHeadSupplied && !expectedHeadMatch) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      finalVerdict: 'SYNC_AFTER_HEAD_MISMATCH',
      blocker: 'SYNC_AFTER_HEAD_MISMATCH',
      sync,
      sourceInstalled: Boolean(normalizedAfterHead),
      sourceHead: normalizedAfterHead,
      branch: expectedBranch,
      expectedHeadMatch: false,
      runtimeRefreshAttempted: false,
      operatorPowerShellRequired: false,
      nextOperatorAction: 'The fetched canonical head did not match the approved exact head. Do not refresh runtime until the source target is reviewed.',
    });
  }

  const preDiagnostics = await diagnosticsFn({ repoRoot, spawnSyncFn });
  const statusBefore = capture(spawnSyncFn, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, timeout: 120000 });
  const dirtBefore = classifyUpdateDirt(statusBefore.stdout);
  const ignitionScript = join(repoRoot, 'scripts', 'run-battle-bridge-ignition.mjs');
  const ignition = capture(spawnSyncFn, process.execPath, [ignitionScript], { cwd: repoRoot, timeout: 900000 });
  const attempts = boundedInteger(runtimeProofAttempts, DEFAULT_RUNTIME_PROOF_ATTEMPTS, 1, MAX_RUNTIME_PROOF_ATTEMPTS);
  const delayMs = boundedInteger(runtimeProofDelayMs, DEFAULT_RUNTIME_PROOF_DELAY_MS, 0, MAX_RUNTIME_PROOF_DELAY_MS);
  const runtimeProof = await collectRuntimeProof({
    diagnosticsFn: () => diagnosticsFn({ repoRoot, spawnSyncFn }),
    preSourceHead: String(preDiagnostics?.fullHead || ''),
    expectedSourceHead: String(sync.afterHead || ''),
    attempts,
    delayMs,
    sleepFn,
  });
  const postDiagnostics = runtimeProof.finalDiagnostics;
  const statusAfter = capture(spawnSyncFn, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, timeout: 120000 });
  const dirtAfter = classifyUpdateDirt(statusAfter.stdout);
  const dirtDelta = compareUpdateDirt(dirtBefore, dirtAfter);
  const finalProof = runtimeProof.finalAttempt;
  const sourceHeadChangedDuringRefresh = finalProof?.sourceHeadChangedDuringRefresh === true;
  const sourceHeadMismatch = finalProof?.sourceHeadMismatch === true;
  const runtimeProofPending = Boolean(
    ignition.ok
    && !dirtDelta.sourceMutationDetected
    && !sourceHeadChangedDuringRefresh
    && !sourceHeadMismatch
    && runtimeProof.passed !== true
  );
  const passed = Boolean(
    ignition.ok
    && runtimeProof.passed
    && !dirtDelta.sourceMutationDetected
  );

  let blocker = '';
  if (dirtDelta.sourceMutationDetected) blocker = 'SOURCE_DIRT_CHANGED_DURING_UPDATE';
  else if (!ignition.ok) blocker = 'IGNITION_REFRESH_FAILED';
  else if (sourceHeadChangedDuringRefresh) blocker = 'SOURCE_HEAD_CHANGED_DURING_REFRESH';
  else if (sourceHeadMismatch) blocker = 'POST_UPDATE_SOURCE_HEAD_MISMATCH';

  const finalVerdict = passed
    ? 'SOURCE_AND_RUNTIME_EXACT_HEAD'
    : (runtimeProofPending ? 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING' : blocker || 'POST_UPDATE_PROOF_FAILED');
  const ok = passed || runtimeProofPending;
  const status = passed ? 'DONE' : (runtimeProofPending ? 'PENDING' : (dirtDelta.sourceMutationDetected ? 'BLOCKED' : 'FAILED'));
  const verdict = passed ? 'PASS' : (runtimeProofPending ? 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING' : 'FAIL');

  return Object.freeze({
    ok,
    schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
    status,
    verdict,
    finalVerdict,
    repoRoot,
    expectedBranch,
    expectedHead: normalizedExpectedHead,
    expectedHeadMatch,
    sourceInstalled: true,
    sourceInstallStatus: sync.updated ? 'SOURCE_UPDATED' : 'SOURCE_ALREADY_CURRENT',
    sourceHead: String(sync.afterHead || ''),
    branch: expectedBranch,
    sync,
    preDiagnostics,
    ignition,
    postDiagnostics,
    servedUiProof: finalProof?.servedUiProof || servedUiProof(postDiagnostics || {}),
    sourceHeadUnchangedDuringRefresh: finalProof?.sourceHeadUnchangedDuringRefresh === true,
    sourceMatchesSync: finalProof?.sourceMatchesSync === true,
    runtimeProofPassed: runtimeProof.passed,
    runtimeProofPending,
    runtimeProof: Object.freeze({
      passed: runtimeProof.passed,
      exhausted: runtimeProof.exhausted,
      attemptCount: runtimeProof.attemptCount,
      maxAttempts: runtimeProof.maxAttempts,
      delayMs: runtimeProof.delayMs,
      failedPredicates: Object.freeze([...(finalProof?.failedPredicates || [])]),
      endpointEvidence: finalProof?.endpointEvidence || Object.freeze([]),
      attempts: runtimeProof.attempts,
    }),
    dirtBefore,
    dirtAfter,
    dirtDelta,
    operatorPowerShellRequired: false,
    visiblePowerShellRequested: false,
    codexChildUsed: false,
    processControlPerformed: true,
    publicExposureChanged: false,
    destructiveSourceCleanupPerformed: false,
    desktopRestartRequired: Boolean(sync.restartRequired),
    blocker,
    nextOperatorAction: passed
      ? (sync.restartRequired
        ? 'Stephanos source and runtime are exact-head. Restart the desktop app when convenient so changed local MCP code is reloaded.'
        : 'Stephanos source and runtime are exact-head. No PowerShell action is required.')
      : (runtimeProofPending
        ? 'Source is installed and safe. Re-run bounded read-only exact-head runtime proof after the grace window; do not repeat the Git update or discard local work.'
        : 'Inspect the returned bounded blocker. Do not reset, clean, stash, force-checkout, or discard local work.'),
  });
}
