import { createHash } from 'node:crypto';
import { parseWindowsCalibrationRemoteV1 } from './sovereignWindowsCalibrationRemoteV1.mjs';
import { validateSovereignWindowsReviewIdentityV1 } from './sovereignCommanderV1.mjs';
import { existsSync, lstatSync, opendirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ensureSovereignCommanderRuntime } from '../../scripts/sovereign-commander-ignition-autoheal.mjs';
import { CANONICAL_CONTROLLER_FLEET } from './controllerFleetTelemetryV1.mjs';
import { inspectOriginalSourceCustodyCensusV1 } from './originalSourceCustodyInspectionV1.mjs';
import { projectOriginalR7WitnessCommissioningAuditV1 } from './originalR7WitnessCommissioningAuditV1.mjs';
import { parseRescueIslandBoundaryStdoutV1, parseRescueIslandBoundaryHeldStdoutV1 } from './rescueIslandBoundaryReceiptV1.mjs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER, readSovereignMaintenanceTerminalReceiptV1,
  sovereignMaintenanceCustodyUnprovenV1 } from './sovereignMaintenanceAdmissionV1.mjs';
import { FLEET_SUPERVISOR_ACTION, projectFleetSupervisorReceiptV1 } from './sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
import { battleBridgeCanonicalRepositoryArgs, inspectBattleBridgeGitTopology, resolveBattleBridgeGitExecution, validateBattleBridgeLocalGitConfiguration } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_COMMANDER_REMOTE_OPERATION = 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION';
export const SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS = 6;
export const SOVEREIGN_COMMANDER_REMOTE_ACTIONS = Object.freeze([
  'status',
  'private-mcp-parity-proof',
  'search-project',
  'battle-bridge-status',
  'battle-bridge-observe',
  'original-source-custody-census',
  'original-r7-witness-readiness',
  'meter-status',
  'controller-lane-status',
  'visibility-snapshot',
  'inspect-canonical-git-worktree-config',
  'repair-canonical-git-worktree-config',
  'rescue-island-readonly-boundary',
  'cpu-pressure-snapshot',
  'publish-controller-activity',
  'repair-ui-4173',
  'restart-stephanos-runtime',
  'status-recovery-mesh',
  'status-worker-watchdog',
  'status-stephanos-core-daemon',
  'sovereign-windows-reviewer-calibration',
  'qwen35-canary',
  'vr-resource-governor',
  'gaming-resource-status',
  'gaming-resource-prepare',
  'starfield-vr-resource-preflight',
  'gaming-resource-cancel-prepare',
  'gaming-resource-auto',
  'gaming-resource-force-on',
  'gaming-resource-force-off',
  'gaming-resource-acceptance',
  'vr-virtual-airlink-acceptance',
  'starfield-vr-performance-diagnosis',
  'report-starfield-vr-telemetry',
  'starfield-vr-telemetry-refresh',
  'starfield-vr-telemetry-archive',
  'ignite-stephanos',
  'repair-battle-bridge',
  'repair-control-plane',
  'goal-discovery-heartbeat',
  'fleet-goal-supervisor',
  'start-mission-orchestrator-worker',
  'status-mission-orchestrator-worker',
  'start-stephanos-backend',
  'status-stephanos-backend',
  'status-openclaw-whatsapp',
  'repair-openclaw-ignite',
  'repair-openclaw-stack',
  'repair-openclaw-standalone',
  'repair-openclaw-local',
  'repair-goal-builder-flow',
  'repair-stephanos',
  'prove-vr-atlas-runtime',
  'prove-flywheel-runtime',
  'prove-stephanos-ai-commander',
  'reconcile-remote-commander-parity',
  'sync-vr-reference-sources',
  'preservation-converge-pr-branch',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PROOF_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
  'remoteAction',
  'remotePlan',
  'searchQuery',
  'searchMaxResults',
  'telemetryOffset',
  'telemetryLimit',
  'targetPrNumber',
  'targetBranch',
  'targetHead',
  'controllerActivity',
  'reviewIdentity',
]);
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const CPU_SNAPSHOT_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const CPU_SNAPSHOT_SCRIPT = 'scripts/windows/read-battle-bridge-cpu-pressure.ps1';
const ORIGINAL_CUSTODY_CENSUS_SCRIPT = 'scripts/windows/inspect-original-source-custody-readonly.ps1';
const ORIGINAL_R7_READINESS_SCRIPT = 'scripts/windows/inspect-original-r7-witness-readiness-readonly.ps1';
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MCP_URL = 'http://127.0.0.1:18791/mcp';
const PROTOCOL_VERSION = '2025-11-25';
export const SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS = 210_000;
export const SOVEREIGN_COMMANDER_REMOTE_REPAIR_NETWORK_TIMEOUT_MS = 240_000;
// Keep multi-step mailbox work comfortably inside the parent outbox guard's
// 15-minute child lifetime so a slow plan returns a terminal receipt instead
// of being killed by the guard with its ACCEPTED command still unresolved.
export const SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS = 480_000;
const SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MAX_MS = 300_000;
const REMOTE_SEARCH_QUERY = /^[A-Za-z0-9_.:/#@() +\-]{1,160}$/;

const CANONICAL_CONTROLLER_IDS = new Set(CANONICAL_CONTROLLER_FLEET.map(({ controllerId }) => controllerId));
const CONTROLLER_ACTIVITY_EXECUTION_STATES = new Set([
  'RUNNING', 'ACTIVE', 'READY', 'IDLE', 'BLOCKED', 'WAITING', 'SAFE_HOLD', 'FAILED',
]);

function validateRemoteControllerActivity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_INVALID', { requested: true });
  }
  let serialized = '';
  try { serialized = JSON.stringify(value); } catch {}
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 32_000) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_TOO_LARGE', { requested: true });
  }
  if (value.schemaVersion !== 'stephanos.sovereign-controller-activity-publish.v1') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_SCHEMA_INVALID', { requested: true });
  }
  const controllerId = text(value.controllerId);
  if (!CANONICAL_CONTROLLER_IDS.has(controllerId)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_CONTROLLER_INVALID', { requested: true });
  }
  const runId = text(value.runId);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(runId)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_RUN_INVALID', { requested: true });
  }
  if (typeof value.observedEnabled !== 'boolean') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ENABLEMENT_INVALID', { requested: true });
  }
  const executionState = text(value.executionState).toUpperCase();
  if (!CONTROLLER_ACTIVITY_EXECUTION_STATES.has(executionState)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_STATE_INVALID', { requested: true });
  }
  // Some canonical controller prompts report active/parked lane *counts* in the
  // legacy activeLanes/parkedLanes fields. Preserve that truth as bounded count-only
  // telemetry while keeping lane identity arrays empty. Material lanes and proof refs
  // remain identity/proof-bearing arrays and never gain synthetic entries.
  const normalized = { ...value };
  for (const [key, countKey] of [['activeLanes', 'activeLaneCount'], ['parkedLanes', 'parkedLaneCount']]) {
    const candidate = normalized[key];
    const legacyCountCandidate = typeof candidate === 'number'
      ? candidate
      : (typeof candidate === 'string' && /^\\d+$/.test(candidate.trim()) ? Number(candidate) : null);
    if (Number.isSafeInteger(legacyCountCandidate) && legacyCountCandidate >= 0 && legacyCountCandidate <= 15) {
      if (normalized[countKey] !== undefined && Number(normalized[countKey]) !== legacyCountCandidate) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID', { requested: true });
      }
      normalized[countKey] = legacyCountCandidate;
      normalized[key] = [];
    }
  }
  for (const key of ['materialLanes', 'proofRefs']) {
    if (normalized[key] === 0) normalized[key] = [];
  }
  const boundedArray = (items, max) => items === undefined || (Array.isArray(items) && items.length <= max);
  if (!boundedArray(normalized.activeLanes, 15)
    || !boundedArray(normalized.parkedLanes, 15)
    || !boundedArray(normalized.materialLanes, 15)
    || !boundedArray(normalized.proofRefs, 20)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ARRAY_INVALID', { requested: true });
  }
  const laneCounts = [normalized.activeLaneCount, normalized.parkedLaneCount].filter((item) => item !== undefined);
  if (laneCounts.some((item) => !Number.isSafeInteger(Number(item)) || Number(item) < 0 || Number(item) > 15)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID', { requested: true });
  }
  const materialActionsSucceeded = Number(normalized.materialActionsSucceeded ?? 0);
  const materialLaneCount = Array.isArray(normalized.materialLanes) ? normalized.materialLanes.length : 0;
  const proofRefCount = Array.isArray(normalized.proofRefs) ? normalized.proofRefs.length : 0;
  if ((materialActionsSucceeded > 0 || materialLaneCount > 0) && proofRefCount === 0) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED', { requested: true });
  }
  const counts = [
    value.materialActionsSucceeded, value.goalsAdvanced, value.sourceChanges,
    value.reviewsAdvanced, value.mergesCompleted, value.safeEligibleWorkRemaining,
  ].filter((item) => item !== undefined);
  if (counts.some((item) => !Number.isSafeInteger(Number(item)) || Number(item) < 0 || Number(item) > 100_000)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID', { requested: true });
  }
  return Object.freeze({
    ok: true,
    controllerActivity: Object.freeze({ ...normalized, controllerId, runId, executionState }),
  });
}

function text(value) {
  return String(value ?? '').trim();
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

/**
 * Publish only typed, bounded non-secret truth from the already local-only
 * Sovereign HTTP /health guardian. A healthy MCP connection does not prove
 * that the unattended repair cycle is running or repairing anything.
 */
export function projectSovereignContinuousRepairGuardianStatus(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const count = (item) => Number.isSafeInteger(item) && item >= 0 && item <= 1_000_000_000
    ? item : null;
  const stamp = (item) => typeof item === 'string'
    && item.length <= 40 && Number.isFinite(Date.parse(item))
    ? new Date(item).toISOString() : '';
  const verdict = (item) => typeof item === 'string'
    && /^[A-Z0-9][A-Z0-9._:-]{0,159}$/.test(item) ? item : '';
  const available = value !== null && typeof value.enabled === 'boolean';
  const enabled = available ? value.enabled : null;
  const running = available && typeof value.running === 'boolean' ? value.running : null;
  const scheduled = available && typeof value.scheduled === 'boolean' ? value.scheduled : null;
  const cycleCount = available ? count(value.cycleCount) : null;
  const successCount = available ? count(value.successCount) : null;
  const failureCount = available ? count(value.failureCount) : null;
  const lastOk = available && typeof value.lastOk === 'boolean' ? value.lastOk : null;
  return Object.freeze({
    available,
    enabled,
    running,
    scheduled,
    cycleCount,
    successCount,
    failureCount,
    lastStartedAtUtc: available ? stamp(value.lastStartedAtUtc) : '',
    lastCompletedAtUtc: available ? stamp(value.lastCompletedAtUtc) : '',
    lastOk,
    lastBlocker: available ? verdict(value.lastBlocker) : '',
    lastFinalVerdict: available ? verdict(value.lastFinalVerdict) : '',
    loopState: !available ? 'UNKNOWN'
      : enabled === false ? 'DISABLED'
      : cycleCount === null || running === null || scheduled === null ? 'UNKNOWN'
      : cycleCount === 0 ? 'AWAITING_FIRST_CYCLE'
      : running === false && scheduled === false ? 'NOT_SCHEDULED'
      : 'CYCLES_OBSERVED',
    // Loop execution and even reported successful maintenance must not be
    // conflated with a real source edit, protected merge and live proof.
    autonomousMaterialRepairProven: false,
    readOnly: true,
    secretMaterialReturned: false,
  });
}

function sovereignCommanderCompletionEnvelope(call = {}) {
  const result = call?.body?.result;
  if (result?.isError === true) return {};
  let candidate = result?.structuredContent;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const proofHash = text(candidate.proofHash).toLowerCase();
    if (
      candidate.ok === true
      && candidate.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(proofHash)
    ) {
      return candidate;
    }
    candidate = candidate.structuredContent;
  }
  return {};
}

function mcpStructuredPayload(call = {}) {
  const envelope = sovereignCommanderCompletionEnvelope(call);
  const nested = envelope?.structuredContent;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return {};
  return nested;
}

function fixedRepositoryRoot(env = process.env) {
  const profile = text(env.USERPROFILE) || homedir();
  return resolve(profile, 'Documents', 'GitHub', 'stephan-os');
}

function fixedTokenPath(env = process.env) {
  const profile = text(env.USERPROFILE) || homedir();
  return resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt');
}

function run(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 30_000,
    maxBuffer: 256 * 1024,
    ...options,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
  });
}

function boundedRemoteNetworkTimeoutMs(value, fallbackMs = SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MAX_MS
    ? parsed
    : fallbackMs;
}

// Bounded repair actions may need Commander to be revived before opening an MCP
// session. Use the existing guarded, fixed-capability ignition preflight only;
// read-only/status commands never gain service-recycle authority.
const COMMANDER_RUNTIME_PREFLIGHT_ACTIONS = new Set([
  'repair-stephanos',
  'repair-goal-builder-flow',
  'fleet-goal-supervisor',
]);

function sovereignCommanderRepairEnvelopeRequired(command = {}) {
  const actions = [
    text(command?.remoteAction),
    ...(Array.isArray(command?.remotePlan) ? command.remotePlan.map((value) => text(value)) : []),
  ];
  return actions.some((actionId) => COMMANDER_RUNTIME_PREFLIGHT_ACTIONS.has(actionId));
}

export function sovereignCommanderRemoteNetworkTimeoutMs(command = {}, requestedTimeoutMs) {
  const fallbackMs = sovereignCommanderRepairEnvelopeRequired(command)
    ? SOVEREIGN_COMMANDER_REMOTE_REPAIR_NETWORK_TIMEOUT_MS
    : SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS;
  return boundedRemoteNetworkTimeoutMs(requestedTimeoutMs, fallbackMs);
}

export function sovereignCommanderRemotePlanStepTimeoutMs({
  startedAtMs,
  nowMs,
  perCallTimeoutMs,
} = {}) {
  const started = Number(startedAtMs);
  const observed = Number(nowMs);
  if (!Number.isFinite(started) || !Number.isFinite(observed) || observed < started) return 0;
  const remaining = Math.floor((started + SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS) - observed);
  if (remaining <= 0) return 0;
  return Math.min(boundedRemoteNetworkTimeoutMs(perCallTimeoutMs), remaining);
}

async function settleWithinDeadline(promise, timeoutMs) {
  const parsedTimeoutMs = Number(timeoutMs);
  const bounded = Number.isSafeInteger(parsedTimeoutMs)
    && parsedTimeoutMs >= 1
    && parsedTimeoutMs <= SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS
    ? parsedTimeoutMs
    : SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS;
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(
        (value) => Object.freeze({ timedOut: false, value }),
        (error) => Object.freeze({ timedOut: false, error }),
      ),
      new Promise((resolvePromise) => {
        timer = setTimeout(
          () => resolvePromise(Object.freeze({ timedOut: true, value: null })),
          bounded,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchTextWithDeadline(fetchFn, url, options = {}, timeoutMs = SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const deadlineMs = boundedRemoteNetworkTimeoutMs(timeoutMs);
  let timer = null;
  try {
    // AbortSignal alone is advisory: a broken/custom transport or its body
    // reader can ignore it and strand an ACCEPTED mailbox child until the
    // outbox guard kills it. Race the *whole* request including response.text.
    // Timeout does NOT prove remote cancellation and never permits replay.
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchFn(url, { ...options, signal: controller.signal });
        const bodyText = await response.text();
        return Object.freeze({ response, bodyText });
      }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error('SOVEREIGN_COMMANDER_REMOTE_TRANSPORT_DEADLINE_EXCEEDED');
          error.name = 'AbortError';
          error.code = 'ABORT_ERR';
          reject(error);
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function postMcp(fetchFn, token, message, sessionId = '', timeoutMs = SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS) {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  let response;
  let bodyText = '';
  try {
    const exchange = await fetchTextWithDeadline(fetchFn, MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    }, timeoutMs);
    response = exchange.response;
    bodyText = exchange.bodyText;
  } catch (error) {
    return Object.freeze({
      ok: false,
      status: 0,
      sessionId: '',
      body: null,
      transportTimedOut: error?.name === 'AbortError' || error?.code === 'ABORT_ERR',
    });
  }
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch {}
  return Object.freeze({
    ok: response.ok,
    status: response.status,
    sessionId: text(response.headers?.get?.('mcp-session-id')),
    body,
    transportTimedOut: false,
  });
}

// Private local callers reuse the existing bounded authenticated MCP transport.
// No health snapshot grants admission, no local child fallback, and no attempt
// to start/recycle an unavailable owner is permitted on this delegation path.
export async function callSovereignMaintenanceOwnerV1(request, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const readFileFn = options.readFileFn || readFile;
  let token = '', sessionId = '';
  try {
    const healthExchange = await fetchTextWithDeadline(fetchFn, HEALTH_URL, { method: 'GET' }, 3_000);
    const health = JSON.parse(healthExchange.bodyText || 'null');
    if (!healthExchange.response.ok || health?.ok !== true || health.service !== 'stephanos-sovereign-commander'
        || health.maintenanceOwnerAdmissionVersion !== SOVEREIGN_MAINTENANCE_OWNER_VERSION) {
      return fail('SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED');
    }
    token = text(await readFileFn(fixedTokenPath(options.env || process.env), 'utf8'));
    if (token.length < 32) return fail('SOVEREIGN_MAINTENANCE_OWNER_TOKEN_UNAVAILABLE');
    const init = await postMcp(fetchFn, token, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sovereign-existing-owner-delegation', version: '1' } } }, '', 3_000);
    if (!init.ok || !init.sessionId || init.body?.error) return fail('SOVEREIGN_MAINTENANCE_OWNER_INITIALIZE_FAILED');
    sessionId = init.sessionId;
    const initialized = await postMcp(fetchFn, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId, 3_000);
    const listed = await postMcp(fetchFn, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sessionId, 3_000);
    if (!initialized.ok || !listed.ok || !listed.body?.result?.tools?.some(tool => tool.name === 'maintenance_action')) {
      return fail('SOVEREIGN_MAINTENANCE_OWNER_TOOL_UNAVAILABLE');
    }
    const timeoutMs = Number.isSafeInteger(request.timeoutMs) ? Math.min(285_000, request.timeoutMs + 15_000) : 285_000;
    const called = await postMcp(fetchFn, token, { jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'maintenance_action', arguments: { ...request.arguments, actionId: request.actionId } } }, init.sessionId, timeoutMs);
    const result = called.body?.result?.structuredContent;
    if (!called.ok || !result || result.command?.plan?.processId !== request.actionId) {
      return fail('SOVEREIGN_MAINTENANCE_OWNER_RECEIPT_INVALID');
    }
    if (result.ok === true) {
      const expected = createHash('sha256').update(JSON.stringify({ commandId: result.command.commandId,
        missionId: result.command.missionId, operation: result.command.operation, plan: result.command.plan,
        contentText: result.contentText, structuredContent: result.structuredContent })).digest('hex');
      if (result.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' || result.proofHash !== expected) {
        return fail('SOVEREIGN_MAINTENANCE_OWNER_RECEIPT_INVALID');
      }
    }
    return result;
  } catch { return fail('SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE'); }
  finally {
    if (sessionId && token) {
      try { await fetchTextWithDeadline(fetchFn, MCP_URL, { method: 'DELETE', headers: {
        authorization: `Bearer ${token}`, 'mcp-session-id': sessionId,
      } }, 3_000); } catch {}
    }
  }
}

function safeAiCommanderAcceptanceProjection(value = {}, processId = '') {
  if (processId !== 'prove-stephanos-ai-commander') return null;
  const raw = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_AI_CHAT_ACCEPTANCE_RESULT=';
  const line = raw.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  let observed = null;
  try { observed = line ? JSON.parse(line.slice(marker.length)) : null; } catch {}
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) return null;
  const proofHash = text(observed.proofHash).toLowerCase();
  const { proofHash: _claimedProofHash, ...signed } = observed;
  const computedProofHash = createHash('sha256').update(JSON.stringify(signed)).digest('hex');
  const passed = observed.ok === true;
  const expectedVerdict = passed
    ? 'STEPHANOS_AI_COMMANDER_TOOL_CALL_PROVEN'
    : 'STEPHANOS_AI_COMMANDER_TOOL_CALL_BLOCKED';
  const blocker = text(observed.blocker);
  const typedBlocker = [
    'AI_COMMANDER_CHAT_ENDPOINT_UNAVAILABLE',
    'AI_COMMANDER_CHAT_RESPONSE_TOO_LARGE',
    'AI_COMMANDER_CHAT_TOOL_CALL_NOT_PROVEN',
    'AI_COMMANDER_TOOL_GUARDRAILS_NOT_PROVEN',
    'AI_COMMANDER_HEALTH_OBSERVED_BUT_HELD',
    'AI_COMMANDER_CHAT_REQUEST_FAILED',
  ].includes(blocker) || /^AI_COMMANDER_CHAT_HTTP_(?:4\d\d|5\d\d)$/.test(blocker);
  if (observed.schemaVersion !== 'stephanos.sovereign-ai-commander-acceptance.v1'
    || observed.finalVerdict !== expectedVerdict
    || observed.readOnly !== true || observed.localLoopbackOnly !== true
    || observed.remoteCommanderRequired !== false
    || observed.arbitraryShellAllowed !== false
    || observed.sourceMutationAllowed !== false || observed.mergeAuthority !== false
    || observed.coreAwakeProven !== false || observed.physicalWorkerPickupProven !== false
    || typeof observed.toolCalled !== 'boolean'
    || typeof observed.healthAvailable !== 'boolean'
    || !['system', 'UNKNOWN'].includes(observed.backendRoute)
    || !(observed.guardianCycleCount === null
      || (Number.isSafeInteger(observed.guardianCycleCount)
        && observed.guardianCycleCount >= 0 && observed.guardianCycleCount <= 1_000_000))
    || (passed && (!observed.toolCalled || !observed.healthAvailable || observed.backendRoute !== 'system' || blocker))
    || (!passed && !typedBlocker)
    || !PROOF_HASH_PATTERN.test(proofHash)
    || proofHash !== computedProofHash) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-ai-commander-acceptance.v1',
    ok: passed,
    toolCalled: observed.toolCalled,
    healthAvailable: observed.healthAvailable,
    guardianCycleCount: observed.guardianCycleCount,
    backendRoute: observed.backendRoute,
    blocker: passed ? '' : blocker,
    proofHash,
    finalVerdict: expectedVerdict,
    readOnly: true, localLoopbackOnly: true,
    remoteCommanderRequired: false,
    arbitraryShellAllowed: false, sourceMutationAllowed: false,
    mergeAuthority: false, coreAwakeProven: false, physicalWorkerPickupProven: false,
  });
}

function safeRuntimeProofProjection(value = {}, processId = '') {
  const proofContract = processId === 'prove-vr-atlas-runtime'
    ? Object.freeze({
      marker: 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=',
      profile: 'vr-atlas-status-pills',
      verdicts: Object.freeze(['VR_ATLAS_RUNTIME_PROOF_PASS', 'VR_ATLAS_RUNTIME_PROOF_BLOCKED']),
    })
    : processId === 'prove-flywheel-runtime'
      ? Object.freeze({
        marker: 'SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_RESULT=',
        profile: 'flywheel-live-feed',
        verdicts: Object.freeze(['FLYWHEEL_RUNTIME_PROOF_PASS', 'FLYWHEEL_RUNTIME_PROOF_BLOCKED']),
      })
      : null;
  if (!proofContract) return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(proofContract.marker));
  if (!line) return null;
  let proof = null;
  try { proof = JSON.parse(line.slice(proofContract.marker.length)); } catch {}
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return null;
  const sourceHead = text(proof.sourceHead).toLowerCase();
  const evidenceHash = text(proof.evidenceHash).toLowerCase();
  const screenshotSha256 = text(proof.screenshotSha256).toLowerCase();
  const profile = text(proof.profile);
  const finalVerdict = text(proof.finalVerdict);
  const blocker = text(proof.blocker || (Array.isArray(proof.blockers) ? proof.blockers[0] : ''));
  const safeCount = (value, max = 10_000) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  };
  const feedState = text(proof?.feed?.state).toLowerCase();
  const browserLiveState = text(proof?.browser?.liveState).toLowerCase();
  const browserLiveLabel = text(proof?.browser?.liveLabel).toUpperCase();
  return Object.freeze({
    profile: profile === proofContract.profile ? profile : '',
    ok: proof.ok === true,
    sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : '',
    exactHeadProofOk: proof.exactHeadProofOk === true,
    finalVerdict: proofContract.verdicts.includes(finalVerdict) ? finalVerdict : '',
    evidenceHash: PROOF_HASH_PATTERN.test(evidenceHash) ? evidenceHash : '',
    screenshotSha256: PROOF_HASH_PATTERN.test(screenshotSha256) ? screenshotSha256 : '',
    pillCount: safeCount(proof.pillCount),
    atlasEvidencePanelReady: proof.evidencePanelReady === true,
    atlasCorpusCount: safeCount(proof.corpusCount),
    atlasCorrelationCount: safeCount(proof.correlationCount),
    atlasResearchAgentActionPresent: Boolean(text(proof.agentAction)),
    feedState: ['ready', 'stale'].includes(feedState) ? feedState : '',
    routeResponseMs: safeCount(proof?.feed?.responseMs, 60_000),
    goalCount: safeCount(proof?.feed?.goalCount, 1_000_000),
    eventCount: safeCount(proof?.feed?.eventCount, 1_000_000),
    starfieldSeedPlanted: proof?.feed?.starfieldSeedPlanted === true,
    browserLiveState: ['ready', 'stale'].includes(browserLiveState) ? browserLiveState : '',
    browserLiveLabel: ['LIVE', 'STALE'].includes(browserLiveLabel) ? browserLiveLabel : '',
    backendUnreachableVisible: proof?.browser?.backendUnreachableVisible === true,
    seedVisible: proof?.browser?.seedVisible === true,
    consoleErrorCount: safeCount(proof.consoleErrorCount),
    pageErrorCount: safeCount(proof.pageErrorCount),
    screenshotCaptured: Boolean(proof.screenshotPath),
    receiptCaptured: Boolean(proof.receiptPath),
    blocker: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(blocker) ? blocker : '',
  });
}

