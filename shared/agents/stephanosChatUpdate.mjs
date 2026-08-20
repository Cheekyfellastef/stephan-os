import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  syncCodexDispatchBridge,
} from './codexDispatchHostOps.mjs';
import { classifyUpdateDirt, compareUpdateDirt } from './stephanosUpdateDirt.mjs';

export { classifyUpdateDirt, compareUpdateDirt } from './stephanosUpdateDirt.mjs';

export const STEPHANOS_CHAT_UPDATE_SCHEMA = 'stephanos.chat-update.v1';
export const DEFAULT_RUNTIME_PROOF_ATTEMPTS = 5;
export const DEFAULT_RUNTIME_PROOF_DELAY_MS = 2000;

const MAX_RUNTIME_PROOF_ATTEMPTS = 8;
const MAX_RUNTIME_PROOF_DELAY_MS = 10000;
const EXACT_HEAD = /^[0-9a-f]{40}$/;
const RUNTIME_PROOF_ENDPOINTS = Object.freeze([
  'http://127.0.0.1:4173/__stephanos/health',
  'http://127.0.0.1:8787/api/health',
  'http://127.0.0.1:18789/health',
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

function capture(spawnSyncFn, command, args, { cwd, timeout = 900000, env } = {}) {
  const result = spawnSyncFn(command, args, {
    cwd,
    ...(env ? { env } : {}),
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

async function readBoundedResponseText(response, maxBytes = 2500) {
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value || []);
        total += chunk.length;
        if (total > maxBytes) throw new Error('RUNTIME_PROOF_RESPONSE_TOO_LARGE');
        chunks.push(chunk);
      }
    } finally {
      if (total > maxBytes) await reader.cancel?.().catch?.(() => {});
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }
  const text = String(await response.text());
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('RUNTIME_PROOF_RESPONSE_TOO_LARGE');
  return text;
}

async function probeRuntimeEndpoint(url, { fetchFn = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('RUNTIME_PROOF_RESPONSE_TIMEOUT'));
    }, timeoutMs);
  });
  timer.unref?.();
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(url, { method: 'GET', signal: controller.signal });
        return Object.freeze({
          url,
          ok: response?.ok === true,
          status: Number.isSafeInteger(response?.status) ? response.status : null,
          body: await readBoundedResponseText(response, 2500),
          error: '',
        });
      })(),
      timeout,
    ]);
  } catch (error) {
    return Object.freeze({ url, ok: false, status: null, body: '', error: error?.message || String(error) });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Runtime proof is deliberately HTTP-only. Source identity is supplied by the
// fixed command runner at the call site; this collector never invokes Git,
// PowerShell, a worker probe, or any logical/ambient diagnostic command.
export async function collectStephanosRuntimeEndpointDiagnostics({
  sourceHead = '',
  fetchFn = globalThis.fetch,
  endpoints = RUNTIME_PROOF_ENDPOINTS,
  timeoutMs = 10_000,
} = {}) {
  const fullHead = String(sourceHead || '').trim().toLowerCase();
  const health = await Promise.all(endpoints.map((url) => probeRuntimeEndpoint(url, { fetchFn, timeoutMs })));
  const ok = EXACT_HEAD.test(fullHead) && health.every((entry) => entry.ok);
  return Object.freeze({
    ok,
    status: ok ? 'DONE' : 'FAILED',
    verdict: ok ? 'PASS' : 'FAIL',
    blocker: ok ? '' : (EXACT_HEAD.test(fullHead) ? 'BATTLE_BRIDGE_ENDPOINT_HEALTH_FAILED' : 'SOURCE_HEAD_UNPROVEN'),
    fullHead,
    health: Object.freeze(health),
    commandDiagnosticsPerformed: false,
    powershellDiagnosticsPerformed: false,
  });
}

function servedUiProof(diagnostics = {}) {
  const ui = Array.isArray(diagnostics.health)
    ? diagnostics.health.find((entry) => String(entry?.url || '').includes('127.0.0.1:4173'))
    : null;
  const body = String(ui?.body || '');
  let payload = null;
  try { payload = body ? JSON.parse(body) : null; } catch { payload = null; }
  const sourceHead = String(diagnostics.fullHead || '').trim().toLowerCase();
  const servedCommit = String(payload?.gitCommit || '').trim().toLowerCase();
  const runtimeMarker = String(payload?.runtimeMarker || '');
  const markerHeadBound = /^[0-9a-f]{40}$/.test(sourceHead)
    && new RegExp(`(?:^|::)${sourceHead}(?:::|$)`, 'i').test(runtimeMarker);
  const canonicalHealth = ui?.ok === true
    && ui?.status === 200
    && payload?.ok === true
    && payload?.service === 'stephanos-dist-server'
    && payload?.intendedMode === 'launcher-root';
  return Object.freeze({
    healthOk: canonicalHealth,
    httpStatus: ui?.status ?? null,
    sourceHead,
    servedCommit,
    runtimeMarker,
    exactHead: Boolean(canonicalHealth && servedCommit === sourceHead && markerHeadBound),
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
  diagnosticsFn = collectStephanosRuntimeEndpointDiagnostics,
  fetchFn = globalThis.fetch,
  runtimeProofAttempts = DEFAULT_RUNTIME_PROOF_ATTEMPTS,
  runtimeProofDelayMs = DEFAULT_RUNTIME_PROOF_DELAY_MS,
  sleepFn = sleep,
  gitCommand = 'git',
  gitArgsPrefix = Object.freeze([]),
  gitEnv,
  nodeCommand = process.execPath,
  nodeEnv,
  commandRunnerFn = null,
  ownerReceiptId = '',
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
  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  const normalizedAfterHead = String(sync?.afterHead || '').trim().toLowerCase();
  const expectedHeadSupplied = /^[0-9a-f]{40}$/i.test(normalizedExpectedHead);
  const sourceInstalled = /^[0-9a-f]{40}$/i.test(normalizedAfterHead)
    && String(sync?.branch || '') === expectedBranch;
  const expectedHeadMatch = expectedHeadSupplied && normalizedAfterHead === normalizedExpectedHead;
  if (!sync?.ok) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: sync?.status || 'BLOCKED',
      verdict: 'FAIL',
      finalVerdict: sync?.blocker || 'SOURCE_SYNC_FAILED',
      blocker: sync?.blocker || 'SOURCE_SYNC_FAILED',
      sync,
      sourceInstalled,
      sourceHead: sourceInstalled ? normalizedAfterHead : '',
      branch: sourceInstalled ? expectedBranch : '',
      expectedHeadMatch,
      runtimeRefreshAttempted: false,
      executionStateUnproven: sync?.executionStateUnproven === true,
      operatorPowerShellRequired: false,
      nextOperatorAction: 'Inspect the exact bounded sync blocker. No local work was discarded and no runtime refresh was attempted.',
    });
  }

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

  if (platform === 'win32' && typeof commandRunnerFn !== 'function') {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      finalVerdict: 'FIXED_RUNTIME_COMMAND_BOUNDARY_REQUIRED',
      blocker: 'FIXED_RUNTIME_COMMAND_BOUNDARY_REQUIRED',
      sync,
      sourceInstalled,
      sourceHead: sourceInstalled ? normalizedAfterHead : '',
      branch: sourceInstalled ? expectedBranch : '',
      expectedHeadMatch,
      runtimeRefreshAttempted: false,
      processControlPerformed: false,
      nextOperatorAction: 'Use the authenticated owner-handler update route with its fixed in-memory command boundary.',
    });
  }

  const runCommand = commandRunnerFn
    ? (command, args, options) => commandRunnerFn(command, args, options)
    : (command, args, options) => capture(spawnSyncFn, command, args, options);
  const headBeforeIgnition = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'rev-parse', 'HEAD'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const branchBeforeIgnition = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'branch', '--show-current'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const statusBefore = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const trackedVisibilityBefore = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'ls-files', '-v', '--'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const dirtBefore = classifyUpdateDirt(statusBefore.stdout);
  const preIgnitionHead = String(headBeforeIgnition.stdout || '').trim().toLowerCase();
  const preIgnitionBranch = String(branchBeforeIgnition.stdout || '').trim();
  const preDiagnosticsRaw = await diagnosticsFn({
    repoRoot,
    sourceHead: preIgnitionHead,
    expectedSourceHead: normalizedAfterHead,
    fetchFn,
  });
  const preDiagnostics = Object.freeze({ ...preDiagnosticsRaw, fullHead: preIgnitionHead });
  let preIgnitionBlocker = '';
  if (!headBeforeIgnition.ok) preIgnitionBlocker = 'PRE_IGNITION_SOURCE_HEAD_UNPROVEN';
  else if (!branchBeforeIgnition.ok) preIgnitionBlocker = 'PRE_IGNITION_BRANCH_UNPROVEN';
  else if (!statusBefore.ok) preIgnitionBlocker = 'PRE_IGNITION_SOURCE_STATUS_UNPROVEN';
  else if (!trackedVisibilityBefore.ok) preIgnitionBlocker = 'PRE_IGNITION_TRACKED_VISIBILITY_UNPROVEN';
  else if (String(trackedVisibilityBefore.stdout || '').split(/\r?\n/).some((line) => /^S\s|^[a-z]\s/.test(line))) preIgnitionBlocker = 'HIDDEN_TRACKED_PATHS_PRESENT';
  else if (dirtBefore.sourceEntries.length > 0) preIgnitionBlocker = 'CHECKOUT_DIRTY_BEFORE_IGNITION';
  else if (!/^[0-9a-f]{40}$/.test(preIgnitionHead)) preIgnitionBlocker = 'PRE_IGNITION_SOURCE_HEAD_UNPROVEN';
  else if (preIgnitionHead !== normalizedAfterHead) preIgnitionBlocker = 'SOURCE_HEAD_CHANGED_BEFORE_REFRESH';
  else if (preIgnitionBranch !== expectedBranch) preIgnitionBlocker = 'PRE_IGNITION_BRANCH_MISMATCH';
  if (preIgnitionBlocker) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      finalVerdict: preIgnitionBlocker,
      blocker: preIgnitionBlocker,
      repoRoot,
      expectedBranch,
      expectedHead: normalizedExpectedHead,
      expectedHeadMatch,
      sourceInstalled: true,
      sourceInstallStatus: sync.updated ? 'SOURCE_UPDATED' : 'SOURCE_ALREADY_CURRENT',
      sourceHead: normalizedAfterHead,
      branch: expectedBranch,
      sync,
      preDiagnostics,
      headBeforeIgnition,
      branchBeforeIgnition,
      statusBefore,
      trackedVisibilityBefore,
      dirtBefore,
      runtimeRefreshAttempted: false,
      runtimeProofPassed: false,
      runtimeProofPending: false,
      processControlPerformed: false,
      destructiveSourceCleanupPerformed: false,
      nextOperatorAction: 'Preserve and inspect the checkout/head evidence. No ignition, cleanup, restore, move, or runtime process control was attempted.',
    });
  }
  const ignitionScript = join(repoRoot, 'scripts', 'run-battle-bridge-ignition.mjs');
  const ignition = await runCommand(nodeCommand, [ignitionScript], {
    cwd: repoRoot,
    timeout: 900000,
    env: nodeEnv,
    ignitionApproval: Object.freeze({ expectedHead: normalizedAfterHead, receiptId: String(ownerReceiptId || '').toLowerCase() }),
  });
  if (ignition?.executionStateUnproven === true || ignition?.processTreeClosureProven === false) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: 'PENDING',
      verdict: 'FAIL',
      finalVerdict: 'IGNITION_EXECUTION_STATE_UNPROVEN',
      blocker: 'IGNITION_EXECUTION_STATE_UNPROVEN',
      repoRoot,
      expectedBranch,
      expectedHead: normalizedExpectedHead,
      expectedHeadMatch,
      sourceInstalled: true,
      sourceInstallStatus: sync.updated ? 'SOURCE_UPDATED' : 'SOURCE_ALREADY_CURRENT',
      sourceHead: normalizedAfterHead,
      branch: expectedBranch,
      sync,
      preDiagnostics,
      headBeforeIgnition,
      branchBeforeIgnition,
      statusBefore,
      dirtBefore,
      ignition,
      runtimeRefreshAttempted: true,
      runtimeProofPassed: false,
      runtimeProofPending: false,
      processControlPerformed: true,
      processTreeClosureProven: false,
      executionStateUnproven: true,
      destructiveSourceCleanupPerformed: false,
      nextOperatorAction: 'Preserve the active owner lane. Do not retry while the timed-out or failed child process tree remains unproven.',
    });
  }
  const attempts = boundedInteger(runtimeProofAttempts, DEFAULT_RUNTIME_PROOF_ATTEMPTS, 1, MAX_RUNTIME_PROOF_ATTEMPTS);
  const delayMs = boundedInteger(runtimeProofDelayMs, DEFAULT_RUNTIME_PROOF_DELAY_MS, 0, MAX_RUNTIME_PROOF_DELAY_MS);
  const runtimeProof = await collectRuntimeProof({
    diagnosticsFn: async () => {
      const fixedHead = await runCommand(
        gitCommand,
        [...gitArgsPrefix, 'rev-parse', 'HEAD'],
        { cwd: repoRoot, timeout: 120000, env: gitEnv },
      );
      const observedHead = String(fixedHead.stdout || '').trim().toLowerCase();
      if (!fixedHead.ok || !EXACT_HEAD.test(observedHead)) {
        return Object.freeze({
          ok: false,
          status: 'FAILED',
          verdict: 'FAIL',
          blocker: 'RUNTIME_PROOF_SOURCE_HEAD_UNPROVEN',
          fullHead: '',
          health: Object.freeze([]),
        });
      }
      const diagnostics = await diagnosticsFn({
        repoRoot,
        sourceHead: observedHead,
        expectedSourceHead: normalizedAfterHead,
        fetchFn,
      });
      return Object.freeze({ ...diagnostics, fullHead: observedHead });
    },
    preSourceHead: preIgnitionHead,
    expectedSourceHead: String(sync.afterHead || ''),
    attempts,
    delayMs,
    sleepFn,
  });
  const postDiagnostics = runtimeProof.finalDiagnostics;
  const headAfterIgnition = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'rev-parse', 'HEAD'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const branchAfterIgnition = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'branch', '--show-current'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const statusAfter = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const trackedVisibilityAfter = await runCommand(
    gitCommand,
    [...gitArgsPrefix, 'ls-files', '-v', '--'],
    { cwd: repoRoot, timeout: 120000, env: gitEnv },
  );
  const dirtAfter = classifyUpdateDirt(statusAfter.stdout);
  const dirtDelta = compareUpdateDirt(dirtBefore, dirtAfter);
  const finalProof = runtimeProof.finalAttempt;
  const directPostHead = String(headAfterIgnition.stdout || '').trim().toLowerCase();
  const sourceHeadChangedDuringRefresh = finalProof?.sourceHeadChangedDuringRefresh === true
    || (headAfterIgnition.ok && directPostHead !== preIgnitionHead);
  const sourceHeadMismatch = finalProof?.sourceHeadMismatch === true
    || (headAfterIgnition.ok && directPostHead !== normalizedAfterHead);
  const runtimeProofPending = Boolean(
    ignition.ok
    && headAfterIgnition.ok
    && branchAfterIgnition.ok
    && String(branchAfterIgnition.stdout || '').trim() === expectedBranch
    && statusAfter.ok
    && trackedVisibilityAfter.ok
    && !String(trackedVisibilityAfter.stdout || '').split(/\r?\n/).some((line) => /^S\s|^[a-z]\s/.test(line))
    && dirtAfter.source.length === 0
    && !dirtDelta.sourceMutationDetected
    && !sourceHeadChangedDuringRefresh
    && !sourceHeadMismatch
    && runtimeProof.passed !== true
  );
  const passed = Boolean(
    ignition.ok
    && runtimeProof.passed
    && headAfterIgnition.ok
    && branchAfterIgnition.ok
    && String(branchAfterIgnition.stdout || '').trim() === expectedBranch
    && statusAfter.ok
    && trackedVisibilityAfter.ok
    && !String(trackedVisibilityAfter.stdout || '').split(/\r?\n/).some((line) => /^S\s|^[a-z]\s/.test(line))
    && dirtAfter.source.length === 0
    && !dirtDelta.sourceMutationDetected
  );

  let blocker = '';
  if (!headAfterIgnition.ok) blocker = 'POST_IGNITION_SOURCE_HEAD_UNPROVEN';
  else if (!branchAfterIgnition.ok) blocker = 'POST_IGNITION_BRANCH_UNPROVEN';
  else if (String(branchAfterIgnition.stdout || '').trim() !== expectedBranch) blocker = 'POST_IGNITION_BRANCH_MISMATCH';
  else if (!statusAfter.ok) blocker = 'POST_IGNITION_SOURCE_STATUS_UNPROVEN';
  else if (!trackedVisibilityAfter.ok) blocker = 'POST_IGNITION_TRACKED_VISIBILITY_UNPROVEN';
  else if (String(trackedVisibilityAfter.stdout || '').split(/\r?\n/).some((line) => /^S\s|^[a-z]\s/.test(line))) blocker = 'HIDDEN_TRACKED_PATHS_PRESENT';
  else if (dirtAfter.source.length > 0) blocker = 'SOURCE_DIRT_PRESENT_AFTER_IGNITION';
  else if (dirtDelta.sourceMutationDetected) blocker = 'SOURCE_DIRT_CHANGED_DURING_UPDATE';
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
    headBeforeIgnition,
    branchBeforeIgnition,
    ignition,
    postDiagnostics,
    headAfterIgnition,
    branchAfterIgnition,
    trackedVisibilityBefore,
    trackedVisibilityAfter,
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
    processTreeClosureProven: ignition?.processTreeClosureProven !== false,
    executionStateUnproven: false,
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
