import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import path from 'node:path';

import {
  createBattleBridgeAsyncCommandRunner,
  syncBattleBridgeExactHeadAsyncV1,
} from '../../../../shared/agents/battleBridgeExactHeadAsyncUpdateV1.mjs';
import {
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  battleBridgeCanonicalRepositoryArgs,
  createBattleBridgeMinimalChildEnvironment,
} from '../../../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import { ensureSafeReceiptDirectoryChainSync } from '../../../../shared/agents/safeReceiptDirectoryChainV1.mjs';
import { updateStephanosFromChat } from '../../../../shared/agents/stephanosChatUpdate.mjs';
import { createStephanosIgniteCommandHandler } from './command-handler.mjs';
import {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_AUTHORIZATION_SCHEMA,
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
  buildOpenClawUpdateAuthorization,
  claimOpenClawUpdateInOwnerHandler,
  ensureOpenClawUpdateReceiptRoot,
  persistOpenClawUpdateCheckpoint,
  readStableOpenClawUpdateReceipt,
  releaseOpenClawUpdateOwnerLane,
  replaceOpenClawUpdateRecord,
  resolveOpenClawUpdateReceiptPaths,
  validateOpenClawUpdateAuthorization,
  writeNewOpenClawUpdateReceipt,
} from './recovery-update-receipt.mjs';

export {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_AUTHORIZATION_SCHEMA,
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
};

const EXACT_HEAD = /^[0-9a-f]{40}$/;
const RECEIPT_ID = /^[0-9a-f]{32}$/;
const SAFE_VERDICT = /^[A-Z0-9_]{1,120}$/;
let activeOwnerUpdateReceiptId = '';
let activeOwnerUpdateTask = null;
let activeOwnerUpdateStatusView = null;
let lastOwnerUpdateStatusView = null;
const OWNER_HANDLER_CAPABILITY = Symbol('stephanos-ignite-owner-handler-capability');

function text(value) {
  return String(value ?? '').trim();
}

function sanitizedCode(value, fallback = '') {
  const normalized = text(value).toUpperCase();
  return SAFE_VERDICT.test(normalized) ? normalized : fallback;
}

function queueFailureBlocker(error) {
  const candidate = sanitizedCode(error?.code || error?.message, 'UPDATE_QUEUE_FAILED');
  return candidate.startsWith('UPDATE_') || candidate.startsWith('OWNER_') || candidate.startsWith('PREVIOUS_')
    ? candidate
    : 'UPDATE_QUEUE_FAILED';
}

export function normalizeOpenClawExactHead(value) {
  const normalized = text(value).toLowerCase();
  return EXACT_HEAD.test(normalized) ? normalized : '';
}

