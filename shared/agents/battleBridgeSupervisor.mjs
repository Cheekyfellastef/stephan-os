import { adjudicateBackendFreshnessProof } from './backendFreshnessSupervisor.mjs';
import { createSharedWorkspaceMessage, validateSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

export const BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION = 'battle-bridge-supervisor.v1';

export const BATTLE_BRIDGE_SERVICE_STATE = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  RECOVERING: 'RECOVERING',
});

export const BATTLE_BRIDGE_RECOVERY_STATE = Object.freeze({
  NONE: 'NONE',
  REQUESTED: 'REQUESTED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
});

export const BATTLE_BRIDGE_SERVICE_IDS = Object.freeze([
  'stephanos-ui',
  'backend',
  'mission-worker',
  'openclaw-gateway',
]);

export const BATTLE_BRIDGE_SERVICE_ALIASES = Object.freeze({
  'mission-orchestrator-worker': 'mission-worker',
  worker: 'mission-worker',
  ui: 'stephanos-ui',
  stephanos: 'stephanos-ui',
  openclaw: 'openclaw-gateway',
});

export const BATTLE_BRIDGE_SERVICE_PORTS = Object.freeze({
  backend: 8787,
  'openclaw-gateway': 18789,
  'stephanos-ui': 4173,
});

export const BATTLE_BRIDGE_PROBE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN',
});

export const BATTLE_BRIDGE_UPDATE_STATUS = Object.freeze({
  UPDATE_AVAILABLE: 'UPDATE_AVAILABLE',
  PULL_REQUIRED: 'PULL_REQUIRED',
  REBUILD_REQUIRED: 'REBUILD_REQUIRED',
  AUTO_UPDATE_NOT_ENABLED: 'AUTO_UPDATE_NOT_ENABLED',
  CURRENT: 'CURRENT',
});