function runtimeProofCompleteForAction(actionId = '', proof = null, expectedHead = '') {
  const common = proof?.ok === true
    && proof?.exactHeadProofOk === true
    && proof?.sourceHead === expectedHead
    && PROOF_HASH_PATTERN.test(proof?.evidenceHash || '')
    && PROOF_HASH_PATTERN.test(proof?.screenshotSha256 || '')
    && proof?.screenshotCaptured === true
    && proof?.receiptCaptured === true
    && Number(proof?.consoleErrorCount || 0) === 0
    && Number(proof?.pageErrorCount || 0) === 0;
  if (!common) return false;
  if (actionId === 'prove-vr-atlas-runtime') {
    return proof.profile === 'vr-atlas-status-pills'
      && proof.finalVerdict === 'VR_ATLAS_RUNTIME_PROOF_PASS'
      && Number(proof.pillCount || 0) >= 4;
  }
  if (actionId === 'prove-flywheel-runtime') {
    return proof.profile === 'flywheel-live-feed'
      && proof.finalVerdict === 'FLYWHEEL_RUNTIME_PROOF_PASS'
      && ['ready', 'stale'].includes(proof.feedState)
      && Number.isSafeInteger(proof.routeResponseMs)
      && proof.routeResponseMs <= 10_000
      && proof.starfieldSeedPlanted === true
      && ['ready', 'stale'].includes(proof.browserLiveState)
      && ['LIVE', 'STALE'].includes(proof.browserLiveLabel)
      && proof.backendUnreachableVisible === false
      && proof.seedVisible === true;
  }
  return false;
}

function safeBattleBridgeObservationProjection(value = {}, processId = '') {
  if (processId !== 'battle-bridge-observe') return null;
  const raw = text(value?.structuredContent?.stdout);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || parsed.schemaVersion !== 'stephanos.battle-bridge-observation.v1') return null;
  if (parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.arbitraryShellAllowed !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.finalVerdict !== 'BATTLE_BRIDGE_OBSERVATION_READY') return null;

  const safeIntegerOrNull = (value, max = Number.MAX_SAFE_INTEGER) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safeModelName = (value) => {
    const candidate = text(value);
    return /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,119}$/.test(candidate) ? candidate : '';
  };
  const safeShortText = (value, pattern, max = 80) => {
    const candidate = text(value).slice(0, max);
    return pattern.test(candidate) ? candidate : '';
  };
  const safeModels = (items, loaded = false) => Object.freeze(
    (Array.isArray(items) ? items : []).slice(0, 64).flatMap((model) => {
      const name = safeModelName(model?.name);
      if (!name) return [];
      const common = {
        name,
        sizeBytes: safeIntegerOrNull(model?.sizeBytes),
      };
      return [Object.freeze(loaded ? {
        ...common,
        sizeVramBytes: safeIntegerOrNull(model?.sizeVramBytes),
        contextLength: safeIntegerOrNull(model?.contextLength, 10_000_000),
      } : {
        ...common,
        parameterSize: safeShortText(model?.parameterSize, /^[A-Za-z0-9._+\-]{0,39}$/, 40),
        quantizationLevel: safeShortText(model?.quantizationLevel, /^[A-Za-z0-9._+\-]{0,39}$/, 40),
        family: safeShortText(model?.family, /^[A-Za-z0-9._+\-]{0,79}$/, 80),
      })];
    }),
  );
  const safeService = (service = {}) => Object.freeze({
    reachable: service?.reachable === true,
    ready: service?.ready === true,
    httpStatus: safeIntegerOrNull(service?.httpStatus, 599) ?? 0,
  });
  const services = Object.freeze(Object.fromEntries(
    ['ui', 'backend', 'openclaw', 'sovereign-commander', 'ollama']
      .map((id) => [id, safeService(parsed?.services?.[id])]),
  ));
  const gpuName = safeShortText(parsed?.gpu?.name, /^[A-Za-z0-9][A-Za-z0-9 ._()+/\-]{0,119}$/, 120);
  const installedModels = safeModels(parsed?.ollama?.installedModels, false);
  const loadedModels = safeModels(parsed?.ollama?.loadedModels, true);
  const installedModelCount = safeIntegerOrNull(parsed?.ollama?.installedModelCount, 10_000) ?? installedModels.length;
  const loadedModelCount = safeIntegerOrNull(parsed?.ollama?.loadedModelCount, 10_000) ?? loadedModels.length;
  const capturedAtUtc = text(parsed.capturedAtUtc);
  const capturedAtValid = capturedAtUtc.length <= 40 && Number.isFinite(Date.parse(capturedAtUtc));

  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: capturedAtValid ? capturedAtUtc : '',
    hostRole: parsed.hostRole === 'battle-bridge' ? 'battle-bridge' : '',
    uptimeSeconds: safeIntegerOrNull(parsed.uptimeSeconds),
    memory: Object.freeze({
      totalBytes: safeIntegerOrNull(parsed?.memory?.totalBytes),
      freeBytes: safeIntegerOrNull(parsed?.memory?.freeBytes),
      usedBytes: safeIntegerOrNull(parsed?.memory?.usedBytes),
    }),
    gpu: Object.freeze({
      available: parsed?.gpu?.available === true,
      name: gpuName,
      memoryTotalMiB: safeIntegerOrNull(parsed?.gpu?.memoryTotalMiB, 1_000_000),
      memoryUsedMiB: safeIntegerOrNull(parsed?.gpu?.memoryUsedMiB, 1_000_000),
      memoryFreeMiB: safeIntegerOrNull(parsed?.gpu?.memoryFreeMiB, 1_000_000),
      utilizationGpuPercent: safeIntegerOrNull(parsed?.gpu?.utilizationGpuPercent, 100),
    }),
    ollama: Object.freeze({
      reachable: parsed?.ollama?.reachable === true,
      installedModelCount,
      loadedModelCount,
      installedModelsTruncated: parsed?.ollama?.installedModelsTruncated === true || installedModelCount > installedModels.length,
      loadedModelsTruncated: parsed?.ollama?.loadedModelsTruncated === true || loadedModelCount > loadedModels.length,
      installedModels,
      loadedModels,
    }),
    services,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
  });
}


