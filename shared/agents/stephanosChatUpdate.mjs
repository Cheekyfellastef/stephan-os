import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';
import { projectIgnitionInertEvidenceV1, projectIgnitionOwnerResultV1,
  projectPostSyncRemainingIgnitionObligationsV1, projectThreeAppDesktopStartupAdmissionV1,
  THREE_APP_DESKTOP_STARTUP_SCOPE_V1 } from './postSyncRuntimeRefreshCoordinator.mjs';
import { collectPostSyncRefreshDebt, resolvePostSyncRefreshDebt } from '../../scripts/battle-bridge-github-sync-policy.mjs';
import { createFixedSyncAndRefreshAdapter, SYNC_AND_REFRESH_CHILD_BUDGET_MS,
  SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS, readCanonicalPostSyncRefreshEvidenceV1,
  resolveCanonicalSyncAndRefreshPaths } from '../../scripts/battle-bridge-github-sync-and-refresh.mjs';
import { adjudicateBattleBridgeIgnitionSyncPreflightResultV1 } from '../../scripts/battle-bridge-ignition-sync-preflight.mjs';
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
const UPDATE_RUNTIME_BUDGET_MS = 900000;
const SHA40 = /^[a-f0-9]{40}$/;
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
  // Git porcelain status uses the first two columns as authority-bearing state.
  // Preserve leading whitespace so a first-line worktree-only status (for example
  // ` D path`) cannot be shifted into the index column or lose the first path byte.
  const text = String(value || '').trimEnd();
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

