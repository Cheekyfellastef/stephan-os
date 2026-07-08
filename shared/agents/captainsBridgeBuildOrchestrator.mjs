import { CODEX_QUEUE_STATUS } from './codexDispatchQueue.mjs';

export const CAPTAINS_BRIDGE_ORCHESTRATOR_SCHEMA_VERSION = 'stephanos.captains-bridge-build-orchestrator.v1';
export const CAPTAINS_BRIDGE_GOALS = Object.freeze(['G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19']);
export const CAPTAINS_BRIDGE_IMPLEMENTED_GUARDED = Object.freeze(['G13', 'G14', 'G15']);
export const CAPTAINS_BRIDGE_PLANNED_GUARDED = Object.freeze(['G16', 'G17', 'G18', 'G19']);

const TERMINAL = new Set([CODEX_QUEUE_STATUS.SUCCEEDED, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED]);
const UNKNOWN = 'UNKNOWN';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function goalId(value = {}) {
  return text(value.goalId || value.goal || value.issue || value.issueNumber).replace(/^#/, '').toUpperCase();
}

function rankStatus(status) {
  const normalized = text(status).toLowerCase();
  return {
    running: 0,
    dispatched: 1,
    'waiting-proof': 2,
    queued: 3,
    blocked: 4,
    failed: 5,
    succeeded: 6,
  }[normalized] ?? 7;
}

function laneForGoal(lanes, goal) {
  return lanes
    .filter((lane) => goalId(lane) === goal)
    .sort((a, b) => rankStatus(a.status || a.queueStatus) - rankStatus(b.status || b.queueStatus) || text(a.laneId || a.branch).localeCompare(text(b.laneId || b.branch)))[0] || null;
}

function queuedGoal(queueRecords) {
  return queueRecords
    .filter((record) => CAPTAINS_BRIDGE_GOALS.includes(goalId(record)))
    .filter((record) => !TERMINAL.has(text(record.status, CODEX_QUEUE_STATUS.QUEUED).toLowerCase()))
    .sort((a, b) => CAPTAINS_BRIDGE_GOALS.indexOf(goalId(a)) - CAPTAINS_BRIDGE_GOALS.indexOf(goalId(b)) || rankStatus(a.status) - rankStatus(b.status))[0] || null;
}

export function projectCaptainsBridgeBuildOrchestrator(input = {}) {
  const lanes = list(input.buildLaneManager?.lanes || input.buildLanes);
  const activeLane = input.buildLaneManager?.activeLane || laneForGoal(lanes, queuedGoal(list(input.queueRecords)) ? goalId(queuedGoal(list(input.queueRecords))) : CAPTAINS_BRIDGE_GOALS[0]);
  const queueRecords = list(input.queueRecords);
  const selectedQueue = queuedGoal(queueRecords);
  const selectedGoal = goalId(activeLane || selectedQueue || { goalId: CAPTAINS_BRIDGE_GOALS[0] });
  const dispatcherState = text(input.dispatcherDashboard?.dispatcherState || input.dispatcherState, UNKNOWN);
  const supervisorState = text(input.supervisor?.overallState || input.battleBridgeSupervisor?.overallState, UNKNOWN);
  const proofStatus = text(activeLane?.latestProof?.status || input.latestProofState, UNKNOWN).toUpperCase();
  const blocker = text(activeLane?.blocker || input.blocker, '');
  let phase = 'NEXT_ACTION';
  let actor = 'CODEX_NEEDED';
  let exactNextAction = `Prepare guarded implementation lane for ${selectedGoal}; automation must only propose and track.`;
  if (blocker) {
    phase = 'BLOCKER'; actor = 'OPERATOR_NEEDED'; exactNextAction = blocker;
  } else if (activeLane && ['running', 'dispatched', 'waiting-proof'].includes(text(activeLane.status || activeLane.queueStatus).toLowerCase())) {
    phase = 'BUILDING_NOW'; actor = proofStatus === 'PASSED' ? 'OPERATOR_NEEDED' : 'CODEX_NEEDED'; exactNextAction = activeLane.nextAction || 'Codex continues bounded source change and publishes deterministic proof.';
  } else if (dispatcherState === 'BLOCKED' || supervisorState === 'ATTENTION_REQUIRED') {
    phase = 'BLOCKER'; actor = dispatcherState === 'BLOCKED' ? 'OPENCLAW_NEEDED' : 'OPERATOR_NEEDED'; exactNextAction = input.exactNextAction || 'Resolve dispatcher/supervisor blocker before selecting another lane.';
  } else if (selectedQueue) {
    phase = 'NEXT_ACTION'; actor = 'OPENCLAW_NEEDED'; exactNextAction = `Dispatch queued ${selectedGoal} only through guarded Codex queue; do not execute builds automatically.`;
  }
  return Object.freeze({
    schemaVersion: CAPTAINS_BRIDGE_ORCHESTRATOR_SCHEMA_VERSION,
    kind: 'stephanos.captains_bridge.build_orchestrator.projection',
    readOnly: true,
    automationExecutesBuilds: false,
    arbitraryShellAllowed: false,
    autoPushAllowed: false,
    autoMergeAllowed: false,
    hardResetAllowed: false,
    branchDeletionAllowed: false,
    goals: Object.freeze({ implementedGuarded: [...CAPTAINS_BRIDGE_IMPLEMENTED_GUARDED], plannedGuarded: [...CAPTAINS_BRIDGE_PLANNED_GUARDED] }),
    selectedGoal,
    selectedLane: activeLane || selectedQueue || null,
    phase,
    actor,
    signals: Object.freeze({ BUILDING_NOW: phase === 'BUILDING_NOW', NEXT_ACTION: phase === 'NEXT_ACTION', BLOCKER: phase === 'BLOCKER', OPERATOR_NEEDED: actor === 'OPERATOR_NEEDED', CODEX_NEEDED: actor === 'CODEX_NEEDED', OPENCLAW_NEEDED: actor === 'OPENCLAW_NEEDED' }),
    exactNextAction,
    finalVerdict: phase === 'BLOCKER' ? 'CAPTAINS_BRIDGE_ORCHESTRATOR_BLOCKED' : 'CAPTAINS_BRIDGE_ORCHESTRATOR_READY',
  });
}
