import { stat } from 'node:fs/promises';
import { resolveSharedWorkspacePath, appendWorkspaceJsonl } from './sharedAgentWorkspaceStore.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig } from './sharedWorkspaceRuntimeConfig.mjs';
import {
  BATTLE_BRIDGE_PUBLISHER_SERVICES,
  BATTLE_BRIDGE_SERVICE_STATUS,
  createBattleBridgePublisherSlice,
  publishBattleBridgeSliceToSharedWorkspace,
} from './battleBridgePublisher.mjs';

export const BATTLE_BRIDGE_PUBLISHER_LOOP_SCHEMA_VERSION = 'battle-bridge-publisher-loop.v1';
export const BATTLE_BRIDGE_PUBLISHER_LOOP_MIN_INTERVAL_MS = 30_000;
export const BATTLE_BRIDGE_PUBLISHER_LOOP_DEFAULT_INTERVAL_MS = 60_000;

function nowIso(now = Date.now) {
  return new Date(now()).toISOString();
}

function safeIntervalMs(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return BATTLE_BRIDGE_PUBLISHER_LOOP_DEFAULT_INTERVAL_MS;
  return Math.max(Math.trunc(candidate), BATTLE_BRIDGE_PUBLISHER_LOOP_MIN_INTERVAL_MS);
}

function workspaceUnavailableResult(reason, root = '') {
  return Object.freeze({
    ok: false,
    reason,
    root,
    finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_WORKSPACE_UNAVAILABLE',
    exactNextAction: 'Set STEPHANOS_SHARED_AGENT_WORKSPACE to an existing external Shared Agent Workspace directory, then restart Battle Bridge startup supervision.',
  });
}

export function buildBattleBridgePublisherLoopContract(input = {}) {
  const requestedIntervalMs = Number.isFinite(Number(input.intervalMs)) ? Number(input.intervalMs) : BATTLE_BRIDGE_PUBLISHER_LOOP_DEFAULT_INTERVAL_MS;
  const intervalMs = safeIntervalMs(requestedIntervalMs);
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_PUBLISHER_LOOP_SCHEMA_VERSION,
    contractKind: 'stephanos.battle_bridge.publisher.runtime_loop.contract',
    startupIntegrationPoint: 'battle-bridge-supervisor-startup',
    publisher: 'publishBattleBridgeSliceToSharedWorkspace',
    intervalMs,
    requestedIntervalMs,
    minimumIntervalMs: BATTLE_BRIDGE_PUBLISHER_LOOP_MIN_INTERVAL_MS,
    intervalGuardApplied: intervalMs !== requestedIntervalMs,
    stoppable: true,
    shutdownMethod: 'stop',
    workspaceMustPreexist: true,
    hiddenLoggingRoute: 'Shared Workspace events/battle-bridge-current.json',
    guardrails: {
      arbitraryShellAllowed: false,
      processKillingAllowed: false,
      restartImplementationAllowed: false,
      secretDumpingAllowed: false,
      dashboardWritesAllowed: false,
      repoMutationAllowedFromRuntime: false,
      fakeLiveProofAllowed: false,
      visiblePowerShellWallsAllowed: false,
      sharedWorkspacePublisherOnly: true,
    },
    finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_CONTRACT_READY',
  });
}

export async function resolveExistingSharedWorkspace(root, options = {}) {
  const runtime = await validateExistingSharedWorkspaceRuntimeConfig({ root, repoRoot: options.repoRoot, env: options.env });
  if (!runtime.ok) {
    const reason = runtime.reason === 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_MISSING' ? 'WORKSPACE_PATH_MISSING' : runtime.reason;
    return workspaceUnavailableResult(reason, runtime.root || runtime.workspaceRoot || '');
  }
  const resolved = resolveSharedWorkspacePath({ root: runtime.root, repoRoot: options.repoRoot });
  if (!resolved.ok) return workspaceUnavailableResult(resolved.reason, resolved.path || '');
  try {
    const info = await stat(resolved.root);
    if (!info.isDirectory()) return workspaceUnavailableResult('WORKSPACE_PATH_NOT_DIRECTORY', resolved.root);
    return { ok: true, reason: 'WORKSPACE_PATH_AVAILABLE', root: resolved.root, finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_WORKSPACE_READY' };
  } catch {
    return workspaceUnavailableResult('WORKSPACE_PATH_MISSING', resolved.root);
  }
}

export function createUnknownPublisherSlice(input = {}) {
  const timestampUtc = input.timestampUtc || nowIso(input.now);
  const status = input.status === BATTLE_BRIDGE_SERVICE_STATUS.STALE ? BATTLE_BRIDGE_SERVICE_STATUS.STALE : BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN;
  const exactNextAction = input.exactNextAction || 'Inspect Battle Bridge supervisor status and rerun the local proof commands before claiming live health.';
  const services = Object.fromEntries(BATTLE_BRIDGE_PUBLISHER_SERVICES.map((serviceId) => [serviceId, {
    status,
    reachable: false,
    usable: false,
    browserCompatible: false,
    summary: `${serviceId} publisher loop could not verify live status.`,
    exactNextAction,
  }]));
  return createBattleBridgePublisherSlice({ timestampUtc, services });
}

async function appendLoopEvent(root, event, options = {}) {
  return appendWorkspaceJsonl(root, ['events', 'battle-bridge-publisher-loop.ndjson'], event, options);
}

function createLoopEvent(input = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.event',
    eventId: input.eventId || 'battle-bridge-publisher-loop',
    timestampUtc: input.timestampUtc,
    eventKind: input.eventKind || 'health-check-result',
    summary: input.summary || 'Battle Bridge publisher loop event.',
  };
}