function safeMeterStatusProjection(value = {}, processId = '') {
  if (processId !== 'meter-status') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_METER_STATUS_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-meter-status.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.arbitraryShellAllowed !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.unknownMeansGreen !== false) return null;

  const safePercent = (value) => {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeInteger = (value) => {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
  };
  const safeTime = (value) => {
    const candidate = text(value);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const safeId = (value) => {
    const candidate = text(value).toLowerCase();
    return /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(candidate) ? candidate : '';
  };
  const meters = Object.freeze((Array.isArray(parsed.meters) ? parsed.meters : [])
    .slice(0, 64)
    .flatMap((meter) => {
      const meterId = safeId(meter?.meterId);
      const provider = safeId(meter?.provider);
      const source = safeId(meter?.source);
      const observationState = text(meter?.observationState).toUpperCase();
      const trafficLight = text(meter?.trafficLight).toUpperCase();
      if (!meterId
        || !provider
        || !source
        || !['CURRENT', 'STALE', 'UNKNOWN'].includes(observationState)
        || !['GREEN', 'AMBER', 'RED', 'GREY'].includes(trafficLight)) return [];
      const availability = text(meter?.availability).toUpperCase().slice(0, 80);
      const truthState = text(meter?.truthState).toUpperCase().slice(0, 80);
      const blocker = text(meter?.blocker).toUpperCase().slice(0, 120);
      return [Object.freeze({
        meterId,
        provider,
        source,
        observationState,
        trafficLight,
        remainingPercent: safePercent(meter?.remainingPercent),
        availability: /^[A-Z0-9._:-]{0,80}$/.test(availability) ? availability : '',
        truthState: /^[A-Z0-9._:-]{0,80}$/.test(truthState) ? truthState : '',
        observedAtUtc: safeTime(meter?.observedAtUtc),
        ageSeconds: safeInteger(meter?.ageSeconds),
        naturalResetAtUtc: safeTime(meter?.naturalResetAtUtc),
        meterTruthUsable: meter?.meterTruthUsable === true,
        observableBySovereign: meter?.observableBySovereign === true,
        limit: safeInteger(meter?.limit),
        remaining: safeInteger(meter?.remaining),
        blocker: /^[A-Z0-9._:-]{0,120}$/.test(blocker) ? blocker : '',
      })];
    }));
  const counts = Object.freeze({
    total: meters.length,
    green: meters.filter((item) => item.trafficLight === 'GREEN').length,
    amber: meters.filter((item) => item.trafficLight === 'AMBER').length,
    red: meters.filter((item) => item.trafficLight === 'RED').length,
    grey: meters.filter((item) => item.trafficLight === 'GREY').length,
  });
  const capturedAtUtc = safeTime(parsed.capturedAtUtc);
  const finalVerdict = text(parsed.finalVerdict).toUpperCase();
  if (!capturedAtUtc
    || !['SOVEREIGN_METER_STATUS_READY', 'SOVEREIGN_METER_STATUS_AMBER_PRESENT', 'SOVEREIGN_METER_STATUS_RED_PRESENT'].includes(finalVerdict)) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: true,
    capturedAtUtc,
    counts,
    meters,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

function safeControllerLaneStatusProjection(value = {}, processId = '') {
  if (processId !== 'controller-lane-status') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-controller-lane-status.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.arbitraryShellAllowed !== false
    || parsed.sourceMutationAllowed !== false
    || parsed.mergeAuthority !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.unknownMeansGreen !== false) return null;

  const bounded = (input, max = 1_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safePercent = (input) => {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 && number <= 100
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeTime = (input) => {
    const candidate = text(input);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const safeControllerId = (input) => {
    const candidate = text(input).slice(0, 80);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(candidate) ? candidate : '';
  };
  const safeTitle = (input) => text(input).replace(/[^A-Za-z0-9 ._()#+/&:-]/g, '').slice(0, 120);
  const safeState = (input, max = 120) => {
    const candidate = text(input).toUpperCase().slice(0, max);
    return /^[A-Z0-9._:-]{0,120}$/.test(candidate) ? candidate : '';
  };
  const safePhysicalController = (controller = {}) => {
    const controllerId = safeControllerId(controller?.controllerId);
    const trafficLight = safeState(controller?.trafficLight, 20);
    if (!controllerId || !['GREEN', 'AMBER', 'RED', 'UNKNOWN'].includes(trafficLight)) return null;
    return Object.freeze({
      controllerId,
      title: safeTitle(controller?.title),
      freshness: safeState(controller?.freshness, 40) || 'UNKNOWN',
      activityState: safeState(controller?.activityState, 80) || 'UNKNOWN',
      trafficLight,
      materialLaneCount: bounded(controller?.materialLaneCount, 100_000),
      activeLaneCount: bounded(controller?.activeLaneCount, 100_000),
      parkedLaneCount: bounded(controller?.parkedLaneCount, 100_000),
      safeEligibleWorkRemaining: bounded(controller?.safeEligibleWorkRemaining, 1_000_000),
      blocker: safeState(controller?.blocker, 120),
    });
  };
  const safeHost = (host = {}) => {
    const controllerId = safeControllerId(host?.controllerId);
    if (!controllerId) return null;
    return Object.freeze({
      controllerId,
      title: safeTitle(host?.title),
      logicalControllerCount: bounded(host?.logicalControllerCount, 1_000_000),
      activeCount: bounded(host?.activeCount, 1_000_000),
      trackingCount: bounded(host?.trackingCount, 1_000_000),
      parkedCount: bounded(host?.parkedCount, 1_000_000),
    });
  };

  const physicalControllers = Object.freeze((Array.isArray(parsed?.physical?.controllers) ? parsed.physical.controllers : [])
    .slice(0, 5)
    .map(safePhysicalController)
    .filter(Boolean));
  const hostLoads = Object.freeze((Array.isArray(parsed?.logical?.hostLoads) ? parsed.logical.hostLoads : [])
    .slice(0, 5)
    .map(safeHost)
    .filter(Boolean));
  const refillHealth = safeState(parsed?.lanes?.refillHealth, 20);
  const refillState = safeState(parsed?.lanes?.refillState, 120);
  if (!['GREEN', 'AMBER', 'RED', 'GREY'].includes(refillHealth)) return null;
  const finalVerdict = safeState(parsed.finalVerdict, 120);
  if (![
    'SOVEREIGN_CONTROLLER_LANE_STATUS_READY',
    'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
    'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED',
    'SOVEREIGN_CONTROLLER_LANE_STATUS_UNKNOWN',
  ].includes(finalVerdict)) return null;
  const capturedAtUtc = safeTime(parsed.capturedAtUtc);
  if (!capturedAtUtc) return null;

  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc,
    physical: Object.freeze({
      expected: bounded(parsed?.physical?.expected, 100),
      building: bounded(parsed?.physical?.building, 100),
      amber: bounded(parsed?.physical?.amber, 100),
      red: bounded(parsed?.physical?.red, 100),
      unknown: bounded(parsed?.physical?.unknown, 100),
      allCurrent: parsed?.physical?.allCurrent === true,
      allObservedEnabled: parsed?.physical?.allObservedEnabled === true,
      finalVerdict: safeState(parsed?.physical?.finalVerdict, 120) || 'UNKNOWN',
      controllers: physicalControllers,
    }),
    logical: Object.freeze({
      current: parsed?.logical?.current === true,
      valid: parsed?.logical?.valid === true,
      observedAtUtc: safeTime(parsed?.logical?.observedAtUtc),
      physicalControllerCount: bounded(parsed?.logical?.physicalControllerCount, 100),
      total: bounded(parsed?.logical?.total, 1_000_000),
      active: bounded(parsed?.logical?.active, 1_000_000),
      tracking: bounded(parsed?.logical?.tracking, 1_000_000),
      parked: bounded(parsed?.logical?.parked, 1_000_000),
      retired: bounded(parsed?.logical?.retired, 1_000_000),
      selectedForAdmission: bounded(parsed?.logical?.selectedForAdmission, 1_000_000),
      finalVerdict: safeState(parsed?.logical?.finalVerdict, 120) || 'UNKNOWN',
      hostLoads,
    }),
    lanes: Object.freeze({
      targetMaterialLanes: bounded(parsed?.lanes?.targetMaterialLanes, 100_000),
      activeMaterialLaneCount: bounded(parsed?.lanes?.activeMaterialLaneCount, 100_000),
      activeLaneClaimCount: bounded(parsed?.lanes?.activeLaneClaimCount, 100_000),
      reportedMaterialLaneCountSum: bounded(parsed?.lanes?.reportedMaterialLaneCountSum, 100_000),
      occupancyPercent: safePercent(parsed?.lanes?.occupancyPercent),
      freeTargetLaneSlots: bounded(parsed?.lanes?.freeTargetLaneSlots, 100_000),
      runnableBacklogCount: bounded(parsed?.lanes?.runnableBacklogCount, 1_000_000),
      parkedPhysicalLaneCount: bounded(parsed?.lanes?.parkedPhysicalLaneCount, 100_000),
      reportedSafeEligibleWorkMax: bounded(parsed?.lanes?.reportedSafeEligibleWorkMax, 1_000_000),
      reportedSafeEligibleWorkSum: bounded(parsed?.lanes?.reportedSafeEligibleWorkSum, 1_000_000),
      refillHealth,
      refillState,
    }),
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}


const CPU_SNAPSHOT_PROCESS_NAMES = new Set(['powershell','pwsh','node','msmpeng','ollama','llama-server']);
const CPU_SNAPSHOT_SCRIPT_NAMES = new Set([
  'run-vr-resource-governor.ps1',
  'run-battle-bridge-recovery-lifeboat-active-v1.ps1',
  'run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
  'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1',
  'Launch-Stephanos-Local.ps1',
  'Invoke-Stephanos-Ignite-With-Approval.ps1',
  'start-mission-orchestrator-worker.ps1',
  'stephanos-core-daemon.mjs',
  'mission-orchestrator-worker-supervised.mjs',
  'sovereign-commander-mcp.mjs',
  'serve-stephanos-dist.mjs',
  'battle-bridge-sovereign-relay-daemon.mjs',
].map((name) => name.toLowerCase()));

export function safeCpuPressureSnapshotProjection(value = {}, processId = '') {
  if (processId !== 'cpu-pressure-snapshot') return null;
  const stdout = String(value?.structuredContent?.stdout || '').trim();
  if (!stdout || stdout.length > 16_000) return null;
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return null; }
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.battle-bridge-cpu-pressure.v1'
    || parsed.readOnly !== true
    || parsed.sourceMutationAllowed !== false
    || parsed.processTerminationAllowed !== false
    || parsed.arbitraryShellAllowed !== false
    || parsed.arbitraryProcessInspectionAllowed !== false
    || parsed.rawCommandLinesReturned !== false
    || parsed.rawPathsReturned !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.unknownMeansGreen !== false
    || parsed.finalVerdict !== 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED') return null;
  const sampleSeconds = Number(parsed.sampleSeconds);
  const processorCount = Number(parsed.processorCount);
  const capturedAt = text(parsed.capturedAtUtc);
  if (!Number.isFinite(Date.parse(capturedAt))
    || !Number.isFinite(sampleSeconds) || sampleSeconds < 4 || sampleSeconds > 20
    || !Number.isSafeInteger(processorCount) || processorCount < 1 || processorCount > 256
    || !Array.isArray(parsed.rows) || parsed.rows.length > 20) return null;
  const safeRows = [];
  for (const row of parsed.rows) {
    const pid = Number(row?.pid);
    const parentPid = Number(row?.parentPid);
    const processName = text(row?.processName);
    const startedAtUtc = text(row?.startedAtUtc);
    const script = text(row?.script);
    const cpuPercent = row?.cpuPercent === null ? null : Number(row?.cpuPercent);
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647
      || !Number.isSafeInteger(parentPid) || parentPid < 0 || parentPid > 2_147_483_647
      || !CPU_SNAPSHOT_PROCESS_NAMES.has(processName.toLowerCase())
      || (startedAtUtc && !Number.isFinite(Date.parse(startedAtUtc)))
      || (script && !CPU_SNAPSHOT_SCRIPT_NAMES.has(script.toLowerCase()))
      || (cpuPercent !== null && (!Number.isFinite(cpuPercent) || cpuPercent < 0 || cpuPercent > 100))
      || typeof row?.sampleMatched !== 'boolean') return null;
    safeRows.push(Object.freeze({
      pid,
      processName,
      parentPid,
      startedAtUtc: startedAtUtc ? new Date(startedAtUtc).toISOString() : '',
      script,
      cpuPercent,
      sampleMatched: row.sampleMatched === true && cpuPercent !== null,
    }));
  }
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-cpu-pressure.v1',
    capturedAtUtc: new Date(capturedAt).toISOString(),
    sampleSeconds,
    processorCount,
    metadataAvailable: parsed.metadataAvailable === true,
    rows: Object.freeze(safeRows),
    readOnly: true,
    processTerminationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryProcessInspectionAllowed: false,
    sourceMutationAllowed: false,
    rawCommandLinesReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED',
  });
}

function safeVisibilitySnapshotProjection(value = {}, processId = '') {
  if (processId !== 'visibility-snapshot') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_VISIBILITY_SNAPSHOT_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-visibility-snapshot.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.sourceMutationAllowed !== false
    || parsed.arbitraryShellAllowed !== false
    || parsed.arbitraryProcessInspectionAllowed !== false
    || parsed.rawLogsReturned !== false
    || parsed.rawPathsReturned !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.mergeAuthority !== false
    || parsed.pcRestartAuthority !== false
    || parsed.remoteCommanderRequired !== false
    || parsed.unknownMeansGreen !== false) return null;

  const safeTime = (input) => {
    const candidate = text(input);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const bounded = (input, max = 1_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safeState = (input, max = 160) => {
    const candidate = text(input).toUpperCase().slice(0, max);
    return /^[A-Z0-9._:-]{0,160}$/.test(candidate) ? candidate : '';
  };
  const safeBranch = (input) => {
    const candidate = text(input).slice(0, 120);
    return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(candidate) ? candidate : '';
  };
  const repositoryHead = text(parsed?.repository?.head).toLowerCase();
  const remoteMainHead = text(parsed?.repository?.remoteMainHead).toLowerCase();
  const repository = Object.freeze({
    available: parsed?.repository?.available === true,
    head: SHA_PATTERN.test(repositoryHead) ? repositoryHead : '',
    branch: safeBranch(parsed?.repository?.branch),
    dirty: parsed?.repository?.dirty === true,
    changedEntryCount: bounded(parsed?.repository?.changedEntryCount, 100_000),
    trackedChangeCount: bounded(parsed?.repository?.trackedChangeCount, 100_000),
    untrackedCount: bounded(parsed?.repository?.untrackedCount, 100_000),
    remoteMainAvailable: parsed?.repository?.remoteMainAvailable === true && SHA_PATTERN.test(remoteMainHead),
    remoteMainHead: SHA_PATTERN.test(remoteMainHead) ? remoteMainHead : '',
    rawPathsReturned: false,
  });

  const rawHeadSync = parsed?.headSync && typeof parsed.headSync === 'object' && !Array.isArray(parsed.headSync)
    ? parsed.headSync
    : {};
  const canonicalMainHead = text(rawHeadSync.canonicalMainHead || repository.remoteMainHead).toLowerCase();
  const headSyncRepositoryHead = text(rawHeadSync.repositoryHead || repository.head).toLowerCase();
  const headSyncRuntimeHead = text(rawHeadSync.runtimeHead || parsed?.core?.sourceHead).toLowerCase();
  const syncState = safeState(rawHeadSync.syncState || 'REMOTE_MAIN_UNKNOWN', 40);
  const headSyncTrafficLight = safeState(rawHeadSync.trafficLight || 'AMBER', 20);
  const exactNextAction = safeState(rawHeadSync.exactNextAction || 'REFRESH_REMOTE_MAIN_PROOF', 80);
  const admittedSyncStates = new Set([
    'CURRENT',
    'REMOTE_MAIN_UNKNOWN',
    'REPOSITORY_HEAD_UNKNOWN',
    'REPOSITORY_DRIFT',
    'RUNTIME_HEAD_UNKNOWN',
    'RUNTIME_DRIFT',
  ]);
  const admittedHeadActions = new Set([
    'NONE',
    'REFRESH_REMOTE_MAIN_PROOF',
    'REPAIR_REPOSITORY_VISIBILITY',
    'SYNC_REPOSITORY_TO_MAIN',
    'REPAIR_RUNTIME_HEAD_VISIBILITY',
    'RELOAD_RUNTIME_AT_REPOSITORY_HEAD',
  ]);
  const safeCanonicalMainHead = SHA_PATTERN.test(canonicalMainHead) ? canonicalMainHead : '';
  const safeHeadSyncRepositoryHead = SHA_PATTERN.test(headSyncRepositoryHead) ? headSyncRepositoryHead : '';
  const safeHeadSyncRuntimeHead = SHA_PATTERN.test(headSyncRuntimeHead) ? headSyncRuntimeHead : '';
  const projectedSyncState = admittedSyncStates.has(syncState) ? syncState : 'REMOTE_MAIN_UNKNOWN';
  const projectedHeadLight = ['GREEN', 'AMBER', 'RED'].includes(headSyncTrafficLight)
    ? headSyncTrafficLight
    : 'AMBER';
  const projectedHeadAction = admittedHeadActions.has(exactNextAction)
    ? exactNextAction
    : 'REFRESH_REMOTE_MAIN_PROOF';
  const headSync = Object.freeze({
    schemaVersion: 'stephanos.sovereign-head-sync.v1',
    canonicalMainHead: safeCanonicalMainHead,
    repositoryHead: safeHeadSyncRepositoryHead,
    runtimeHead: safeHeadSyncRuntimeHead,
    remoteMainAvailable: rawHeadSync.remoteMainAvailable === true && Boolean(safeCanonicalMainHead),
    repositoryMatchesMain: rawHeadSync.repositoryMatchesMain === true
      && Boolean(safeCanonicalMainHead)
      && safeHeadSyncRepositoryHead === safeCanonicalMainHead,
    runtimeMatchesRepository: rawHeadSync.runtimeMatchesRepository === true
      && Boolean(safeHeadSyncRuntimeHead)
      && safeHeadSyncRuntimeHead === safeHeadSyncRepositoryHead,
    runtimeMatchesMain: rawHeadSync.runtimeMatchesMain === true
      && Boolean(safeCanonicalMainHead)
      && safeHeadSyncRuntimeHead === safeCanonicalMainHead,
    exactHeadChainProven: rawHeadSync.exactHeadChainProven === true
      && projectedSyncState === 'CURRENT'
      && Boolean(safeCanonicalMainHead)
      && safeHeadSyncRepositoryHead === safeCanonicalMainHead
      && safeHeadSyncRuntimeHead === safeCanonicalMainHead,
    mainChangedSinceRepository: rawHeadSync.mainChangedSinceRepository === true,
    mainChangedSinceRuntime: rawHeadSync.mainChangedSinceRuntime === true,
    syncState: projectedSyncState,
    trafficLight: projectedHeadLight,
    exactNextAction: projectedHeadAction,
    readOnly: true,
    sourceMutationAllowed: false,
    unknownMeansGreen: false,
    finalVerdict: `SOVEREIGN_HEAD_SYNC_${projectedSyncState}`,
  });

  const observationEnvelope = {
    structuredContent: { stdout: JSON.stringify(parsed?.observation || {}) },
  };
  const observation = safeBattleBridgeObservationProjection(observationEnvelope, 'battle-bridge-observe');

  const controllerEnvelope = {
    structuredContent: {
      stdout: `SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=${JSON.stringify(parsed?.controllers || {})}`,
    },
  };
  const controllers = safeControllerLaneStatusProjection(controllerEnvelope, 'controller-lane-status');

  let meters = null;
  if (parsed?.meters
    && parsed.meters.schemaVersion === 'stephanos.sovereign-meter-status.v1'
    && parsed.meters.ok === true
    && parsed.meters.readOnly === true
    && parsed.meters.arbitraryShellAllowed === false
    && parsed.meters.secretMaterialIncluded === false
    && parsed.meters.unknownMeansGreen === false) {
    const meterId = (input) => {
      const candidate = text(input).toLowerCase().slice(0, 120);
      return /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(candidate) ? candidate : '';
    };
    const attentionMeters = Object.freeze((Array.isArray(parsed.meters.attentionMeters)
      ? parsed.meters.attentionMeters
      : [])
      .slice(0, 12)
      .flatMap((meter) => {
        const id = meterId(meter?.meterId);
        const provider = meterId(meter?.provider);
        const source = meterId(meter?.source);
        const observationState = safeState(meter?.observationState, 40);
        const trafficLight = safeState(meter?.trafficLight, 20);
        if (!id || !provider || !source
          || !['CURRENT', 'STALE', 'UNKNOWN'].includes(observationState)
          || !['GREEN', 'AMBER', 'RED', 'GREY'].includes(trafficLight)) return [];
        return [Object.freeze({
          meterId: id,
          provider,
          source,
          observationState,
          trafficLight,
          blocker: safeState(meter?.blocker, 120),
        })];
      }));
    const finalVerdict = safeState(parsed.meters.finalVerdict, 120);
    const capturedAtUtc = safeTime(parsed.meters.capturedAtUtc);
    const counts = Object.freeze({
      total: bounded(parsed?.meters?.counts?.total, 10_000),
      green: bounded(parsed?.meters?.counts?.green, 10_000),
      amber: bounded(parsed?.meters?.counts?.amber, 10_000),
      red: bounded(parsed?.meters?.counts?.red, 10_000),
      grey: bounded(parsed?.meters?.counts?.grey, 10_000),
    });
    if (capturedAtUtc
      && Object.values(counts).every((value) => value !== null)
      && ['SOVEREIGN_METER_STATUS_READY', 'SOVEREIGN_METER_STATUS_AMBER_PRESENT', 'SOVEREIGN_METER_STATUS_RED_PRESENT'].includes(finalVerdict)) {
      meters = Object.freeze({
        schemaVersion: 'stephanos.sovereign-meter-status.v1',
        ok: true,
        capturedAtUtc,
        counts,
        attentionMeters,
        attentionMetersTruncated: parsed.meters.attentionMetersTruncated === true,
        readOnly: true,
        arbitraryShellAllowed: false,
        secretMaterialIncluded: false,
        unknownMeansGreen: false,
        finalVerdict,
      });
    }
  }

  let core = Object.freeze({ available: false });
  if (parsed?.core?.available !== false) {
    const coreEnvelope = { structuredContent: { stdout: JSON.stringify(parsed?.core || {}) } };
    core = safeCoreDaemonStatusProjection(coreEnvelope);
  }

  const proofHashes = Object.freeze((Array.isArray(parsed?.selfHeal?.dependencySelfHealProofHashes)
    ? parsed.selfHeal.dependencySelfHealProofHashes
    : [])
    .map((item) => text(item).toLowerCase())
    .filter((item) => PROOF_HASH_PATTERN.test(item))
    .slice(0, 8));
  const octopusProofHash = text(parsed?.selfHeal?.octopusSelfHealLastProofHash).toLowerCase();
  const selfHeal = Object.freeze({
    available: parsed?.selfHeal?.available === true,
    dependencySelfHealEnabled: parsed?.selfHeal?.dependencySelfHealEnabled === true,
    dependencySelfHealLastAttemptAtUtc: safeTime(parsed?.selfHeal?.dependencySelfHealLastAttemptAtUtc),
    dependencySelfHealAttemptCount: bounded(parsed?.selfHeal?.dependencySelfHealAttemptCount),
    dependencySelfHealLastVerdict: safeState(parsed?.selfHeal?.dependencySelfHealLastVerdict),
    dependencySelfHealLastBlocker: safeState(parsed?.selfHeal?.dependencySelfHealLastBlocker),
    dependencySelfHealProofHashes: proofHashes,
    octopusSelfHealEnabled: parsed?.selfHeal?.octopusSelfHealEnabled === true,
    octopusSelfHealLastAttemptAtUtc: safeTime(parsed?.selfHeal?.octopusSelfHealLastAttemptAtUtc),
    octopusSelfHealAttemptCount: bounded(parsed?.selfHeal?.octopusSelfHealAttemptCount),
    octopusSelfHealLastVerdict: safeState(parsed?.selfHeal?.octopusSelfHealLastVerdict),
    octopusSelfHealLastBlocker: safeState(parsed?.selfHeal?.octopusSelfHealLastBlocker),
    octopusSelfHealLastProofHash: PROOF_HASH_PATTERN.test(octopusProofHash) ? octopusProofHash : '',
    flywheelCycleRunning: parsed?.selfHeal?.flywheelCycleRunning === true,
    flywheelLastCycleFinishedAtUtc: safeTime(parsed?.selfHeal?.flywheelLastCycleFinishedAtUtc),
    flywheelLastStatus: safeState(parsed?.selfHeal?.flywheelLastStatus, 120),
    flywheelLastAction: safeState(parsed?.selfHeal?.flywheelLastAction, 120),
    flywheelLastBlockerCount: bounded(parsed?.selfHeal?.flywheelLastBlockerCount),
  });

  const relay = Object.freeze({
    available: parsed?.relay?.available === true,
    daemonHealthy: parsed?.relay?.daemonHealthy === true,
    carrierHealthy: parsed?.relay?.carrierHealthy === true,
    deliveryState: safeState(parsed?.relay?.deliveryState, 80),
    adaptivePollMode: safeState(parsed?.relay?.adaptivePollMode, 40),
    nextPollMs: bounded(parsed?.relay?.nextPollMs, 60_000),
    heartbeatAtUtc: safeTime(parsed?.relay?.heartbeatAtUtc),
    heartbeatAgeSeconds: bounded(parsed?.relay?.heartbeatAgeSeconds, 31_536_000),
    carrierConsecutiveFailures: bounded(parsed?.relay?.carrierConsecutiveFailures),
    scheduledMailboxFallbackExpected: parsed?.relay?.scheduledMailboxFallbackExpected === true,
    fallbackCovered: parsed?.relay?.fallbackCovered === true,
    retryIdentityPreserved: parsed?.relay?.retryIdentityPreserved === true,
    blocker: safeState(parsed?.relay?.blocker),
    finalVerdict: safeState(parsed?.relay?.finalVerdict, 120),
  });

  const safeLight = (input) => {
    const candidate = safeState(input, 20);
    return ['GREEN', 'AMBER', 'RED', 'GREY'].includes(candidate) ? candidate : 'GREY';
  };
  const health = Object.freeze({
    repository: safeLight(parsed?.health?.repository),
    core: safeLight(parsed?.health?.core),
    headSync: safeLight(parsed?.health?.headSync || headSync.trafficLight),
    services: safeLight(parsed?.health?.services),
    laneRefill: safeLight(parsed?.health?.laneRefill),
    transport: safeLight(parsed?.health?.transport),
  });
  const capturedAtUtc = safeTime(parsed.capturedAtUtc);
  const finalVerdict = safeState(parsed.finalVerdict, 120);
  if (!capturedAtUtc
    || !observation
    || !controllers
    || !meters
    || ![
      'SOVEREIGN_VISIBILITY_SNAPSHOT_READY',
      'SOVEREIGN_VISIBILITY_SNAPSHOT_DEGRADED_OR_INCOMPLETE',
      'SOVEREIGN_VISIBILITY_SNAPSHOT_ATTENTION_REQUIRED',
    ].includes(finalVerdict)) return null;

  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-visibility-snapshot.v1',
    ok: true,
    capturedAtUtc,
    repository,
    observation,
    core,
    headSync,
    selfHeal,
    controllers,
    meters,
    relay,
    health,
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryProcessInspectionAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    remoteCommanderRequired: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

function safeCapabilityParityProjection(value = {}, processId = '') {
  if (processId !== 'reconcile-remote-commander-parity') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const prefix = 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(prefix.length)); } catch {}
  if (!parsed || parsed.ok !== true) return null;
  const bounded = (input) => {
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= 10000 ? number : null;
  };
  const retainedCapabilityCount = bounded(parsed.retainedCapabilityCount);
  const parityPresentCount = bounded(parsed.parityPresentCount);
  const buildableGapCount = bounded(parsed.buildableGapCount);
  const boundaryHoldCount = bounded(parsed.boundaryHoldCount);
  if ([retainedCapabilityCount, parityPresentCount, buildableGapCount, boundaryHoldCount].some((entry) => entry === null)) return null;
  const finalVerdict = text(parsed.finalVerdict);
  if (!['SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN', 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GAPS_TRACKED'].includes(finalVerdict)) return null;
  return Object.freeze({
    canonicalOwnerGoal: text(parsed.canonicalOwnerGoal) === '#2573' ? '#2573' : '',
    retainedCapabilityCount,
    parityPresentCount,
    buildableGapCount,
    boundaryHoldCount,
    zeroGapInvariantSatisfied: buildableGapCount === 0,
    closureRequired: buildableGapCount > 0,
    daemonMayReportGreen: buildableGapCount === 0,
    mustContinueUntilZero: true,
    finalVerdict,
  });
}

function safeStarfieldVrTelemetryArchiveProjection(value = {}, processId = '') {
  if (processId !== 'starfield-vr-telemetry-archive') return null;
  // The network completion envelope may contain an inner maintenance
  // execution envelope. The generic projector unwraps it, so archive parsing
  // must use that same trusted execution frame rather than the outer wrapper.
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value;
  const stdout = String(source?.structuredContent?.stdout || '');
  const marker = 'STARFIELD_VR_TELEMETRY_ARCHIVE_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed || parsed.schemaVersion !== 'stephanos.starfield-vr-telemetry-archive.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true || parsed.sourceMutationAllowed !== false
    || parsed.arbitraryShellAllowed !== false || parsed.rawTelemetryReturned !== false
    || parsed.hostPathsReturned !== false || parsed.secretMaterialReturned !== false
    || parsed.unknownMeansGreen !== false
    || !['STARFIELD_VR_TELEMETRY_ARCHIVE_READY', 'STARFIELD_VR_TELEMETRY_ARCHIVE_NO_SESSIONS'].includes(parsed.finalVerdict)) return null;
  const count = (value, max = 1_000_000_000) => (
    Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null
  );
  const metric = (value, max = 1_000_000) => (
    value === null || value === undefined ? null
      : Number.isFinite(value) && value >= 0 && value <= max ? value : null
  );
  const token = (value) => {
    const s = typeof value === 'string' ? value : '';
    return /^[A-Za-z0-9._:-]{1,120}$/.test(s) ? s : '';
  };
  const time = (value) => {
    if (typeof value !== 'string' || value.length > 60) return '';
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const totalSessions = count(parsed.totalSessions, 1_000_000);
  const offset = count(parsed.offset, 1_000_000);
  const limit = count(parsed.limit, 12);
  const nextOffset = parsed.nextOffset === null ? null : count(parsed.nextOffset, 1_000_000);
  if (!time(parsed.generatedAtUtc) || totalSessions === null
    || offset === null || limit === null || limit < 1
    || !Array.isArray(parsed.sessions) || parsed.sessions.length > limit
    || (parsed.hasMore === true && nextOffset === null)
    || (parsed.hasMore !== true && parsed.hasMore !== false)) return null;
  const sessions = parsed.sessions.map((item) => ({
    sessionId: token(item?.sessionId),
    endedAtUtc: time(item?.endedAtUtc),
    enteredAtUtc: time(item?.enteredAtUtc),
    provider: ['mutar-openxr', 'vorpx'].includes(item?.provider) ? item.provider : 'UNKNOWN',
    sourceHead: SHA_PATTERN.test(item?.sourceHead || '') ? item.sourceHead : '',
    launchSessionId: token(item?.launchSessionId),
    configurationFingerprintSha256: PROOF_HASH_PATTERN.test(item?.configurationFingerprintSha256 || '')
      ? item.configurationFingerprintSha256 : '',
    sessionOutcome: token(item?.sessionOutcome) || 'UNKNOWN',
    sampleCount: count(item?.sampleCount),
    partialTelemetry: item?.partialTelemetry === true,
    csvPresent: item?.csvPresent === true,
    summaryPresent: item?.summaryPresent === true,
    sessionReceiptPresent: item?.sessionReceiptPresent === true,
    avgApplicationFrameTimeMs: metric(item?.avgApplicationFrameTimeMs),
    p95ApplicationFrameTimeMs: metric(item?.p95ApplicationFrameTimeMs),
    p99ApplicationFrameTimeMs: metric(item?.p99ApplicationFrameTimeMs),
    avgDeliveredCadenceHz: metric(item?.avgDeliveredCadenceHz, 1000),
    headsetRefreshRateHz: metric(item?.headsetRefreshRateHz, 1000),
    maxEyePresentationSkewMs: metric(item?.maxEyePresentationSkewMs),
    maxPoseAgeMs: metric(item?.maxPoseAgeMs),
    avgGpuUtilPct: metric(item?.avgGpuUtilPct, 100),
    avgSystemCpuPct: metric(item?.avgSystemCpuPct, 100),
    maxLlamaServerCount: count(item?.maxLlamaServerCount, 10000),
    telemetryMissingCount: count(item?.telemetryMissingCount, 1000),
    crashEvidenceCount: count(item?.crashEvidenceCount, 1000),
  }));
  if (sessions.some((s) => !s.sessionId)
    || !token(parsed.newestSessionId) && totalSessions > 0) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.starfield-vr-telemetry-archive.v1',
    ok: true,
    generatedAtUtc: time(parsed.generatedAtUtc),
    directoryAvailable: parsed.directoryAvailable === true,
    totalSessions,
    newestSessionId: token(parsed.newestSessionId),
    offset, limit, nextOffset, hasMore: parsed.hasMore,
    sessions: Object.freeze(sessions),
    readOnly: true, sourceMutationAllowed: false,
    arbitraryShellAllowed: false, rawTelemetryReturned: false,
    hostPathsReturned: false, secretMaterialReturned: false,
    unknownMeansGreen: false, finalVerdict: parsed.finalVerdict,
  });
}

function safeStarfieldVrTelemetryProjection(value = {}, processId = '') {
  if (!['report-starfield-vr-telemetry', 'starfield-vr-telemetry-refresh'].includes(processId)) return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.starfield-vr-telemetry-headline.v1'
    || parsed.primaryTelemetryPublished !== true
    || parsed.rawTelemetryReturned !== false
    || parsed.hostPathsReturned !== false
    || parsed.secretMaterialReturned !== false) return null;

  const safeText = (input, max = 240) => {
    const candidate = text(input).replace(/[\r\n\t]/g, ' ').slice(0, max);
    return /^[\x20-\x7E]*$/.test(candidate) ? candidate : '';
  };
  const boundedCount = (input, max = 10_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const boundedMetric = (input, min = 0, max = 1_000_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isFinite(number) && number >= min && number <= max
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeTime = (input) => {
    const candidate = text(input);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const headline = parsed?.headline && typeof parsed.headline === 'object' && !Array.isArray(parsed.headline)
    ? parsed.headline
    : {};
  const sourceHead = safeText(headline.sourceHead, 40).toLowerCase();
  const signals = Object.freeze((Array.isArray(headline.signals) ? headline.signals : [])
    .map((item) => safeText(item, 120))
    .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(item))
    .slice(0, 32));
  const finalVerdict = safeText(parsed.finalVerdict, 120);
  const generatedAtUtc = safeTime(parsed.generatedAtUtc);
  if (!generatedAtUtc
    || !['STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED', 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED'].includes(finalVerdict)) return null;

  const publication = Object.freeze({
    packet: parsed?.publication?.packet === true,
    history: parsed?.publication?.history === true,
    loop: parsed?.publication?.loop === true,
    event: parsed?.publication?.event === true,
  });
  if (!publication.packet || !publication.history) return null;
  const degraded = finalVerdict === 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED';

  return Object.freeze({
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: parsed.ok === true,
    generatedAtUtc,
    finalVerdict,
    sessionId: safeText(parsed.sessionId, 160),
    headline: Object.freeze({
      focus: safeText(headline.focus, 120),
      provider: safeText(headline.provider, 80),
      providerIdentityStatus: safeText(headline.providerIdentityStatus, 80),
      launchSessionId: safeText(headline.launchSessionId, 160),
      sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : '',
      telemetrySessionId: safeText(headline.telemetrySessionId, 160),
      signals,
      sessionOutcome: safeText(headline.sessionOutcome, 80),
      partialTelemetry: headline.partialTelemetry === true,
      crashEvidenceCount: boundedCount(headline.crashEvidenceCount, 10_000),
      sampleCount: boundedCount(headline.sampleCount),
      avgGpuUtilPct: boundedMetric(headline.avgGpuUtilPct, 0, 100),
      maxGpuUtilPct: boundedMetric(headline.maxGpuUtilPct, 0, 100),
      maxGpuMemoryPct: boundedMetric(headline.maxGpuMemoryPct, 0, 100),
      avgStarfieldCpuPct: boundedMetric(headline.avgStarfieldCpuPct, 0, 100),
      avgSystemCpuPct: boundedMetric(headline.avgSystemCpuPct, 0, 100),
      maxLlamaServerCount: boundedCount(headline.maxLlamaServerCount, 1000),
      airLinkRuntimeSamplePct: boundedMetric(headline.airLinkRuntimeSamplePct, 0, 100),
      minGameDriveFreeGiB: boundedMetric(headline.minGameDriveFreeGiB, 0, 10_000_000),
      minGameDriveFreePct: boundedMetric(headline.minGameDriveFreePct, 0, 100),
      avgGameDriveActivePct: boundedMetric(headline.avgGameDriveActivePct, 0, 100),
      maxGameDriveLatencyMs: boundedMetric(headline.maxGameDriveLatencyMs, 0, 10_000_000),
      maxGameDriveQueueLength: boundedMetric(headline.maxGameDriveQueueLength, 0, 1_000_000),
      maxPagesPerSec: boundedMetric(headline.maxPagesPerSec, 0, 1_000_000_000),
      storageTelemetryAvailable: headline.storageTelemetryAvailable === true,
      topRecommendation: safeText(headline.topRecommendation, 240),
      topRecommendationSource: safeText(headline.topRecommendationSource, 160),
      projectLoopState: safeText(headline.projectLoopState, 120),
      projectTelemetryGapCount: boundedCount(headline.projectTelemetryGapCount, 10_000),
      projectNextExperiment: safeText(headline.projectNextExperiment, 240),
    }),
    history: Object.freeze({
      sessionCount: boundedCount(parsed?.history?.sessionCount, 1_000_000),
      newestSessionId: safeText(parsed?.history?.newestSessionId, 160),
    }),
    publication,
    degraded,
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: parsed.auxiliaryProjectionPublished === true,
    sharedWorkspacePublished: parsed.sharedWorkspacePublished === true,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  });
}

function safePreservationConvergenceProjection(value = {}, command = {}) {
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value;
  const processId = text(source?.command?.plan?.processId);
  const status = Number(source?.structuredContent?.status);
  const stdout = String(source?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_PRESERVATION_CONVERGENCE_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  let parsed = null;
  try { parsed = line ? JSON.parse(line.slice(marker.length)) : null; } catch {}
  const proofHash = text(parsed?.proofHash).toLowerCase();
  const proofCore = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? {
      schemaVersion: parsed.schemaVersion,
      timestampUtc: parsed.timestampUtc,
      canonicalOwnerGoal: parsed.canonicalOwnerGoal,
      relatedPr: parsed.relatedPr,
      branch: parsed.branch,
      oldHead: parsed.oldHead,
      protectedMainHead: parsed.protectedMainHead,
      newHead: parsed.newHead,
      changed: parsed.changed,
      pushed: parsed.pushed,
      diffCheckPassed: parsed.diffCheckPassed,
      oldHeadAncestorPreserved: parsed.oldHeadAncestorPreserved,
      mainAncestorPreserved: parsed.mainAncestorPreserved,
      exactHeadWriterGuard: parsed.exactHeadWriterGuard,
      nonForcePushOnly: parsed.nonForcePushOnly,
      mergeAuthority: parsed.mergeAuthority,
      directMainWriteAllowed: parsed.directMainWriteAllowed,
      forcePushAllowed: parsed.forcePushAllowed,
      rebaseAllowed: parsed.rebaseAllowed,
      resetAllowed: parsed.resetAllowed,
      leaseSeizureAllowed: parsed.leaseSeizureAllowed,
      finalVerdict: parsed.finalVerdict,
    }
    : null;
  const recomputedProofHash = proofCore
    ? createHash('sha256').update(JSON.stringify(proofCore)).digest('hex')
    : '';
  const oldHead = text(parsed?.oldHead).toLowerCase();
  const protectedMainHead = text(parsed?.protectedMainHead).toLowerCase();
  const newHead = text(parsed?.newHead).toLowerCase();
  const branch = text(parsed?.branch);
  const relatedPr = Number(parsed?.relatedPr);
  const valid = processId === 'preservation-converge-pr-branch'
    && Number.isInteger(status) && status === 0
    && parsed?.ok === true
    && parsed?.schemaVersion === 'stephanos.sovereign-preservation-convergence.v1'
    && parsed?.finalVerdict === 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE'
    && relatedPr === Number(command?.targetPrNumber)
    && branch === text(command?.targetBranch)
    && oldHead === text(command?.targetHead).toLowerCase()
    && protectedMainHead === text(command?.expectedHead).toLowerCase()
    && SHA_PATTERN.test(newHead)
    && PROOF_HASH_PATTERN.test(proofHash)
    && proofHash === recomputedProofHash
    && parsed?.changed === (newHead !== oldHead)
    && parsed?.pushed === parsed?.changed
    && parsed?.canonicalOwnerGoal === '#2573'
    && typeof parsed?.timestampUtc === 'string'
    && Number.isFinite(Date.parse(parsed.timestampUtc))
    && parsed?.diffCheckPassed === true
    && parsed?.oldHeadAncestorPreserved === true
    && parsed?.mainAncestorPreserved === true
    && parsed?.exactHeadWriterGuard === true
    && parsed?.nonForcePushOnly === true
    && parsed?.mergeAuthority === false
    && parsed?.directMainWriteAllowed === false
    && parsed?.forcePushAllowed === false
    && parsed?.rebaseAllowed === false
    && parsed?.resetAllowed === false
    && parsed?.leaseSeizureAllowed === false;
  if (!valid) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-preservation-convergence.v1',
    ok: true,
    relatedPr,
    branch,
    oldHead,
    protectedMainHead,
    newHead,
    changed: parsed?.changed === true,
    pushed: parsed?.pushed === true,
    proofHash,
    finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE',
    mergeAuthority: false,
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    leaseSeizureAllowed: false,
  });
}

function safeControllerActivityPublicationProjection(value = {}, processId = '') {
  if (processId !== 'publish-controller-activity') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_CONTROLLER_ACTIVITY_PUBLISH_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  const controllerId = text(parsed?.controllerId);
  const runId = text(parsed?.runId);
  const statusId = text(parsed?.statusId);
  const proofId = text(parsed?.proofId);
  const executionState = text(parsed?.executionState).toUpperCase();
  const materialLaneCount = Number(parsed?.materialLaneCount);
  const materialActionsSucceeded = Number(parsed?.materialActionsSucceeded);
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-controller-activity-publish.v1'
    || parsed.ok !== true
    || parsed.finalVerdict !== 'SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISHED'
    || !CANONICAL_CONTROLLER_IDS.has(controllerId)
    || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)
    || !/^controller-[A-Za-z0-9._-]+-activity$/.test(statusId)
    || !CONTROLLER_ACTIVITY_EXECUTION_STATES.has(executionState)
    || !Number.isSafeInteger(materialLaneCount) || materialLaneCount < 0 || materialLaneCount > 15
    || !Number.isSafeInteger(materialActionsSucceeded) || materialActionsSucceeded < 0 || materialActionsSucceeded > 100_000
    || parsed.arbitraryShellAllowed !== false
    || parsed.sourceMutationAllowed !== false
    || parsed.mergeAuthority !== false
    || parsed.secretMaterialIncluded !== false) return null;
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    ok: true,
    controllerId,
    runId,
    statusWritten: parsed.statusWritten === true,
    proofWritten: parsed.proofWritten === true,
    statusId,
    proofId: /^[A-Za-z0-9._-]{0,160}$/.test(proofId) ? proofId : '',
    executionState,
    materialLaneCount,
    materialActionsSucceeded,
    finalVerdict: parsed.finalVerdict,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
  });
}