// The source-sync owner returns the real transition; it does not perform or
// publish canonical runtime adoption. Reuse the existing coordinator and
// preflight owners before the direct service supervisor can have effects.
async function admitCanonicalUpdateRuntime({ repoRoot, sync, spawnSyncFn, adoptionEvidenceReader }) {
  const beforeHead = sync?.beforeHead, sourceHead = sync?.afterHead;
  const deadline = performance.now() + UPDATE_RUNTIME_BUDGET_MS;
  const remaining = () => Math.max(0, Math.floor(deadline - performance.now()));
  const stages = [];
  const result = (ok, blocker = '') => Object.freeze({ ok, blocker, sourceHead: typeof sourceHead === 'string' ? sourceHead : '',
    beforeHead: typeof beforeHead === 'string' ? beforeHead : '', stages: Object.freeze(stages), remainingBudgetMs: remaining() });
  if (!SHA40.test(beforeHead || '') || !SHA40.test(sourceHead || '') || sync.branch !== 'main'
    || sync.approvedTargetHead !== sourceHead || sync.sourceConverged !== true || sync.verificationPassed !== true
    || sync.tests?.ok !== true || typeof sync.updated !== 'boolean' || sync.updated !== (beforeHead !== sourceHead))
    return result(false, 'CHAT_UPDATE_SOURCE_TRANSITION_UNPROVEN');
  const observer = createFixedSyncAndRefreshAdapter({ spawnSyncFn });
  const exactHead = () => {
    const observed = observer.observeCurrentHead(repoRoot, { timeoutMs: remaining() });
    return observed?.ok === true && observed.head === sourceHead;
  };
  const safeBlocker = value => typeof value === 'string' && /^[A-Z0-9_:-]{1,180}$/.test(value)
    ? value : 'CANONICAL_RUNTIME_ADOPTION_HELD';
  function stage(script, args, marker, ceiling) {
    if (!exactHead()) return { ok: false, blocker: 'CHAT_UPDATE_SOURCE_ADVANCED_BEFORE_ADOPTION' };
    const timeout = Math.min(ceiling, remaining());
    if (timeout <= 0) return { ok: false, blocker: 'CHAT_UPDATE_RUNTIME_BUDGET_EXHAUSTED' };
    let child;
    try { child = spawnSyncFn(process.execPath, [join(repoRoot, 'scripts', script), ...args], {
      cwd: repoRoot, shell: false, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: createBattleBridgeMinimalChildEnvironment(process.env), timeout, maxBuffer: 256 * 1024,
    }); } catch { child = { status: null, error: { code: 'SPAWN_UNPROVEN' } }; }
    const closed = !child?.error && !child?.signal && [0, 2].includes(child?.status);
    let parsed = null;
    try {
      const lines = typeof child?.stdout === 'string' ? child.stdout.split(/\r?\n/).filter(line => line.startsWith(marker)) : [];
      if (closed && lines.length === 1) parsed = projectIgnitionInertEvidenceV1(JSON.parse(lines[0].slice(marker.length)));
    } catch { /* Missing/invalid authority remains a hold. */ }
    const sourceStillExact = exactHead();
    const summary = Object.freeze({ script, exitCode: Number.isInteger(child?.status) ? child.status : null,
      sourceStillExact, parsed: parsed !== null,
      blocker: child?.error?.code === 'ETIMEDOUT' ? 'CHAT_UPDATE_ADOPTION_TIMEOUT'
        : !sourceStillExact ? 'CHAT_UPDATE_SOURCE_ADVANCED_DURING_ADOPTION'
          : !closed || !parsed ? 'CHAT_UPDATE_ADOPTION_RESULT_UNPROVEN' : parsed.ok === true ? '' : safeBlocker(parsed.blocker) });
    stages.push(summary);
    return { ok: summary.blocker === '' && child.status === 0, normalTerminal: closed && parsed !== null && sourceStillExact,
      exitCode: child?.status, blocker: summary.blocker || safeBlocker(parsed?.blocker), parsed };
  }
  const changed = beforeHead !== sourceHead;
  const paths = resolveCanonicalSyncAndRefreshPaths();
  const ancestry = (before, after) => before === after ? { ok: true, ancestor: true }
    : observer.isAncestor(before, after, repoRoot, { timeoutMs: remaining() });
  async function canonicalEvidence() {
    if (!exactHead()) return { ok: false, blocker: 'CHAT_UPDATE_SOURCE_ADVANCED_BEFORE_EVIDENCE' };
    let view;
    try { view = projectIgnitionInertEvidenceV1(await adoptionEvidenceReader(paths)); } catch { /* A read failure is not absent history. */ }
    if (!exactHead()) return { ok: false, blocker: 'CHAT_UPDATE_SOURCE_ADVANCED_DURING_EVIDENCE' };
    if (!view || view.schemaVersion !== 'stephanos.canonical-post-sync-refresh-evidence.v1' || !view.canonicalRecords)
      return { ok: false, blocker: 'CHAT_UPDATE_CANONICAL_ADOPTION_EVIDENCE_UNPROVEN' };
    // Re-derive authority from the actual bounded canonical records. A supplied
    // summary/ok flag never substitutes for owner, span or scoped proof checks.
    const evidence = collectPostSyncRefreshDebt(view.canonicalRecords);
    if (!evidence.ok) return evidence;
    const resolved = resolvePostSyncRefreshDebt({ ...evidence, currentHead: sourceHead, requireCurrentCoverage: true, isAncestor: ancestry });
    if (!resolved.ok) return resolved;
    let paid = !changed && resolved.debt === null;
    if (changed) {
      const covered = resolvePostSyncRefreshDebt({ ...evidence, requestedSpans: [{ beforeHead, afterHead: sourceHead }],
        currentHead: sourceHead, requireCurrentCoverage: true, isAncestor: ancestry });
      if (!covered.ok) return covered;
      paid = covered.debt === null;
      if (!paid) {
        const debt = resolved.debt;
        const coversStart = debt && debt.afterHead === sourceHead ? ancestry(debt.beforeHead, beforeHead) : null;
        if (!debt || coversStart?.ok !== true || coversStart.ancestor !== true)
          return { ok: false, blocker: 'CHAT_UPDATE_TRANSITION_RETENTION_UNPROVEN' };
      }
    }
    return { ok: true, paid, records: view.canonicalRecords };
  }
  if (beforeHead !== sourceHead) {
    const refresh = stage('battle-bridge-post-sync-refresh.mjs', ['--before', beforeHead, '--after', sourceHead],
      'POST_SYNC_REFRESH_RESULT=', SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.refresh);
    if (!refresh.normalTerminal) return result(false, refresh.blocker);
    const record = projectIgnitionOwnerResultV1({ ok: true, result: refresh.parsed }, 'refresh')?.result;
    const obligations = projectPostSyncRemainingIgnitionObligationsV1(record, sourceHead);
    if (!record || record.schemaVersion !== 'stephanos.post-sync-runtime-refresh.v1'
      || typeof record.ok !== 'boolean' || record.sourceHead !== sourceHead
      || record.phase !== (record.ok ? 'complete' : 'blocked') || refresh.exitCode !== (record.ok ? 0 : 2) || !obligations)
      return result(false, 'CHAT_UPDATE_ADOPTION_PROJECTION_UNPROVEN');
  }
  const beforeEvidence = await canonicalEvidence();
  if (!beforeEvidence.ok) return result(false, beforeEvidence.blocker);
  const preflight = stage('battle-bridge-ignition-sync-preflight.mjs', [],
    'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=', SYNC_AND_REFRESH_CHILD_BUDGET_MS);
  if (!preflight.ok) return result(false, preflight.blocker);
  const proof = preflight.parsed;
  const classifications = ['IGNITION_SYNC_PREFLIGHT_PASS', 'IGNITION_SYNC_PREFLIGHT_PASS_CONTROL_PLANE_DEGRADED',
    'IGNITION_SYNC_PREFLIGHT_PASS_COMMANDER_CUSTODY_DEGRADED', 'IGNITION_SYNC_PREFLIGHT_PASS_PLUGIN_HOST_DEGRADED',
    'IGNITION_SYNC_PREFLIGHT_PASS_THREE_APP_STARTUP'];
  const scoped = proof.classification === classifications[4];
  const common = ['schemaVersion','ok','skipped','classification','sourceHead','syncClassification','syncBlockerReason',
    'refreshCount','pendingRefreshObserved','sourceForwardedBeforeRefresh','refreshDebtCoalesced','controlPlaneRepairObserved','blocker','finalVerdict'];
  const reports = ['refreshBlocker','refreshObligations'];
  const scopeFields = scoped ? ['startupScope','startupAdmission'] : [];
  const optional = proof.classification === classifications[1] ? ['controlPlaneDegraded','controlPlaneBlocker']
    : proof.classification === classifications[2] ? ['commanderDegraded','commanderBlocker']
      : proof.classification === classifications[3] ? ['pluginHostDegraded','pluginHostBlocker']
        : scoped && proof.controlPlaneDegraded === true ? ['controlPlaneDegraded','controlPlaneBlocker'] : [];
  if (proof.schemaVersion !== 'stephanos.battle-bridge-ignition-sync-preflight.v1' || proof.ok !== true
    || proof.skipped !== false || proof.sourceHead !== sourceHead || !classifications.includes(proof.classification)
    || common.some(key => !Object.hasOwn(proof,key))
    || Object.keys(proof).some(key => ![...common,...optional,...reports,...scopeFields].includes(key))
    || proof.syncClassification !== 'SYNC_NO_CHANGE' || typeof proof.syncBlockerReason !== 'string'
    || !Number.isSafeInteger(proof.refreshCount) || proof.refreshCount < 0 || proof.refreshCount > 3
    || ['pendingRefreshObserved','sourceForwardedBeforeRefresh','refreshDebtCoalesced','controlPlaneRepairObserved'].some(key => typeof proof[key] !== 'boolean')
    || (optional.length && (proof[optional[0]] !== true || typeof proof[optional[1]] !== 'string'))
    || proof.blocker !== '' || proof.finalVerdict !== 'IGNITION_SYNC_PREFLIGHT_PASS')
    return result(false, 'CHAT_UPDATE_ADOPTION_PREFLIGHT_UNPROVEN');
  const afterEvidence = await canonicalEvidence();
  if (!afterEvidence.ok) return result(false, afterEvidence.blocker);
  const refresh = afterEvidence.records.refreshRecord;
  if (proof.classification !== classifications[0] && (!refresh || refresh.afterHead !== sourceHead))
    return result(false, 'CHAT_UPDATE_OPTIONAL_ADOPTION_COHORT_UNPROVEN');
  // Reporting fields and scoped startup are not caller-granted authority. Check
  // both against a separately read, exact-head canonical record, not stdout.
  const sameFrame = (provided, canonical) => JSON.stringify(provided) === JSON.stringify(canonical);
  const hasReports = reports.some(key => Object.hasOwn(proof, key));
  if (hasReports) {
    const obligations = refresh && projectPostSyncRemainingIgnitionObligationsV1(refresh, sourceHead);
    if (!reports.every(key => Object.hasOwn(proof, key)) || !obligations
      || typeof proof.refreshBlocker !== 'string' || proof.refreshBlocker !== refresh.blocker
      || !sameFrame(proof.refreshObligations, obligations))
      return result(false, 'CHAT_UPDATE_CANONICAL_PREFLIGHT_REPORT_MISMATCH');
  }
  if (scoped) {
    const admission = refresh && projectThreeAppDesktopStartupAdmissionV1(refresh, sourceHead);
    if (!hasReports || !admission || admission.admitted !== true
      || proof.startupScope !== THREE_APP_DESKTOP_STARTUP_SCOPE_V1
      || !sameFrame(proof.startupAdmission, admission))
      return result(false, 'CHAT_UPDATE_THREE_APP_CANONICAL_ADMISSION_UNPROVEN');
  }
  if (!afterEvidence.paid && !scoped) {
    if (!refresh || refresh.afterHead !== sourceHead) return result(false, 'CHAT_UPDATE_OPTIONAL_ADOPTION_COHORT_UNPROVEN');
    // Reuse the exact canonical optional-hold decision over the actual current
    // record. This is a pure check, with no additional sync/writer/executor.
    const decision = adjudicateBattleBridgeIgnitionSyncPreflightResultV1({ ok: false, blocker: refresh.blocker,
      sourceHead, syncClassification: 'SYNC_NO_CHANGE', refreshes: [{ result: refresh }], finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
    if (decision.ok !== true || decision.classification !== proof.classification)
      return result(false, 'CHAT_UPDATE_CANONICAL_MANDATORY_OBLIGATIONS_UNPROVEN');
  }
  if (!exactHead()) return result(false, 'CHAT_UPDATE_SOURCE_ADVANCED_BEFORE_SUPERVISOR');
  if (remaining() <= 0) return result(false, 'CHAT_UPDATE_RUNTIME_BUDGET_EXHAUSTED');
  return result(true);
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
  adoptionEvidenceReader = readCanonicalPostSyncRefreshEvidenceV1,
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

  const preDiagnostics = await diagnosticsFn({ repoRoot, spawnSyncFn });
  const statusBefore = capture(spawnSyncFn, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, timeout: 120000 });
  const dirtBefore = classifyUpdateDirt(statusBefore.stdout);
  const runtimeAdoption = await admitCanonicalUpdateRuntime({ repoRoot, sync, spawnSyncFn, adoptionEvidenceReader });
  if (!runtimeAdoption.ok) return Object.freeze({ ok: false, schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
    status: 'BLOCKED', verdict: 'FAIL', finalVerdict: 'SOURCE_INSTALLED_ADOPTION_HELD', blocker: runtimeAdoption.blocker,
    sync, sourceInstalled: true, sourceHead: normalizedAfterHead, branch: expectedBranch,
    sourceInstallStatus: sync.updated ? 'SOURCE_UPDATED' : 'SOURCE_ALREADY_CURRENT', runtimeAdoption,
    runtimeRefreshAttempted: runtimeAdoption.stages.length > 0, serviceSupervisorInvoked: false,
    readinessScope: 'SOURCE_AND_SERVED_SERVICES', desktopIgnitionReadiness: 'UNPROVEN',
    operatorPowerShellRequired: false, nextOperatorAction: 'Source remains installed. Resolve the canonical runtime-adoption hold before retrying ordinary Ignition; do not discard source or invent desktop readiness.' });
  const ignitionScript = join(repoRoot, 'scripts', 'run-battle-bridge-ignition.mjs');
  const ignition = capture(spawnSyncFn, process.execPath, [ignitionScript, '--expected-main', normalizedAfterHead], { cwd: repoRoot, timeout: runtimeAdoption.remainingBudgetMs });
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
    runtimeAdoption,
    serviceSupervisorInvoked: true,
    readinessScope: 'SOURCE_AND_SERVED_SERVICES',
    desktopIgnitionReadiness: 'UNPROVEN',
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
        : 'Stephanos source and served services are exact-head. Full desktop Ignition readiness requires the existing canonical launcher and its fresh browser-window receipts.')
      : (runtimeProofPending
        ? 'Source is installed and safe. Re-run bounded read-only exact-head runtime proof after the grace window; do not repeat the Git update or discard local work.'
        : 'Inspect the returned bounded blocker. Do not reset, clean, stash, force-checkout, or discard local work.'),
  });
}