export const BATTLE_BRIDGE_ACTION_STATUS = Object.freeze({
  READY: 'READY',
  NEEDS_START: 'NEEDS_START',
  NEEDS_RESTART: 'NEEDS_RESTART',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/#() -]{0,240}$/i;
const FORBIDDEN_DETAIL_PATTERN = /token|secret|password|credential|private key|\.env/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text || FORBIDDEN_DETAIL_PATTERN.test(text)) return fallback;
  return SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function safeId(value, fallback) {
  const text = asText(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function normalizeServiceId(value) {
  const id = safeId(value, 'mission-worker');
  const aliased = BATTLE_BRIDGE_SERVICE_ALIASES[id] || id;
  return BATTLE_BRIDGE_SERVICE_IDS.includes(aliased) ? aliased : 'mission-worker';
}

function normalizeServiceState(value) {
  const state = asText(value, BATTLE_BRIDGE_SERVICE_STATE.UNKNOWN).toUpperCase();
  return Object.values(BATTLE_BRIDGE_SERVICE_STATE).includes(state) ? state : BATTLE_BRIDGE_SERVICE_STATE.UNKNOWN;
}

function normalizeRecoveryState(value) {
  const state = asText(value, BATTLE_BRIDGE_RECOVERY_STATE.NONE).toUpperCase();
  return Object.values(BATTLE_BRIDGE_RECOVERY_STATE).includes(state) ? state : BATTLE_BRIDGE_RECOVERY_STATE.NONE;
}

function normalizeUpdateStatus(value) {
  const status = asText(value, BATTLE_BRIDGE_UPDATE_STATUS.AUTO_UPDATE_NOT_ENABLED).toUpperCase();
  return Object.values(BATTLE_BRIDGE_UPDATE_STATUS).includes(status) ? status : BATTLE_BRIDGE_UPDATE_STATUS.AUTO_UPDATE_NOT_ENABLED;
}

function normalizeProbeStatus(value) {
  const status = asText(value, BATTLE_BRIDGE_PROBE_STATUS.UNKNOWN).toUpperCase();
  return Object.values(BATTLE_BRIDGE_PROBE_STATUS).includes(status) ? status : BATTLE_BRIDGE_PROBE_STATUS.UNKNOWN;
}

export function buildBattleBridgeSupervisorContract() {
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    contractKind: 'stephanos.battle_bridge.supervisor.contract',
    services: [...BATTLE_BRIDGE_SERVICE_IDS],
    serviceStates: Object.values(BATTLE_BRIDGE_SERVICE_STATE),
    recoveryStates: Object.values(BATTLE_BRIDGE_RECOVERY_STATE),
    knownPorts: { ...BATTLE_BRIDGE_SERVICE_PORTS },
    requiredHealthFields: ['schemaVersion', 'serviceId', 'state', 'recoveryState', 'checkedAtUtc', 'summary', 'health'],
    requiredReceiptFields: ['schemaVersion', 'receiptId', 'serviceId', 'recoveryState', 'restartIntentPublished', 'executedCommand'],
    guardrails: {
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      processKillingAllowed: false,
      actualRestartImplementationAllowed: false,
      mutationAllowedByDefault: false,
      restartRequiresExplicitServiceId: true,
      structuredContractsOnly: true,
      secretOutputAllowed: false,
      visiblePowerShellWallsAllowed: false,
    },
    workspaceRoutes: {
      status: 'status/battle-bridge-supervisor.json',
      events: 'events/battle-bridge-supervisor.ndjson',
      receipts: 'receipts/battle-bridge-supervisor-recovery.json',
    },
    finalVerdict: 'BATTLE_BRIDGE_SUPERVISOR_CONTRACT_READY',
  };
}

export function buildBattleBridgeServiceRegistry(input = {}) {
  const now = safeText(input.timestampUtc, 'pending');
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.service_registry',
    generatedAtUtc: now,
    services: BATTLE_BRIDGE_SERVICE_IDS.map((serviceId) => ({
      serviceId,
      displayName: {
        'stephanos-ui': 'Stephanos UI',
        backend: 'Backend',
        'mission-worker': 'Mission Worker',
        'openclaw-gateway': 'OpenClaw Gateway',
      }[serviceId],
      port: BATTLE_BRIDGE_SERVICE_PORTS[serviceId] || null,
      commandExecutionAllowed: false,
      processKillAllowed: false,
      restartImplementationAllowed: false,
      restartIntentAllowed: true,
    })),
    finalVerdict: 'BATTLE_BRIDGE_SERVICE_REGISTRY_READY',
  };
}

export function createBattleBridgeHealthRecord(input = {}) {
  const serviceId = normalizeServiceId(input.serviceId);
  const state = normalizeServiceState(input.state);
  const recoveryState = normalizeRecoveryState(input.recoveryState);
  const failing = [BATTLE_BRIDGE_SERVICE_STATE.FAILED, BATTLE_BRIDGE_SERVICE_STATE.DEGRADED, BATTLE_BRIDGE_SERVICE_STATE.UNKNOWN].includes(state);
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.health',
    serviceId,
    state,
    recoveryState,
    checkedAtUtc: safeText(input.checkedAtUtc, 'pending'),
    heartbeatId: safeText(input.heartbeatId, `${serviceId}-heartbeat-pending`),
    health: {
      reachable: input.reachable === true,
      usable: input.usable === true,
      browserCompatible: input.browserCompatible === true,
      detail: safeText(input.detail, ''),
    },
    summary: safeText(input.summary, `${serviceId} health is ${state.toLowerCase()}.`),
    failurePublished: failing,
    sharedWorkspaceEventKind: failing ? 'error' : 'health-check-result',
  };
}

export function createBattleBridgeHeartbeat(input = {}) {
  const serviceId = normalizeServiceId(input.serviceId);
  const sequence = Number.isInteger(input.sequence) && input.sequence >= 0 ? input.sequence : 0;
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.heartbeat',
    heartbeatId: safeText(input.heartbeatId, `${serviceId}-heartbeat-${sequence}`),
    serviceId,
    state: normalizeServiceState(input.state || BATTLE_BRIDGE_SERVICE_STATE.UNKNOWN),
    sequence,
    publishedAtUtc: safeText(input.publishedAtUtc, 'pending'),
    sharedWorkspaceEventKind: 'heartbeat',
  };
}

