import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

export const MISSION_ORCHESTRATOR_WORKER_TASK = 'Stephanos Mission Orchestrator Worker';

function battleBridgeSupervisorText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function battleBridgeSupervisorApprovedTask(name) {
  return battleBridgeSupervisorText(name) === MISSION_ORCHESTRATOR_WORKER_TASK;
}

function battleBridgeSupervisorHeartbeatLive(heartbeat = {}, nowMs = Date.now(), maxAgeMs = 120000) {
  const at = Date.parse(battleBridgeSupervisorText(heartbeat.checkedAt || heartbeat.updatedAt || heartbeat.timestamp));
  return Number.isFinite(at) && nowMs - at <= maxAgeMs && heartbeat.workerFromMain === true;
}

export function assessBattleBridgeWorker(input = {}) {
  const taskName = battleBridgeSupervisorText(input.scheduledTask?.taskName, MISSION_ORCHESTRATOR_WORKER_TASK);
  const processRunning = input.process?.running === true;
  const heartbeatHealthy = battleBridgeSupervisorHeartbeatLive(input.heartbeat, input.nowMs, input.maxHeartbeatAgeMs);
  const scheduledTaskHealthy = battleBridgeSupervisorApprovedTask(taskName) && ['ready', 'running'].includes(battleBridgeSupervisorText(input.scheduledTask?.status, 'unknown').toLowerCase());
  const workerDown = !scheduledTaskHealthy || !processRunning || !heartbeatHealthy;
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    supervisorKind: 'fixed-allowlisted-watchdog',
    approvedScheduledTask: MISSION_ORCHESTRATOR_WORKER_TASK,
    taskName,
    scheduledTaskApproved: battleBridgeSupervisorApprovedTask(taskName),
    scheduledTaskHealthy,
    workerProcessRunning: processRunning,
    heartbeatHealthy,
    workerDown,
    visiblePowerShellRequired: false,
    arbitraryShellAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: workerDown ? 'WORKER_DOWN' : 'WORKER_HEALTHY',
  });
}

export function runBattleBridgeSupervisor(input = {}) {
  const before = assessBattleBridgeWorker(input.before || input);
  const proof = {
    schemaVersion: BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
    proofKind: 'battle-bridge-supervisor-worker-self-heal-proof',
    WORKER_KILLED: input.workerKilled === true,
    SUPERVISOR_DETECTED_WORKER_DOWN: before.workerDown === true,
    SUPERVISOR_RESTARTED_WORKER: false,
    WORKER_RECOVERED: false,
    WORKER_FROM_MAIN: false,
    PROOF_WRITTEN_TO_SHARED_WORKSPACE: false,
    VISIBLE_POWERSHELL_REQUIRED: false,
    approvedScheduledTask: MISSION_ORCHESTRATOR_WORKER_TASK,
    attemptedTaskName: before.taskName,
    blockedReasons: [],
  };
  if (!before.scheduledTaskApproved) proof.blockedReasons.push('scheduled-task-not-allowlisted');
  if (proof.SUPERVISOR_DETECTED_WORKER_DOWN && before.scheduledTaskApproved) {
    const restart = input.restartApprovedWorkerTask?.(MISSION_ORCHESTRATOR_WORKER_TASK) || { restarted: input.restartSucceeded === true };
    proof.SUPERVISOR_RESTARTED_WORKER = restart.restarted === true;
  }
  const after = assessBattleBridgeWorker(input.after || {});
  proof.WORKER_RECOVERED = proof.SUPERVISOR_RESTARTED_WORKER && after.finalVerdict === 'WORKER_HEALTHY';
  proof.WORKER_FROM_MAIN = after.heartbeatHealthy === true;
  proof.finalVerdict = proof.WORKER_RECOVERED && proof.WORKER_FROM_MAIN ? 'BATTLE_BRIDGE_WORKER_SELF_HEAL_PASS' : 'BATTLE_BRIDGE_WORKER_SELF_HEAL_BLOCKED';
  return Object.freeze(proof);
}


export function writeBattleBridgeSupervisorProof(proof = {}, options = {}) {
  const workspaceRoot = battleBridgeSupervisorText(
    options.workspaceRoot,
    process.env.STEPHANOS_OPENCLAW_WORKSPACE || (process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace') : ''),
  );
  if (!workspaceRoot) throw new Error('Shared workspace root is required for Battle Bridge proof.');
  mkdirSync(workspaceRoot, { recursive: true });
  const proofPath = join(workspaceRoot, battleBridgeSupervisorText(options.fileName, 'battle-bridge-supervisor-worker-self-heal-proof.json'));
  const payload = { ...proof, PROOF_WRITTEN_TO_SHARED_WORKSPACE: true, proofPath };
  writeFileSync(proofPath, `${JSON.stringify(payload, null, 2)}
`, 'utf8');
  return Object.freeze(payload);
}