function safeMaintenanceProjection(value = {}) {
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value;
  const proofHash = text(source?.proofHash).toLowerCase();
  const processId = text(source?.command?.plan?.processId);
  const status = Number(source?.structuredContent?.status);
  const errorCode = text(source?.structuredContent?.errorCode);
  return Object.freeze({
    ok: source?.ok === true,
    finalVerdict: text(source?.finalVerdict),
    proofHash: PROOF_HASH_PATTERN.test(proofHash) ? proofHash : '',
    processId: /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(processId) ? processId : '',
    status: Number.isInteger(status) ? status : null,
    errorCode: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(errorCode) ? errorCode : '',
    runtimeProof: safeRuntimeProofProjection(source, processId),
    aiCommanderAcceptance: safeAiCommanderAcceptanceProjection(source, processId),
    observation: safeBattleBridgeObservationProjection(source, processId),
    meterStatus: safeMeterStatusProjection(source, processId),
    controllerLaneStatus: safeControllerLaneStatusProjection(source, processId),
    controllerActivityPublication: safeControllerActivityPublicationProjection(source, processId),
    capabilityParity: safeCapabilityParityProjection(source, processId),
    starfieldVrTelemetry: safeStarfieldVrTelemetryProjection(source, processId),
  });
}

const FLEET_MAINTENANCE_OWNER_BLOCKERS = new Set([
  SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER,
  'SOVEREIGN_MAINTENANCE_OWNER_BUSY',
  'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE',
]);

function safeFleetMaintenanceFailureProjection(value = {}, expectedAction = '') {
  if (expectedAction !== FLEET_SUPERVISOR_ACTION) return null;
  let source = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    // Wrappers may nest, but another command cannot lend its child's identity.
    if (Object.hasOwn(source, 'command')) break;
    source = depth < 4 ? source.structuredContent : null;
  }
  const command = source?.command;
  if (source?.ok !== false || command?.dispatchAllowed !== true
    || command.operation !== 'MAINTENANCE_ACTION'
    || command.plan?.kind !== 'fixed-process'
    || command.plan.processId !== expectedAction) return null;
  const execution = source.structuredContent;
  let errorCode = '';
  let executionBlocker;
  if (source.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED') {
    if (!FLEET_MAINTENANCE_OWNER_BLOCKERS.has(source.blocker)) return null;
    // A pre-launch owner denial has no execution output. A post-execution
    // custody hold is distinct: it must carry the canonical negative evidence,
    // and never supplies a successful fleet terminal receipt or custody release.
    if (Object.hasOwn(source, 'structuredContent')) {
      if (source.blocker !== SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER
        || !execution || typeof execution !== 'object' || Array.isArray(execution)
        || typeof execution.ok !== 'boolean'
        || !(execution.status === null || Number.isInteger(execution.status))
        || typeof execution.signal !== 'string' || typeof execution.errorCode !== 'string'
        || execution.ok !== (execution.status === 0 && !execution.signal && !execution.errorCode)
        || typeof execution.stdout !== 'string' || typeof execution.stderr !== 'string'
        || !sovereignMaintenanceCustodyUnprovenV1(execution,
          readSovereignMaintenanceTerminalReceiptV1(execution.stdout, expectedAction), expectedAction)) return null;
      if (['ETIMEDOUT', 'ABORT_ERR'].includes(execution.errorCode)) errorCode = execution.errorCode;
    } else if (Object.hasOwn(source, 'status')) return null;
    executionBlocker = source.blocker;
  } else if (source.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED') {
    if (!execution || execution.ok !== false || execution.status !== null
      || !['ETIMEDOUT', 'ABORT_ERR'].includes(execution.errorCode)
      || typeof execution.stdout !== 'string' || typeof execution.stderr !== 'string') return null;
    errorCode = execution.errorCode;
    executionBlocker = SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER;
  } else return null;
  return Object.freeze({ processId: expectedAction, status: null, errorCode, executionBlocker });
}

function safeFleetSupervisorExecutionProjection(value = {}) {
  const source = findMaintenanceExecutionEnvelope(value);
  const execution = source?.structuredContent;
  if (source?.command?.plan?.processId !== FLEET_SUPERVISOR_ACTION
    || !execution || ![0, 2].includes(execution.status)
    || execution.ok !== (execution.status === 0)
    || (execution.signal !== undefined && execution.signal !== '')
    || (execution.errorCode !== undefined && execution.errorCode !== '')
    || source.ok !== (execution.status === 0)
    || source.finalVerdict !== (source.ok
      ? 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' : 'SOVEREIGN_COMMANDER_EXECUTION_FAILED')
    || (source.ok && !PROOF_HASH_PATTERN.test(text(source.proofHash)))) return null;
  const receipt = readSovereignMaintenanceTerminalReceiptV1(execution.stdout, FLEET_SUPERVISOR_ACTION);
  if (sovereignMaintenanceCustodyUnprovenV1(execution, receipt, FLEET_SUPERVISOR_ACTION)) return null;
  return projectFleetSupervisorReceiptV1(receipt, execution.status);
}

function findMaintenanceExecutionEnvelope(value = {}) {
  let candidate = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const processId = text(candidate?.command?.plan?.processId);
    const status = Number(candidate?.structuredContent?.status);
    if (processId && Number.isInteger(status)) return candidate;
    candidate = candidate.structuredContent;
  }
  return {};
}

function findFailedMaintenanceExecutionEnvelope(value = {}) {
  let candidate = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const processId = text(candidate?.command?.plan?.processId);
    const rawStatus = candidate?.structuredContent?.status;
    const status = Number.isInteger(rawStatus) ? rawStatus : null;
    const errorCode = text(candidate?.structuredContent?.errorCode);
    const hasBoundedOutput = typeof candidate?.structuredContent?.stdout === 'string'
      || typeof candidate?.structuredContent?.stderr === 'string';
    const failedByExit = Number.isInteger(status) && status !== 0;
    const failedByRunner = status === null && Boolean(errorCode);
    if (
      candidate?.ok === false
      && candidate?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
      && processId
      && (failedByExit || failedByRunner)
      && hasBoundedOutput
    ) {
      return candidate;
    }
    candidate = candidate.structuredContent;
  }
  return {};
}

function safeMaintenanceFailureProjection(value = {}, expectedAction = '') {
  const source = findFailedMaintenanceExecutionEnvelope(value);
  if (!source || Object.keys(source).length === 0) return null;
  const processId = text(source?.command?.plan?.processId);
  const rawStatus = source?.structuredContent?.status;
  const status = Number.isInteger(rawStatus) ? rawStatus : null;
  const errorCode = text(source?.structuredContent?.errorCode);
  let executionBlocker = text(source?.blocker);
  if (processId === 'publish-controller-activity') {
    const stdout = String(source?.structuredContent?.stdout || '');
    const marker = 'SOVEREIGN_COMMANDER_CONTROLLER_ACTIVITY_PUBLISH_RESULT=';
    const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
    let parsed = null;
    try { parsed = line ? JSON.parse(line.slice(marker.length)) : null; } catch {}
    const innerBlocker = text(parsed?.blocker);
    if (innerBlocker) executionBlocker = innerBlocker;
  }
  const safeToken = (candidate, max = 160) => (
    candidate.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate) ? candidate : ''
  );
  const safeErrorCode = safeToken(errorCode);
  const safeExecutionBlocker = safeToken(executionBlocker);
  const failedByExit = Number.isInteger(status) && status !== 0;
  const failedByRunner = status === null && Boolean(safeErrorCode || safeExecutionBlocker);
  if (
    source?.ok !== false
    || source?.finalVerdict !== 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
    || processId !== text(expectedAction)
    || (!failedByExit && !failedByRunner)
  ) return null;
  return Object.freeze({
    processId,
    status,
    errorCode: safeErrorCode,
    executionBlocker: safeExecutionBlocker,
  });
}

function safeStarfieldVrResourcePreflightProjection(value = {}) {
  const failureEnvelope = findFailedMaintenanceExecutionEnvelope(value);
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(failureEnvelope).length > 0
    ? failureEnvelope
    : (Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value);
  const structured = source?.structuredContent && typeof source.structuredContent === 'object'
    ? source.structuredContent
    : {};
  const status = Number(structured?.status);
  const stdout = String(structured?.stdout || '').trim();
  const stderr = String(structured?.stderr || '').trim();
  let parsed = null;
  try { parsed = stdout ? JSON.parse(stdout) : null; } catch {}

  const safeModels = (items) => Object.freeze(
    (Array.isArray(items) ? items : [])
      .map((item) => text(item))
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item))
      .slice(0, 32),
  );
  const safeDiagnostic = (value) => String(value || '')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gi, '%USERPROFILE%')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 480);

  if (!parsed || parsed.schemaVersion !== 'stephanos.vr-resource-governor.v1') {
    if (!Number.isInteger(status) || status === 0) return null;
    const diagnostic = safeDiagnostic(stderr || stdout);
    return Object.freeze({
      ok: false,
      finalVerdict: 'STARFIELD_VR_RESOURCE_PREFLIGHT_FAILED',
      blocker: /\bThe property\b/i.test(diagnostic)
        ? 'STARFIELD_VR_RESOURCE_PREFLIGHT_STRICTMODE_PROPERTY'
        : 'STARFIELD_VR_RESOURCE_PREFLIGHT_EXECUTION_FAILED',
      status,
      phase: '',
      active: false,
      reason: '',
      profileName: '',
      profileProcessName: '',
      parkAllModels: false,
      localModelAllowed: null,
      zeroLocalModelInvariant: false,
      evictionHealthy: false,
      loadedModelsBefore: Object.freeze([]),
      loadedModelsAfter: Object.freeze([]),
      reappearanceDetected: false,
      reappearanceCount: 0,
      diagnostic,
    });
  }

  const profile = parsed.profile && typeof parsed.profile === 'object' && !Array.isArray(parsed.profile)
    ? parsed.profile
    : {};
  const phase = text(parsed.phase);
  const loadedModelsAfter = safeModels(parsed.loadedModelsAfter);
  const invariantsGreen = parsed.active === true
    && profile.parkAllModels === true
    && parsed.localModelAllowed === false
    && parsed.zeroLocalModelInvariant === true
    && parsed.evictionHealthy === true
    && loadedModelsAfter.length === 0;
  const ok = Number.isInteger(status) && status === 0 && invariantsGreen;
  return Object.freeze({
    ok,
    finalVerdict: ok
      ? 'STARFIELD_VR_RESOURCE_PREFLIGHT_PASSED'
      : 'STARFIELD_VR_RESOURCE_PREFLIGHT_FAILED',
    blocker: ok ? '' : 'STARFIELD_VR_RESOURCE_PREFLIGHT_INVARIANT_FAILED',
    status: Number.isInteger(status) ? status : null,
    phase,
    active: parsed.active === true,
    reason: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text(parsed.reason)) ? text(parsed.reason) : '',
    profileName: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text(profile.name)) ? text(profile.name) : '',
    profileProcessName: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text(profile.processName)) ? text(profile.processName) : '',
    parkAllModels: profile.parkAllModels === true,
    localModelAllowed: typeof parsed.localModelAllowed === 'boolean' ? parsed.localModelAllowed : null,
    zeroLocalModelInvariant: parsed.zeroLocalModelInvariant === true,
    evictionHealthy: parsed.evictionHealthy === true,
    loadedModelsBefore: safeModels(parsed.loadedModelsBefore),
    loadedModelsAfter,
    reappearanceDetected: parsed.reappearanceDetected === true,
    reappearanceCount: Number.isInteger(Number(parsed.reappearanceCount)) ? Number(parsed.reappearanceCount) : 0,
    diagnostic: '',
  });
}

function safeVrVirtualAirLinkAcceptanceProjection(value = {}) {
  const failureEnvelope = findFailedMaintenanceExecutionEnvelope(value);
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(failureEnvelope).length > 0
    ? failureEnvelope
    : (Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value);
  const raw = text(source?.structuredContent?.stdout);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || parsed.schemaVersion !== 'stephanos.vr-virtual-airlink-acceptance.v1') return null;
  const safeModels = (items) => Object.freeze(
    (Array.isArray(items) ? items : [])
      .map((item) => text(item))
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item))
      .slice(0, 32),
  );
  const safeGpu = (gpu) => {
    if (!gpu || typeof gpu !== 'object' || Array.isArray(gpu)) return null;
    const integerOrNull = (value) => Number.isInteger(Number(value)) ? Number(value) : null;
    return Object.freeze({
      available: gpu.available === true,
      memoryUsedMiB: integerOrNull(gpu.memoryUsedMiB),
      memoryTotalMiB: integerOrNull(gpu.memoryTotalMiB),
      utilizationGpuPercent: integerOrNull(gpu.utilizationGpuPercent),
    });
  };
  const blocker = text(parsed.blocker);
  const finalVerdict = text(parsed.finalVerdict);
  if (!['SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED', 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED'].includes(finalVerdict)) return null;
  if (blocker && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(blocker)) return null;
  return Object.freeze({
    ok: parsed.ok === true,
    finalVerdict,
    blocker,
    virtualAirLinkTestUsed: parsed.virtualAirLinkTestUsed === true,
    virtualAirLinkRestoredOff: parsed.virtualAirLinkRestoredOff === true,
    launchAllowed: parsed.launchAllowed === true,
    realHeadsetProofClaimed: parsed.realHeadsetProofClaimed === true,
    governorWatchStarted: parsed.governorWatchStarted === true,
    governorWatchProcessCount: Number.isInteger(Number(parsed.governorWatchProcessCount)) ? Number(parsed.governorWatchProcessCount) : 0,
    lightweightModel: text(parsed.lightweightModel),
    loadedModelsBefore: safeModels(parsed.loadedModelsBefore),
    heavyModelsBefore: safeModels(parsed.heavyModelsBefore),
    heavyModelSamplesDuringGuard: safeModels(parsed.heavyModelSamplesDuringGuard),
    loadedModelsAfterGuard: safeModels(parsed.loadedModelsAfterGuard),
    heavyModelsAfterGuard: safeModels(parsed.heavyModelsAfterGuard),
    gpuBefore: safeGpu(parsed.gpuBefore),
    gpuAfter: safeGpu(parsed.gpuAfter),
    vramReleasedMiB: Number.isInteger(Number(parsed.vramReleasedMiB)) ? Number(parsed.vramReleasedMiB) : null,
    observationSeconds: Number.isInteger(Number(parsed.observationSeconds)) ? Number(parsed.observationSeconds) : 0,
  });
}

function safeCoreDaemonStatusProjection(value = {}) {
  const raw = text(value?.structuredContent?.stdout);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || parsed?.schemaVersion !== 'stephanos.core-daemon-status.v1') {
    return Object.freeze({ available: false });
  }
  const sourceHead = text(parsed.sourceHead).toLowerCase();
  const heartbeatAgeSeconds = Number(parsed.heartbeatAgeSeconds);
  return Object.freeze({
    available: true,
    ok: parsed.ok === true && parsed.processInventoryComplete === true && parsed.processCount === 1,
    processCount: parsed.processInventoryComplete === true
      && Number.isSafeInteger(parsed.processCount) && parsed.processCount >= 0 && parsed.processCount <= 100
      ? parsed.processCount
      : null,
    processInventoryComplete: parsed.processInventoryComplete === true,
    processObservationBlocker: /^[A-Z0-9_:-]{0,120}$/.test(text(parsed.processObservationBlocker))
      ? text(parsed.processObservationBlocker) : '',
    daemonHealthy: parsed.daemonHealthy === true,
    reportedDaemonHealthy: parsed.reportedDaemonHealthy === true,
    // Public projection contains only bounded custody verdicts, never PIDs,
    // paths or raw command lines. Absent fields remain unproven.
    singleWriterProven: parsed.singleWriterProven === true,
    writerProcessObserved: parsed.writerProcessObserved === true,
    lockOwnerMatchesWriter: parsed.lockOwnerMatchesWriter === true,
    rescueGenerationPresent: parsed.rescueGenerationPresent === true,
    rescueAttemptCount: Number.isSafeInteger(parsed.rescueAttemptCount)
      && parsed.rescueAttemptCount >= 0 && parsed.rescueAttemptCount <= 1_000_000
      ? parsed.rescueAttemptCount : null,
    readiness: /^[A-Z_]{1,40}$/.test(text(parsed.readiness)) ? text(parsed.readiness) : 'UNKNOWN',
    wakeState: /^[A-Z_]{1,40}$/.test(text(parsed.wakeState)) ? text(parsed.wakeState) : 'UNKNOWN',
    awake: parsed.awake === true,
    repairRequired: parsed.repairRequired === true,
    repairReason: /^[A-Z0-9_:-]{0,160}$/.test(text(parsed.repairReason)) ? text(parsed.repairReason) : '',
    controlPlaneFinalVerdict: /^[A-Z0-9_:-]{0,160}$/.test(text(parsed.controlPlaneFinalVerdict))
      ? text(parsed.controlPlaneFinalVerdict)
      : '',
    sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : '',
    heartbeatAgeSeconds: Number.isFinite(heartbeatAgeSeconds) && heartbeatAgeSeconds >= 0 ? heartbeatAgeSeconds : null,
    heartbeatFresh: parsed.heartbeatFresh === true || (Number.isFinite(heartbeatAgeSeconds) && heartbeatAgeSeconds >= 0 && heartbeatAgeSeconds <= 60),
    busyGraceActive: parsed.busyGraceActive === true,
    flywheelCycleAgeSeconds: Number.isFinite(Number(parsed.flywheelCycleAgeSeconds)) && Number(parsed.flywheelCycleAgeSeconds) >= 0
      ? Number(parsed.flywheelCycleAgeSeconds)
      : null,
    sovereignCommanderHealthy: parsed.sovereignCommanderHealthy === true,
    backendHealthy: parsed.backendHealthy === true,
    missionWorkerHealthy: parsed.missionWorkerHealthy === true,
    gamingActive: parsed.gamingActive === true,
    uiRequired: false,
    sourceMutationAllowed: false,
    schedulerAuthority: false,
    mergeAuthority: false,
    vendorMeterRequired: false,
    remoteCommanderRequired: false,
  });
}