export function readOpenClawExactHeadUpdateStatusFromOwnerHandler({
  receiptId,
  authenticatedContext = null,
  env = process.env,
  platform = process.platform,
} = {}) {
  const normalizedReceiptId = text(receiptId).toLowerCase();
  if (!RECEIPT_ID.test(normalizedReceiptId)) return blockedResult('', 'UPDATE_STATUS_RECEIPT_ID_INVALID');
  if (platform !== 'win32') return blockedResult('', 'WINDOWS_REQUIRED', normalizedReceiptId);
  if (authenticatedContext?.authenticatedByHost !== true
      || authenticatedContext?.commandName !== 'stephanos-ignite'
      || authenticatedContext?.command !== 'update-status'
      || authenticatedContext?.senderIsOwner !== true) {
    return blockedResult('', 'OWNER_AUTH_REQUIRED', normalizedReceiptId);
  }
  try {
    const paths = resolveOpenClawUpdateReceiptPaths({ env, receiptId: normalizedReceiptId });
    const safeRoot = ensureOpenClawUpdateReceiptRoot(paths, { create: false });
    const receipt = readStableOpenClawUpdateReceipt({ paths, safeRoot }).receipt;
    const expectedHead = normalizeOpenClawExactHead(receipt?.expectedHead);
    const authorizationIssuedAt = new Date(receipt?.authorization?.issuedAtUtc || '');
    const authorization = validateOpenClawUpdateAuthorization(receipt?.authorization, {
      receiptId: normalizedReceiptId,
      expectedHead,
      parentHostPid: receipt?.authorization?.hostPid,
      now: authorizationIssuedAt,
    });
    if (receipt?.schemaVersion !== OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA
        || receipt?.receiptId !== normalizedReceiptId || !expectedHead || !authorization.ok) {
      return blockedResult(expectedHead, 'UPDATE_STATUS_RECEIPT_INVALID', normalizedReceiptId);
    }
    let activeRecordPresent = false;
    try { lstatSync(paths.activePath); activeRecordPresent = true; } catch (error) {
      if (error?.code !== 'ENOENT') activeRecordPresent = true;
    }
    const durableReceiptStatusObserved = sanitizedCode(receipt.status, 'UPDATE_STATUS_UNPROVEN');
    const trusted = activeOwnerUpdateReceiptId === normalizedReceiptId && activeOwnerUpdateStatusView
      ? activeOwnerUpdateStatusView
      : (lastOwnerUpdateStatusView?.receiptId === normalizedReceiptId ? lastOwnerUpdateStatusView : null);
    if (!trusted) {
      return Object.freeze({
        ok: true,
        status: 'DURABLE_RECEIPT_AUTHENTICITY_UNPROVEN',
        finalVerdict: 'DURABLE_RECEIPT_AUTHENTICITY_UNPROVEN',
        blocker: 'DURABLE_RECEIPT_AUTHENTICITY_UNPROVEN',
        durableReceiptStatusObserved,
        receiptId: normalizedReceiptId,
        expectedHead,
        sourceHead: '',
        expectedHeadMatch: false,
        sourceInstalled: false,
        runtimeProofPassed: false,
        runtimeProofPending: false,
        pluginReloadProofPending: false,
        servedUiExactHead: false,
        retrySafe: false,
        executionStateUnproven: activeRecordPresent,
        resultAuthenticityProven: false,
        resultPersistenceProven: false,
        route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
      });
    }
    const persistenceMatches = receipt.expectedHead === trusted.expectedHead
      && durableReceiptStatusObserved === trusted.status;
    const terminal = ['FAILED', 'PLUGIN_RELOAD_PROOF_PENDING', 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING', 'DONE'].includes(trusted.status);
    return Object.freeze({
      ...trusted,
      ok: true,
      receiptId: normalizedReceiptId,
      retrySafe: terminal && persistenceMatches && !activeRecordPresent && trusted.resultPersistenceProven !== false,
      executionStateUnproven: trusted.executionStateUnproven === true || (activeRecordPresent && activeOwnerUpdateReceiptId !== normalizedReceiptId),
      resultAuthenticityProven: true,
      resultPersistenceProven: persistenceMatches && trusted.resultPersistenceProven !== false,
      route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
    });
  } catch (error) {
    return blockedResult('', sanitizedCode(error?.code || error?.message, 'UPDATE_STATUS_READ_FAILED'), normalizedReceiptId);
  }
}

function canonicalRepoRoot(env = process.env) {
  if (!env.USERPROFILE) return '';
  return path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
}

function blockedResult(expectedHead, blocker, receiptId = '') {
  return Object.freeze({
    ok: false,
    status: 'FAILED',
    finalVerdict: blocker,
    blocker,
    expectedHead,
    ...(receiptId ? { receiptId } : {}),
    sourceHead: '',
    expectedHeadMatch: false,
    sourceInstalled: false,
    runtimeProofPassed: false,
    runtimeProofPending: false,
    pluginReloadProofPending: false,
    servedUiExactHead: false,
    route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
  });
}

function executingResult(expectedHead, receiptId) {
  return Object.freeze({
    ok: true,
    status: 'EXECUTING',
    finalVerdict: 'UPDATE_EXECUTION_RUNNING',
    blocker: '',
    expectedHead,
    receiptId,
    sourceHead: '',
    expectedHeadMatch: false,
    sourceInstalled: false,
    runtimeProofPassed: false,
    runtimeProofPending: false,
    pluginReloadProofPending: false,
    servedUiExactHead: false,
    route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
    destructiveGitAllowed: false,
    arbitraryShellAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedExecutableAllowed: false,
    pcRestartAllowed: false,
  });
}

function trustedStatusViewFromResult(result, receiptId, expectedHead) {
  const executionStateUnproven = result?.executionStateUnproven === true;
  const status = executionStateUnproven
    ? 'EXECUTION_STATE_UNPROVEN'
    : (result?.ok === true
      ? (result?.runtimeProofPassed === true ? 'PLUGIN_RELOAD_PROOF_PENDING' : 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING')
      : 'FAILED');
  return Object.freeze({
    status,
    finalVerdict: sanitizedCode(result?.finalVerdict, status),
    blocker: sanitizedCode(result?.blocker, ''),
    receiptId,
    expectedHead,
    sourceHead: normalizeOpenClawExactHead(result?.sourceHead),
    expectedHeadMatch: result?.expectedHeadMatch === true,
    sourceInstalled: result?.sourceInstalled === true,
    runtimeProofPassed: result?.runtimeProofPassed === true,
    runtimeProofPending: result?.runtimeProofPending === true,
    pluginReloadProofPending: result?.pluginReloadProofPending === true,
    servedUiExactHead: result?.servedUiExactHead === true,
    executionStateUnproven,
    resultPersistenceProven: result?.resultPersistenceProven !== false,
  });
}

export function sanitizeOpenClawBattleBridgeUpdateResult(result = {}, expectedHead = '') {
  const normalizedExpectedHead = normalizeOpenClawExactHead(expectedHead);
  const sourceHead = normalizeOpenClawExactHead(result?.sourceHead);
  const exactSourceObserved = result?.sourceInstalled === true
    && result?.expectedHeadMatch === true
    && sourceHead === normalizedExpectedHead;
  const executionStateUnproven = result?.executionStateUnproven === true;
  const successfulExactSource = result?.ok === true && exactSourceObserved && !executionStateUnproven;
  const runtimeProofPassed = successfulExactSource
    && result?.runtimeProofPassed === true
    && result?.servedUiProof?.exactHead === true;
  const runtimeProofPending = successfulExactSource && !runtimeProofPassed;
  const successVerdict = runtimeProofPassed
    ? 'PLUGIN_RELOAD_PROOF_PENDING'
    : 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING';
  return Object.freeze({
    ok: successfulExactSource,
    status: successfulExactSource ? 'PENDING' : sanitizedCode(result?.status, 'FAILED'),
    finalVerdict: successfulExactSource
      ? successVerdict
      : sanitizedCode(result?.finalVerdict || result?.verdict, 'UPDATE_FAILED'),
    blocker: successfulExactSource ? '' : sanitizedCode(result?.blocker, ''),
    expectedHead: normalizedExpectedHead,
    sourceHead,
    expectedHeadMatch: exactSourceObserved,
    sourceInstalled: exactSourceObserved,
    runtimeProofPassed,
    runtimeProofPending,
    pluginReloadProofPending: successfulExactSource && runtimeProofPassed,
    servedUiExactHead: result?.servedUiProof?.exactHead === true,
    executionStateUnproven,
    retrySafe: !executionStateUnproven,
    route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
    destructiveGitAllowed: false,
    arbitraryShellAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedExecutableAllowed: false,
    pcRestartAllowed: false,
  });
}

function exactSourceCheckpoint(claimedReceipt, sync, now = new Date()) {
  return Object.freeze({
    ...claimedReceipt,
    status: 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING',
    finalVerdict: 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING',
    blocker: '',
    sourceHead: String(sync.afterHead || '').toLowerCase(),
    sourceInstalled: true,
    expectedHeadMatch: true,
    runtimeProofPassed: false,
    runtimeProofPending: true,
    pluginReloadProof: 'NOT_STARTED',
    sourceInstalledAtUtc: now.toISOString(),
  });
}

function failedReceipt(base, result, now = new Date()) {
  const blocker = sanitizedCode(result?.blocker || result?.finalVerdict, 'UPDATE_EXECUTION_FAILED');
  return Object.freeze({
    ...base,
    status: 'FAILED',
    finalVerdict: blocker,
    blocker,
    sourceHead: normalizeOpenClawExactHead(result?.sourceHead),
    sourceInstalled: result?.sourceInstalled === true,
    expectedHeadMatch: result?.expectedHeadMatch === true,
    runtimeProofPassed: false,
    runtimeProofPending: false,
    pluginReloadProof: 'NOT_APPLICABLE',
    completedAtUtc: now.toISOString(),
  });
}

function unprovenExecutionReceipt(base, result, now = new Date()) {
  const blocker = sanitizedCode(result?.blocker || result?.finalVerdict, 'UPDATE_EXECUTION_STATE_UNPROVEN');
  return Object.freeze({
    ...base,
    status: 'EXECUTION_STATE_UNPROVEN',
    finalVerdict: blocker,
    blocker,
    sourceHead: normalizeOpenClawExactHead(result?.sourceHead),
    sourceInstalled: result?.sourceInstalled === true,
    expectedHeadMatch: result?.expectedHeadMatch === true,
    runtimeProofPassed: result?.runtimeProofPassed === true,
    runtimeProofPending: false,
    pluginReloadProof: 'NOT_APPLICABLE',
    executionStateUnproven: true,
    retrySafe: false,
    observedAtUtc: now.toISOString(),
  });
}

function completedReceipt(base, result, now = new Date()) {
  return Object.freeze({
    ...base,
    status: result.ok
      ? (result.runtimeProofPassed ? 'PLUGIN_RELOAD_PROOF_PENDING' : 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING')
      : 'FAILED',
    finalVerdict: result.finalVerdict,
    blocker: result.blocker,
    sourceHead: result.sourceHead,
    sourceInstalled: result.sourceInstalled,
    expectedHeadMatch: result.expectedHeadMatch,
    runtimeProofPassed: result.runtimeProofPassed,
    runtimeProofPending: result.runtimeProofPending,
    pluginReloadProof: result.pluginReloadProofPending ? 'PENDING' : 'NOT_STARTED',
    servedUiExactHead: result.servedUiExactHead,
    completedAtUtc: now.toISOString(),
  });
}

function persistenceFailureResult(observed, blocker, receiptId) {
  return Object.freeze({
    ...observed,
    ok: false,
    status: 'FAILED',
    observedFinalVerdict: observed.finalVerdict,
    finalVerdict: blocker,
    blocker,
    receiptId,
    resultPersistenceProven: false,
  });
}

function fixedDependencies(environment) {
  return Object.freeze({
    spawnFn: spawn,
    spawnSyncFn: spawnSync,
    syncFn: syncBattleBridgeExactHeadAsyncV1,
    runtimeUpdateFn: updateStephanosFromChat,
    persistFn: persistOpenClawUpdateCheckpoint,
    releaseFn: releaseOpenClawUpdateOwnerLane,
    gitEnv: createBattleBridgeMinimalChildEnvironment(environment, { git: true }),
    nodeEnv: createBattleBridgeMinimalChildEnvironment(environment, { git: true }),
  });
}

function selectDependencies(environment, testDependencies) {
  if (process.platform === 'win32' || !testDependencies) return fixedDependencies(environment);
  return Object.freeze({ ...fixedDependencies(environment), ...testDependencies });
}

// Mutation authority exists only on this direct owner-handler call stack. No
// receipt watcher, child process, argv, disk record, or exported verifier can
// initiate source or runtime changes.
async function runBattleBridgeExactHeadFromOpenClawOwnerHandler({
  expectedHead,
  authenticatedContext = null,
  env = process.env,
  platform = process.platform,
  nonce = randomUUID(),
  now = new Date(),
  hostPid = process.pid,
  testDependencies = null,
  ownerHandlerCapability = null,
} = {}) {
  const normalizedExpectedHead = normalizeOpenClawExactHead(expectedHead);
  if (ownerHandlerCapability !== OWNER_HANDLER_CAPABILITY) return blockedResult(normalizedExpectedHead, 'OWNER_HANDLER_CAPABILITY_REQUIRED');
  if (!normalizedExpectedHead) return blockedResult('', 'EXPECTED_HEAD_INVALID');
  if (platform !== 'win32') return blockedResult(normalizedExpectedHead, 'WINDOWS_REQUIRED');
  if (authenticatedContext?.authenticatedByHost !== true
      || authenticatedContext?.commandName !== 'stephanos-ignite'
      || authenticatedContext?.command !== 'update'
      || authenticatedContext?.senderIsOwner !== true) return blockedResult(normalizedExpectedHead, 'OWNER_AUTH_REQUIRED');
  if (activeOwnerUpdateReceiptId) return blockedResult(normalizedExpectedHead, 'UPDATE_ALREADY_EXECUTING', activeOwnerUpdateReceiptId);

  const receiptId = String(nonce).replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 32);
  const repoRoot = canonicalRepoRoot(env);
  if (!repoRoot) return blockedResult(normalizedExpectedHead, 'CANONICAL_REPO_ROOT_UNAVAILABLE');
  let safeRepo;
  try {
    safeRepo = ensureSafeReceiptDirectoryChainSync(path.resolve(repoRoot, '.git'), {
      create: false,
      linkedBlocker: 'CANONICAL_REPO_LINKED_ANCESTOR',
      changedBlocker: 'CANONICAL_REPO_IDENTITY_CHANGED',
      missingBlocker: 'CANONICAL_REPO_DIRECTORY_MISSING',
    });
  } catch (error) {
    return blockedResult(normalizedExpectedHead, sanitizedCode(error?.code || error?.message, 'CANONICAL_REPO_IDENTITY_UNPROVEN'));
  }
  let paths;
  let safeRoot;
  let claimed;
  let queued;
  let receiptWritten = false;
  const dependencies = selectDependencies(env, testDependencies);
  const commandRunnerFn = createBattleBridgeAsyncCommandRunner({
    environment: env,
    pathInvariant: safeRepo,
  });
  try {
    paths = resolveOpenClawUpdateReceiptPaths({ env, receiptId });
    safeRoot = ensureOpenClawUpdateReceiptRoot(paths, { create: true });
    const authorization = buildOpenClawUpdateAuthorization({
      receiptId,
      expectedHead: normalizedExpectedHead,
      authenticatedContext,
      hostPid,
      now,
    });
    queued = Object.freeze({
      schemaVersion: OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
      receiptId,
      status: 'QUEUED',
      expectedHead: normalizedExpectedHead,
      queuedAtUtc: now.toISOString(),
      authorization,
      finalVerdict: 'UPDATE_EXECUTION_QUEUED',
      blocker: '',
      pluginReloadProof: 'NOT_STARTED',
    });
    writeNewOpenClawUpdateReceipt({ paths, safeRoot, receipt: queued });
    receiptWritten = true;
    claimed = claimOpenClawUpdateInOwnerHandler({ paths, safeRoot, queued, claimantPid: hostPid, now });
  } catch (error) {
    const blocker = queueFailureBlocker(error);
    if (receiptWritten && paths && safeRoot && queued) {
      try {
        const failed = Object.freeze({
          ...queued,
          status: 'FAILED',
          finalVerdict: blocker,
          blocker,
          pluginReloadProof: 'NOT_APPLICABLE',
          failedAtUtc: new Date().toISOString(),
        });
        // No disk consumer exists, so terminalizing this invocation's own
        // successfully-created receipt cannot race a legitimate executor.
        const current = readStableOpenClawUpdateReceipt({ paths, safeRoot }).receipt;
        if (current?.receiptId === queued.receiptId && current?.status === 'QUEUED') {
          replaceOpenClawUpdateRecord({ pathname: paths.receiptPath, root: paths.root, safeRoot, value: failed });
        }
      } catch { /* return remains fail closed; claim/receipt evidence is durable */ }
    }
    return blockedResult(normalizedExpectedHead, blocker, receiptId);
  }

  activeOwnerUpdateReceiptId = receiptId;
  activeOwnerUpdateStatusView = Object.freeze({
    ...executingResult(normalizedExpectedHead, receiptId),
    resultPersistenceProven: true,
  });
  const executionTask = (async () => {
    let observedReceipt = claimed.receipt;
    let observedResult = null;
    try {
    let sync;
    try {
    sync = await dependencies.syncFn({
      repoRoot,
      expectedBranch: 'main',
      expectedHead: normalizedExpectedHead,
      operatorApproval: 'operator-approved',
      platform,
      spawnFn: dependencies.spawnFn,
      spawnSyncFn: dependencies.spawnSyncFn,
      nodeCommand: BATTLE_BRIDGE_WINDOWS_HOST.node,
      environment: env,
      pathInvariant: safeRepo,
    });
    } catch (error) {
      sync = { ok: false, status: 'FAILED', blocker: sanitizedCode(error?.message, 'SOURCE_SYNC_EXCEPTION') };
    }
    const sourceHead = normalizeOpenClawExactHead(sync?.afterHead);
    const exactSource = sync?.ok === true && sourceHead === normalizedExpectedHead && sync?.expectedHeadMatch === true;
    if (!exactSource) {
    const projected = sanitizeOpenClawBattleBridgeUpdateResult({
      ok: false,
      status: sync?.status || 'FAILED',
      finalVerdict: sync?.blocker || 'SOURCE_SYNC_FAILED',
      blocker: sync?.blocker || 'SOURCE_SYNC_FAILED',
      sourceHead,
      sourceInstalled: Boolean(sourceHead),
      expectedHeadMatch: sourceHead === normalizedExpectedHead,
      executionStateUnproven: sync?.executionStateUnproven === true,
    }, normalizedExpectedHead);
    try {
      const receipt = projected.executionStateUnproven
        ? unprovenExecutionReceipt(claimed.receipt, projected)
        : failedReceipt(claimed.receipt, projected);
      dependencies.persistFn({ paths, safeRoot, claimed, receipt, claimStatus: receipt.status });
      if (!projected.executionStateUnproven) dependencies.releaseFn({ paths, safeRoot, claimed });
    } catch (error) {
      return persistenceFailureResult(
        projected,
        sanitizedCode(error?.code, 'UPDATE_RESULT_PERSIST_FAILED'),
        receiptId,
      );
    }
      return Object.freeze({ ...projected, receiptId });
    }

    const sourceCheckpoint = exactSourceCheckpoint(claimed.receipt, sync);
    try {
      dependencies.persistFn({ paths, safeRoot, claimed, receipt: sourceCheckpoint, claimStatus: 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING' });
      observedReceipt = sourceCheckpoint;
      activeOwnerUpdateStatusView = Object.freeze({
        status: 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING',
        finalVerdict: 'SOURCE_INSTALLED_RUNTIME_REFRESH_PENDING',
        blocker: '',
        receiptId,
        expectedHead: normalizedExpectedHead,
        sourceHead,
        expectedHeadMatch: true,
        sourceInstalled: true,
        runtimeProofPassed: false,
        runtimeProofPending: true,
        pluginReloadProofPending: false,
        servedUiExactHead: false,
        executionStateUnproven: false,
        resultPersistenceProven: true,
      });
    } catch {
      return persistenceFailureResult({
        ...sanitizeOpenClawBattleBridgeUpdateResult({
          ok: false,
          status: 'FAILED',
          finalVerdict: 'UPDATE_SOURCE_CHECKPOINT_PERSIST_FAILED',
          blocker: 'UPDATE_SOURCE_CHECKPOINT_PERSIST_FAILED',
          sourceHead,
          sourceInstalled: true,
          expectedHeadMatch: true,
        }, normalizedExpectedHead),
        sourceInstalled: true,
        expectedHeadMatch: true,
        sourceHead,
      }, 'UPDATE_SOURCE_CHECKPOINT_PERSIST_FAILED', receiptId);
    }

    let runtimeResult;
    try {
      runtimeResult = await dependencies.runtimeUpdateFn({
      repoRoot,
      expectedBranch: 'main',
      expectedHead: normalizedExpectedHead,
      operatorApproval: 'operator-approved',
      platform,
      spawnSyncFn: dependencies.spawnSyncFn,
      syncFn: () => sync,
      gitCommand: BATTLE_BRIDGE_WINDOWS_HOST.git,
      gitArgsPrefix: Object.freeze([...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS, ...battleBridgeCanonicalRepositoryArgs(repoRoot)]),
      gitEnv: dependencies.gitEnv,
      nodeCommand: BATTLE_BRIDGE_WINDOWS_HOST.node,
      nodeEnv: dependencies.nodeEnv,
      commandRunnerFn: dependencies.commandRunnerFn || commandRunnerFn,
      ownerReceiptId: receiptId,
      });
    } catch (error) {
      runtimeResult = {
      ok: false,
      status: 'FAILED',
      finalVerdict: sanitizedCode(error?.message, 'IGNITION_REFRESH_EXCEPTION'),
      blocker: sanitizedCode(error?.message, 'IGNITION_REFRESH_EXCEPTION'),
      sourceHead,
      sourceInstalled: true,
      expectedHeadMatch: true,
      };
    }
    const projected = sanitizeOpenClawBattleBridgeUpdateResult(runtimeResult, normalizedExpectedHead);
    observedResult = projected;
    try {
      const receipt = projected.executionStateUnproven
        ? unprovenExecutionReceipt(sourceCheckpoint, projected)
        : (projected.ok
        ? completedReceipt(sourceCheckpoint, projected)
        : failedReceipt(sourceCheckpoint, projected));
      dependencies.persistFn({ paths, safeRoot, claimed, receipt, claimStatus: receipt.status });
      if (!projected.executionStateUnproven) dependencies.releaseFn({ paths, safeRoot, claimed });
    } catch (error) {
      return persistenceFailureResult(
        projected,
        sanitizedCode(error?.code, 'UPDATE_RESULT_PERSIST_FAILED'),
        receiptId,
      );
    }
      return Object.freeze({ ...projected, receiptId });
    } catch (error) {
      const blocker = sanitizedCode(error?.code || error?.message, 'UPDATE_EXECUTION_EXCEPTION');
      const projected = observedResult || sanitizeOpenClawBattleBridgeUpdateResult({
        ok: false,
        status: 'FAILED',
        finalVerdict: blocker,
        blocker,
        sourceHead: observedReceipt.sourceHead || '',
        sourceInstalled: observedReceipt.sourceInstalled === true,
        expectedHeadMatch: observedReceipt.expectedHeadMatch === true,
      }, normalizedExpectedHead);
      const exceptionResult = Object.freeze({
        ...projected,
        ok: false,
        status: 'FAILED',
        observedFinalVerdict: projected.finalVerdict,
        finalVerdict: blocker,
        blocker,
      });
      try {
        const terminalFailure = {
          ...failedReceipt(observedReceipt, exceptionResult),
          observedFinalVerdict: projected.finalVerdict,
          runtimeProofPassed: projected.runtimeProofPassed === true,
          runtimeProofPending: projected.runtimeProofPending === true,
          servedUiExactHead: projected.servedUiExactHead === true,
        };
        dependencies.persistFn({
          paths,
          safeRoot,
          claimed,
          receipt: terminalFailure,
          claimStatus: 'FAILED',
        });
        dependencies.releaseFn({ paths, safeRoot, claimed });
      } catch (persistError) {
        return persistenceFailureResult(
          exceptionResult,
          sanitizedCode(persistError?.code, 'UPDATE_RESULT_PERSIST_FAILED'),
          receiptId,
        );
      }
      return Object.freeze({ ...exceptionResult, receiptId });
    } finally {
      if (activeOwnerUpdateReceiptId === receiptId) {
        activeOwnerUpdateReceiptId = '';
        activeOwnerUpdateTask = null;
      }
    }
  })();
  activeOwnerUpdateTask = executionTask;
  executionTask.then((result) => {
    lastOwnerUpdateStatusView = trustedStatusViewFromResult(result, receiptId, normalizedExpectedHead);
    if (activeOwnerUpdateReceiptId !== receiptId) activeOwnerUpdateStatusView = null;
  }).catch(() => { /* the execution body catches and terminalizes every outcome */ });
  if (process.platform !== 'win32' && testDependencies?.awaitCompletion === true) return executionTask;
  // The command callback receives bounded admission truth while this caught,
  // module-owned Promise continues. No receipt, CLI, watcher, or retry can
  // start it, and the wx active record remains until terminal persistence.
  return executingResult(normalizedExpectedHead, receiptId);
}

// Production mutation authority is lexical to the host-registered callback.
// The supported import surface exposes registration, not a plain-object
// mutator. The state-machine seam below is inert on Windows and accepts only
// injected test dependencies, so it cannot start the physical update lane.
export async function runBattleBridgeExactHeadOwnerLaneStateMachineForTests(options = {}) {
  if (process.platform === 'win32' || !options?.testDependencies) {
    return blockedResult(normalizeOpenClawExactHead(options?.expectedHead), 'TEST_ONLY_STATE_MACHINE_UNAVAILABLE');
  }
  return runBattleBridgeExactHeadFromOpenClawOwnerHandler({
    ...options,
    ownerHandlerCapability: OWNER_HANDLER_CAPABILITY,
  });
}

export function registerStephanosIgniteCommand(api) {
  if (!api || typeof api.registerCommand !== 'function') throw new TypeError('OPENCLAW_REGISTER_COMMAND_REQUIRED');
  const handler = createStephanosIgniteCommandHandler({
    queueUpdateFn: (input) => runBattleBridgeExactHeadFromOpenClawOwnerHandler({
      ...input,
      platform: process.platform,
      env: process.env,
      hostPid: process.pid,
      testDependencies: null,
      ownerHandlerCapability: OWNER_HANDLER_CAPABILITY,
    }),
    readUpdateStatusFn: (input) => readOpenClawExactHeadUpdateStatusFromOwnerHandler({
      ...input,
      platform: process.platform,
      env: process.env,
    }),
  });
  api.registerCommand({
    name: 'stephanos-ignite',
    description: 'Show ignition status, wake recovery, or perform an owner-approved exact-head Battle Bridge update.',
    acceptsArgs: true,
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler,
  });
}