export function transitionBattleBridgeWorkerState(input = {}) {
  const currentState = normalizeServiceState(input.currentState);
  const event = safeText(input.event, 'observe').toLowerCase();
  const table = {
    observe: currentState,
    start_requested: currentState === 'STOPPED' || currentState === 'UNKNOWN' ? 'STARTING' : currentState,
    health_passed: 'READY',
    health_degraded: 'DEGRADED',
    health_failed: 'FAILED',
    recovery_requested: 'RECOVERING',
    recovery_succeeded: 'READY',
    recovery_failed: 'FAILED',
    stopped: 'STOPPED',
  };
  const nextState = normalizeServiceState(table[event] || currentState);
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.worker_lifecycle_transition',
    serviceId: normalizeServiceId(input.serviceId || 'mission-worker'),
    previousState: currentState,
    event,
    nextState,
    executedCommand: false,
    finalVerdict: 'BATTLE_BRIDGE_WORKER_STATE_TRANSITION_RECORDED',
  };
}

export function createBattleBridgeRecoveryReceipt(input = {}) {
  const serviceId = normalizeServiceId(input.serviceId);
  const recoveryState = normalizeRecoveryState(input.recoveryState);
  const receiptId = safeText(input.receiptId, `${serviceId}-recovery-pending`);
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.recovery_receipt',
    receiptId,
    serviceId,
    requestedAtUtc: safeText(input.requestedAtUtc, 'pending'),
    completedAtUtc: safeText(input.completedAtUtc, ''),
    recoveryState,
    reason: safeText(input.reason, 'deterministic supervisor simulation'),
    restartIntentPublished: input.restartIntentPublished === true,
    executedCommand: false,
    killedProcess: false,
    secretOutputIncluded: false,
    sharedWorkspaceEventKind: recoveryState === 'FAILED' ? 'error' : 'command-intent',
    finalVerdict: recoveryState === 'FAILED' ? 'BATTLE_BRIDGE_RECOVERY_FAILED' : 'BATTLE_BRIDGE_RECOVERY_RECEIPT_RECORDED',
  };
}

export function createBattleBridgeWorkspaceEvent(input = {}) {
  const message = createSharedWorkspaceMessage({
    messageId: safeText(input.messageId, 'battle-bridge-supervisor-event'),
    timestampUtc: safeText(input.timestampUtc, 'pending'),
    sender: 'mission-orchestrator',
    recipient: input.requiresOperator ? 'operator' : 'stephanos',
    kind: input.eventKind || 'status',
    severity: input.severity || 'info',
    correlationId: safeText(input.correlationId, 'battle-bridge-supervisor'),
    summary: safeText(input.summary, 'Battle Bridge supervisor event.'),
    status: safeText(input.status, 'recorded'),
    requiresOperator: input.requiresOperator === true,
    proofRefs: input.proofRefs,
  });
  return { ...message, validation: validateSharedWorkspaceMessage(message) };
}