function safeProjectSearchProjection(value = {}, query = '') {
  const results = Array.isArray(value?.results) ? value.results : [];
  const safeResults = results.slice(0, 30).flatMap((entry) => {
    const relativePath = text(entry?.relativePath).replaceAll('\\', '/');
    const line = Number(entry?.line);
    const column = Number(entry?.column);
    if (!relativePath
      || relativePath.startsWith('/')
      || relativePath.includes('..')
      || /^[A-Za-z]:/.test(relativePath)
      || relativePath.length > 240
      || !Number.isSafeInteger(line) || line < 1
      || !Number.isSafeInteger(column) || column < 1) return [];
    return [Object.freeze({ relativePath, line, column })];
  });
  return Object.freeze({
    queryHash: createHash('sha256').update(String(query)).digest('hex'),
    resultCount: safeResults.length,
    truncated: value?.truncated === true || results.length > safeResults.length,
    results: Object.freeze(safeResults),
  });
}

function isBoundedCommanderConfig(config = {}) {
  return config?.implementation === 'stephanos-local-node'
    && config?.vendorMeterRequired === false
    && config?.externalSaasRelayRequired === false
    && config?.sourceControlledMaintenanceOnly === true
    && config?.arbitraryUnboundedCommandAllowed === false
    && config?.mergeAuthority === false
    && config?.pcRestartAuthority === false
    && config?.canRunFocusedNodeTests === false;
}

export function validateSovereignCommanderRemoteCommandShape(command = {}) {
  if (text(command?.operation) !== SOVEREIGN_COMMANDER_REMOTE_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  const remoteAction = text(command?.remoteAction);
  const remotePlanFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'remotePlan');
  const remotePlanSupplied = Array.isArray(command?.remotePlan);
  if (remotePlanFieldPresent && !remotePlanSupplied) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID', { requested: true });
  }
  if (remoteAction && remotePlanFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT', { requested: true });
  }
  const telemetryPageFieldsPresent = ['telemetryOffset', 'telemetryLimit']
    .some((field) => Object.prototype.hasOwnProperty.call(command || {}, field));
  if (telemetryPageFieldsPresent && (remoteAction !== 'starfield-vr-telemetry-archive' || remotePlanFieldPresent)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_TELEMETRY_PAGE_FIELDS_NOT_ALLOWED', { requested: true });
  }
  if (remotePlanSupplied) {
    const remotePlan = command.remotePlan.map((value) => text(value));
    if (remotePlan.length < 1 || remotePlan.length > SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID', {
        requested: true,
        stepCount: remotePlan.length,
      });
    }
    const invalidAction = remotePlan.find((actionId) => (
      actionId === 'status'
      || actionId === 'sovereign-windows-reviewer-calibration'
      || actionId === 'search-project'
      || actionId === 'battle-bridge-observe'
      || actionId === 'original-source-custody-census'
      || actionId === 'original-r7-witness-readiness'
      || actionId === 'meter-status'
      || actionId === 'controller-lane-status'
      || actionId === 'cpu-pressure-snapshot'
      || actionId === 'publish-controller-activity'
      || actionId === CANONICAL_GIT_WORKTREE_CONFIG_INSPECT_ACTION
      || actionId === CANONICAL_GIT_WORKTREE_CONFIG_ACTION
      || actionId === 'preservation-converge-pr-branch'
      || !SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(actionId)
    ));
    if (invalidAction) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED', {
        requested: true,
        remoteAction: invalidAction,
      });
    }
    if (new Set(remotePlan).size !== remotePlan.length) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction: '',
        remotePlan: Object.freeze(remotePlan),
      }),
    });
  }
  if (!SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(remoteAction)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', {
      requested: true,
      remoteAction,
    });
  }
  // Only the fixed reviewed calibration may accept per-review identity.
  // The outer authenticated mailbox HEAD and repository must agree; a
  // caller-supplied identity cannot create high-risk reviewer authority.
  if (remoteAction === 'sovereign-windows-reviewer-calibration'
    || Object.hasOwn(command, 'reviewIdentity')) {
    if (remoteAction !== 'sovereign-windows-reviewer-calibration') {
      return fail('SOVEREIGN_WINDOWS_CALIBRATION_IDENTITY_ACTION_MISMATCH', { requested: true });
    }
    const identity = validateSovereignWindowsReviewIdentityV1(command.reviewIdentity);
    if (!identity || identity.sourceHead !== expectedHead
      || identity.repository !== text(command.repository)
      || identity.branch !== text(command.branch)) {
      return fail('SOVEREIGN_WINDOWS_CALIBRATION_IDENTITY_UNBOUND', { requested: true });
    }
    return Object.freeze({
      ok: true, requested: true, expectedHead,
      command: Object.freeze({ ...command, expectedHead, remoteAction,
        reviewIdentity: identity }),
    });
  }
  if (remoteAction === 'starfield-vr-telemetry-archive') {
    const exclusiveFields = [
      'searchQuery', 'searchMaxResults', 'controllerActivity',
      'targetPrNumber', 'targetBranch', 'targetHead',
    ];
    if (exclusiveFields.some((field) => Object.prototype.hasOwnProperty.call(command, field))) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_TELEMETRY_PAGE_FIELDS_NOT_ALLOWED', { requested: true });
    }
    const telemetryOffset = command.telemetryOffset ?? 0;
    const telemetryLimit = command.telemetryLimit ?? 4;
    if (!Number.isSafeInteger(telemetryOffset) || telemetryOffset < 0 || telemetryOffset > 1_000_000
      || !Number.isSafeInteger(telemetryLimit) || telemetryLimit < 1 || telemetryLimit > 4) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_TELEMETRY_PAGE_INVALID', { requested: true });
    }
    return Object.freeze({
      ok: true, requested: true, expectedHead,
      command: Object.freeze({ ...command, expectedHead, remoteAction, telemetryOffset, telemetryLimit }),
    });
  }
  const searchFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'searchQuery')
    || Object.prototype.hasOwnProperty.call(command || {}, 'searchMaxResults');
  if (remoteAction === 'search-project') {
    const searchQuery = text(command?.searchQuery);
    const searchMaxResults = Number(command?.searchMaxResults ?? 20);
    if (!REMOTE_SEARCH_QUERY.test(searchQuery)) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID', { requested: true });
    }
    if (!Number.isSafeInteger(searchMaxResults) || searchMaxResults < 1 || searchMaxResults > 30) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_LIMIT_INVALID', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({ ...command, expectedHead, remoteAction, searchQuery, searchMaxResults }),
    });
  }
  if (searchFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED', { requested: true });
  }
  const controllerActivityFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'controllerActivity');
  const controllerActivityConflictingFields = ['targetPrNumber', 'targetBranch', 'targetHead']
    .some((field) => Object.prototype.hasOwnProperty.call(command || {}, field));
  if (remoteAction === 'publish-controller-activity') {
    if (controllerActivityConflictingFields) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED', { requested: true });
    }
    const validatedActivity = validateRemoteControllerActivity(command?.controllerActivity);
    if (!validatedActivity.ok) return validatedActivity;
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction,
        controllerActivity: validatedActivity.controllerActivity,
      }),
    });
  }
  if (controllerActivityFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED', { requested: true });
  }

  const convergenceFieldPresent = ['targetPrNumber', 'targetBranch', 'targetHead']
    .some((field) => Object.prototype.hasOwnProperty.call(command || {}, field));
  if (remoteAction === 'preservation-converge-pr-branch') {
    const targetPrNumber = Number(command?.targetPrNumber);
    const targetBranch = text(command?.targetBranch);
    const targetHead = text(command?.targetHead).toLowerCase();
    const branchSafe = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(targetBranch)
      && !targetBranch.includes('..')
      && !targetBranch.includes('//')
      && !targetBranch.endsWith('/')
      && !targetBranch.startsWith('refs/')
      && !['main', 'master'].includes(targetBranch.toLowerCase());
    if (!Number.isSafeInteger(targetPrNumber) || targetPrNumber < 1 || targetPrNumber > 999999999) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_TARGET_PR_INVALID', { requested: true });
    }
    if (!branchSafe) return fail('SOVEREIGN_COMMANDER_REMOTE_TARGET_BRANCH_INVALID', { requested: true });
    if (!SHA_PATTERN.test(targetHead) || targetHead === expectedHead) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_TARGET_HEAD_INVALID', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction,
        targetPrNumber,
        targetBranch,
        targetHead,
      }),
    });
  }
  if (convergenceFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONVERGENCE_FIELDS_NOT_ALLOWED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({ ...command, expectedHead, remoteAction }),
  });
}

export function isTerminalizableSovereignCommanderRemoteBlocker(value) {
  return new Set([
    'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_EXPECTED_HEAD_REQUIRED',
    'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_LIMIT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_TELEMETRY_PAGE_FIELDS_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_TELEMETRY_PAGE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_TOO_LARGE',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_SCHEMA_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_CONTROLLER_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_RUN_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ENABLEMENT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_STATE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ARRAY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_TARGET_PR_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_TARGET_BRANCH_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_TARGET_HEAD_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONVERGENCE_FIELDS_NOT_ALLOWED',
  ]).has(text(value));
}

/**
 * #3109: constant-vocabulary native Island diagnostic. It examines only the
 * fixed process identity, exit status and closed-world marker shape, and NEVER
 * publishes stdout, stderr, process arguments, paths, environment or tokens.
 * It grants no source mutation authority, even when the marker is positive.
 */
export function diagnoseRescueIslandNativeReceiptInvalidV1({
  envelope, expectedAction, projection, positive, negative,
  rawMaintenance, mcpError = false,
} = {}) {
  if (expectedAction !== 'rescue-island-readonly-boundary')
    return 'ISLAND_NATIVE_ACTION_NOT_ALLOWED';
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).length === 0) {
    // Classify only fixed native Commander runner denials. Raw process,
    // path, task identity and untrusted exception data remain private.
    let observation = rawMaintenance;
    for (let depth = 0; depth < 5; depth += 1) {
      if (!observation || typeof observation !== 'object'
        || Array.isArray(observation)) break;
      if (observation.ok === false
        && observation.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED') {
        const known = observation.command?.blockers;
        if (Array.isArray(known) && known.every(item => typeof item === 'string')) {
          if (known.includes('trusted-repository-root-required'))
            return 'ISLAND_NATIVE_TRUSTED_REPOSITORY_ROOT_UNAVAILABLE';
          if (known.includes('sovereign-commander-process-not-registered'))
            return 'ISLAND_NATIVE_FIXED_ACTION_NOT_REGISTERED';
        }
        return 'ISLAND_NATIVE_COMMAND_BLOCKED_BEFORE_RUN';
      }
      if (observation.ok === false
        && observation.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
        && observation.command?.plan?.processId === expectedAction
        && !Number.isInteger(observation.structuredContent?.status)) {
        return 'ISLAND_NATIVE_RUNNER_FAILED_WITHOUT_EXIT_STATUS';
      }
      observation = observation.structuredContent;
    }
    return mcpError === true
      ? 'ISLAND_NATIVE_MCP_REJECTED_OR_UNAVAILABLE'
      : 'ISLAND_NATIVE_ENVELOPE_NOT_OBSERVED';
  }
  if (envelope?.command?.plan?.processId !== expectedAction)
    return 'ISLAND_NATIVE_PROCESS_BINDING_INVALID';
  const status = envelope?.structuredContent?.status;
  if (!Number.isInteger(status)) return 'ISLAND_NATIVE_EXIT_STATUS_UNAVAILABLE';
  const stdout = envelope?.structuredContent?.stdout;
  if (typeof stdout !== 'string') return 'ISLAND_NATIVE_STDOUT_UNAVAILABLE';
  if (Buffer.byteLength(stdout, 'utf8') > 4096)
    return 'ISLAND_NATIVE_STDOUT_TOO_LARGE';
  const lines = stdout.trimEnd().split(/\r?\n/);
  if (lines.length !== 1) return 'ISLAND_NATIVE_STDOUT_LINES_INVALID';
  if (!lines[0].startsWith('RESCUE_ISLAND_BOUNDARY_PROBE_RESULT='))
    return 'ISLAND_NATIVE_MARKER_NOT_OBSERVED';
  if (!positive && !negative) return 'ISLAND_NATIVE_MARKER_REJECTED';
  if (negative) return 'ISLAND_NATIVE_DENIAL_ENVELOPE_INVALID';
  if (positive && status !== 0) return 'ISLAND_NATIVE_POSITIVE_EXIT_MISMATCH';
  if (positive && (projection?.ok !== true
      || projection?.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !PROOF_HASH_PATTERN.test(projection?.proofHash || '')
      || projection?.processId !== expectedAction
      || projection?.status !== 0))
    return 'ISLAND_NATIVE_SUCCESS_ENVELOPE_INVALID';
  return 'ISLAND_NATIVE_BOUNDARY_INCONSISTENT';
}


const CANONICAL_GIT_WORKTREE_CONFIG_INSPECT_ACTION = 'inspect-canonical-git-worktree-config';
const CANONICAL_GIT_WORKTREE_CONFIG_ACTION = 'repair-canonical-git-worktree-config';

// A registration namespace is not a registration. Inspect at most one entry
// under the already-authenticated canonical .git directory; never resolve or
// expose linked paths, delete metadata, or infer writer/lease ownership.
export function inspectCanonicalLinkedWorktreeMetadataV1(repositoryRoot, {
  lstatFn = lstatSync,
  openDirectoryFn = opendirSync,
} = {}) {
  const metadataPath = resolve(repositoryRoot, '.git', 'worktrees');
  const result = state => Object.freeze({ state,
    linkedWorktreesExcluded: state === 'ABSENT' || state === 'EMPTY' });
  let before;
  try { before = lstatFn(metadataPath); }
  catch (error) { return result(error?.code === 'ENOENT' ? 'ABSENT' : 'UNPROVEN'); }
  if (!before.isDirectory() || before.isSymbolicLink()) return result('UNPROVEN');
  let directory;
  try {
    directory = openDirectoryFn(metadataPath);
    if (directory.readSync() !== null) return result('PRESENT');
    const after = lstatFn(metadataPath);
    if (!after.isDirectory() || after.isSymbolicLink()
        || ['dev', 'ino', 'mode', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) {
      return result('UNPROVEN');
    }
    return result('EMPTY');
  } catch { return result('UNPROVEN'); }
  finally { if (directory) { try { directory.closeSync(); } catch { /* read verdict remains conservative */ } } }
}

function linkedMetadataBlocker(evidence) {
  return evidence?.linkedWorktreesExcluded === true
    && ['ABSENT', 'EMPTY'].includes(evidence.state) ? ''
    : evidence?.state === 'PRESENT'
      ? 'CANONICAL_GIT_WORKTREE_CONFIG_LINKED_WORKTREES_PRESENT'
      : 'CANONICAL_GIT_WORKTREE_CONFIG_LINKED_METADATA_UNPROVEN';
}

function finiteGitConfigRepairFailure(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    blocker,
    mutationPerformed: false,
    ...details,
  });
}

export function inspectCanonicalGitWorktreeConfigV1({
  repositoryRoot = fixedRepositoryRoot(),
  expectedHead = '',
  platform = process.platform,
  environment = process.env,
  spawnSyncFn = spawnSync,
  inspectTopologyFn = inspectBattleBridgeGitTopology,
  existsFn = existsSync,
  inspectLinkedMetadataFn = inspectCanonicalLinkedWorktreeMetadataV1,
  remainingTimeoutMsFn = () => 10_000,
} = {}) {
  const normalizedHead = text(expectedHead).toLowerCase();
  const held = (blocker, details = {}) => Object.freeze({
    ok: false,
    blocker,
    inspectionComplete: false,
    safeForFixedUnset: false,
    mutationPerformed: false,
    readOnly: true,
    sourceMutationAllowed: false,
    gitConfigurationMutationAllowed: false,
    arbitraryShellAllowed: false,
    rawPathsReturned: false,
    rawConfigValuesReturned: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
    ...details,
  });
  if (!SHA_PATTERN.test(normalizedHead)) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_EXPECTED_HEAD_REQUIRED');
  }

  let git;
  try {
    git = resolveBattleBridgeGitExecution({ platform, environment });
  } catch {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_GIT_UNAVAILABLE');
  }
  const canonicalPrefix = [
    ...git.fixedConfigArgs,
    ...battleBridgeCanonicalRepositoryArgs(repositoryRoot),
  ];
  const nextProbeTimeoutMs = () => {
    let remaining = 0;
    try { remaining = Number(remainingTimeoutMsFn()); } catch { return 0; }
    if (!Number.isFinite(remaining) || remaining <= 0) return 0;
    return Math.max(1, Math.min(10_000, Math.floor(remaining)));
  };
  const deadlineResult = () => Object.freeze({
    ok: false,
    status: null,
    stdout: '',
    deadlineExceeded: true,
  });
  const captureCanonical = (args) => {
    const timeout = nextProbeTimeoutMs();
    if (timeout <= 0) return deadlineResult();
    const result = spawnSyncFn(git.executable, [...canonicalPrefix, ...args], {
      cwd: repositoryRoot,
      env: git.environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout,
      maxBuffer: 64 * 1024,
    });
    return Object.freeze({
      ok: !result?.error && Number(result?.status) === 0,
      status: Number.isInteger(result?.status) ? result.status : null,
      stdout: String(result?.stdout || ''),
      deadlineExceeded: false,
    });
  };
  const head = captureCanonical(['rev-parse', 'HEAD']);
  const branch = captureCanonical(['branch', '--show-current']);
  if (head.deadlineExceeded || branch.deadlineExceeded) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_DEADLINE_EXCEEDED');
  }
  if (!head.ok || text(head.stdout).toLowerCase() !== normalizedHead
      || !branch.ok || text(branch.stdout) !== 'main') {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_SOURCE_IDENTITY_CHANGED');
  }

  if (nextProbeTimeoutMs() <= 0) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_DEADLINE_EXCEEDED');
  }
  const topology = inspectTopologyFn(repositoryRoot);
  if (topology?.ok !== true) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_TOPOLOGY_UNPROVEN');
  }

  const metadataBlocker = linkedMetadataBlocker(inspectLinkedMetadataFn(repositoryRoot));
  if (metadataBlocker) return held(metadataBlocker);
  const records = Object.freeze([
    Object.freeze({ root: repositoryRoot, locked: false, prunable: false }),
  ]);

  const localConfig = captureCanonical(['config', '--local', '--null', '--list']);
  if (localConfig.deadlineExceeded) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_DEADLINE_EXCEEDED', {
      registeredWorktreeCount: records.length,
    });
  }
  if (!localConfig.ok) return held('CANONICAL_GIT_WORKTREE_CONFIG_READ_FAILED');
  const policy = validateBattleBridgeLocalGitConfiguration(localConfig.stdout);
  const riskCategories = Object.freeze(
    (Array.isArray(policy?.diagnostic?.riskCategories) ? policy.diagnostic.riskCategories : [])
      .slice(0, 16),
  );

  const configured = captureCanonical([
    'config', '--local', '--null', '--get-all', 'extensions.worktreeConfig',
  ]);
  let extensionValues = [];
  let extensionValueState = 'ABSENT';
  if (configured.deadlineExceeded) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_DEADLINE_EXCEEDED', {
      registeredWorktreeCount: records.length,
      riskCategories,
    });
  }
  if (configured.ok) {
    const raw = configured.stdout.endsWith('\0')
      ? configured.stdout.slice(0, -1) : configured.stdout;
    extensionValues = raw.split('\0');
    if (extensionValues.length > 1) extensionValueState = 'MULTIPLE';
    else if (extensionValues[0]?.toLowerCase() === 'true') extensionValueState = 'TRUE';
    else if (extensionValues[0]?.toLowerCase() === 'false') extensionValueState = 'FALSE';
    else extensionValueState = 'OTHER';
  } else if (configured.status !== 1) {
    return held('CANONICAL_GIT_WORKTREE_CONFIG_VALUE_UNPROVEN', {
      registeredWorktreeCount: records.length,
      riskCategories,
    });
  }

  let worktreeConfigFileCount = 0;
  let nonEmptyWorktreeConfigFileCount = 0;
  let worktreeConfigEntryCount = 0;
  let allWorktreeConfigsObserved = true;
  const worktreeConfigPath = resolve(repositoryRoot, '.git', 'config.worktree');
  if (existsFn(worktreeConfigPath)) {
    worktreeConfigFileCount = 1;
    const config = captureCanonical([
      'config', '--file', worktreeConfigPath, '--null', '--list',
    ]);
    if (config.deadlineExceeded) {
      return held('CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_DEADLINE_EXCEEDED', {
        registeredWorktreeCount: records.length,
        riskCategories,
        worktreeConfigFileCount,
        nonEmptyWorktreeConfigFileCount,
        worktreeConfigEntryCount,
      });
    }
    if (!config.ok) {
      return held('CANONICAL_GIT_WORKTREE_CONFIG_CONTENT_UNPROVEN', {
        registeredWorktreeCount: records.length,
        riskCategories,
        worktreeConfigFileCount,
      });
    }
    const entries = config.stdout.split('\0').filter(Boolean);
    worktreeConfigEntryCount = entries.length;
    if (entries.length > 0) nonEmptyWorktreeConfigFileCount = 1;
  }

  const linkedWorktreeCount = Math.max(0, records.length - 1);
  const lockedWorktreeCount = records.filter(record => record.locked).length;
  const prunableWorktreeCount = records.filter(record => record.prunable).length;
  const originCount = text(policy?.diagnostic?.originCount) || 'UNKNOWN';
  const originMatch = text(policy?.diagnostic?.originMatch) || 'UNKNOWN';
  const soleExpectedRisk = policy?.blocker === 'CANONICAL_GIT_CONFIGURATION_INVALID'
    && riskCategories.length === 1
    && riskCategories[0] === 'EXTENSIONS_WORKTREE_CONFIG';
  const safeForFixedUnset = topology?.ok === true
    && originCount === 'ONE'
    && originMatch === 'CANONICAL'
    && soleExpectedRisk
    && extensionValues.length === 1
    && extensionValueState === 'TRUE'
    && records.length === 1
    && linkedWorktreeCount === 0
    && lockedWorktreeCount === 0
    && prunableWorktreeCount === 0
    && allWorktreeConfigsObserved
    && worktreeConfigEntryCount === 0;

  const observation = Object.freeze({
    schemaVersion: 'stephanos.canonical-git-worktree-config-inspection.v1',
    ok: true,
    inspectionComplete: true,
    sourceHead: normalizedHead,
    canonicalTopologyProven: true,
    canonicalGitConfigurationValid: policy?.ok === true,
    originCount,
    originMatch,
    riskCategories,
    extensionValueCount: extensionValues.length,
    extensionValueState,
    registeredWorktreeCount: records.length,
    linkedWorktreeCount,
    lockedWorktreeCount,
    prunableWorktreeCount,
    worktreeConfigFileCount,
    nonEmptyWorktreeConfigFileCount,
    worktreeConfigEntryCount,
    allWorktreeConfigsObserved,
    safeForFixedUnset,
    mutationPerformed: false,
    readOnly: true,
    sourceMutationAllowed: false,
    gitConfigurationMutationAllowed: false,
    arbitraryShellAllowed: false,
    rawPathsReturned: false,
    rawConfigValuesReturned: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
    finalVerdict: policy?.ok === true
      ? 'CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_CANONICAL'
      : safeForFixedUnset
        ? 'CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_REPAIR_ELIGIBLE'
        : 'CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_REPAIR_HELD',
  });
  return observation;
}

