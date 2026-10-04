export const COMPLETION_GUARDIAN_SCHEMA = 'stephanos.completion-guardian.v1';

export const COMPLETION_GUARDIAN_STATE = Object.freeze({
  COMPLETE_PROVEN: 'COMPLETE_PROVEN',
  IN_PROGRESS: 'IN_PROGRESS',
  PROOF_PENDING: 'PROOF_PENDING',
  BUILDABLE_REPAIR: 'BUILDABLE_REPAIR',
  APPROVAL_GATED: 'APPROVAL_GATED',
  EXTERNAL_BLOCKED: 'EXTERNAL_BLOCKED',
  ORPHANED_REPAIR_REQUIRED: 'ORPHANED_REPAIR_REQUIRED',
  REGRESSION_REPAIR_REQUIRED: 'REGRESSION_REPAIR_REQUIRED',
  SCHEDULER_VISIBLE_READY: 'SCHEDULER_VISIBLE_READY',
  TERMINAL_INACTIVE: 'TERMINAL_INACTIVE',
});

const TERMINAL_DEPLOYMENT_STEPS = Object.freeze(['sync', 'build', 'verify', 'restart']);
const REPAIRABLE_BLOCKER = /ORPHANED_ACTIVE_MISSION|stalled|no progress|lost|abandoned/i;
const EXTERNAL_BLOCKER = /external|operator|approval|credential|rate.limit|provider unavailable/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}
function list(value) { return Array.isArray(value) ? value : []; }
function issueNumber(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function missionIssues(mission = {}, backlog = []) {
  const entry = backlog.find((item) => item?.mission?.missionId === mission.missionId);
  const bound = list(entry?.issueNumbers).map(issueNumber).filter(Boolean);
  if (bound.length > 0) return Object.freeze(bound);
  const match = /^critical-([1-9]\d*)-/.exec(text(mission.missionId).toLowerCase());
  const canonicalIssue = issueNumber(match?.[1]);
  return Object.freeze(canonicalIssue ? [canonicalIssue] : []);
}
function deploymentProven(mission = {}) {
  return TERMINAL_DEPLOYMENT_STEPS.every((step) => mission?.deployment?.[step]?.status === 'success');
}
function mergedProven(mission = {}) {
  return mission?.pullRequest?.merged === true && Boolean(text(mission?.pullRequest?.mergeCommitSha));
}
function completionProven(mission = {}) {
  if (text(mission.currentPhase).toUpperCase() !== 'COMPLETE') return false;
  const evidenceProven = list(mission.evidenceReceipts).some((receipt) => receipt?.verified === true);
  if (text(mission.missionKind).toLowerCase() === 'live-runtime-investigation') return evidenceProven;
  return mergedProven(mission) && deploymentProven(mission) && evidenceProven;
}
function blockerText(mission = {}) {
  return [...list(mission.blockers), text(mission?.continuity?.reason)].filter(Boolean).join(' | ');
}

export function classifyCompletionMission(mission = {}, options = {}) {
  const phase = text(mission.currentPhase, 'UNKNOWN').toUpperCase();
  const parking = text(mission?.continuity?.parkingStatus, 'ACTIVE').toUpperCase();
  const blockers = blockerText(mission);
  const regression = list(options.regressedMissionIds).includes(mission.missionId);

  if (['CANCELLED', 'RETIRED'].includes(phase)) return COMPLETION_GUARDIAN_STATE.TERMINAL_INACTIVE;
  if (regression) return COMPLETION_GUARDIAN_STATE.REGRESSION_REPAIR_REQUIRED;
  if (completionProven(mission)) return COMPLETION_GUARDIAN_STATE.COMPLETE_PROVEN;
  if (['AWAITING_OPERATOR_APPROVAL', 'MERGE_PULL_REQUEST'].includes(phase)
    || mission?.approval?.status === 'pending') return COMPLETION_GUARDIAN_STATE.APPROVAL_GATED;
  if (phase === 'BLOCKED' && parking === 'PARKED_BLOCKED' && REPAIRABLE_BLOCKER.test(blockers)) {
    return COMPLETION_GUARDIAN_STATE.BUILDABLE_REPAIR;
  }
  if (phase === 'BLOCKED' && (EXTERNAL_BLOCKER.test(blockers)
    || text(mission?.continuity?.repairOwner).toLowerCase() === 'operator')) {
    return COMPLETION_GUARDIAN_STATE.EXTERNAL_BLOCKED;
  }
  if (phase === 'BLOCKED') return COMPLETION_GUARDIAN_STATE.ORPHANED_REPAIR_REQUIRED;
  if (['VERIFY', 'OPEN_PULL_REQUEST', 'WAIT_FOR_CHECKS', 'LOCAL_DEPLOYMENT'].includes(phase)
    || mission?.pullRequest?.merged === true) return COMPLETION_GUARDIAN_STATE.PROOF_PENDING;
  return COMPLETION_GUARDIAN_STATE.IN_PROGRESS;
}

export function buildCompletionGuardianProjection(input = {}) {
  const goals = list(input.goals);
  const missions = list(input.missions);
  const backlog = list(input.backlog);
  const missionRows = missions.map((mission) => Object.freeze({
    missionId: text(mission.missionId),
    title: text(mission.title, text(mission.missionId)),
    issueNumbers: missionIssues(mission, backlog),
    phase: text(mission.currentPhase, 'UNKNOWN').toUpperCase(),
    parkingStatus: text(mission?.continuity?.parkingStatus, 'ACTIVE').toUpperCase(),
    classification: classifyCompletionMission(mission, input),
    nextAction: text(mission?.nextAction?.type),
    repairOwner: text(mission?.continuity?.repairOwner),
    blocker: blockerText(mission),
  }));

  const ownedIssues = new Set(missionRows.flatMap((row) => row.issueNumbers));
  const readyUnownedGoals = goals
    .filter((goal) => text(goal.state ?? goal.status).toUpperCase() === 'READY')
    .filter((goal) => goal.mirrorBuildPickupAllowed !== false)
    .map((goal) => issueNumber(goal.issueNumber))
    .filter((number) => number && !ownedIssues.has(number));

  const priorityByMission = new Map(backlog.map((entry) => [entry?.mission?.missionId, Number(entry?.priority) || 999]));
  const repairQueue = missionRows
    .filter((row) => [
      COMPLETION_GUARDIAN_STATE.BUILDABLE_REPAIR,
      COMPLETION_GUARDIAN_STATE.ORPHANED_REPAIR_REQUIRED,
      COMPLETION_GUARDIAN_STATE.REGRESSION_REPAIR_REQUIRED,
    ].includes(row.classification))
    .map((row) => ({
      missionId: row.missionId,
      issueNumbers: row.issueNumbers,
      classification: row.classification,
      repairOwner: row.repairOwner || 'goal-building-agent',
      priority: priorityByMission.get(row.missionId) || 999,
      nextAction: row.classification === COMPLETION_GUARDIAN_STATE.BUILDABLE_REPAIR
        ? 'PROVE_REPAIR_THEN_REENTER_EXISTING_MISSION'
        : 'RECONCILE_EXISTING_MISSION_IDENTITY',
    }))
    .sort((left, right) => left.priority - right.priority || left.missionId.localeCompare(right.missionId))
    .map((row) => Object.freeze(row));

  const counts = Object.fromEntries(Object.values(COMPLETION_GUARDIAN_STATE).map((state) => [state, 0]));
  for (const row of missionRows) counts[row.classification] += 1;
  counts[COMPLETION_GUARDIAN_STATE.SCHEDULER_VISIBLE_READY] += readyUnownedGoals.length;

  const actionable = repairQueue.length;
  return Object.freeze({
    schema: COMPLETION_GUARDIAN_SCHEMA,
    observedAtUtc: text(input.observedAtUtc, new Date().toISOString()),
    finalVerdict: actionable > 0 ? 'COMPLETION_GUARDIAN_ACTION_REQUIRED' : 'COMPLETION_GUARDIAN_CLEAR',
    missionRows: Object.freeze(missionRows),
    readyUnownedGoalIssueNumbers: Object.freeze(readyUnownedGoals),
    repairQueue: Object.freeze(repairQueue),
    counts: Object.freeze(counts),
    actionableCount: actionable,
    duplicateSchedulerCreated: false,
    duplicateMissionAllowed: false,
    duplicateBranchOrPrAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}
