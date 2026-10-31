#!/usr/bin/env node
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { inspectFixedRuntimeQualificationV1, executeFixedMaintenanceRuntimeV1, consumeFixedRuntimeTerminalProvenanceV1, consumeFixedRuntimePrelaunchExclusionV1, fixedRuntimeMaintenanceActionQualifiedV1, FIXED_MAINTENANCE_RUNTIME_ROUTE_V1 } from './sovereign-fixed-runtime-parent-v1.mjs';
import { createSovereignCommanderMcpHandler } from './sovereign-commander-mcp.mjs';
import { createMaintenanceCustodyStoreV1, readMaintenanceRecoverySourceV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { isProvenSovereignWindowsReviewerPreExecutionDenialV1, buildSovereignCommanderCommandV1, SOVEREIGN_COMMANDER_OPERATION } from '../shared/agents/sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1, STEPHANOS_EXECUTION_SURFACE } from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';
import { publishSovereignCommanderRepairReport, SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE } from '../shared/agents/sovereignCommanderRepairReportV1.mjs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER, sovereignMaintenanceCustodyUnprovenV1, readSovereignMaintenanceTerminalReceiptV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';

export const SOVEREIGN_COMMANDER_HTTP_HOST = '127.0.0.1';
export const SOVEREIGN_COMMANDER_HTTP_PORT = 18791;
export const SOVEREIGN_COMMANDER_HTTP_MAX_BODY_BYTES = 1024 * 1024;
export const SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION = '2026-10-18-island-action-contract-v6';
export const SOVEREIGN_COMMANDER_REMOTE_IGNITION_PATH = '/ignite';
export const SOVEREIGN_COMMANDER_REMOTE_IGNITION_NONCE_TTL_MS = 5 * 60 * 1000;
export const SOVEREIGN_COMMANDER_REMOTE_IGNITION_MAX_NONCES = 32;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_START_DELAY_MS = 5_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_INTERVAL_MS = 60_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_BACKOFF_MS = 15 * 60_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_RUNTIME_MS = 240_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_OUTPUT_BYTES = 64 * 1024;
const REPAIR_TIMEOUT_CUSTODY_BLOCKER = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';

function text(value) {
  return String(value ?? '').trim();
}

function loopbackHost(value) {
  return ['127.0.0.1', '::1', 'localhost'].includes(text(value).toLowerCase());
}

function appendBoundedOutput(current, chunk, maxBytes) {
  const joined = String(current || '') + String(chunk || '');
  if (Buffer.byteLength(joined, 'utf8') <= maxBytes) return joined;
  return Buffer.from(joined, 'utf8').subarray(-maxBytes).toString('utf8');
}

export function startSovereignCommanderContinuousRepairGuardian(options = {}) {
  const custodyStore = options.custodyStore;
  const persisted = custodyStore?.status();
  const spawnImpl = options.spawnImpl || spawn;
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const now = options.now || (() => new Date().toISOString());
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const repairScript = options.repairScript
    || fileURLToPath(new URL('./sovereign-commander-stephanos-repair.mjs', import.meta.url));
  const repoRoot = options.repoRoot || fileURLToPath(new URL('..', import.meta.url));
  const startDelayMs = Number.isSafeInteger(Number(options.startDelayMs))
    ? Math.max(0, Number(options.startDelayMs))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_START_DELAY_MS;
  const intervalMs = Number.isSafeInteger(Number(options.intervalMs))
    ? Math.max(1_000, Number(options.intervalMs))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_INTERVAL_MS;
  const maxRuntimeMs = Number.isSafeInteger(Number(options.maxRuntimeMs))
    ? Math.max(1_000, Number(options.maxRuntimeMs))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_RUNTIME_MS;
  const maxOutputBytes = Number.isSafeInteger(Number(options.maxOutputBytes))
    ? Math.max(1_024, Number(options.maxOutputBytes))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_OUTPUT_BYTES;
  const guardianEnv = options.env || process.env;

  let stopped = false;
  let scheduledTimer = null;
  let killTimer = null;
  let child = null;
  let lastFailureKey = '';
  let nativeCyclePromise = null;
  let nativeCycleController = null;
  let activeMaintenanceController = null;
  let custodyClosed = false;
  // Private result identity is retained only after this owner consumes the
  // native adapter's one-use provenance and records the terminal release.
  const nativeResults = new WeakMap();
  const state = {
    enabled: options.enabled !== false,
    maintenanceInFlight: false,
    running: false,
    scheduled: false,
    cycleCount: 0,
    successCount: 0,
    failureCount: 0,
    consecutiveFailureCount: 0,
    nextDelayMs: null,
    currentCycleId: '',
    lastCycleId: persisted?.reservationId || '',
    lastStartedAtUtc: '',
    lastCompletedAtUtc: '',
    lastOk: null,
    lastBlocker: persisted?.held ? REPAIR_TIMEOUT_CUSTODY_BLOCKER : '',
    lastFinalVerdict: persisted?.held ? 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED' : '',
    lastReportOk: null,
    lastReportOutcome: '',
    lastReportStatus: '',
    lastReportBlocker: '',
    lastActionId: '',
    lastActionOk: null,
    lastSourceHead: '',
    fullStephanosRepairProven: false,
    // Node child kill is not proof that spawned Windows descendants have exited.
    timeoutCustodyHeld: persisted?.held === true,
  };

  const status = () => Object.freeze({ ...state, running: state.running || state.maintenanceInFlight,
    ...(custodyStore ? { persistentCustody: custodyStore.status() } : {}) });
  const reserve = (reservationId, operation) => {
    if (!custodyStore || custodyStore.reserve({ reservationId, operation }).ok) return true;
    state.timeoutCustodyHeld = true;
    state.lastOk = false;
    state.lastBlocker = REPAIR_TIMEOUT_CUSTODY_BLOCKER;
    state.lastFinalVerdict = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED';
    return false;
  };
  const release = () => {
    if (custodyStore && !custodyStore.release().ok) {
      state.timeoutCustodyHeld = true;
      state.lastBlocker = REPAIR_TIMEOUT_CUSTODY_BLOCKER;
      state.lastOk = false;
    }
  };

  const closeStoppedCustody = () => {
    if (stopped && !custodyClosed && !state.maintenanceInFlight && !nativeCyclePromise) {
      custodyClosed = true;
      custodyStore?.close();
    }
  };

  const schedule = (delayMs) => {
    if (stopped || !state.enabled || state.timeoutCustodyHeld || state.maintenanceInFlight
        || state.running || nativeCyclePromise || scheduledTimer) return;
    state.scheduled = true;
    state.nextDelayMs = delayMs;
    scheduledTimer = setTimeoutImpl(() => {
      scheduledTimer = null;
      state.scheduled = false;
      state.nextDelayMs = null;
      runNow();
    }, delayMs);
    scheduledTimer?.unref?.();
  };

  const withMaintenanceOwner = async (command, run, executionOptions = {}) => {
    const blocked = blocker => Object.freeze({ ok: false, command,
      blocker, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' });
    // Reserve synchronously BEFORE the first await. This is the existing
    // guardian owner, shared by all authenticated HTTP sessions and its timer.
    if (state.timeoutCustodyHeld) return blocked(SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    if (stopped) return blocked('SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE');
    if (child || state.running || state.maintenanceInFlight) return blocked('SOVEREIGN_MAINTENANCE_OWNER_BUSY');
    const nativeWindows = process.platform === 'win32' && !options.spawnImpl;
    if (nativeWindows && !fixedRuntimeMaintenanceActionQualifiedV1(command?.plan?.processId))
      return blocked('FIXED_RUNTIME_PROFILE_NOT_QUALIFIED');
    const nativeGoal = nativeWindows
      && fixedRuntimeMaintenanceActionQualifiedV1(command?.plan?.processId);
    const qualification = nativeGoal ? inspectFixedRuntimeQualificationV1() : null;
    if (nativeGoal && (!custodyStore || qualification?.ok !== true))
      return blocked(qualification?.reason || 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    const resumeDelayMs = state.nextDelayMs ?? intervalMs;
    if (scheduledTimer) clearTimeoutImpl(scheduledTimer);
    scheduledTimer = null;
    state.scheduled = false;
    state.nextDelayMs = null;
    if (!reserve(command?.commandId || randomUUID(), command?.plan?.processId || 'fixed-maintenance'))
      return blocked(SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    state.maintenanceInFlight = true;
    const controller = nativeGoal ? new AbortController() : null;
    const forwardAbort = () => controller?.abort();
    if (controller) {
      activeMaintenanceController = controller;
      executionOptions.signal?.addEventListener('abort', forwardAbort, { once: true });
      if (executionOptions.signal?.aborted) controller.abort();
    }
    try {
      if (nativeGoal) {
        const active = custodyStore.status();
        const binding = { requestId: command.commandId, sourceHead: qualification.sourceHead,
          custodyRecordSha256: active.digest, nativeRecordId: active.anchorRecordId };
        const native = await executeFixedMaintenanceRuntimeV1(qualification, binding, {
          signal: controller.signal,
          onPrepared: root => custodyStore.recordNativeRoot(root).ok === true,
        });
        const excluded = consumeFixedRuntimePrelaunchExclusionV1(native, binding);
        const zero = !excluded && consumeFixedRuntimeTerminalProvenanceV1(native, binding);
        const released = excluded ? custodyStore.release()
          : zero ? custodyStore.releaseNativeTerminal(native.nativeReceipt) : { ok: false };
        state.timeoutCustodyHeld = released.ok !== true;
        state.lastOk = native.ok === true && released.ok === true;
        state.lastBlocker = state.timeoutCustodyHeld ? SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER
          : native.ok === true ? '' : native.reason;
        state.lastFinalVerdict = state.lastOk ? 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
          : 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED';
        const structuredContent = Object.freeze({ ...native, processId: command.plan.processId,
          status: native.ok ? 0 : 2, terminalEvidenceRef: released.terminalEvidenceRef || '',
          terminalEvidenceSha256: released.terminalEvidenceSha256 || '' });
        const contentText = native.stdout || native.reason;
        const owned = Object.freeze({ ok: state.lastOk, command, structuredContent, contentText,
          blocker: state.lastBlocker, finalVerdict: state.lastFinalVerdict,
          proofHash: createHash('sha256').update(JSON.stringify({ commandId: command.commandId,
            missionId: command.missionId, operation: command.operation, plan: command.plan,
            contentText, structuredContent })).digest('hex') });
        nativeResults.set(owned, Object.freeze({
          sourceHead: qualification.sourceHead,
          terminalProven: zero === true && released.ok === true,
          prelaunchProven: excluded === true && released.ok === true,
        }));
        return owned;
      }
      const result = await run();
      // A direct-child timeout/unknown result cannot release Windows
      // descendant custody. No caller retry or timer clears this hold.
      const execution = result?.structuredContent;
      const provenPreExecutionDenial = isProvenSovereignWindowsReviewerPreExecutionDenialV1(command, result);
      if (!provenPreExecutionDenial
          && sovereignMaintenanceCustodyUnprovenV1(execution,
            readSovereignMaintenanceTerminalReceiptV1(execution?.stdout, command?.plan?.processId), command?.plan?.processId)) {
        state.timeoutCustodyHeld = true;
        state.lastOk = false;
        state.lastBlocker = SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER;
        state.lastFinalVerdict = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED';
        return Object.freeze({ ...result, ok: false, blocker: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER,
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' });
      }
      if (provenPreExecutionDenial) {
        // Keep the typed independent reviewer HOLD visible and allow only
        // the guardian's ordinary scheduled retry, never reviewer authority.
        state.lastOk = false;
        state.lastBlocker = result.blocker;
        state.lastFinalVerdict = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED';
      }
      release();
      if (state.timeoutCustodyHeld) return blocked(SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
      return result;
    } catch (error) {
      state.timeoutCustodyHeld = true;
      state.lastOk = false;
      state.lastBlocker = SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER;
      state.lastFinalVerdict = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED';
      return blocked(SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    } finally {
      executionOptions.signal?.removeEventListener('abort', forwardAbort);
      if (activeMaintenanceController === controller) activeMaintenanceController = null;
      state.maintenanceInFlight = false;
      if (!state.timeoutCustodyHeld) schedule(resumeDelayMs);
      closeStoppedCustody();
    }
  };

  const runNativeCycle = () => {
    if (scheduledTimer) clearTimeoutImpl(scheduledTimer);
    scheduledTimer = null;
    state.scheduled = false;
    state.nextDelayMs = null;
    state.cycleCount += 1;
    state.currentCycleId = randomUUID();
    state.lastStartedAtUtc = now();
    state.lastActionId = FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId;
    state.lastActionOk = null;
    state.lastBlocker = '';
    state.lastFinalVerdict = '';
    nativeCycleController = new AbortController();
    const controller = nativeCycleController;
    let pending;
    try {
      const catalog = buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot });
      const envelope = buildStephanosExecutionCommandEnvelopeV1({
        catalog, surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
        actionId: state.currentCycleId, missionId: 'sovereign-continuous-repair',
        relatedIssue: '#2961', operation: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
        targetPaths: [], payload: { actionId: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId },
      });
      const command = buildSovereignCommanderCommandV1(envelope, { repoRoot });
      if (command.dispatchAllowed !== true || command.plan?.kind !== 'fixed-process'
          || command.plan.processId !== FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId) {
        pending = Promise.resolve({ ok: false, blocker: 'SOVEREIGN_CONTINUOUS_FIXED_COMMAND_NOT_ADMITTED' });
      } else {
        // The same owner reserves synchronously before its first await. Do not
        // pre-set running and reject our own request, or use a second owner.
        pending = withMaintenanceOwner(command, () => {
          throw new Error('SOVEREIGN_CONTINUOUS_NATIVE_FALLBACK_FORBIDDEN');
        }, { signal: controller.signal });
      }
    } catch {
      // Command construction is synchronous and occurs before owner admission.
      pending = Promise.resolve({ ok: false, blocker: 'SOVEREIGN_CONTINUOUS_FIXED_COMMAND_NOT_ADMITTED' });
    }
    state.running = true;
    nativeCyclePromise = (async () => {
      let result;
      try { result = await pending; }
      catch {
        // An owner exception can be a reservation/journal failure. Never infer
        // prelaunch exclusion from an exception or schedule another request.
        state.timeoutCustodyHeld = true;
        result = { ok: false, blocker: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER };
      }
      const proof = nativeResults.get(result);
      nativeResults.delete(result);
      const actionOk = result?.ok === true && proof?.terminalProven === true
        && !state.timeoutCustodyHeld && !controller.signal.aborted && !stopped;
      const blocker = state.timeoutCustodyHeld ? SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER
        : controller.signal.aborted || stopped ? 'SOVEREIGN_CONTINUOUS_MAINTENANCE_CANCELLED'
        : actionOk ? '' : text(result?.blocker || 'SOVEREIGN_CONTINUOUS_MAINTENANCE_UNPROVEN');
      const sourceHead = text(proof?.sourceHead);
      const repair = {
        scope: SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE,
        ok: actionOk, blocker, sourceHead,
        maintenance: {
          actionId: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId,
          profile: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.profile,
          operationOk: actionOk, terminalProven: proof?.terminalProven === true,
          terminalEvidenceSha256: text(result?.structuredContent?.terminalEvidenceSha256),
          proofHash: text(result?.proofHash),
        },
        steps: [{ actionId: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId,
          ok: actionOk, blocker,
          finalVerdict: actionOk ? 'SOVEREIGN_QUALIFIED_MAINTENANCE_COMPLETED'
            : 'SOVEREIGN_QUALIFIED_MAINTENANCE_BLOCKED' }],
      };
      let reporting;
      try {
        reporting = await publishSovereignCommanderRepairReport({
          repair, repoRoot, cycleId: state.currentCycleId,
          startedAtUtc: state.lastStartedAtUtc, completedAtUtc: now(),
          source: 'continuous-repair-guardian',
        });
      } catch {
        reporting = { ok: false, blocker: 'SOVEREIGN_COMMANDER_REPAIR_REPORT_PUBLICATION_FAILED' };
      }
      const reportCompleted = reporting?.outcome === 'MAINTENANCE_COMPLETED'
        && reporting?.status === 'OBSERVED';
      const ok = actionOk && reporting?.ok === true && reportCompleted
        && !controller.signal.aborted && !stopped;
      state.lastActionOk = actionOk;
      state.lastSourceHead = sourceHead;
      state.lastOk = ok;
      state.lastReportOk = reporting?.ok === true;
      state.lastReportOutcome = text(reporting?.outcome).slice(0, 64);
      state.lastReportStatus = text(reporting?.status).slice(0, 64);
      state.lastReportBlocker = reporting?.ok === true ? ''
        : text(reporting?.blocker || 'SOVEREIGN_COMMANDER_REPAIR_REPORT_MISSING').slice(0, 160);
      state.lastBlocker = ok ? '' : (blocker || state.lastReportBlocker
        || (actionOk && !reportCompleted ? 'SOVEREIGN_QUALIFIED_MAINTENANCE_REPORT_UNPROVEN' : '')
        || 'SOVEREIGN_CONTINUOUS_MAINTENANCE_CANCELLED').slice(0, 160);
      state.lastFinalVerdict = ok ? 'SOVEREIGN_QUALIFIED_MAINTENANCE_COMPLETED'
        : 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED';
      state.lastCycleId = state.currentCycleId;
      state.currentCycleId = '';
      state.lastCompletedAtUtc = now();
      if (ok) {
        state.successCount += 1;
        state.consecutiveFailureCount = 0;
        lastFailureKey = '';
      } else {
        state.failureCount += 1;
        const failureKey = JSON.stringify([sourceHead, state.lastBlocker]);
        state.consecutiveFailureCount = failureKey === lastFailureKey
          ? Math.min(1_000_000, state.consecutiveFailureCount + 1) : 1;
        lastFailureKey = failureKey;
      }
    })().finally(() => {
      nativeCyclePromise = null;
      nativeCycleController = null;
      state.running = false;
      if (!state.timeoutCustodyHeld) schedule(state.lastOk ? intervalMs : Math.min(
        Math.max(intervalMs, SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_BACKOFF_MS),
        intervalMs * 2 ** Math.min(20, state.consecutiveFailureCount - 1),
      ));
      closeStoppedCustody();
    });
    return true;
  };

  const runNow = () => {
    if (stopped || !state.enabled || child || state.running || nativeCyclePromise
        || state.maintenanceInFlight || state.timeoutCustodyHeld) return false;
    if (process.platform === 'win32' && !options.spawnImpl) return runNativeCycle();
    if (scheduledTimer) {
      clearTimeoutImpl(scheduledTimer);
      scheduledTimer = null;
    }
    state.running = true;
    state.scheduled = false;
    state.nextDelayMs = null;
    state.cycleCount += 1;
    state.currentCycleId = randomUUID();
    state.lastStartedAtUtc = now();
    state.lastBlocker = '';
    state.lastFinalVerdict = '';
    if (!reserve(state.currentCycleId, 'repair-stephanos')) {
      state.running = false; state.currentCycleId = '';
      return false;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let currentChild;
    const finish = (code, fallbackBlocker = '', signal = '') => {
      if (settled) return;
      settled = true;
      if (killTimer) {
        clearTimeoutImpl(killTimer);
        killTimer = null;
      }
      const receipt = readSovereignMaintenanceTerminalReceiptV1(stdout, 'repair-stephanos');
      state.timeoutCustodyHeld ||= sovereignMaintenanceCustodyUnprovenV1(
        { status: code, signal, errorCode: fallbackBlocker },
        receipt, 'repair-stephanos',
      );
      if (!state.timeoutCustodyHeld) release();
      const reporting = receipt?.reporting && typeof receipt.reporting === 'object'
        ? receipt.reporting
        : {};
      const reportOk = reporting?.ok === true;
      const ok = !state.timeoutCustodyHeld && code === 0 && receipt?.ok === true && reportOk;
      state.running = false;
      state.lastCycleId = state.currentCycleId;
      state.currentCycleId = '';
      state.lastCompletedAtUtc = now();
      state.lastOk = ok;
      state.lastFinalVerdict = !ok
        ? 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED'
        : text(receipt?.finalVerdict || (ok ? 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_GREEN' : 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED'));
      state.lastReportOk = reportOk;
      state.lastReportOutcome = text(reporting?.outcome).slice(0, 64);
      state.lastReportStatus = text(reporting?.status).slice(0, 64);
      state.lastReportBlocker = reportOk ? '' : text(reporting?.blocker || 'SOVEREIGN_COMMANDER_REPAIR_REPORT_MISSING').slice(0, 160);
      state.lastBlocker = ok
        ? ''
        : state.timeoutCustodyHeld ? REPAIR_TIMEOUT_CUSTODY_BLOCKER
          : text(receipt?.blocker || reporting?.blocker || fallbackBlocker || stderr || 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_FAILED').slice(0, 160);
      if (ok) {
        state.successCount += 1;
        state.consecutiveFailureCount = 0;
        lastFailureKey = '';
      } else {
        state.failureCount += 1;
        // Repeated attempts against the same source/blocker are observations,
        // not progress. Pace them without changing the original repair owner,
        // lease, or authority. A new source/blocker starts a fresh retry window.
        const failureKey = JSON.stringify([text(receipt?.sourceHead), state.lastBlocker]);
        state.consecutiveFailureCount = failureKey === lastFailureKey
          ? Math.min(1_000_000, state.consecutiveFailureCount + 1) : 1;
        lastFailureKey = failureKey;
      }
      // A timed-out direct child may have live descendants. Retain its handle
      // until close, and NEVER schedule another cycle without separate custody
      // qualification (including when a user explicitly wakes the guardian).
      child = state.timeoutCustodyHeld ? currentChild : null;
      if (!state.timeoutCustodyHeld) schedule(ok ? intervalMs : Math.min(
        Math.max(intervalMs, SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_BACKOFF_MS),
        intervalMs * 2 ** Math.min(20, state.consecutiveFailureCount - 1),
      ));
    };

    try {
      currentChild = spawnImpl(nodeExecutable, [repairScript], {
        cwd: repoRoot,
        shell: false,
        windowsHide: true,
        env: {
          ...guardianEnv,
          STEPHANOS_SOVEREIGN_REPAIR_CYCLE_ID: state.currentCycleId,
          STEPHANOS_SOVEREIGN_REPAIR_CYCLE_STARTED_AT_UTC: state.lastStartedAtUtc,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = currentChild;
      currentChild.stdout?.on?.('data', (chunk) => {
        stdout = appendBoundedOutput(stdout, chunk, maxOutputBytes);
      });
      currentChild.stderr?.on?.('data', (chunk) => {
        stderr = appendBoundedOutput(stderr, chunk, maxOutputBytes);
      });
      currentChild.once?.('error', (error) => {
        finish(null, text(error?.code || error?.message || 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_SPAWN_FAILED'));
      });
      currentChild.once?.('close', (code, signal) => {
        if (state.timeoutCustodyHeld) child = null;
        finish(code, '', text(signal));
      });
      killTimer = setTimeoutImpl(() => {
        if (settled) return;
        state.timeoutCustodyHeld = true;
        try { currentChild.kill?.(); } catch {}
        // A termination request cannot attest Windows descendant exclusion.
        finish(null, REPAIR_TIMEOUT_CUSTODY_BLOCKER);
      }, maxRuntimeMs);
      killTimer?.unref?.();
    } catch (error) {
      finish(null, text(error?.code || error?.message || 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_SPAWN_FAILED'));
    }
    return true;
  };

  const recoverPreparedCustodyOnStartup = async () => {
    if (!state.timeoutCustodyHeld
        || typeof custodyStore?.recoverPreparedAfterBoot !== 'function'
        || state.running || state.maintenanceInFlight || stopped) return false;
    state.maintenanceInFlight = true;
    let recovered = false;
    try {
      const result = await custodyStore.recoverPreparedAfterBoot();
      if (result?.ok === true) {
        state.timeoutCustodyHeld = false;
        state.lastBlocker = '';
        state.lastOk = false;
        state.lastFinalVerdict = 'SOVEREIGN_MAINTENANCE_CUSTODY_RECOVERED_REPAIR_PENDING';
        recovered = true;
      }
      return recovered;
    } catch {
      return false;
    } finally {
      state.maintenanceInFlight = false;
      if (recovered && !state.timeoutCustodyHeld) schedule(startDelayMs);
      closeStoppedCustody();
    }
  };

  if (state.timeoutCustodyHeld) {
    void recoverPreparedCustodyOnStartup();
  } else {
    schedule(startDelayMs);
  }

  return Object.freeze({
    status,
    runNow,
    prepareAfterAuditLoss: async (request) => {
      if (stopped || !custodyStore?.prepareAfterAuditLoss || state.running || state.maintenanceInFlight
          || !state.timeoutCustodyHeld
          || (state.lastCycleId && state.lastCycleId !== request.expectedReservationId))
        return { ok: false, blocker: 'MAINTENANCE_AUDIT_LOSS_OWNER_UNPROVEN', custodyReleased: false };
      state.maintenanceInFlight = true;
      try {
        const result = await custodyStore.prepareAfterAuditLoss(request);
        if (result.ok) state.lastCycleId = result.reservationId;
        return result;
      }
      finally { state.maintenanceInFlight = false; closeStoppedCustody(); }
    },
    recoverAfterBoot: async (request) => {
      if (stopped || !custodyStore || state.running || state.maintenanceInFlight)
        return { ok: false, blocker: 'MAINTENANCE_CUSTODY_RECOVERY_OWNER_BUSY' };
      state.maintenanceInFlight = true;
      try {
        const result = await custodyStore.recoverAfterBoot(request);
        if (result.ok) {
          state.timeoutCustodyHeld = false;
          state.lastBlocker = '';
          // Recovery proves process extinction, never successful repair.
          state.lastOk = false;
          state.lastFinalVerdict = 'SOVEREIGN_MAINTENANCE_CUSTODY_RECOVERED_REPAIR_PENDING';
        }
        return result;
      } finally {
        state.maintenanceInFlight = false;
        if (!state.timeoutCustodyHeld) schedule(intervalMs);
        closeStoppedCustody();
      }
    },
    withMaintenanceOwner,
    stop: () => {
      stopped = true;
      state.enabled = false;
      state.scheduled = false;
      state.nextDelayMs = null;
      if (!nativeCyclePromise) state.running = false;
      nativeCycleController?.abort();
      activeMaintenanceController?.abort();
      if (scheduledTimer) clearTimeoutImpl(scheduledTimer);
      if (killTimer) clearTimeoutImpl(killTimer);
      try { child?.kill?.(); } catch {}
      scheduledTimer = null;
      killTimer = null;
      child = null;
      closeStoppedCustody();
    },
  });
}

function tokenFile(env = process.env) {
  const configured = text(env.STEPHANOS_SOVEREIGN_COMMANDER_TOKEN_FILE);
  if (configured) return resolve(configured);
  const profile = text(env.USERPROFILE || env.HOME) || homedir();
  return resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt');
}

export async function loadSovereignCommanderToken(options = {}) {
  if (text(options.token)) return text(options.token);
  const path = options.tokenFile || tokenFile(options.env || process.env);
  try {
    const token = text(await (options.readFileImpl || readFile)(path, 'utf8'));
    return token.length >= 32 ? token : '';
  } catch {
    return '';
  }
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(req) {
  const auth = text(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? text(match[1]) : '';
}

async function readJsonBody(req, maxBytes = SOVEREIGN_COMMANDER_HTTP_MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('REQUEST_BODY_TOO_LARGE'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }); }
}

function sendJson(res, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function remoteIgnitionHtml(nonce) {
  const safeNonce = JSON.stringify(String(nonce || ''));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Stephanos Remote Ignition</title>
<style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d14;color:#eef4ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
main{width:min(92vw,520px);padding:28px;box-sizing:border-box;text-align:center}
h1{font-size:clamp(28px,7vw,44px);margin:0 0 12px}p{opacity:.78;line-height:1.45}
button{width:100%;min-height:84px;margin-top:22px;border:0;border-radius:22px;font-size:24px;font-weight:750;cursor:pointer}
button:disabled{opacity:.55;cursor:wait}#status{min-height:52px;margin-top:20px;font-weight:650}
small{display:block;margin-top:28px;opacity:.5}
</style>
</head>
<body>
<main>
<h1>🔥 Stephanos Ignition</h1>
<p>Private Battle Bridge control over your Tailscale network.</p>
<button id="ignite" type="button">Ignite Stephanos</button>
<div id="status" role="status" aria-live="polite"></div>
<small>Fixed action only. No arbitrary shell or PC restart authority.</small>
</main>
<script>
const nonce=${safeNonce};
const button=document.getElementById('ignite');
const status=document.getElementById('status');
button.addEventListener('click',async()=>{
  button.disabled=true; status.textContent='Igniting…';
  try{
    const response=await fetch('/ignite',{
      method:'POST',
      headers:{'content-type':'application/json','x-stephanos-ignition-nonce':nonce},
      body:JSON.stringify({action:'ignite-stephanos'})
    });
    const body=await response.json();
    status.textContent=body.ok?'Ignition command accepted ✅':('Blocked: '+(body.blocker||body.finalVerdict||response.status));
  }catch{status.textContent='Could not reach Sovereign Commander.'}
  finally{button.disabled=false}
});
</script>
</body>
</html>`;
}

function pruneIgnitionNonces(nonces, nowMs) {
  for (const [nonce, expiry] of nonces) {
    if (!Number.isFinite(expiry) || expiry <= nowMs) nonces.delete(nonce);
  }
  while (nonces.size >= SOVEREIGN_COMMANDER_REMOTE_IGNITION_MAX_NONCES) {
    const oldest = nonces.keys().next().value;
    if (!oldest) break;
    nonces.delete(oldest);
  }
}

async function executeFixedRemoteIgnition(handlerFactory) {
  const handler = handlerFactory();
  await handler('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'tailnet-remote-ignition', version: '1.0.0' },
    capabilities: {},
  }, { id: 1, isRequest: true, isNotification: false });
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  const listed = await handler('tools/list', {}, { id: 2, isRequest: true, isNotification: false });
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  if (!tools.some((tool) => text(tool?.name) === 'maintenance_action')) {
    return Object.freeze({ ok: false, blocker: 'REMOTE_IGNITION_MAINTENANCE_ACTION_UNAVAILABLE', finalVerdict: 'REMOTE_IGNITION_BLOCKED' });
  }
  const called = await handler('tools/call', {
    name: 'maintenance_action',
    arguments: { actionId: 'ignite-stephanos' },
  }, { id: 3, isRequest: true, isNotification: false });
  const outer = called?.structuredContent && typeof called.structuredContent === 'object' && !Array.isArray(called.structuredContent)
    ? called.structuredContent
    : {};
  const inner = outer?.structuredContent && typeof outer.structuredContent === 'object' && !Array.isArray(outer.structuredContent)
    ? outer.structuredContent
    : outer;
  const ok = called?.isError !== true && outer?.ok === true;
  return Object.freeze({
    ok,
    blocker: ok ? '' : text(inner?.blocker || outer?.blocker || 'REMOTE_IGNITION_EXECUTION_BLOCKED'),
    finalVerdict: text(inner?.finalVerdict || outer?.finalVerdict || (ok ? 'REMOTE_IGNITION_ACCEPTED' : 'REMOTE_IGNITION_BLOCKED')),
  });
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function validRpcMessage(message) {
  const object = Boolean(message) && typeof message === 'object' && !Array.isArray(message);
  const hasId = object && Object.prototype.hasOwnProperty.call(message, 'id');
  const idOk = !hasId || typeof message.id === 'string' || Number.isSafeInteger(message.id);
  return object && message.jsonrpc === '2.0' && typeof message.method === 'string' && idOk;
}

export async function createSovereignCommanderHttpServer(options = {}) {
  const env = options.env || process.env;
  const host = text(options.host || env.STEPHANOS_SOVEREIGN_COMMANDER_HOST) || SOVEREIGN_COMMANDER_HTTP_HOST;
  const port = Number.isSafeInteger(Number(options.port ?? env.STEPHANOS_SOVEREIGN_COMMANDER_PORT))
    ? Number(options.port ?? env.STEPHANOS_SOVEREIGN_COMMANDER_PORT)
    : SOVEREIGN_COMMANDER_HTTP_PORT;
  if (!loopbackHost(host) && options.allowNonLoopback !== true) {
    throw new Error('SOVEREIGN_COMMANDER_NON_LOOPBACK_BIND_REQUIRES_EXPLICIT_APPROVAL');
  }

  const token = await loadSovereignCommanderToken(options);
  if (!token) throw new Error('SOVEREIGN_COMMANDER_BEARER_TOKEN_REQUIRED');

  const sessions = new Map();
  const ignitionNonces = new Map();
  const handlerFactory = options.handlerFactory || (() => createSovereignCommanderMcpHandler({
    repoRoot: options.repoRoot, executor: options.commandExecutor,
    // HTTP sessions reserve the actual existing owner directly. External local
    // callers delegate here; owned fixed mutation leaves health responsive.
    withMaintenanceOwner: (command, run, context) => continuousRepairGuardian.withMaintenanceOwner(command, run, context),
  }));
  const now = options.now || (() => new Date().toISOString());
  const nowMs = options.nowMs || (() => {
    const value = Date.parse(now());
    return Number.isFinite(value) ? value : Date.now();
  });
  const continuousRepairGuardian = startSovereignCommanderContinuousRepairGuardian({
      enabled: options.continuousRepairEnabled === true,
      repoRoot: options.repoRoot,
      spawnImpl: options.continuousRepairSpawnImpl,
      setTimeoutImpl: options.continuousRepairSetTimeoutImpl,
      clearTimeoutImpl: options.continuousRepairClearTimeoutImpl,
      now,
      startDelayMs: options.continuousRepairStartDelayMs,
      intervalMs: options.continuousRepairIntervalMs,
      maxRuntimeMs: options.continuousRepairMaxRuntimeMs,
      custodyStore: options.custodyStore,
    });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'stephanos-sovereign-commander',
          capabilityVersion: SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION,
          maintenanceOwnerAdmissionVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION,
          maintenanceCustodyRecoveryVersion: options.custodyStore ? '2026-10-25-durable-boot-recovery-v1' : '',
          transport: 'authenticated-http-jsonrpc',
          observedAtUtc: now(),
          remoteIgnitionPath: SOVEREIGN_COMMANDER_REMOTE_IGNITION_PATH,
          remoteIgnitionAction: 'ignite-stephanos',
          remoteIgnitionTailnetOnlyExpected: true,
          remoteIgnitionCsrfProtected: true,
          continuousRepairGuardian: continuousRepairGuardian?.status() || {
            enabled: false,
            timeoutCustodyHeld: false,
            running: false,
            scheduled: false,
            cycleCount: 0,
            successCount: 0,
            failureCount: 0,
            lastStartedAtUtc: '',
            lastCompletedAtUtc: '',
            lastOk: null,
            lastBlocker: '',
            lastFinalVerdict: '',
          },
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
        });
      }

      if (url.pathname === SOVEREIGN_COMMANDER_REMOTE_IGNITION_PATH) {
        const fetchSite = text(req.headers['sec-fetch-site']).toLowerCase();
        if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
          return sendJson(res, 403, { ok: false, blocker: 'REMOTE_IGNITION_CROSS_SITE_BLOCKED' });
        }
        if (req.method === 'GET') {
          const currentMs = nowMs();
          pruneIgnitionNonces(ignitionNonces, currentMs);
          const nonce = randomUUID();
          ignitionNonces.set(nonce, currentMs + SOVEREIGN_COMMANDER_REMOTE_IGNITION_NONCE_TTL_MS);
          return sendHtml(res, 200, remoteIgnitionHtml(nonce));
        }
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, blocker: 'METHOD_NOT_ALLOWED' });
        const nonce = text(req.headers['x-stephanos-ignition-nonce']);
        const currentMs = nowMs();
        pruneIgnitionNonces(ignitionNonces, currentMs);
        const expiry = ignitionNonces.get(nonce);
        if (!nonce || !Number.isFinite(expiry) || expiry <= currentMs) {
          return sendJson(res, 403, { ok: false, blocker: 'REMOTE_IGNITION_NONCE_INVALID_OR_EXPIRED' });
        }
        ignitionNonces.delete(nonce);
        const body = await readJsonBody(req, 4096);
        if (Object.keys(body).length !== 1 || body.action !== 'ignite-stephanos') {
          return sendJson(res, 400, { ok: false, blocker: 'REMOTE_IGNITION_ACTION_NOT_ALLOWED' });
        }
        const ignition = await executeFixedRemoteIgnition(handlerFactory);
        return sendJson(res, ignition.ok ? 200 : 409, {
          ok: ignition.ok,
          action: 'ignite-stephanos',
          blocker: ignition.blocker,
          finalVerdict: ignition.finalVerdict,
          arbitraryShellAllowed: false,
          pcRestartAllowed: false,
        });
      }

      if (url.pathname === '/maintenance-custody/prepare-after-audit-loss') {
        if (!safeTokenEqual(bearerToken(req), token))
          return sendJson(res, 401, { ok: false, blocker: 'SOVEREIGN_COMMANDER_AUTH_REQUIRED' });
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, blocker: 'METHOD_NOT_ALLOWED' });
        const request = await readJsonBody(req, 1024);
        if (Object.keys(request).sort().join(',') !== 'expectedDigest,expectedMain,expectedReservationId,operatorApproval')
          return sendJson(res, 400, { ok: false, blocker: 'MAINTENANCE_AUDIT_LOSS_SCHEMA_INVALID' });
        if (!options.recoverySourceAdmission?.(request.expectedMain))
          return sendJson(res, 409, { ok: false, blocker: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN' });
        const result = await continuousRepairGuardian.prepareAfterAuditLoss(request);
        return sendJson(res, result.ok ? 200 : 409, result);
      }
      if (url.pathname === '/maintenance-custody/recover-after-boot') {
        if (!safeTokenEqual(bearerToken(req), token))
          return sendJson(res, 401, { ok: false, blocker: 'SOVEREIGN_COMMANDER_AUTH_REQUIRED' });
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, blocker: 'METHOD_NOT_ALLOWED' });
        const request = await readJsonBody(req, 1024);
        if (Object.keys(request).sort().join(',') !== 'expectedDigest,expectedMain,operatorApproval')
          return sendJson(res, 400, { ok: false, blocker: 'MAINTENANCE_CUSTODY_RECOVERY_SCHEMA_INVALID' });
        if (!options.recoverySourceAdmission?.(request.expectedMain))
          return sendJson(res, 409, { ok: false, blocker: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN' });
        const result = await continuousRepairGuardian.recoverAfterBoot(request);
        return sendJson(res, result.ok ? 200 : 409, result);
      }
      if (url.pathname !== '/mcp') return sendJson(res, 404, { ok: false, blocker: 'NOT_FOUND' });
      if (!safeTokenEqual(bearerToken(req), token)) {
        return sendJson(res, 401, { ok: false, blocker: 'SOVEREIGN_COMMANDER_AUTH_REQUIRED' }, { 'www-authenticate': 'Bearer' });
      }

      if (req.method === 'DELETE') {
        const sessionId = text(req.headers['mcp-session-id']);
        if (!sessionId || !sessions.has(sessionId)) return sendJson(res, 404, { ok: false, blocker: 'MCP_SESSION_NOT_FOUND' });
        sessions.delete(sessionId);
        res.writeHead(204, { 'cache-control': 'no-store' });
        return res.end();
      }

      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, blocker: 'METHOD_NOT_ALLOWED' });
      const message = await readJsonBody(req, options.maxBodyBytes);
      if (!validRpcMessage(message)) return sendJson(res, 400, rpcError(message?.id, -32600, 'Invalid Request'));

      let sessionId = text(req.headers['mcp-session-id']);
      let handler = sessionId ? sessions.get(sessionId) : null;
      const initializing = message.method === 'initialize';

      if (initializing) {
        if (handler || sessionId) return sendJson(res, 409, rpcError(message.id, -32000, 'Session already supplied for initialize'));
        sessionId = randomUUID();
        handler = handlerFactory();
      } else if (!handler) {
        return sendJson(res, 400, rpcError(message.id, -32001, 'MCP session required'));
      }

      const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
      const isRequest = hasId;
      const isNotification = !hasId;
      const requestController = new AbortController();
      const cancelDisconnected = () => { if (!res.writableEnded) requestController.abort(); };
      res.once('close', cancelDisconnected);
      let result;
      try { result = await handler(message.method, message.params || {}, {
        id: message.id,
        isRequest,
        isNotification,
        transportKind: 'authenticated-http-jsonrpc',
        transportAuthenticated: true,
        signal: requestController.signal,
      }); } finally { res.removeListener('close', cancelDisconnected); }
      if (initializing) sessions.set(sessionId, handler);
      const headers = { 'mcp-session-id': sessionId };

      if (isNotification || result === undefined) {
        res.writeHead(202, { 'cache-control': 'no-store', ...headers });
        return res.end();
      }
      return sendJson(res, 200, { jsonrpc: '2.0', id: message.id, result }, headers);
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      return sendJson(res, statusCode, rpcError(null, -32603, String(error?.message || error)));
    }
  });

  server.once('close', () => continuousRepairGuardian?.stop());

  return Object.freeze({
    server,
    host,
    port,
    tokenFile: options.tokenFile || tokenFile(env),
    sessionCount: () => sessions.size,
    ignitionNonceCount: () => ignitionNonces.size,
    continuousRepairStatus: () => continuousRepairGuardian?.status() || Object.freeze({ enabled: false }),
  });
}

export async function runSovereignCommanderHttpServer(options = {}) {
  const token = await loadSovereignCommanderToken(options);
  const readRecoverySource = options.readRecoverySource || readMaintenanceRecoverySourceV1;
  let installedSourceHead = '';
  try { installedSourceHead = readRecoverySource(); } catch { installedSourceHead = ''; }

  let custodyStore = options.custodyStore;
  if (!custodyStore) {
    try {
      custodyStore = createMaintenanceCustodyStoreV1({ signingKey: token });
    } catch {
      // Observation remains available when custody authority itself cannot be
      // authenticated. Source drift alone must not erase a valid prepared
      // custody record or prevent successor-boot recovery.
      const refusal = () => ({ ok: false, custodyReleased: false,
        blocker: 'MAINTENANCE_CUSTODY_STATE_UNPROVEN' });
      custodyStore = Object.freeze({
        status: () => ({ held: true, blocker: 'MAINTENANCE_CUSTODY_STATE_UNPROVEN' }),
        reserve: refusal, release: refusal, recoverAfterBoot: refusal,
        recoverPreparedAfterBoot: refusal, close: () => {},
      });
    }
  }
  const created = await createSovereignCommanderHttpServer({
    ...options,
    token,
    custodyStore,
    recoverySourceAdmission: expectedMain => {
      if (!installedSourceHead || expectedMain !== installedSourceHead) return false;
      try { return readRecoverySource() === installedSourceHead; } catch { return false; }
    },
    continuousRepairEnabled: Boolean(installedSourceHead) && (options.continuousRepairEnabled ?? true),
  });
  await new Promise((resolveListen, rejectListen) => {
    created.server.once('error', rejectListen);
    created.server.listen(created.port, created.host, resolveListen);
  });
  const address = created.server.address();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'stephanos.sovereign-commander-http.v1',
    ok: true,
    host: created.host,
    port: typeof address === 'object' && address ? address.port : created.port,
    transport: 'authenticated-http-jsonrpc',
    capabilityVersion: SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_HTTP_READY',
  })}\n`);
  return created;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSovereignCommanderHttpServer();
}