export function repairCanonicalGitWorktreeConfigV1({
  repositoryRoot = fixedRepositoryRoot(),
  expectedHead = '',
  platform = process.platform,
  environment = process.env,
  spawnSyncFn = spawnSync,
  inspectTopologyFn = inspectBattleBridgeGitTopology,
  existsFn = existsSync,
  inspectLinkedMetadataFn = inspectCanonicalLinkedWorktreeMetadataV1,
} = {}) {
  const normalizedHead = text(expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(normalizedHead)) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_EXPECTED_HEAD_REQUIRED');
  }

  let git;
  try {
    git = resolveBattleBridgeGitExecution({ platform, environment });
  } catch {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_GIT_UNAVAILABLE');
  }
  const prefix = [
    ...git.fixedConfigArgs,
    ...battleBridgeCanonicalRepositoryArgs(repositoryRoot),
  ];
  const capture = (args) => {
    const result = spawnSyncFn(git.executable, [...prefix, ...args], {
      cwd: repositoryRoot,
      env: git.environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    return Object.freeze({
      ok: !result?.error && Number(result?.status) === 0,
      status: Number.isInteger(result?.status) ? result.status : null,
      stdout: String(result?.stdout || ''),
    });
  };

  const beforeHead = capture(['rev-parse', 'HEAD']);
  const branch = capture(['branch', '--show-current']);
  if (!beforeHead.ok || text(beforeHead.stdout).toLowerCase() !== normalizedHead
      || !branch.ok || text(branch.stdout) !== 'main') {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_SOURCE_IDENTITY_CHANGED');
  }

  const topology = inspectTopologyFn(repositoryRoot);
  if (topology?.ok !== true) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_TOPOLOGY_UNPROVEN');
  }

  const metadataBlocker = linkedMetadataBlocker(inspectLinkedMetadataFn(repositoryRoot));
  if (metadataBlocker) return finiteGitConfigRepairFailure(metadataBlocker);

  const beforeConfig = capture(['config', '--local', '--null', '--list']);
  if (!beforeConfig.ok) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_READ_FAILED');
  }
  const beforeProof = validateBattleBridgeLocalGitConfiguration(beforeConfig.stdout);
  if (beforeProof.ok === true) {
    return Object.freeze({
      ok: true,
      blocker: '',
      mutationPerformed: false,
      finalVerdict: 'CANONICAL_GIT_CONFIGURATION_ALREADY_VALID',
      riskCategoriesBefore: Object.freeze([]),
      canonicalAfter: true,
    });
  }

  const categories = Array.isArray(beforeProof?.diagnostic?.riskCategories)
    ? beforeProof.diagnostic.riskCategories : [];
  if (beforeProof.blocker !== 'CANONICAL_GIT_CONFIGURATION_INVALID'
      || beforeProof?.diagnostic?.originCount !== 'ONE'
      || beforeProof?.diagnostic?.originMatch !== 'CANONICAL'
      || categories.length !== 1
      || categories[0] !== 'EXTENSIONS_WORKTREE_CONFIG') {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_SCOPE_MISMATCH', {
      riskCategoriesBefore: Object.freeze(categories.slice(0, 8)),
    });
  }

  const configured = capture(['config', '--local', '--null', '--get-all', 'extensions.worktreeConfig']);
  const configuredRaw = configured.ok ? configured.stdout : '';
  const configuredValues = configured.ok
    ? (configuredRaw.endsWith('\0') ? configuredRaw.slice(0, -1) : configuredRaw).split('\0') : [];
  if (!configured.ok || configuredValues.length !== 1
      || configuredValues[0].toLowerCase() !== 'true') {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_VALUE_UNEXPECTED');
  }

  const worktreeConfigPath = resolve(repositoryRoot, '.git', 'config.worktree');
  let worktreeEntries = [];
  if (existsFn(worktreeConfigPath)) {
    const worktreeConfig = capture(['config', '--file', worktreeConfigPath, '--null', '--list']);
    if (!worktreeConfig.ok) {
      return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_CONTENT_UNPROVEN');
    }
    worktreeEntries = worktreeConfig.stdout.split('\0').filter(Boolean);
  }
  if (worktreeEntries.length !== 0) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_CONTENT_PRESENT');
  }

  // Recheck after the config/value probes: a newly registered worker holds
  // this repair. This is not a claim of hostile privileged-writer exclusion.
  const finalMetadataBlocker = linkedMetadataBlocker(inspectLinkedMetadataFn(repositoryRoot));
  if (finalMetadataBlocker) return finiteGitConfigRepairFailure(finalMetadataBlocker);
  const unset = capture(['config', '--local', '--unset-all', 'extensions.worktreeConfig']);
  if (!unset.ok) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_UNSET_FAILED');
  }

  const afterConfig = capture(['config', '--local', '--null', '--list']);
  const afterHead = capture(['rev-parse', 'HEAD']);
  if (!afterConfig.ok || !afterHead.ok || text(afterHead.stdout).toLowerCase() !== normalizedHead) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_POSTCONDITION_UNPROVEN', {
      mutationPerformed: true,
    });
  }
  const afterProof = validateBattleBridgeLocalGitConfiguration(afterConfig.stdout);
  if (afterProof.ok !== true) {
    return finiteGitConfigRepairFailure('CANONICAL_GIT_WORKTREE_CONFIG_POSTCONDITION_INVALID', {
      mutationPerformed: true,
    });
  }

  return Object.freeze({
    ok: true,
    blocker: '',
    mutationPerformed: true,
    finalVerdict: 'CANONICAL_GIT_WORKTREE_CONFIG_REPAIRED',
    riskCategoriesBefore: Object.freeze(['EXTENSIONS_WORKTREE_CONFIG']),
    canonicalAfter: true,
  });
}

