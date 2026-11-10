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

const MANDATORY_FORBIDDEN_FILES = Object.freeze([
  'runtime/**', 'tmp/**', 'memory/**', 'node_modules/**', '.env*', '**/*secret*',
]);
function hasAmbiguousGoalIds(goals) {
  const seen = new Set();
  for (const goal of goals) {
    if (!goal.goalId || goal.goalId === '#unknown' || seen.has(goal.goalId)) return true;
    seen.add(goal.goalId);
  }
  return false;
}
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
  // Unproven existing custody must never be reclassified as fresh implementation work.
  if (goal.state !== GOAL_STATE.PLANNED && goal.state !== GOAL_STATE.DONE) {
    return { ...goal, state: GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, finalVerdict: 'GOAL_STAGE_CUSTODY_UNPROVEN' };
  }
  return { ...goal, state: GOAL_STATE.PLANNED, finalVerdict: 'GOAL_PLANNED' };
}

export function selectNextGoal(input = {}) {
  const goals = (Array.isArray(input.goals) ? input.goals : []).map(classifyGoal);
  if (hasAmbiguousGoalIds(goals)) return null;
  const completedIds = new Set(goals.filter((goal) => goal.state === GOAL_STATE.DONE).map((goal) => goal.goalId));
  // Stage-owned work stays in its existing lane; select only genuinely fresh source work.
  const eligible = goals.filter((goal) => goal.state === GOAL_STATE.PLANNED && !goal.prNumber && !goal.activeBranch)
    .filter((goal) => goal.dependsOn.every((id) => completedIds.has(id)));
  return [...eligible].sort((a, b) => b.priority - a.priority || a.goalId.localeCompare(b.goalId))[0] || null;
}

export function createSourceSlicePacket(input = {}) {
  const goal = classifyGoal(input.goal || {});
  const branch = text(input.branch, `feature/${goal.goalId.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-slice-v1`);
  const proofCommand = text(input.proofCommand, goal.proofCommand || 'npm test');
  const allowedFiles = list(input.allowedFiles).length ? list(input.allowedFiles) : goal.allowedFiles;
  const forbiddenFiles = [...new Set([...MANDATORY_FORBIDDEN_FILES, ...goal.forbiddenFiles, ...list(input.forbiddenFiles)])];
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
  const ambiguous = hasAmbiguousGoalIds(goals);
  const hasHint = input.nextGoal !== null && input.nextGoal !== undefined;
  const selectedId = typeof input.nextGoal?.goalId === 'string' ? input.nextGoal.goalId.trim() : '';
  const selectedGoal = ambiguous ? null : hasHint
    ? goals.find((goal) => goal.goalId === selectedId) || null
    : selectNextGoal({ goals });
  const completedIds = new Set(goals.filter((goal) => goal.state === GOAL_STATE.DONE).map((goal) => goal.goalId));
  const candidate = selectedGoal && selectedGoal.state === GOAL_STATE.PLANNED
    && !selectedGoal.prNumber && !selectedGoal.activeBranch
    && selectedGoal.dependsOn.every((id) => completedIds.has(id))
    ? selectedGoal : null;
  // Explicit empty or disjoint source restrictions are denials, never full-allow fallback.
  const hasScope = input.slice != null && Object.prototype.hasOwnProperty.call(input.slice, 'allowedFiles');
  const requested = list(input.slice?.allowedFiles);
  const scoped = hasScope
    ? requested.filter((path) => candidate?.allowedFiles.includes(path))
    : candidate?.allowedFiles || [];
  const nextGoal = candidate && scoped.length ? candidate : null;
  const forbidden = nextGoal
    ? [...new Set([...MANDATORY_FORBIDDEN_FILES, ...nextGoal.forbiddenFiles, ...list(input.slice?.forbiddenFiles)])]
    : [];
  // Do not spread untrusted caller executor, command, branch, title, or identity into source custody.
  const packet = nextGoal
    ? createSourceSlicePacket({ goal: nextGoal, allowedFiles: scoped, forbiddenFiles: forbidden })
    : null;
  const unfinished = goals.some((goal) => goal.state !== GOAL_STATE.DONE);
  return {
    schemaVersion: MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION,
    kind: 'stephanos.mission_flywheel_director.status_packet',
    directorState: nextGoal ? GOAL_STATE.BUILDING
      : unfinished || ambiguous ? GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : GOAL_STATE.DONE,
    goals, nextGoal, nextSourceSlice: packet,
    lastActivity: text(input.lastActivity, 'director-status-created'),
    finalVerdict: nextGoal ? 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE'
      : unfinished || ambiguous ? 'MISSION_FLYWHEEL_DIRECTOR_HELD' : 'MISSION_FLYWHEEL_DIRECTOR_IDLE',
  };
}

export function validateDirectorStatusPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== MISSION_FLYWHEEL_DIRECTOR_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.mission_flywheel_director.status_packet') errors.push('invalid-kind');
  if (!Array.isArray(packet.goals)) errors.push('missing-goals');
  const goals = Array.isArray(packet.goals) ? packet.goals.map(classifyGoal) : [];
  if (hasAmbiguousGoalIds(goals)) errors.push('ambiguous-canonical-goal-identity');
  const slice = packet.nextSourceSlice;
  if (slice) {
    if (slice.exactHeadMergeRequired !== true) errors.push('exact-head-merge-required');
    if (slice.approvalGated !== true) errors.push('approval-gated-required');
    if (!slice.proofCommand) errors.push('missing-proof-command');
    const goal = packet.nextGoal;
    const canonical = goals.find((g) => g.goalId === goal?.goalId);
    if (!goal || !canonical || JSON.stringify(canonical) !== JSON.stringify(goal)) {
      errors.push('source-slice-goal-not-canonical');
    }
    if (goal?.state !== GOAL_STATE.PLANNED || goal?.activeBranch || goal?.prNumber) {
      errors.push('source-slice-stage-not-planned');
    }
    const scoped = Array.isArray(slice.allowedFiles) ? slice.allowedFiles : [];
    if (!scoped.length || scoped.some((path) => !(goal?.allowedFiles || []).includes(path))) {
      errors.push('source-slice-allowed-files-outside-canonical-scope');
    }
    const forbidden = Array.isArray(slice.forbiddenFiles) ? slice.forbiddenFiles : [];
    if ([...MANDATORY_FORBIDDEN_FILES, ...(goal?.forbiddenFiles || [])].some((path) => !forbidden.includes(path))) {
      errors.push('source-slice-mandatory-forbidden-missing');
    }
    if (goal) {
      const expected = createSourceSlicePacket({ goal, allowedFiles: scoped, forbiddenFiles: forbidden });
      for (const field of ['goalId','title','branch','worker','proofCommand','prTitle','prBody','nextAction']) {
        if (slice[field] !== expected[field]) errors.push(`source-slice-${field}-not-canonical`);
      }
    }
  } else if (packet.nextGoal) errors.push('source-slice-missing-for-selected-goal');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_FLYWHEEL_DIRECTOR_STATUS_PASS' : 'MISSION_FLYWHEEL_DIRECTOR_STATUS_BLOCKED',
  };
}