function blockedTick(reason, error, workspaceRoot = '') {
  const errorCode = ['EPERM', 'EBUSY', 'EACCES', 'EIO', 'ENOSPC'].includes(error?.code)
    ? error.code : 'WORKSPACE_IO_ERROR';
  return Object.freeze({ ok: false, reason, errorCode, workspaceRoot,
    errorHandled: true, finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_BLOCKED',
    exactNextAction: 'Inspect publisher storage and restore publication through the existing workspace owner; retained records are not fresh proof.',
  });
}

export async function publishBattleBridgeLoopTick(input = {}) {
  const timestampUtc = input.timestampUtc || nowIso(input.now);
  let workspace;
  try { workspace = await resolveExistingSharedWorkspace(input.root, { repoRoot: input.repoRoot }); }
  catch (error) { return blockedTick('PUBLISHER_WORKSPACE_RESOLUTION_FAILED', error); }
  if (!workspace.ok) return workspace;
  let sliceInput, sourceFailed = false;
  const exactNextAction = 'Inspect Battle Bridge publisher loop error event then fix the failing status source and rerun local proof commands.';
  try {
    sliceInput = typeof input.buildSlice === 'function'
      ? await input.buildSlice({ timestampUtc })
      : createUnknownPublisherSlice({ timestampUtc, status: input.status, exactNextAction: input.exactNextAction });
  } catch {
    sourceFailed = true;
    sliceInput = createUnknownPublisherSlice({ timestampUtc, status: BATTLE_BRIDGE_SERVICE_STATUS.STALE, exactNextAction });
  }
  let result;
  try {
    result = await publishBattleBridgeSliceToSharedWorkspace(workspace.root, sliceInput,
      { ...input.options, repoRoot: input.repoRoot, timestampUtc, nowMs: input.nowMs });
  } catch (error) {
    // Storage failure cannot be repaired by a second write to the same sink.
    // Preserve the atomic writer's refusal and keep the host process alive.
    return blockedTick('PUBLISHER_WORKSPACE_PUBLICATION_FAILED', error, workspace.root);
  }
  let event;
  try {
    event = await appendLoopEvent(workspace.root, createLoopEvent({ timestampUtc,
      eventKind: sourceFailed ? 'operator-action-required' : 'health-check-result',
      summary: sourceFailed ? 'Battle Bridge publisher loop marked status STALE: publisher source failed.'
        : result.ok ? 'Battle Bridge publisher loop tick published current Shared Workspace records.'
          : 'Battle Bridge publisher loop publication was blocked.',
    }), { repoRoot: input.repoRoot, timestampUtc, nowMs: input.nowMs });
  } catch (error) { return blockedTick('PUBLISHER_LOOP_EVENT_WRITE_FAILED', error, workspace.root); }
  if (event?.ok !== true) return blockedTick('PUBLISHER_LOOP_EVENT_WRITE_FAILED', null, workspace.root);
  return { ...result, workspaceRoot: workspace.root,
    ...(sourceFailed ? { errorHandled: true, exactNextAction } : {}),
    finalVerdict: result.ok ? sourceFailed ? 'BATTLE_BRIDGE_PUBLISHER_LOOP_FAILURE_PUBLISHED_STALE'
      : 'BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_PUBLISHED' : 'BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_BLOCKED',
  };
}

export function startBattleBridgePublisherLoop(input = {}) {
  const contract = buildBattleBridgePublisherLoopContract({ intervalMs: input.intervalMs });
  const setTimer = input.setIntervalFn || setInterval;
  const clearTimer = input.clearIntervalFn || clearInterval;
  let stopped = false;
  let inFlight = false;
  let lastResult = null;
  const tick = async () => {
    if (stopped || inFlight) return null;
    inFlight = true;
    try { lastResult = await publishBattleBridgeLoopTick(input); }
    catch (error) { lastResult = blockedTick('PUBLISHER_LOOP_UNEXPECTED_FAILURE', error); }
    finally { inFlight = false; }
    if (lastResult?.ok !== true) console.warn('BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_BLOCKED');
    return lastResult;
  };
  if (input.runImmediately !== false) void tick();
  const timer = setTimer(() => { void tick(); }, contract.intervalMs);
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_PUBLISHER_LOOP_SCHEMA_VERSION,
    contract,
    getStatus() { return Object.freeze({ stopped, inFlight, lastResult }); },
    stop() {
      if (!stopped) {
        stopped = true;
        clearTimer(timer);
      }
      return { stopped: true, finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_STOPPED' };
    },
  });
}

export function createBattleBridgeSupervisorStartupPublisher(input = {}) {
  return startBattleBridgePublisherLoop({ ...input, startupSource: 'battle-bridge-supervisor-startup' });
}