export function publishBattleBridgeSupervisorStatus(input = {}) {
  const heartbeat = createBattleBridgeHeartbeat(input.heartbeat || input);
  const healthRecords = Array.isArray(input.healthRecords) ? input.healthRecords.map(createBattleBridgeHealthRecord) : [];
  const recoveryReceipts = Array.isArray(input.recoveryReceipts) ? input.recoveryReceipts.map(createBattleBridgeRecoveryReceipt) : [];
  const failing = healthRecords.filter((record) => record.failurePublished);
  const restartIntents = recoveryReceipts.filter((receipt) => receipt.restartIntentPublished);
  const status = failing.length === 0 ? 'ready' : 'action-required';
  const event = createBattleBridgeWorkspaceEvent({
    messageId: safeText(input.messageId, 'battle-bridge-supervisor-status'),
    timestampUtc: heartbeat.publishedAtUtc,
    eventKind: failing.length === 0 ? 'health-check-result' : 'operator-action-required',
    severity: failing.length === 0 ? 'info' : 'warning',
    summary: failing.length === 0 ? 'Battle Bridge supervisor status is ready.' : 'Battle Bridge supervisor published failures and restart intent only.',
    status,
    requiresOperator: failing.length > 0,
    proofRefs: ['status/battle-bridge-supervisor.json'],
  });
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.status_publication',
    heartbeat,
    healthRecords,
    recoveryReceipts,
    failureServiceIds: failing.map((record) => record.serviceId),
    restartIntentServiceIds: restartIntents.map((receipt) => receipt.serviceId),
    workspaceMessage: event,
    visibleLogWall: false,
    finalVerdict: failing.length === 0 ? 'BATTLE_BRIDGE_SUPERVISOR_STATUS_READY' : 'BATTLE_BRIDGE_SUPERVISOR_STATUS_ACTION_REQUIRED',
  };
}

export function simulateBattleBridgeSelfHeal(input = {}) {
  const serviceId = normalizeServiceId(input.serviceId || 'mission-worker');
  const startState = normalizeServiceState(input.startState || 'FAILED');
  const requested = transitionBattleBridgeWorkerState({ serviceId, currentState: startState, event: 'recovery_requested' });
  const succeeds = input.succeeds !== false;
  const finished = transitionBattleBridgeWorkerState({ serviceId, currentState: requested.nextState, event: succeeds ? 'recovery_succeeded' : 'recovery_failed' });
  const receipt = createBattleBridgeRecoveryReceipt({
    receiptId: `${serviceId}-simulated-recovery`,
    serviceId,
    recoveryState: succeeds ? 'SUCCEEDED' : 'FAILED',
    restartIntentPublished: true,
    reason: 'deterministic self-heal simulation only',
    requestedAtUtc: input.requestedAtUtc,
    completedAtUtc: input.completedAtUtc,
  });
  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.self_heal_simulation',
    serviceId,
    transitions: [requested, finished],
    receipt,
    executedCommand: false,
    killedProcess: false,
    finalVerdict: succeeds ? 'BATTLE_BRIDGE_SELF_HEAL_SIMULATION_SUCCEEDED' : 'BATTLE_BRIDGE_SELF_HEAL_SIMULATION_FAILED',
  };
}

export function createBattleBridgeProbe(input = {}) {
  const serviceId = normalizeServiceId(input.serviceId);
  const status = normalizeProbeStatus(input.status);
  const port = Number.isInteger(input.port) ? input.port : BATTLE_BRIDGE_SERVICE_PORTS[serviceId] || null;
  const summary = safeText(input.summary, `${serviceId} probe ${status.toLowerCase()}`);

  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.probe',
    serviceId,
    status,
    port,
    checkedAtUtc: safeText(input.checkedAtUtc, 'pending'),
    summary,
    detail: safeText(input.detail, ''),
    operatorVisible: input.operatorVisible !== false,
    sharedWorkspaceEventKind: status === BATTLE_BRIDGE_PROBE_STATUS.PASS ? 'health-check-result' : 'operator-action-required',
  };
}

export function createMissionWorkerSelfHealPlan(input = {}) {
  const probe = createBattleBridgeProbe({
    serviceId: 'mission-worker',
    status: input.workerHealthy === true ? 'PASS' : 'FAIL',
    checkedAtUtc: input.checkedAtUtc,
    summary: input.workerHealthy === true ? 'Mission Worker is healthy.' : 'Mission Worker did not recover.',
    detail: input.detail,
  });

  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.self_heal_plan',
    targetServiceId: 'mission-worker',
    currentProbe: probe,
    actionStatus: probe.status === 'PASS' ? BATTLE_BRIDGE_ACTION_STATUS.READY : BATTLE_BRIDGE_ACTION_STATUS.NEEDS_RESTART,
    exactUnblockAction: probe.status === 'PASS' ? '' : 'Publish restart intent for mission-worker and keep real restart execution future-gated.',
    restartCommand: '',
    restartIntentOnly: probe.status !== 'PASS',
    statusRoute: 'shared-workspace/status/battle-bridge-supervisor.json',
    proofRoute: 'shared-workspace/proof/battle-bridge-supervisor-worker-self-heal.json',
    finalVerdict: probe.status === 'PASS' ? 'WORKER_SELF_HEAL_NOT_REQUIRED' : 'WORKER_SELF_HEAL_RESTART_INTENT_ONLY',
  };
}