export async function executeSovereignCommanderRemoteOnBattleBridge(command = {}, options = {}) {
  const shape = validateSovereignCommanderRemoteCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const env = options?.env || process.env;
  const repositoryRoot = fixedRepositoryRoot(env);
  const tokenPath = fixedTokenPath(env);
  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const readFileFn = typeof options?.readFileFn === 'function' ? options.readFileFn : readFile;
  const fetchFn = typeof options?.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;
  const ensureRuntimeFn = typeof options?.ensureRuntimeFn === 'function'
    ? options.ensureRuntimeFn
    : ensureSovereignCommanderRuntime;
  const networkTimeoutMs = sovereignCommanderRemoteNetworkTimeoutMs(
    shape.command,
    options?.networkTimeoutMs,
  );
  const nowFn = typeof options?.nowFn === 'function' ? options.nowFn : Date.now;
  const remotePlanRequested = Array.isArray(shape.command.remotePlan);
  // Start the total receipt-liveness budget before any source identity, Commander
  // recycle, health, MCP setup or maintenance work. The parent outbox guard gives
  // the child 15 minutes; plans get eight minutes total so a bounded terminal
  // receipt still has generous publication margin.
  // A single action previously had only per-MCP-call timeouts. Several slow
  // setup calls could cumulatively exceed the parent's 15-minute child guard
  // and leave ACCEPTED without a terminal receipt. Bound the full operation
  // (single action OR plan) to eight minutes, from source identity onward.
  const planStartedAtMs = Number(nowFn());
  const remainingPlanTimeoutMs = (perCallTimeoutMs = networkTimeoutMs) => (
    sovereignCommanderRemotePlanStepTimeoutMs({
      startedAtMs: planStartedAtMs,
      nowMs: Number(nowFn()),
      perCallTimeoutMs,
    })
  );
  const planDeadlineFailure = (details = {}) => fail(
    remotePlanRequested
      ? 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED'
      : 'SOVEREIGN_COMMANDER_REMOTE_ACTION_DEADLINE_EXCEEDED',
    {
      ...(remotePlanRequested ? {
        stepIndex: 0,
        remotePlan: shape.command.remotePlan,
        stepCount: 0,
        completedSteps: Object.freeze([]),
      } : {}),
      remoteAction: remotePlanRequested ? shape.command.remotePlan[0] : shape.command.remoteAction,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
      ...details,
    },
  );
  const boundedPlanFetch = remotePlanRequested
    ? async (url, fetchOptions = {}) => {
      const remainingMs = remainingPlanTimeoutMs(networkTimeoutMs);
      if (remainingMs <= 0) {
        const error = new Error('SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED');
        error.name = 'AbortError';
        error.code = 'ABORT_ERR';
        throw error;
      }
      const exchange = await fetchTextWithDeadline(fetchFn, url, fetchOptions, remainingMs);
      const response = exchange.response;
      const bodyText = exchange.bodyText;
      return Object.freeze({
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        json: async () => {
          try { return bodyText ? JSON.parse(bodyText) : null; } catch { return null; }
        },
        text: async () => bodyText,
      });
    }
    : fetchFn;

  const branch = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();
  if (!branch.ok || !head.ok) return fail('SOVEREIGN_COMMANDER_REMOTE_SOURCE_IDENTITY_UNAVAILABLE');
  if (observedBranch !== 'main') return fail('SOVEREIGN_COMMANDER_REMOTE_CANONICAL_BRANCH_REQUIRED', { observedBranch });
  if (observedHead !== shape.expectedHead) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH', {
      expectedHead: shape.expectedHead,
      observedHead,
    });
  }


  if (shape.command.remoteAction === CANONICAL_GIT_WORKTREE_CONFIG_INSPECT_ACTION) {
    const inspection = inspectCanonicalGitWorktreeConfigV1({
      repositoryRoot,
      expectedHead: observedHead,
      platform: process.platform,
      environment: env,
      spawnSyncFn,
      remainingTimeoutMsFn: () => remainingPlanTimeoutMs(10_000),
    });
    if (!inspection.ok) {
      if (inspection.blocker === 'CANONICAL_GIT_WORKTREE_CONFIG_INSPECTION_DEADLINE_EXCEEDED') {
        return planDeadlineFailure({
          inspectionComplete: false,
          registeredWorktreeCount: inspection.registeredWorktreeCount ?? null,
          riskCategories: inspection.riskCategories || Object.freeze([]),
        });
      }
      return fail(inspection.blocker, {
        remoteAction: CANONICAL_GIT_WORKTREE_CONFIG_INSPECT_ACTION,
        sourceHead: observedHead,
        expectedHeadMatch: true,
        registeredWorktreeCount: inspection.registeredWorktreeCount ?? null,
        riskCategories: inspection.riskCategories || Object.freeze([]),
        gitConfigurationMutationPerformed: false,
        sourceMutationAllowed: false,
        arbitraryShellAllowed: false,
        mergeAuthority: false,
        pcRestartAuthority: false,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true,
      finalVerdict: inspection.finalVerdict,
      remoteAction: CANONICAL_GIT_WORKTREE_CONFIG_INSPECT_ACTION,
      sourceHead: observedHead,
      expectedHeadMatch: true,
      canonicalGitWorktreeConfigInspection: inspection,
      proofHash: createHash('sha256').update(JSON.stringify({
        sourceHead: observedHead,
        remoteAction: CANONICAL_GIT_WORKTREE_CONFIG_INSPECT_ACTION,
        canonicalGitConfigurationValid: inspection.canonicalGitConfigurationValid,
        riskCategories: inspection.riskCategories,
        extensionValueCount: inspection.extensionValueCount,
        extensionValueState: inspection.extensionValueState,
        registeredWorktreeCount: inspection.registeredWorktreeCount,
        linkedWorktreeCount: inspection.linkedWorktreeCount,
        lockedWorktreeCount: inspection.lockedWorktreeCount,
        prunableWorktreeCount: inspection.prunableWorktreeCount,
        worktreeConfigFileCount: inspection.worktreeConfigFileCount,
        nonEmptyWorktreeConfigFileCount: inspection.nonEmptyWorktreeConfigFileCount,
        worktreeConfigEntryCount: inspection.worktreeConfigEntryCount,
        allWorktreeConfigsObserved: inspection.allWorktreeConfigsObserved,
        safeForFixedUnset: inspection.safeForFixedUnset,
      })).digest('hex'),
      readOnly: true,
      gitConfigurationMutationPerformed: false,
      sourceMutationAllowed: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...result,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result,
    });
  }

  if (shape.command.remoteAction === CANONICAL_GIT_WORKTREE_CONFIG_ACTION) {
    const repair = repairCanonicalGitWorktreeConfigV1({
      repositoryRoot,
      expectedHead: observedHead,
      platform: process.platform,
      environment: env,
      spawnSyncFn,
    });
    if (!repair.ok) {
      return fail(repair.blocker, {
        remoteAction: CANONICAL_GIT_WORKTREE_CONFIG_ACTION,
        sourceHead: observedHead,
        expectedHeadMatch: true,
        riskCategoriesBefore: repair.riskCategoriesBefore || Object.freeze([]),
        gitConfigurationMutationPerformed: repair.mutationPerformed === true,
        sourceMutationAllowed: false,
        arbitraryShellAllowed: false,
        mergeAuthority: false,
        pcRestartAuthority: false,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true,
      finalVerdict: repair.finalVerdict,
      remoteAction: CANONICAL_GIT_WORKTREE_CONFIG_ACTION,
      sourceHead: observedHead,
      expectedHeadMatch: true,
      gitConfigurationMutationPerformed: repair.mutationPerformed === true,
      gitConfigurationMutationScope: 'extensions.worktreeConfig-only',
      riskCategoriesBefore: repair.riskCategoriesBefore,
      canonicalGitConfigurationValid: repair.canonicalAfter === true,
      proofHash: createHash('sha256').update(JSON.stringify({
        sourceHead: observedHead,
        remoteAction: CANONICAL_GIT_WORKTREE_CONFIG_ACTION,
        mutationPerformed: repair.mutationPerformed === true,
        canonicalAfter: repair.canonicalAfter === true,
      })).digest('hex'),
      sourceMutationAllowed: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...result,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result,
    });
  }

  // The canonical owner-attested GitHub mailbox already supplies fixed authority.
  // Sample directly in this existing process, not by recycling the long-lived
  // Commander: diagnostic observation must never start a repair guardian.
  if (shape.command.remoteAction === 'original-source-custody-census') {
    // Single fixed unprivileged sampler. Never execute the mutable checkout
    // script or accept user-supplied process IDs, paths, launch arguments or keys.
    const committed = run(spawnSyncFn, GIT, [
      '-C', repositoryRoot, 'show', observedHead + ':' + ORIGINAL_CUSTODY_CENSUS_SCRIPT,
    ], { timeout: 10_000, maxBuffer: 12 * 1024 });
    const sourceBytes = committed.stdout;
    // EncodedCommand has no script file path: explicitly bind PSScriptRoot to
    // the canonical repository's scripts/windows directory. The committed
    // census body is appended verbatim; no checkout copy can be swapped in.
    const rootBase64 = Buffer.from(repositoryRoot, 'utf16le').toString('base64');
    const fixedPrelude = '$script:PSScriptRoot = Join-Path ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String("'
      + rootBase64 + '"))) "scripts\\windows"\r\n';
    const encoded = committed.ok && sourceBytes.length > 0 && sourceBytes.length <= 12_000
      ? Buffer.from(fixedPrelude + sourceBytes, 'utf16le').toString('base64') : '';
    if (!encoded || encoded.length > 32_000) return fail(
      'SOVEREIGN_CUSTODY_CENSUS_COMMITTED_SOURCE_UNAVAILABLE',
      { publicReceiptSafe: true, secretMaterialReturned: false },
    );
    const sampled = run(spawnSyncFn, CPU_SNAPSHOT_POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded,
    ], { timeout: 25_000, maxBuffer: 16 * 1024 });
    let rawCensus = null;
    try {
      if (sampled.ok && sampled.stdout.length <= 8_000) rawCensus = JSON.parse(sampled.stdout);
    } catch {}
    const custody = inspectOriginalSourceCustodyCensusV1(rawCensus);
    if (!sampled.ok || custody.observable !== true
      || custody.finalVerdict !== 'ORIGINAL_SOURCE_CUSTODY_HOLD') {
      return fail('SOVEREIGN_CUSTODY_CENSUS_UNTRUSTED_OR_STALE', {
        publicReceiptSafe: true, secretMaterialReturned: false,
      });
    }
    const inspection = Object.freeze({
      originalLeaseId: 'critical-2962-elastic-goal-r7-lease',
      inspectedAtUtc: rawCensus.inspectedAtUtc,
      checkoutPresent: rawCensus.checkoutPresent,
      aclReadable: rawCensus.aclReadable,
      candidateProcessCount: rawCensus.candidateProcessCount,
      stephanosScheduledTaskCount: rawCensus.stephanosScheduledTaskCount,
      blockers: custody.blockers,
      historicalExecutionOutcome: 'UNKNOWN',
      independentWindowsExclusionProven: false,
      independentOperatorApprovalProven: false,
      leaseReleaseAuthorized: false,
      sourceMutationAuthorized: false,
      finalVerdict: 'ORIGINAL_SOURCE_CUSTODY_HOLD',
    });
    const result = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_CUSTODY_CENSUS_OBSERVED_HOLD',
      remoteAction: 'original-source-custody-census',
      sourceHead: observedHead,
      inspection,
      proofHash: createHash('sha256')
        .update(JSON.stringify({ sourceHead: observedHead, inspection })).digest('hex'),
      readOnly: true, publicReceiptSafe: true, secretMaterialReturned: false,
      originalLeaseReleased: false, privilegedWindowsWitnessCommissioned: false,
      sourceMutationAllowed: false, arbitraryShellAllowed: false,
      mergeAuthority: false, vendorMeterRequired: false,
    });
    return Object.freeze({
      ...result, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId), result,
    });
  }

  if (shape.command.remoteAction === 'original-r7-witness-readiness') {
    // Only the exact committed sampler may run. No caller inputs, script paths,
    // admin action or arbitrary shell is accepted by this route.
    const committed = run(spawnSyncFn, GIT, [
      '-C', repositoryRoot, 'show', observedHead + ':' + ORIGINAL_R7_READINESS_SCRIPT,
    ], { timeout: 10_000, maxBuffer: 12 * 1024 });
    const sourceBytes = committed.stdout;
    const rootBase64 = Buffer.from(repositoryRoot, 'utf16le').toString('base64');
    const fixedPrelude = '$script:PSScriptRoot = Join-Path ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String("'
      + rootBase64 + '"))) "scripts\\windows"\r\n';
    const encoded = committed.ok && sourceBytes.length > 0 && sourceBytes.length <= 12_000
      ? Buffer.from(fixedPrelude + sourceBytes, 'utf16le').toString('base64') : '';
    if (!encoded || encoded.length > 32_000) return fail(
      'SOVEREIGN_R7_READINESS_COMMITTED_SOURCE_UNAVAILABLE',
      { publicReceiptSafe: true, secretMaterialReturned: false },
    );
    const sampled = run(spawnSyncFn, CPU_SNAPSHOT_POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded,
    ], { timeout: 25_000, maxBuffer: 16 * 1024 });
    let raw = null;
    try {
      if (sampled.ok && sampled.stdout.length <= 8_000) raw = JSON.parse(sampled.stdout);
    } catch {}
    const readiness = projectOriginalR7WitnessCommissioningAuditV1(raw);
    if (!sampled.ok || readiness.observable !== true
      || readiness.finalVerdict !== 'ORIGINAL_R7_WINDOWS_WITNESS_NOT_COMMISSIONED') {
      return fail('SOVEREIGN_R7_READINESS_UNTRUSTED_OR_STALE', {
        publicReceiptSafe: true, secretMaterialReturned: false,
      });
    }
    const observation = Object.freeze({
      observedAtUtc: raw.observedAtUtc,
      servicePresent: readiness.servicePresent,
      serviceStatus: readiness.serviceStatus,
      publisherTaskPresent: readiness.publisherTaskPresent,
      publisherTaskState: readiness.publisherTaskState,
      publisherLastResultClass: readiness.publisherLastResultClass,
      publisherOriginalWriterAuthenticated: false,
      blockers: readiness.blockers,
      historicalOutcome: 'UNKNOWN',
      authenticatedWitness: false,
      physicalPickupProven: false,
      leaseReleaseAuthority: false,
      sourceMutationAuthority: false,
      finalVerdict: readiness.finalVerdict,
    });
    const result = Object.freeze({
      ok: true, remoteAction: 'original-r7-witness-readiness',
      finalVerdict: 'SOVEREIGN_R7_READINESS_OBSERVED_HOLD',
      sourceHead: observedHead, witnessReadiness: observation,
      proofHash: createHash('sha256')
        .update(JSON.stringify({ sourceHead: observedHead, observation })).digest('hex'),
      readOnly: true, publicReceiptSafe: true, secretMaterialReturned: false,
      originalLeaseReleased: false, privilegedWindowsWitnessCommissioned: false,
      sourceMutationAllowed: false, arbitraryShellAllowed: false,
      mergeAuthority: false, vendorMeterRequired: false,
    });
    return Object.freeze({
      ...result, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId), result,
    });
  }

  if (shape.command.remoteAction === 'cpu-pressure-snapshot') {
    // Read exactly the blob from the SHA-approved immutable Git tree.
    // Never execute a checkout pathname: diff --quiet can be bypassed by
    // skip-worktree/assume-unchanged and has a time-of-check/use race.
    const committedScript = run(spawnSyncFn, GIT, [
      '-C', repositoryRoot, 'show', observedHead + ':' + CPU_SNAPSHOT_SCRIPT,
    ], { timeout: 10_000, maxBuffer: 12 * 1024 });
    const source = committedScript.stdout;
    const encodedSource = committedScript.ok && source.length > 0 && source.length <= 12_000
      ? Buffer.from(source, 'utf16le').toString('base64')
      : '';
    if (!encodedSource || encodedSource.length > 28_000) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CPU_COMMITTED_SCRIPT_UNAVAILABLE', {
        remoteAction: 'cpu-pressure-snapshot',
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const sampled = run(spawnSyncFn, CPU_SNAPSHOT_POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedSource,
    ], { timeout: 25_000, maxBuffer: 32 * 1024 });
    const cpuPressure = sampled.ok
      ? safeCpuPressureSnapshotProjection({
        structuredContent: { stdout: sampled.stdout },
      }, 'cpu-pressure-snapshot')
      : null;
    if (!cpuPressure) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_RECEIPT_INVALID', {
        remoteAction: 'cpu-pressure-snapshot',
        sampleStatus: sampled.status,
        readOnly: true,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_COMPLETE',
      remoteAction: 'cpu-pressure-snapshot',
      sourceHead: shape.expectedHead,
      proofHash: createHash('sha256')
        .update(JSON.stringify({ sourceHead: observedHead, cpuPressure }))
        .digest('hex'),
      cpuPressure,
      executionSurface: 'canonical-sovereign-mailbox-fixed-sampler',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...result,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result,
    });
  }

  // repair-stephanos may need to recycle a stale Commander capability. Do that
  // from the mailbox process before opening an MCP session so the repair cannot
  // terminate the HTTP process that is carrying its own in-flight request.
  // The same safety rule applies when repair-stephanos is one step inside a plan.
  if (sovereignCommanderRepairEnvelopeRequired(shape.command)) {
    const preflightBudgetMs = remainingPlanTimeoutMs(
      remotePlanRequested ? SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS : networkTimeoutMs,
    );
    if (preflightBudgetMs <= 0) return planDeadlineFailure();
    const runtimeSettlement = await settleWithinDeadline(ensureRuntimeFn({
      fetchFn: boundedPlanFetch,
      spawnSyncFn,
      repoRoot: repositoryRoot,
    }), preflightBudgetMs);
    if (runtimeSettlement.timedOut === true && remotePlanRequested) {
      return planDeadlineFailure();
    }
    if (runtimeSettlement.timedOut === true) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_RUNTIME_PREFLIGHT_FAILED', {
        remoteAction: shape.command.remoteAction,
        runtimeBlocker: 'SOVEREIGN_COMMANDER_RUNTIME_PREFLIGHT_TIMEOUT',
        runtimeBootstrapAttempted: false,
        staleCapabilityRecycleRequested: false,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    if (runtimeSettlement.error && remotePlanRequested
      && (runtimeSettlement.error?.name === 'AbortError'
        || runtimeSettlement.error?.code === 'ABORT_ERR'
        || text(runtimeSettlement.error?.message) === 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED')) {
      return planDeadlineFailure();
    }
    if (runtimeSettlement.error) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_RUNTIME_PREFLIGHT_FAILED', {
        remoteAction: shape.command.remoteAction,
        runtimeBlocker: 'SOVEREIGN_COMMANDER_RUNTIME_PREFLIGHT_FAILED',
        runtimeBootstrapAttempted: false,
        staleCapabilityRecycleRequested: false,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const runtime = runtimeSettlement.value;
    if (runtime?.ok !== true) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_RUNTIME_PREFLIGHT_FAILED', {
        remoteAction: shape.command.remoteAction,
        runtimeBlocker: text(runtime?.blocker).slice(0, 160),
        runtimeBootstrapAttempted: runtime?.bootstrapAttempted === true,
        staleCapabilityRecycleRequested: runtime?.staleCapabilityRecycleRequested === true,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
  }

  let health;
  try {
    const healthTimeoutMs = remainingPlanTimeoutMs(Math.min(networkTimeoutMs, 15_000));
    if (healthTimeoutMs <= 0) return planDeadlineFailure();
    const exchange = await fetchTextWithDeadline(
      fetchFn,
      HEALTH_URL,
      { method: 'GET' },
      healthTimeoutMs,
    );
    let parsedHealth = null;
    try { parsedHealth = exchange.bodyText ? JSON.parse(exchange.bodyText) : null; } catch {}
    health = exchange.response.ok ? parsedHealth : null;
  } catch {
    health = null;
  }
  if (health?.ok !== true || health?.service !== 'stephanos-sovereign-commander') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_HEALTH_REQUIRED');
  }

  let token = '';
  try { token = text(await readFileFn(tokenPath, 'utf8')); } catch {}
  if (token.length < 32) return fail('SOVEREIGN_COMMANDER_REMOTE_TOKEN_UNAVAILABLE');
  const callMcp = (message, sessionId = '', timeoutMs = networkTimeoutMs) => {
    const resolvedTimeoutMs = remainingPlanTimeoutMs(timeoutMs);
    if (resolvedTimeoutMs <= 0) {
      return Promise.resolve(Object.freeze({
        ok: false,
        status: 0,
        sessionId: '',
        body: null,
        transportTimedOut: false,
        planDeadlineExceeded: true,
        planBudgetLimited: true,
      }));
    }
    return postMcp(fetchFn, token, message, sessionId, resolvedTimeoutMs).then((result) => Object.freeze({
      ...result,
      planDeadlineExceeded: false,
      planBudgetLimited: remotePlanRequested && resolvedTimeoutMs < boundedRemoteNetworkTimeoutMs(timeoutMs),
    }));
  };

  const initialize = await callMcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'battle-bridge-mobile-ingress', version: '1.0.0' },
      capabilities: {},
    },
  });
  const sessionId = initialize.sessionId;
  if (initialize.planDeadlineExceeded === true
    || (initialize.transportTimedOut === true && initialize.planBudgetLimited === true)) {
    return planDeadlineFailure();
  }
  if (!initialize.ok || !sessionId) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZE_FAILED', { status: initialize.status });
  }

  const initialized = await callMcp({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, sessionId);
  if (initialized.planDeadlineExceeded === true
    || (initialized.transportTimedOut === true && initialized.planBudgetLimited === true)) {
    return planDeadlineFailure();
  }
  if (!initialized.ok) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZED_FAILED', { status: initialized.status });
  }

  const listed = await callMcp({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionId);
  if (listed.planDeadlineExceeded === true
    || (listed.transportTimedOut === true && listed.planBudgetLimited === true)) {
    return planDeadlineFailure();
  }
  const tools = Array.isArray(listed.body?.result?.tools)
    ? listed.body.result.tools.map((tool) => text(tool?.name))
    : [];
  // Prove the *served* archive capability. Source availability does not mean
  // a stale running MCP service can execute that source's new action.
  const archiveDedicatedAdvertised = tools.includes('starfield_vr_telemetry_archive');
  const archiveActionRequested = shape.command.remoteAction === 'starfield-vr-telemetry-archive';
  if (!listed.ok
    || !tools.includes('get_config')
    || !tools.includes('maintenance_action')
    || (shape.command.remoteAction === 'search-project' && !tools.includes('search_project'))) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_TOOL_SURFACE_INVALID');
  }

  const configCall = await callMcp({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_config', arguments: {} },
  }, sessionId);
  if (configCall.planDeadlineExceeded === true
    || (configCall.transportTimedOut === true && configCall.planBudgetLimited === true)) {
    return planDeadlineFailure();
  }
  const config = mcpStructuredPayload(configCall);
  if (!configCall.ok || !isBoundedCommanderConfig(config)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
  }
  if (archiveActionRequested && !archiveDedicatedAdvertised) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_ARCHIVE_SERVED_TOOL_MISSING', {
      remoteAction: shape.command.remoteAction,
      dedicatedToolAdvertised: false,
      fixedMaintenanceFallbackSelected: false,
      runtimeRefreshRequired: true,
      sourceMutationAllowed: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
  }

  if (shape.command.remoteAction === 'private-mcp-parity-proof') {
    // The owner-approved public command only selects a *fixed* read-only test.
    // The private authenticated MCP session, token and local paths never leave
    // the Battle Bridge. Never project result content or input paths publicly.
    const filePath = resolve(repositoryRoot, 'scripts', 'sovereign-commander-mcp.mjs');
    const batchSchema = listed.body?.result?.tools?.find((tool) => tool?.name === 'read_multiple_files');
    const metadataSchema = listed.body?.result?.tools?.find((tool) => tool?.name === 'get_file_info');
    const advertised = batchSchema?.annotations?.readOnlyHint === true
      && batchSchema?.annotations?.destructiveHint === false
      && batchSchema?.inputSchema?.properties?.paths?.maxItems === 8
      && batchSchema?.inputSchema?.properties?.length?.maximum === 200
      && metadataSchema?.annotations?.readOnlyHint === true
      && metadataSchema?.annotations?.destructiveHint === false
      && metadataSchema?.inputSchema?.required?.length === 1
      && metadataSchema?.inputSchema?.required?.[0] === 'path';
    if (!advertised) {
      return fail('SOVEREIGN_PRIVATE_MCP_CAPABILITIES_NOT_ADVERTISED', {
        batchReadAdvertised: Boolean(batchSchema),
        metadataAdvertised: Boolean(metadataSchema),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const metadataCall = await callMcp({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_file_info', arguments: { path: filePath } },
    }, sessionId, 15_000);
    const metadataEnvelope = sovereignCommanderCompletionEnvelope(metadataCall);
    const metadata = mcpStructuredPayload(metadataCall);
    const metadataProven = metadataCall.ok
      && metadataEnvelope.ok === true
      && PROOF_HASH_PATTERN.test(text(metadataEnvelope.proofHash))
      && metadata.type === 'FILE'
      && Number.isSafeInteger(metadata.bytes) && metadata.bytes > 0
      && text(metadata.path) === filePath;
    if (!metadataProven) return fail('SOVEREIGN_PRIVATE_MCP_METADATA_CALL_UNPROVEN', {
      readOnly: true, publicReceiptSafe: true, secretMaterialReturned: false,
    });
    const batchCall = await callMcp({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'read_multiple_files', arguments: { paths: [filePath], offset: 0, length: 1 } },
    }, sessionId, 15_000);
    const batchEnvelope = sovereignCommanderCompletionEnvelope(batchCall);
    const batch = mcpStructuredPayload(batchCall);
    const batchProven = batchCall.ok
      && batchEnvelope.ok === true
      && PROOF_HASH_PATTERN.test(text(batchEnvelope.proofHash))
      && batch.totalFiles === 1
      && Array.isArray(batch.files) && batch.files.length === 1
      && batch.files[0]?.path === filePath
      && batch.files[0]?.content === '#!/usr/bin/env node'
      && batch.files[0]?.truncated === false
      && batch.files[0]?.offset === 0
      && batch.files[0]?.length === 1;
    if (!batchProven) return fail('SOVEREIGN_PRIVATE_MCP_BATCH_READ_CALL_UNPROVEN', {
      metadataCallProven: true, readOnly: true,
      publicReceiptSafe: true, secretMaterialReturned: false,
    });
    const outcome = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_PRIVATE_MCP_PARITY_PROVEN',
      remoteAction: 'private-mcp-parity-proof',
      sourceHead: shape.expectedHead,
      toolListProven: true,
      metadataCallProven: true,
      batchReadCallProven: true,
      toolCount: tools.length,
      proofHash: createHash('sha256').update(JSON.stringify({
        head: shape.expectedHead,
        metadataProofHash: text(metadataEnvelope.proofHash),
        batchProofHash: text(batchEnvelope.proofHash),
        capabilityVersion: text(health.capabilityVersion),
      })).digest('hex'),
      localAuthenticatedMcp: true,
      readOnly: true,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
      privateFileContentReturned: false,
      privateFilePathReturned: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      sourceMutationAllowed: false,
      vendorMeterRequired: false,
    });
    return Object.freeze({
      ...outcome, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId), result: outcome,
    });
  }

  if (shape.command.remoteAction === 'status') {
    const statusResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE',
      remoteAction: 'status',
      sourceHead: shape.expectedHead,
      healthReady: true,
      authenticatedMcpReady: true,
      continuousRepairGuardian: projectSovereignContinuousRepairGuardianStatus(health.continuousRepairGuardian),
      implementation: 'stephanos-local-node',
      sourceControlledMaintenanceOnly: true,
      arbitraryUnboundedCommandAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...statusResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: statusResult,
    });
  }

  if (shape.command.remoteAction === 'search-project') {
    const searchCall = await callMcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_project',
        arguments: {
          query: shape.command.searchQuery,
          maxResults: shape.command.searchMaxResults,
        },
      },
    }, sessionId);
    const completion = sovereignCommanderCompletionEnvelope(searchCall);
    const rawSearch = completion?.structuredContent;
    if (!searchCall.ok
      || completion?.ok !== true
      || completion?.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !PROOF_HASH_PATTERN.test(text(completion?.proofHash))) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_FAILED', {
        status: searchCall.status,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const projection = safeProjectSearchProjection(rawSearch, shape.command.searchQuery);
    const searchResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PROJECT_SEARCH_COMPLETE',
      remoteAction: 'search-project',
      sourceHead: shape.expectedHead,
      proofHash: text(completion.proofHash).toLowerCase(),
      queryHash: projection.queryHash,
      resultCount: projection.resultCount,
      truncated: projection.truncated,
      results: projection.results,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
      fileContentsReturned: false,
    });
    return Object.freeze({
      ...searchResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: searchResult,
    });
  }

  if (remotePlanRequested) {
    const completedSteps = [];
    for (let index = 0; index < shape.command.remotePlan.length; index += 1) {
      const actionId = shape.command.remotePlan[index];
      const stepTimeoutMs = sovereignCommanderRemotePlanStepTimeoutMs({
        startedAtMs: planStartedAtMs,
        nowMs: Number(nowFn()),
        perCallTimeoutMs: networkTimeoutMs,
      });
      if (stepTimeoutMs <= 0) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      const actionCall = await callMcp({
        jsonrpc: '2.0',
        id: 4 + index,
        method: 'tools/call',
        params: {
          name: 'maintenance_action',
          arguments: { actionId },
        },
      }, sessionId, stepTimeoutMs);
      if (!actionCall.ok) {
        if (actionCall.planDeadlineExceeded === true
          || (actionCall.transportTimedOut === true && actionCall.planBudgetLimited === true)
          || (actionCall.transportTimedOut === true && stepTimeoutMs < networkTimeoutMs)) {
          return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED', {
            stepIndex: index,
            remoteAction: actionId,
            remotePlan: shape.command.remotePlan,
            stepCount: completedSteps.length,
            completedSteps: Object.freeze(completedSteps),
            publicReceiptSafe: true,
            secretMaterialReturned: false,
          });
        }
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          status: actionCall.status,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      const fleetMaintenanceFailure = safeFleetMaintenanceFailureProjection(
        actionCall.body?.result?.structuredContent, actionId);
      if (fleetMaintenanceFailure) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED', {
          stepIndex: index, remoteAction: actionId, remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length, completedSteps: Object.freeze(completedSteps),
          ...fleetMaintenanceFailure,
          publicReceiptSafe: true, secretMaterialReturned: false,
        });
      }
      const boundedFailure = safeMaintenanceFailureProjection(
        actionCall.body?.result?.structuredContent,
        actionId,
      );
      const fleetSupervisor = actionId === FLEET_SUPERVISOR_ACTION
        ? safeFleetSupervisorExecutionProjection(actionCall.body?.result?.structuredContent) : null;
      if (actionId === FLEET_SUPERVISOR_ACTION && !fleetSupervisor) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID', {
          stepIndex: index, remoteAction: actionId, remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length, completedSteps: Object.freeze(completedSteps),
          executionBlocker: 'FLEET_SUPERVISOR_TERMINAL_RECEIPT_INVALID',
          publicReceiptSafe: true, secretMaterialReturned: false,
        });
      }
      if (boundedFailure) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          status: boundedFailure.status,
          processId: boundedFailure.processId,
          errorCode: boundedFailure.errorCode,
          executionBlocker: fleetSupervisor ? 'FLEET_SUPERVISOR_REPORTED_BLOCKED' : boundedFailure.executionBlocker,
          ...(fleetSupervisor ? { fleetSupervisor } : {}),
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      const projection = safeMaintenanceProjection(sovereignCommanderCompletionEnvelope(actionCall));
      const runtimeProofRequired = ['prove-vr-atlas-runtime', 'prove-flywheel-runtime'].includes(actionId);
      const aiProofRequired = actionId === 'prove-stephanos-ai-commander';
      const runtimeProofComplete = !runtimeProofRequired
        || runtimeProofCompleteForAction(actionId, projection.runtimeProof, shape.expectedHead);
      const proofComplete = projection.ok === true
        && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
        && PROOF_HASH_PATTERN.test(projection.proofHash)
        && projection.processId === actionId
        && projection.status === 0
        && (actionId !== FLEET_SUPERVISOR_ACTION || fleetSupervisor?.ok === true)
        && runtimeProofComplete
        && (!aiProofRequired || projection.aiCommanderAcceptance?.toolCalled === true);
      if (!proofComplete) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
          processIdMatch: projection.processId === actionId,
          successfulStatus: projection.status === 0,
          runtimeProof: projection.runtimeProof,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      completedSteps.push(Object.freeze({
        stepIndex: index,
        remoteAction: actionId,
        proofHash: projection.proofHash,
        processId: projection.processId,
        status: projection.status,
        errorCode: projection.errorCode,
        runtimeProof: projection.runtimeProof,
        aiCommanderAcceptance: projection.aiCommanderAcceptance,
        ...(fleetSupervisor ? { fleetSupervisor } : {}),
      }));
    }

    const planProofHash = createHash('sha256').update(JSON.stringify({
      requestId: text(shape.command.requestId),
      sourceHead: shape.expectedHead,
      remotePlan: shape.command.remotePlan,
      completedSteps: completedSteps.map((step) => ({
        stepIndex: step.stepIndex,
        remoteAction: step.remoteAction,
        proofHash: step.proofHash,
        processId: step.processId,
        status: step.status,
      })),
    })).digest('hex');
    const planResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE',
      remotePlan: shape.command.remotePlan,
      stepCount: completedSteps.length,
      completedSteps: Object.freeze(completedSteps),
      planProofHash,
      sourceHead: shape.expectedHead,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...planResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: planResult,
    });
  }

  const actionCall = await callMcp({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: archiveActionRequested
        ? 'starfield_vr_telemetry_archive' : 'maintenance_action',
      arguments: archiveActionRequested
        ? { offset: shape.command.telemetryOffset, limit: shape.command.telemetryLimit }
        : shape.command.remoteAction === 'preservation-converge-pr-branch'
        ? {
          actionId: shape.command.remoteAction,
          targetPrNumber: shape.command.targetPrNumber,
          targetBranch: shape.command.targetBranch,
          targetHead: shape.command.targetHead,
          expectedMain: shape.expectedHead,
        }
        : shape.command.remoteAction === 'publish-controller-activity'
          ? {
            actionId: shape.command.remoteAction,
            controllerActivityPayloadBase64: Buffer.from(
              JSON.stringify(shape.command.controllerActivity),
              'utf8',
            ).toString('base64url'),
          }
          : shape.command.remoteAction === 'sovereign-windows-reviewer-calibration'
            ? { actionId: shape.command.remoteAction, reviewIdentity: shape.command.reviewIdentity }
            : { actionId: shape.command.remoteAction },
    },
  }, sessionId);
  if (!actionCall.ok) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED', { status: actionCall.status });
  }
  const fleetMaintenanceFailure = safeFleetMaintenanceFailureProjection(
    actionCall.body?.result?.structuredContent, shape.command.remoteAction);
  if (fleetMaintenanceFailure) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED', {
      remoteAction: shape.command.remoteAction, ...fleetMaintenanceFailure,
      publicReceiptSafe: true, secretMaterialReturned: false,
    });
  }
  const dedicatedBoundedFailureAction = ['vr-virtual-airlink-acceptance', 'starfield-vr-resource-preflight',
    'rescue-island-readonly-boundary', 'starfield-vr-telemetry-archive']
    .includes(shape.command.remoteAction);
  const boundedFailure = (dedicatedBoundedFailureAction
    || shape.command.remoteAction === 'sovereign-windows-reviewer-calibration')
    ? null
    : safeMaintenanceFailureProjection(actionCall.body?.result?.structuredContent, shape.command.remoteAction);
  const fleetSupervisor = shape.command.remoteAction === FLEET_SUPERVISOR_ACTION
    ? safeFleetSupervisorExecutionProjection(actionCall.body?.result?.structuredContent) : null;
  if (shape.command.remoteAction === FLEET_SUPERVISOR_ACTION && !fleetSupervisor) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_FLEET_RECEIPT_INVALID', {
      remoteAction: shape.command.remoteAction,
      executionBlocker: 'FLEET_SUPERVISOR_TERMINAL_RECEIPT_INVALID',
      publicReceiptSafe: true, secretMaterialReturned: false,
    });
  }
  if (boundedFailure) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED', {
      remoteAction: shape.command.remoteAction,
      status: boundedFailure.status,
      processId: boundedFailure.processId,
      errorCode: boundedFailure.errorCode,
      executionBlocker: fleetSupervisor ? 'FLEET_SUPERVISOR_REPORTED_BLOCKED' : boundedFailure.executionBlocker,
      ...(fleetSupervisor ? { fleetSupervisor } : {}),
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
  }
  const rawMaintenance = (dedicatedBoundedFailureAction
    || shape.command.remoteAction === 'sovereign-windows-reviewer-calibration')
    ? (actionCall.body?.result?.structuredContent || {})
    : sovereignCommanderCompletionEnvelope(actionCall);
  const projection = safeMaintenanceProjection(rawMaintenance);
  if (shape.command.remoteAction === 'sovereign-windows-reviewer-calibration') {
    const calibration = parseWindowsCalibrationRemoteV1(
      findMaintenanceExecutionEnvelope(rawMaintenance), shape.expectedHead,
      shape.command.reviewIdentity.baseSha);
    if (!calibration) {
      // The calibration may fail before it can emit a typed, signed-source
      // candidate/HOLD projection. Keep receipt admission fail-closed while
      // exposing only the pre-existing strict token-filtered native failure.
      // Never echo native stdout, stderr, command arguments, identities or paths.
      const nativeFailure = safeMaintenanceFailureProjection(
        rawMaintenance, shape.command.remoteAction);
      return fail('SOVEREIGN_WINDOWS_CALIBRATION_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        ...(nativeFailure ? {
          // The canonical public mailbox reads operationResult.status.
          // Missing native exit status remains absent, never coerced to zero.
          ...(Number.isInteger(nativeFailure.status)
            ? { status: nativeFailure.status } : {}),
          errorCode: nativeFailure.errorCode,
          executionBlocker: nativeFailure.executionBlocker,
        } : {}),
        publicReceiptSafe: true, secretMaterialReturned: false,
      });
    }
    // DONE means candidate exam completed, not that a specialist was admitted.
    if (calibration.status !== 'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED') {
      return fail('SOVEREIGN_WINDOWS_CALIBRATION_HELD', {
        remoteAction: shape.command.remoteAction, calibration,
        publicReceiptSafe: true, secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true, finalVerdict: 'SOVEREIGN_WINDOWS_CALIBRATION_CANDIDATE_OBSERVED',
      remoteAction: shape.command.remoteAction, sourceHead: shape.expectedHead,
      proofHash: projection.proofHash, calibration,
      qualifiedWindowsSpecialist: false, mergeAuthority: false, leaseReleaseAuthority: false,
      vendorMeterRequired: false, publicReceiptSafe: true, secretMaterialReturned: false,
    });
    return Object.freeze({ ...result, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId), result });
  }

  const coreDaemonStatus = shape.command.remoteAction === 'status-stephanos-core-daemon'
    ? safeCoreDaemonStatusProjection(rawMaintenance)
    : null;

  if (shape.command.remoteAction === 'publish-controller-activity') {
    const publication = projection.controllerActivityPublication;
    const requested = shape.command.controllerActivity;
    const requestedMaterialLaneCount = Array.isArray(requested?.materialLanes) ? requested.materialLanes.length : 0;
    const requestedMaterialActionsSucceeded = Number(requested?.materialActionsSucceeded ?? 0);
    const publicationProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && publication?.ok === true
      && publication?.statusWritten === true
      && publication?.controllerId === requested?.controllerId
      && publication?.runId === requested?.runId
      && publication?.executionState === requested?.executionState
      && publication?.materialLaneCount === requestedMaterialLaneCount
      && publication?.materialActionsSucceeded === requestedMaterialActionsSucceeded;
    if (!publicationProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicationPresent: Boolean(publication),
        statusWritten: publication?.statusWritten === true,
        controllerIdMatch: publication?.controllerId === requested?.controllerId,
        runIdMatch: publication?.runId === requested?.runId,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const controllerActivityResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_PUBLICATION_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      controllerActivityPublication: publication,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...controllerActivityResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: controllerActivityResult,
    });
  }

  if (shape.command.remoteAction === 'status-stephanos-core-daemon') {
    const coreHealthy = coreDaemonStatus?.available === true
      && coreDaemonStatus?.ok === true
      && coreDaemonStatus?.daemonHealthy === true
      // A fresh heartbeat without exclusive lock/loaded rescue proof is not
      // evidence of a healthy Core writer. Missing fields fail closed.
      && coreDaemonStatus?.singleWriterProven === true
      && coreDaemonStatus?.writerProcessObserved === true
      && coreDaemonStatus?.lockOwnerMatchesWriter === true
      && coreDaemonStatus?.rescueGenerationPresent === true
      && Number.isSafeInteger(coreDaemonStatus?.rescueAttemptCount)
      && coreDaemonStatus.rescueAttemptCount >= 0
      && (coreDaemonStatus?.heartbeatFresh === true || coreDaemonStatus?.busyGraceActive === true)
      && coreDaemonStatus.sourceHead === shape.expectedHead
      && coreDaemonStatus.readiness !== 'RELOAD_REQUIRED';
    if (!coreHealthy) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CORE_DAEMON_NOT_READY', {
        remoteAction: shape.command.remoteAction,
        sourceHead: shape.expectedHead,
        coreDaemonStatus,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
  }

  if (shape.command.remoteAction === 'preservation-converge-pr-branch') {
    const preservationConvergence = safePreservationConvergenceProjection(rawMaintenance, shape.command);
    if (!preservationConvergence) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        targetPrNumber: shape.command.targetPrNumber,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const convergenceResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: preservationConvergence.proofHash,
      preservationConvergence,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...convergenceResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: convergenceResult,
    });
  }



  if (shape.command.remoteAction === 'rescue-island-readonly-boundary') {
    // Do not treat a generic successful maintenance call as an OS-scope proof.
    // The fixed native child must publish its own one-line, closed-world result.
    const nativeEnvelope = findMaintenanceExecutionEnvelope(rawMaintenance);
    const failedEnvelope = findFailedMaintenanceExecutionEnvelope(rawMaintenance);
    const candidate = Object.keys(nativeEnvelope).length > 0 ? nativeEnvelope : failedEnvelope;
    const nativeProcessId = text(candidate?.command?.plan?.processId);
    const nativeStatus = candidate?.structuredContent?.status;
    const nativeStdout = candidate?.structuredContent?.stdout;
    const held = parseRescueIslandBoundaryHeldStdoutV1(nativeStdout, nativeProcessId);
    if (held && nativeProcessId === shape.command.remoteAction
        && nativeStatus === 1
        && candidate?.ok === false
        && candidate?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED') {
      return fail('SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_HELD', {
        remoteAction: shape.command.remoteAction,
        executionBlocker: held.blocker,
        rescueIslandBoundary: held,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const readback = parseRescueIslandBoundaryStdoutV1(
      nativeStdout, nativeProcessId,
    );
    if (projection.ok !== true
      || projection.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !PROOF_HASH_PATTERN.test(projection.proofHash)
      || projection.processId !== shape.command.remoteAction
      || projection.status !== 0
      || !readback) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        executionBlocker: diagnoseRescueIslandNativeReceiptInvalidV1({
          envelope: candidate,
          expectedAction: shape.command.remoteAction,
          projection, positive: readback, negative: held,
          rawMaintenance,
          mcpError: actionCall.body?.result?.isError === true,
        }),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_OBSERVED',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      rescueIslandBoundary: readback,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      originalSourceLeaseReleaseAllowed: false,
      mergeAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...result,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result,
    });
  }

  if (shape.command.remoteAction === 'cpu-pressure-snapshot') {
    const cpuPressure = safeCpuPressureSnapshotProjection(rawMaintenance, projection.processId);
    if (projection.ok !== true
      || projection.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !PROOF_HASH_PATTERN.test(projection.proofHash)
      || projection.processId !== shape.command.remoteAction
      || projection.status !== 0
      || !cpuPressure) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      cpuPressure,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...result,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result,
    });
  }

  if (shape.command.remoteAction === 'visibility-snapshot') {
    const visibilitySnapshot = safeVisibilitySnapshotProjection(rawMaintenance, projection.processId);
    const visibilityProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && visibilitySnapshot
      && visibilitySnapshot.readOnly === true
      && visibilitySnapshot.sourceMutationAllowed === false
      && visibilitySnapshot.arbitraryShellAllowed === false
      && visibilitySnapshot.arbitraryProcessInspectionAllowed === false
      && visibilitySnapshot.rawLogsReturned === false
      && visibilitySnapshot.rawPathsReturned === false
      && visibilitySnapshot.secretMaterialIncluded === false
      && visibilitySnapshot.mergeAuthority === false
      && visibilitySnapshot.pcRestartAuthority === false
      && visibilitySnapshot.remoteCommanderRequired === false
      && visibilitySnapshot.unknownMeansGreen === false;
    if (!visibilityProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const visibilityResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      visibilitySnapshot,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...visibilityResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: visibilityResult,
    });
  }

  if (shape.command.remoteAction === 'battle-bridge-observe') {
    const observation = safeBattleBridgeObservationProjection(rawMaintenance, projection.processId);
    const observationProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && observation
      && observation.readOnly === true
      && observation.arbitraryShellAllowed === false
      && observation.secretMaterialIncluded === false;
    if (!observationProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_OBSERVATION_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const observationResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_BATTLE_BRIDGE_OBSERVATION_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      observation,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...observationResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: observationResult,
    });
  }

  if (shape.command.remoteAction === 'meter-status') {
    const meterStatus = safeMeterStatusProjection(rawMaintenance, projection.processId);
    const meterProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && meterStatus
      && meterStatus.readOnly === true
      && meterStatus.arbitraryShellAllowed === false
      && meterStatus.secretMaterialIncluded === false
      && meterStatus.unknownMeansGreen === false;
    if (!meterProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const meterResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      meterStatus,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...meterResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: meterResult,
    });
  }

  if (shape.command.remoteAction === 'controller-lane-status') {
    const controllerLaneStatus = safeControllerLaneStatusProjection(rawMaintenance, projection.processId);
    const statusProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && controllerLaneStatus
      && controllerLaneStatus.readOnly === true
      && controllerLaneStatus.arbitraryShellAllowed === false
      && controllerLaneStatus.sourceMutationAllowed === false
      && controllerLaneStatus.mergeAuthority === false
      && controllerLaneStatus.secretMaterialIncluded === false
      && controllerLaneStatus.unknownMeansGreen === false;
    if (!statusProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const controllerLaneResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      controllerLaneStatus,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...controllerLaneResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: controllerLaneResult,
    });
  }

  if (shape.command.remoteAction === 'starfield-vr-telemetry-archive') {
    const telemetryArchive = safeStarfieldVrTelemetryArchiveProjection(rawMaintenance, projection.processId);
    const proofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && telemetryArchive?.readOnly === true
      && telemetryArchive.rawTelemetryReturned === false
      && telemetryArchive.hostPathsReturned === false
      && telemetryArchive.secretMaterialReturned === false;
    if (!proofComplete) {
      const mcpReply = actionCall.body?.result;
      const mcpError = mcpReply?.isError === true;
      const safeEnvelope = findMaintenanceExecutionEnvelope(rawMaintenance);
      const source = Object.keys(safeEnvelope).length > 0 ? safeEnvelope : rawMaintenance;
      const stdout = String(source?.structuredContent?.stdout || '');
      const marker = 'STARFIELD_VR_TELEMETRY_ARCHIVE_RESULT=';
      const markerLine = stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
      let decoded = null;
      try { decoded = markerLine ? JSON.parse(markerLine.slice(marker.length)) : null; } catch {}
      const reason = projection.ok !== true
        || projection.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
        ? 'EXECUTION_ENVELOPE_INVALID'
        : !PROOF_HASH_PATTERN.test(projection.proofHash)
          ? 'PROOF_HASH_MISSING'
          : projection.processId !== shape.command.remoteAction
            ? 'PROCESS_ID_MISMATCH'
            : projection.status !== 0
              ? 'PROCESS_STATUS_INVALID'
              : !markerLine
                ? 'MARKER_MISSING'
                : !decoded
                  ? 'JSON_UNREADABLE'
                  : decoded.ok !== true
                    ? 'ARCHIVE_NOT_READY'
                    : decoded.schemaVersion !== 'stephanos.starfield-vr-telemetry-archive.v1'
                      ? 'SCHEMA_MISMATCH'
                      : 'ARCHIVE_CONTRACT_INVALID';
      const originalEnvelope = mcpReply?.structuredContent;
      const classifiedCode = [
        originalEnvelope?.blocker,
        originalEnvelope?.structuredContent?.blocker,
        originalEnvelope?.structuredContent?.structuredContent?.blocker,
      ].map((value) => text(value)).find((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) || '';
      const failure = safeMaintenanceFailureProjection(originalEnvelope, shape.command.remoteAction);
      return fail('SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_ARCHIVE_' + reason, {
        remoteAction: shape.command.remoteAction,
        dedicatedToolAdvertised: archiveDedicatedAdvertised,
        fixedMaintenanceFallbackSelected: false,
        mcpToolReturnedError: mcpError,
        commanderBlocker: classifiedCode,
        executionStatus: failure?.status ?? null,
        executionErrorCode: failure?.errorCode || '',
        executionBlocker: failure?.executionBlocker || '',
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        archivePresent: telemetryArchive !== null,
        publicReceiptSafe: true, secretMaterialReturned: false,
      });
    }
    const result = Object.freeze({
      ok: true,
      finalVerdict: telemetryArchive.finalVerdict,
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      telemetryArchive,
      vendorMeterRequired: false, externalSaasRelayRequired: false,
      arbitraryShellAllowed: false, sourceMutationAllowed: false,
      mergeAuthority: false, pcRestartAuthority: false,
      publicReceiptSafe: true, secretMaterialReturned: false,
    });
    return Object.freeze({
      ...result,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result,
    });
  }

  if (['report-starfield-vr-telemetry', 'starfield-vr-telemetry-refresh'].includes(shape.command.remoteAction)) {
    const telemetry = safeStarfieldVrTelemetryProjection(rawMaintenance, projection.processId);
    const telemetryProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && telemetry
      && telemetry.primaryTelemetryPublished === true
      && telemetry.rawTelemetryReturned === false
      && telemetry.hostPathsReturned === false
      && telemetry.secretMaterialReturned === false;
    if (!telemetryProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        telemetryProjectionPresent: Boolean(telemetry),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const telemetryResult = Object.freeze({
      ok: true,
      finalVerdict: telemetry.degraded
        ? 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED'
        : 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      processId: projection.processId,
      status: projection.status,
      telemetry,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...telemetryResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: telemetryResult,
    });
  }

  if (shape.command.remoteAction === 'starfield-vr-resource-preflight') {
    const preflight = safeStarfieldVrResourcePreflightProjection(rawMaintenance);
    const successReceiptProven = preflight?.ok === true
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED';
    const failureEnvelope = findFailedMaintenanceExecutionEnvelope(rawMaintenance);
    const failedProcessId = text(failureEnvelope?.command?.plan?.processId);
    const failedStatus = Number(failureEnvelope?.structuredContent?.status);
    const boundedFailureProven = preflight?.ok === false
      && failureEnvelope?.ok === false
      && failureEnvelope?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
      && failedProcessId === shape.command.remoteAction
      && Number.isInteger(failedStatus)
      && failedStatus !== 0;
    const boundedFailureProofHash = boundedFailureProven
      ? createHash('sha256').update(JSON.stringify({
        expectedHead: shape.expectedHead,
        remoteAction: shape.command.remoteAction,
        processId: failedProcessId,
        status: failedStatus,
        preflight,
      })).digest('hex')
      : '';
    const receiptProven = successReceiptProven
      || (boundedFailureProven && PROOF_HASH_PATTERN.test(boundedFailureProofHash));
    const effectiveProofHash = successReceiptProven ? projection.proofHash : boundedFailureProofHash;
    const effectiveProcessId = successReceiptProven ? projection.processId : failedProcessId;
    const effectiveStatus = successReceiptProven ? projection.status : failedStatus;
    if (!receiptProven || !preflight) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_PREFLIGHT_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(effectiveProofHash),
        processIdMatch: effectiveProcessId === shape.command.remoteAction,
        boundedStatus: Number.isInteger(effectiveStatus),
      });
    }
    const preflightResult = Object.freeze({
      ok: true,
      preflightPassed: preflight.ok,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_PREFLIGHT_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: effectiveProofHash,
      processId: effectiveProcessId,
      status: effectiveStatus,
      preflight,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...preflightResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: preflightResult,
    });
  }

  if (shape.command.remoteAction === 'vr-virtual-airlink-acceptance') {
    const acceptance = safeVrVirtualAirLinkAcceptanceProjection(rawMaintenance);
    const successReceiptProven = PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED';
    const failureEnvelope = findFailedMaintenanceExecutionEnvelope(rawMaintenance);
    const failedProcessId = text(failureEnvelope?.command?.plan?.processId);
    const failedStatus = Number(failureEnvelope?.structuredContent?.status);
    const boundedFailureProven = acceptance?.ok === false
      && acceptance.finalVerdict === 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED'
      && failureEnvelope?.ok === false
      && failureEnvelope?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
      && failedProcessId === shape.command.remoteAction
      && failedStatus === 2;
    const boundedFailureProofHash = boundedFailureProven
      ? createHash('sha256').update(JSON.stringify({
        expectedHead: shape.expectedHead,
        remoteAction: shape.command.remoteAction,
        processId: failedProcessId,
        status: failedStatus,
        acceptance,
      })).digest('hex')
      : '';
    const receiptProven = successReceiptProven
      || (boundedFailureProven && PROOF_HASH_PATTERN.test(boundedFailureProofHash));
    const effectiveProofHash = successReceiptProven ? projection.proofHash : boundedFailureProofHash;
    const effectiveProcessId = successReceiptProven ? projection.processId : failedProcessId;
    const effectiveStatus = successReceiptProven ? projection.status : failedStatus;
    if (!receiptProven || !acceptance) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(effectiveProofHash),
        processIdMatch: effectiveProcessId === shape.command.remoteAction,
        boundedStatus: [0, 2].includes(effectiveStatus),
      });
    }
    const acceptanceResult = Object.freeze({
      ok: true,
      acceptancePassed: acceptance.ok,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: effectiveProofHash,
      processId: effectiveProcessId,
      status: effectiveStatus,
      acceptance,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...acceptanceResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: acceptanceResult,
    });
  }

  const runtimeProofRequired = ['prove-vr-atlas-runtime', 'prove-flywheel-runtime'].includes(shape.command.remoteAction);
  const aiProofRequired = shape.command.remoteAction === 'prove-stephanos-ai-commander';
  if (aiProofRequired) {
    const acceptance = projection.aiCommanderAcceptance;
    const actionEnvelopeComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0;
    if (!actionEnvelopeComplete || !acceptance) {
      // Preserve the precise *safe* gate that failed through the existing
      // public mailbox executionBlocker projection. Previously all these
      // distinct live failures collapsed into RECEIPT_INVALID, hiding whether
      // the Commander action ran, returned a valid envelope, or lost stdout.
      // Do not expose the raw MCP payload, stdout, file paths or credentials.
      const executionBlocker = projection.ok !== true
        ? 'AI_COMMANDER_ACTION_ENVELOPE_MISSING'
        : projection.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
          ? 'AI_COMMANDER_ACTION_COMPLETION_UNVERIFIED'
          : !PROOF_HASH_PATTERN.test(projection.proofHash)
            ? 'AI_COMMANDER_ACTION_PROOF_HASH_MISSING'
            : projection.processId !== shape.command.remoteAction
              ? 'AI_COMMANDER_ACTION_ID_MISMATCH'
              : projection.status !== 0
                ? 'AI_COMMANDER_ACTION_STATUS_NOT_ZERO'
                : 'AI_COMMANDER_TYPED_ACCEPTANCE_MISSING';
      return fail('SOVEREIGN_COMMANDER_REMOTE_AI_CHAT_ACCEPTANCE_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        executionBlocker,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        typedAcceptancePresent: Boolean(acceptance),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    // A fixed read-only probe can execute successfully while the observed AI
    // route is offline or incorrectly wired. Preserve its precise sanitised
    // blocker without claiming the action or the Commander is healthy.
    if (acceptance.ok !== true) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_AI_CHAT_ACCEPTANCE_BLOCKED', {
        remoteAction: shape.command.remoteAction,
        acceptanceBlocker: acceptance.blocker,
        executionBlocker: acceptance.blocker,
        toolCalled: acceptance.toolCalled,
        healthAvailable: acceptance.healthAvailable,
        acceptanceProofHash: acceptance.proofHash,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
  }


  const runtimeProofComplete = !runtimeProofRequired
    || runtimeProofCompleteForAction(shape.command.remoteAction, projection.runtimeProof, shape.expectedHead);
  const observationRequired = shape.command.remoteAction === 'battle-bridge-observe';
  const observationComplete = !observationRequired || (
    projection.observation?.ok === true
    && projection.observation?.schemaVersion === 'stephanos.battle-bridge-observation.v1'
    && projection.observation?.hostRole === 'battle-bridge'
    && projection.observation?.readOnly === true
    && projection.observation?.arbitraryShellAllowed === false
    && projection.observation?.secretMaterialIncluded === false
    && projection.observation?.finalVerdict === 'BATTLE_BRIDGE_OBSERVATION_READY'
  );
  const proofComplete = projection.ok === true
    && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
    && PROOF_HASH_PATTERN.test(projection.proofHash)
    && projection.processId === shape.command.remoteAction
    && projection.status === 0
    && (shape.command.remoteAction !== FLEET_SUPERVISOR_ACTION || fleetSupervisor?.ok === true)
    && runtimeProofComplete
    && observationComplete
    && (!aiProofRequired || projection.aiCommanderAcceptance?.toolCalled === true);
  if (!proofComplete) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID', {
      remoteAction: shape.command.remoteAction,
      proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
      processIdMatch: projection.processId === shape.command.remoteAction,
      successfulStatus: projection.status === 0,
      runtimeProof: projection.runtimeProof,
      observation: projection.observation,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
  }

  const maintenanceResult = Object.freeze({
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
    remoteAction: shape.command.remoteAction,
    sourceHead: shape.expectedHead,
    proofHash: projection.proofHash,
    processId: projection.processId,
    status: projection.status,
    errorCode: projection.errorCode,
    runtimeProof: projection.runtimeProof,
    aiCommanderAcceptance: projection.aiCommanderAcceptance,
    observation: projection.observation,
    meterStatus: projection.meterStatus,
    controllerLaneStatus: projection.controllerLaneStatus,
    controllerActivityPublication: projection.controllerActivityPublication,
    capabilityParity: projection.capabilityParity,
    ...(fleetSupervisor ? { fleetSupervisor } : {}),
    ...(coreDaemonStatus ? { coreDaemonStatus } : {}),
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  });
  return Object.freeze({
    ...maintenanceResult,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    requestId: text(shape.command.requestId),
    maintenance: projection,
    result: maintenanceResult,
  });
}
