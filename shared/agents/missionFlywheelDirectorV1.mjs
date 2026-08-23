export const MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION = 'mission-flywheel-director.v1';

export const GOAL_STATE = Object.freeze({
  PLANNED: 'PLANNED',
  BUILDING: 'BUILDING',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_CODEX: 'WAITING_FOR_CODEX',
  WAITING_FOR_OPENCLAW: 'WAITING_FOR_OPENCLAW',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  DONE: 'DONE',
});

export const WORKER_KIND = Object.freeze({
  STEPHANOS: 'STEPHANOS',
  CODEX: 'CODEX',
  OPENCLAW: 'OPENCLAW',
  PUBLISHER: 'PUBLISHER',
  OPERATOR: 'OPERATOR',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function normalizeGoalState(state) {
  const out = text(state, GOAL_STATE.PLANNED).toUpperCase();
  return Object.values(GOAL_STATE).includes(out) ? out : GOAL_STATE.PLANNED;
}

function normalizeWorkerKind(worker) {
  const out = text(worker, WORKER_KIND.STEPHANOS).toUpperCase();
  return Object.values(WORKER_KIND).includes(out) ? out : WORKER_KIND.STEPHANOS;
}

function numberOrDefault(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function buildMissionFlywheelDirectorContract() {
  return {
    schemaVersion: MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_flywheel_director.contract',
    goalStates: Object.values(GOAL_STATE),
    workerKinds: Object.values(WORKER_KIND),
    completionRule: 'DONE requires merged-to-main source, focused proof recorded, and mission state updated.',
    finalVerdict: 'MISSION_FLYWHEEL_DIRECTOR_CONTRACT_READY',
  };
}

export function createGoalRecord(input = {}) {
  return {
    goalId: text(input.goalId, '#unknown'),
    title: text(input.title, 'Untitled goal'),
    state: normalizeGoalState(input.state),
    priority: numberOrDefault(input.priority, 0),
    dependsOn: list(input.dependsOn),
    sourceMerged: input.sourceMerged === true,
    focusedProofRecorded: input.focusedProofRecorded === true,
    missionStateUpdated: input.missionStateUpdated === true,
    activeBranch: text(input.activeBranch),
    prNumber: text(input.prNumber),
    proofCommand: text(input.proofCommand),
    blocker: text(input.blocker),
    nextAction: text(input.nextAction),
    allowedFiles: list(input.allowedFiles),
    forbiddenFiles: list(input.forbiddenFiles),
  };
}

export function classifyGoal(record = {}) {
  const goal = createGoalRecord(record);
  if (goal.sourceMerged && goal.focusedProofRecorded && goal.missionStateUpdated) {
    return { ...goal, state: GOAL_STATE.DONE, finalVerdict: 'GOAL_DONE' };
  }
  if (goal.blocker) {
    return { ...goal, state: GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, finalVerdict: 'GOAL_BLOCKED' };
  }
  if (goal.prNumber && !goal.focusedProofRecorded) {
    return { ...goal, state: GOAL_STATE.WAITING_FOR_PROOF, finalVerdict: 'GOAL_WAITING_FOR_PROOF' };
  }
  if (goal.prNumber && goal.focusedProofRecorded && !goal.sourceMerged) {
    return { ...goal, state: GOAL_STATE.WAITING_FOR_OPERATOR_APPROVAL, finalVerdict: 'GOAL_WAITING_FOR_OPERATOR_APPROVAL' };
  }
  if (goal.activeBranch) {
    return { ...goal, state: GOAL_STATE.BUILDING, finalVerdict: 'GOAL_BUILDING' };
  }
  return { ...goal, state: GOAL_STATE.PLANNED, finalVerdict: 'GOAL_PLANNED' };
}

export function selectNextGoal(input = {}) {
  const goals = (Array.isArray(input.goals) ? input.goals : []).map(classifyGoal);
  const completed = goals.filter((goal) => goal.state === GOAL_STATE.DONE);
  const active = goals.filter((goal) => goal.state !== GOAL_STATE.DONE);
  const unblocked = active.filter((goal) => goal.state !== GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION)
    .filter((goal) => goal.dependsOn.every((dependency) => completed.some((done) => done.goalId === dependency)));
  const candidates = unblocked.length ? unblocked : active;
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority || a.goalId.localeCompare(b.goalId));
  return sorted[0] || null;
}

export function createSourceSlicePacket(input = {}) {
  const goal = classifyGoal(input.goal || {});
  const branch = text(input.branch, `feature/${goal.goalId.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-slice-v1`);
  const proofCommand = text(input.proofCommand, goal.proofCommand || 'npm test');
  const allowedFiles = list(input.allowedFiles).length ? list(input.allowedFiles) : goal.allowedFiles;
  const forbiddenFiles = list(input.forbiddenFiles).length ? list(input.forbiddenFiles) : [
    'runtime/**',
    'tmp/**',
    'memory/**',
    'node_modules/**',
    '.env*',
    '**/*secret*',
  ];
  return {
    schemaVersion: MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION,
    kind: 'stephanos.mission_flywheel_director.source_slice_packet',
    goalId: goal.goalId,
    title: text(input.title, `Advance ${goal.goalId}: ${goal.title}`),
    branch,
    worker: normalizeWorkerKind(input.worker),
    allowedFiles,
    forbiddenFiles,
    proofCommand,
    prTitle: text(input.prTitle, goal.title),
    prBody: text(input.prBody, `Implements a focused source slice for ${goal.goalId}. Proof: ${proofCommand}`),
    exactHeadMergeRequired: true,
    approvalGated: true,
    nextAction: text(input.nextAction, `Dispatch ${goal.goalId} source slice through the repository-native publish lane.`),
    finalVerdict: 'SOURCE_SLICE_PACKET_READY',
  };
}

export function createDirectorStatusPacket(input = {}) {
  const goals = (Array.isArray(input.goals) ? input.goals : []).map(classifyGoal);
  const nextGoal = input.nextGoal ? classifyGoal(input.nextGoal) : selectNextGoal({ goals });
  const packet = nextGoal ? createSourceSlicePacket({ goal: nextGoal, ...input.slice }) : null;
  return {
    schemaVersion: MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION,
    kind: 'stephanos.mission_flywheel_director.status_packet',
    directorState: nextGoal ? GOAL_STATE.BUILDING : GOAL_STATE.DONE,
    goals,
    nextGoal,
    nextSourceSlice: packet,
    lastActivity: text(input.lastActivity, 'director-status-created'),
    finalVerdict: nextGoal ? 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE' : 'MISSION_FLYWHEEL_DIRECTOR_IDLE',
  };
}

export function validateDirectorStatusPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.mission_flywheel_director.status_packet') errors.push('invalid-kind');
  if (!Array.isArray(packet.goals)) errors.push('missing-goals');
  if (packet.nextSourceSlice) {
    if (packet.nextSourceSlice.exactHeadMergeRequired !== true) errors.push('exact-head-merge-required');
    if (packet.nextSourceSlice.approvalGated !== true) errors.push('approval-gated-required');
    if (!packet.nextSourceSlice.proofCommand) errors.push('missing-proof-command');
  }
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_FLYWHEEL_DIRECTOR_STATUS_PASS' : 'MISSION_FLYWHEEL_DIRECTOR_STATUS_BLOCKED',
  };
}