export function aggregateBattleBridgeSupervisorProbes(input = {}) {
  const probes = Array.isArray(input.probes) ? input.probes.map(createBattleBridgeProbe) : [];
  const failed = probes.filter((probe) => probe.status !== BATTLE_BRIDGE_PROBE_STATUS.PASS);
  const missing = BATTLE_BRIDGE_SERVICE_IDS.filter((serviceId) => !probes.some((probe) => probe.serviceId === serviceId));
  const ready = probes.length > 0 && failed.length === 0 && missing.length === 0;

  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.aggregate',
    status: ready ? BATTLE_BRIDGE_ACTION_STATUS.READY : BATTLE_BRIDGE_ACTION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    probes,
    failedServiceIds: failed.map((probe) => probe.serviceId),
    missingServiceIds: missing,
    summary: ready ? 'Battle Bridge services are ready.' : 'Battle Bridge supervisor has failed or missing probes.',
    exactUnblockAction: ready ? '' : 'Publish structured health and recovery receipts for Stephanos UI, Backend, Mission Worker, and OpenClaw Gateway and keep real restarts future-gated.',
    finalVerdict: ready ? 'BATTLE_BRIDGE_SUPERVISOR_PASS' : 'BATTLE_BRIDGE_SUPERVISOR_BLOCKED',
  };
}

export function createBattleBridgeGitPullHelper(input = {}) {
  const dirtyTree = input.dirtyTree === true;
  const updateStatus = normalizeUpdateStatus(input.updateStatus);
  const safeToPull = dirtyTree === false && [BATTLE_BRIDGE_UPDATE_STATUS.UPDATE_AVAILABLE, BATTLE_BRIDGE_UPDATE_STATUS.PULL_REQUIRED].includes(updateStatus);

  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.git_pull_helper',
    updateStatus,
    localSha: safeText(input.localSha, ''),
    mainSha: safeText(input.mainSha, ''),
    dirtyTree,
    safeToPull,
    autoPullClaim: false,
    command: safeToPull ? 'npm run stephanos:publish-merge' : '',
    exactUnblockAction: dirtyTree ? 'Commit or stash local changes before using the Battle Bridge git pull helper.' : safeToPull ? 'Run the Battle Bridge git pull helper, rebuild Stephanos UI, then manually refresh the browser.' : 'Refresh update status before requesting a pull.',
    sharedWorkspaceEventKind: safeToPull ? 'operator-action-required' : 'update-status-only',
    finalVerdict: safeToPull ? 'BATTLE_BRIDGE_GIT_PULL_HELPER_READY' : 'BATTLE_BRIDGE_GIT_PULL_HELPER_BLOCKED',
  };
}

export function createBackendFreshnessReuseProbe(input = {}) {
  const proof = adjudicateBackendFreshnessProof(input);
  return createBattleBridgeProbe({
    serviceId: 'backend',
    status: proof.backendCurrent ? BATTLE_BRIDGE_PROBE_STATUS.PASS : BATTLE_BRIDGE_PROBE_STATUS.FAIL,
    port: BATTLE_BRIDGE_SERVICE_PORTS.backend,
    checkedAtUtc: input.checkedAtUtc,
    summary: proof.backendCurrent ? 'Backend 8787 verified current with /api/health and /api/mission-operations.' : `${proof.finalVerdict}: backend reuse blocked until route freshness is restored.`,
    detail: proof.backendCurrent ? 'BACKEND_CURRENT' : proof.finalVerdict,
  });
}
