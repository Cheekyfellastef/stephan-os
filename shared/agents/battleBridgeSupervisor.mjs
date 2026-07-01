import { adjudicateBackendFreshnessProof } from './backendFreshnessSupervisor.mjs';
export const BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION = 'battle-bridge-supervisor.v1';

export const BATTLE_BRIDGE_SERVICE_IDS = Object.freeze([
  'backend',
  'openclaw-gateway',
  'stephanos-ui',
  'mission-orchestrator-worker',
  'shared-agent-workspace',
]);

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
  const id = safeId(value, 'mission-orchestrator-worker');
  return BATTLE_BRIDGE_SERVICE_IDS.includes(id) ? id : 'mission-orchestrator-worker';
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
    knownPorts: { ...BATTLE_BRIDGE_SERVICE_PORTS },
    requiredProbeFields: [
      'schemaVersion',
      'serviceId',
      'status',
      'checkedAtUtc',
      'summary',
      'operatorVisible',
    ],
    guardrails: {
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      mutationAllowedByDefault: false,
      restartRequiresExplicitServiceId: true,
      secretOutputAllowed: false,
      visiblePowerShellWallsAllowed: false,
    },
    finalVerdict: 'BATTLE_BRIDGE_SUPERVISOR_CONTRACT_READY',
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
    serviceId: 'mission-orchestrator-worker',
    status: input.workerHealthy === true ? 'PASS' : 'FAIL',
    checkedAtUtc: input.checkedAtUtc,
    summary: input.workerHealthy === true ? 'Mission Orchestrator Worker is healthy.' : 'Mission Orchestrator Worker did not recover.',
    detail: input.detail,
  });
  const autostartInstalled = input.autostartInstalled === true;
  const repositoryRootKnown = asText(input.repositoryRoot, '') !== '';
  const startCommandKnown = asText(input.startCommand, '') !== '';
  const canAttemptRestart = probe.status === 'FAIL' && autostartInstalled && repositoryRootKnown && startCommandKnown;

  return {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.supervisor.self_heal_plan',
    targetServiceId: 'mission-orchestrator-worker',
    currentProbe: probe,
    actionStatus: probe.status === 'PASS'
      ? BATTLE_BRIDGE_ACTION_STATUS.READY
      : canAttemptRestart
        ? BATTLE_BRIDGE_ACTION_STATUS.NEEDS_RESTART
        : BATTLE_BRIDGE_ACTION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    exactUnblockAction: canAttemptRestart || probe.status === 'PASS'
      ? ''
      : 'Install or repair the Mission Orchestrator Worker autostart task, then rerun the worker self-heal proof.',
    restartCommand: canAttemptRestart ? safeText(input.startCommand, '') : '',
    statusRoute: 'shared-workspace/status/battle-bridge-supervisor.json',
    proofRoute: 'shared-workspace/proof/battle-bridge-supervisor-worker-self-heal.json',
    finalVerdict: probe.status === 'PASS'
      ? 'WORKER_SELF_HEAL_NOT_REQUIRED'
      : canAttemptRestart
        ? 'WORKER_SELF_HEAL_READY_TO_RESTART'
        : 'WORKER_SELF_HEAL_BLOCKED',
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
    summary: ready
      ? 'Battle Bridge services are ready.'
      : 'Battle Bridge supervisor has failed or missing probes.',
    exactUnblockAction: ready
      ? ''
      : 'Run supervisor probes for backend, OpenClaw gateway, Stephanos UI, Mission Orchestrator Worker, and shared workspace, then restart failed services only by explicit service id.',
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
    exactUnblockAction: dirtyTree
      ? 'Commit or stash local changes before using the Battle Bridge git pull helper.'
      : safeToPull
        ? 'Run the Battle Bridge git pull helper, rebuild Stephanos UI, then manually refresh the browser.'
        : 'Refresh update status before requesting a pull.',
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
    summary: proof.backendCurrent
      ? 'Backend 8787 verified current with /api/health and /api/mission-operations.'
      : `${proof.finalVerdict}: backend reuse blocked until route freshness is restored.`,
    detail: proof.backendCurrent ? 'BACKEND_CURRENT' : proof.finalVerdict,
  });
}
