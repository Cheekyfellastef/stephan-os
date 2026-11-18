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

// Source scopes are exact repository path identities, not human-readable labels.
// Refuse normalization and partial filtering that could silently widen custody.
function exactSourcePaths(value) {
  if (!Array.isArray(value) || value.some((path) => typeof path !== 'string'
      || !path || path !== path.trim())) return [];
  return [...value];
}

function normalizeGoalState(state) {
  if (state === undefined) return GOAL_STATE.PLANNED;
  const out = typeof state === 'string' ? state.trim().toUpperCase() : '';
  return Object.values(GOAL_STATE).includes(out) ? out : GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
}

// Source slices contain exact repository paths. A glob in an allowed path
// could select forbidden content later, so ambiguous or unsafe paths fail closed.
function forbiddenSourcePath(path, patterns) {
  if (typeof path !== 'string' || !path || path.startsWith('/')
      || path.includes('\\') || path.includes(':')
      || /[\x00-\x1f*?[\]{}]/.test(path)) return true;
  const parts = path.split('/');
  // Windows strips trailing dots/spaces and recognizes DOS device basenames
  // even with extensions. A short-name alias can also resolve under protected
  // directories despite spelling a different lexical repository path.
  if (parts.some((part) => !part || part === '.' || part === '..'
      || /[. ]$/.test(part) || /[<>|"]/.test(part)
      || /^(?:conin\$|conout\$|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)
      || /~[1-9][0-9]*(?:\.|$)/u.test(part))) return true;

  const segmentMatches = (name, glob) => {
    const value = name.toLowerCase();
    const pattern = glob.toLowerCase();
    const pieces = pattern.split('*');
    if (!value.startsWith(pieces[0])) return false;
    let at = pieces[0].length;
    for (let i = 1; i < pieces.length; i += 1) {
      const found = value.indexOf(pieces[i], at);
      if (found < 0) return false;
      at = found + pieces[i].length;
    }
    return pattern.endsWith('*') || value.endsWith(pieces[pieces.length - 1]);
  };
  return patterns.some((pattern) => {
    if (typeof pattern !== 'string' || !pattern || pattern.includes('\\')
        || pattern.split('').some((ch) => ch.charCodeAt(0) < 32)) return true;
    const rule = pattern.split('/');
    const matches = (i, j) => {
      if (i === rule.length) return j === parts.length;
      if (rule[i] === '**') return matches(i + 1, j)
        || (j < parts.length && matches(i, j + 1));
      return j < parts.length && segmentMatches(parts[j], rule[i]) && matches(i + 1, j + 1);
    };
    // A protected directory or basename remains protected when nested.
    return parts.some((_, start) => matches(0, start));
  });
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
  // Preserve an explicit invalid state as custody evidence across subsequent
  // normalization and validation, including when completion flags are present.
  const explicitlyInvalidState = input.state !== undefined
    && (typeof input.state !== 'string'
      || !Object.values(GOAL_STATE).includes(input.state.trim().toUpperCase()));
  return {
    goalId: text(input.goalId, '#unknown'),
    title: text(input.title, 'Untitled goal'),
    state: normalizeGoalState(input.state),
    invalidGoalState: input.invalidGoalState === true || explicitlyInvalidState,
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
    allowedFiles: exactSourcePaths(input.allowedFiles),
    forbiddenFiles: list(input.forbiddenFiles),
  };
}

export function classifyGoal(record = {}) {
  const goal = createGoalRecord(record);
  if (goal.invalidGoalState) {
    return { ...goal, state: GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      finalVerdict: 'GOAL_STATE_UNRECOGNIZED' };
  }
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
  // Partial completion or a previous merge belongs to the original acceptance owner, not a fresh build.
  if (goal.state === GOAL_STATE.DONE || goal.sourceMerged) {
    return { ...goal, state: GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, finalVerdict: 'GOAL_COMPLETION_CUSTODY_UNPROVEN' };
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
  // An explicitly supplied empty scope is a denial, never fallback to all files.
  const requestedFiles = Object.prototype.hasOwnProperty.call(input, 'allowedFiles')
    ? exactSourcePaths(input.allowedFiles) : goal.allowedFiles;
  const forbiddenFiles = [...new Set([...MANDATORY_FORBIDDEN_FILES, ...goal.forbiddenFiles, ...list(input.forbiddenFiles)])];
  const allowedFiles = goal.state === GOAL_STATE.PLANNED && !goal.prNumber && !goal.activeBranch
    && requestedFiles.length
    && requestedFiles.every((path) => goal.allowedFiles.includes(path) && !forbiddenSourcePath(path, forbiddenFiles))
    ? requestedFiles : [];
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
    finalVerdict: allowedFiles.length ? 'SOURCE_SLICE_PACKET_READY' : 'SOURCE_SLICE_PACKET_HELD',
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
  const requested = exactSourcePaths(input.slice?.allowedFiles);
  // Never silently discard ungranted paths from caller-supplied custody scope.
  // An invalid member denies the entire requested packet rather than narrowing intent.
  const scoped = hasScope ? requested : candidate?.allowedFiles || [];
  const forbidden = candidate
    ? [...new Set([...MANDATORY_FORBIDDEN_FILES, ...candidate.forbiddenFiles, ...list(input.slice?.forbiddenFiles)])]
    : [];
  const nextGoal = candidate && scoped.length
    && scoped.every((path) => candidate.allowedFiles.includes(path)
      && !forbiddenSourcePath(path, forbidden))
    ? candidate : null;
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
    if (slice.finalVerdict !== 'SOURCE_SLICE_PACKET_READY') errors.push('source-slice-not-ready');
    if (!slice.proofCommand) errors.push('missing-proof-command');
    const goal = packet.nextGoal;
    const canonical = goals.find((g) => g.goalId === goal?.goalId);
    if (!goal || !canonical || JSON.stringify(canonical) !== JSON.stringify(goal)) {
      errors.push('source-slice-goal-not-canonical');
    }
    if (goal?.state !== GOAL_STATE.PLANNED || goal?.activeBranch || goal?.prNumber) {
      errors.push('source-slice-stage-not-planned');
    }
    const completedIds = new Set(goals.filter((g) => g.state === GOAL_STATE.DONE).map((g) => g.goalId));
    if (!canonical || !canonical.dependsOn.every((id) => completedIds.has(id))) {
      errors.push('source-slice-dependency-unproven');
    }
    const scoped = Array.isArray(slice.allowedFiles) ? slice.allowedFiles : [];
    if (!scoped.length || scoped.some((path) => !(goal?.allowedFiles || []).includes(path))) {
      errors.push('source-slice-allowed-files-outside-canonical-scope');
    }
    const forbidden = Array.isArray(slice.forbiddenFiles) ? slice.forbiddenFiles : [];
    if (scoped.some((path) => forbiddenSourcePath(path,
      [...MANDATORY_FORBIDDEN_FILES, ...(goal?.forbiddenFiles || []), ...forbidden]))) {
      errors.push('source-slice-forbidden-path-collision');
    }
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
  // Status and terminal verdict are derived facts, never caller-assigned evidence.
  const unfinished = goals.some((goal) => goal.state !== GOAL_STATE.DONE);
  const held = unfinished || hasAmbiguousGoalIds(goals);
  const expectedDirectorState = slice ? GOAL_STATE.BUILDING
    : held ? GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : GOAL_STATE.DONE;
  const expectedFinalVerdict = slice ? 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE'
    : held ? 'MISSION_FLYWHEEL_DIRECTOR_HELD' : 'MISSION_FLYWHEEL_DIRECTOR_IDLE';
  if (packet.directorState !== expectedDirectorState) errors.push('director-state-not-derived');
  if (packet.finalVerdict !== expectedFinalVerdict) errors.push('final-verdict-not-derived');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_FLYWHEEL_DIRECTOR_STATUS_PASS' : 'MISSION_FLYWHEEL_DIRECTOR_STATUS_BLOCKED',
  };
}
