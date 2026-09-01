import {
  createMissionRecord,
  listMissionRecords,
} from './missionOrchestratorStore.js';
import {
  MAXIMUM_BUILD_LANES,
  projectCanonicalResourceIds,
} from '../../shared/agents/elasticBuildCapacityV1.mjs';

export const ELASTIC_GOAL_MISSION_ADMISSION_SCHEMA = 'stephanos.elastic-goal-mission-admission.v1';

const SCHEDULER_SCHEMA = 'stephanos.mission-scheduler.v1';
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPOSITORY_PATH_RESOURCE = /^repo:([^:]+\/[^:]+):path:(.+)$/;
const TERMINAL_PHASES = new Set(['COMPLETE', 'CANCELLED']);
const NON_RUNNABLE_PHASES = new Set(['BLOCKED', 'AWAITING_OPERATOR_APPROVAL']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function positiveInteger(value) {
  const normalized = typeof value === 'string' ? Number(value.replace(/^#/, '')) : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function issueFromMissionId(value) {
  const match = /^critical-([1-9]\d*)-elastic-goal(?:$|[-_.])/.exec(text(value).toLowerCase());
  return positiveInteger(match?.[1]);
}

function missionIdForIssue(issueNumber) {
  return `critical-${issueNumber}-elastic-goal`;
}

function branchForIssue(issueNumber) {
  return `orchestrator/critical-${issueNumber}-elastic-goal`;
}

function sourceScope(candidate = {}, portfolioGoal = {}) {
  const projection = projectCanonicalResourceIds(candidate.resourceIds ?? portfolioGoal.resourceIds ?? []);
  if (!projection.valid || projection.resourceIds.length === 0) {
    return freeze({ valid: false, repository: '', allowedFiles: [], resourceIds: [], reason: 'RESOURCE_SCOPE_REQUIRED' });
  }
  const repositories = new Set();
  const paths = [];
  for (const resourceId of projection.resourceIds) {
    const match = REPOSITORY_PATH_RESOURCE.exec(resourceId);
    if (!match) continue;
    repositories.add(match[1]);
    paths.push(match[2]);
  }
  if (repositories.size !== 1 || paths.length === 0) {
    return freeze({
      valid: false,
      repository: '',
      allowedFiles: [],
      resourceIds: projection.resourceIds,
      reason: repositories.size > 1 ? 'MULTI_REPOSITORY_SOURCE_SCOPE_NOT_SUPPORTED' : 'SOURCE_PATH_SCOPE_REQUIRED',
    });
  }
  const repository = [...repositories][0];
  if (!SAFE_REPOSITORY.test(repository)) {
    return freeze({ valid: false, repository: '', allowedFiles: [], resourceIds: projection.resourceIds, reason: 'REPOSITORY_SCOPE_INVALID' });
  }
  const allowedFiles = [...new Set(paths.flatMap((path) => [path, `${path}/**`]))].sort();
  return freeze({ valid: true, repository, allowedFiles, resourceIds: projection.resourceIds, reason: '' });
}

function goalForIssue(scheduler, issueNumber) {
  return list(scheduler?.portfolio).find((goal) => positiveInteger(goal?.issue) === issueNumber) ?? null;
}

function candidateIssue(candidate = {}) {
  return positiveInteger(candidate.issue ?? candidate.candidateId);
}

function missionMatchesIssue(state, issueNumber) {
  return issueFromMissionId(state?.missionId) === issueNumber;
}

function missionRunnable(state = {}) {
  const phase = text(state.currentPhase).toUpperCase();
  if (!phase || TERMINAL_PHASES.has(phase) || NON_RUNNABLE_PHASES.has(phase)) return false;
  if (state.dispatch?.status === 'running' && ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED', 'LIVE_RUNTIME_INVESTIGATION'].includes(phase)) return false;
  return true;
}

function schedulerEligible(scheduler = {}) {
  return Boolean(
    scheduler
    && scheduler.schemaVersion === SCHEDULER_SCHEMA
    && scheduler.readOnly === true
    && scheduler.failClosed === false
    && scheduler.elasticCapacity?.status === 'RUNNING'
    && Array.isArray(scheduler.parallelCandidateDetails)
    && scheduler.parallelCandidateDetails.length <= MAXIMUM_BUILD_LANES
  );
}

function missionInput(issueNumber, goal, scope, options = {}) {
  const title = text(goal?.title, `Goal #${issueNumber}`);
  return {
    missionId: missionIdForIssue(issueNumber),
    title: `Elastic goal #${issueNumber}: ${title}`,
    operatorIntent: [
      `Build durable GitHub goal #${issueNumber} through the canonical elastic Goal Flywheel.`,
      'Read the authoritative GitHub goal and current repository truth before implementation.',
      'Stay within the scheduler-approved resource scope and do not create duplicate implementation work.',
    ].join(' '),
    intendedOutcome: title,
    missionKind: 'implementation',
    repository: scope.repository,
    repositoryRoot: text(options.repoRoot),
    baseBranch: 'main',
    branch: branchForIssue(issueNumber),
    worktreePath: '',
    allowedFiles: scope.allowedFiles,
    requiredEvidence: [`Goal #${issueNumber} bounded implementation and focused verification evidence`],
    requiredTests: ['npm run stephanos:verify'],
    browserProofRequired: false,
  };
}

export function planElasticGoalMissionAdmissions(scheduler = {}, missionRecords = [], options = {}) {
  if (!schedulerEligible(scheduler)) {
    return freeze({
      schemaVersion: ELASTIC_GOAL_MISSION_ADMISSION_SCHEMA,
      ok: false,
      classification: 'ELASTIC_GOAL_ADMISSION_SAFE_HOLD',
      admitted: [],
      held: [{ issueNumber: null, reason: 'SCHEDULER_ELASTIC_ADMISSION_NOT_PROVEN' }],
      runnableMissions: [],
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }
  const records = list(missionRecords);
  const admitted = [];
  const held = [];
  const runnableMissions = records.filter(missionRunnable);
  for (const candidate of scheduler.parallelCandidateDetails) {
    const issueNumber = candidateIssue(candidate);
    if (!issueNumber) {
      held.push({ issueNumber: null, reason: 'CANDIDATE_ISSUE_INVALID' });
      continue;
    }
    const existing = records.find((state) => missionMatchesIssue(state, issueNumber));
    if (existing) {
      if (TERMINAL_PHASES.has(text(existing.currentPhase).toUpperCase())) {
        held.push({ issueNumber, reason: 'EXISTING_GOAL_MISSION_TERMINAL_AWAITING_GOAL_RECONCILIATION', missionId: existing.missionId });
      } else {
        admitted.push({ issueNumber, missionId: existing.missionId, existing: true, mission: existing });
      }
      continue;
    }
    const goal = goalForIssue(scheduler, issueNumber);
    if (!goal || text(goal.lifecycle).toUpperCase() !== 'READY') {
      held.push({ issueNumber, reason: 'SCHEDULER_READY_GOAL_NOT_PROVEN' });
      continue;
    }
    const scope = sourceScope(candidate, goal);
    if (!scope.valid) {
      held.push({ issueNumber, reason: scope.reason, resourceIds: scope.resourceIds });
      continue;
    }
    admitted.push({
      issueNumber,
      missionId: missionIdForIssue(issueNumber),
      existing: false,
      missionInput: missionInput(issueNumber, goal, scope, options),
      resourceIds: scope.resourceIds,
    });
  }
  return freeze({
    schemaVersion: ELASTIC_GOAL_MISSION_ADMISSION_SCHEMA,
    ok: true,
    classification: admitted.length ? 'ELASTIC_GOAL_ADMISSIONS_READY' : 'ELASTIC_GOAL_ADMISSIONS_EMPTY',
    admitted,
    held,
    runnableMissions,
    desiredWidth: scheduler.elasticCapacity.desiredWidth,
    remainingAdmissionSlots: scheduler.elasticCapacity.remainingAdmissionSlots,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}

export async function ensureElasticGoalMissions(input = {}, options = {}) {
  const env = input.env ?? options.env ?? process.env;
  const now = input.now instanceof Date ? input.now : options.now instanceof Date ? options.now : new Date();
  const deps = options.testOnly === true && options.dependencies ? options.dependencies : {};
  const listRecords = deps.listMissionRecords ?? listMissionRecords;
  const createRecord = deps.createMissionRecord ?? createMissionRecord;
  const storeOptions = {
    ...options,
    env,
    now,
    repoRoot: input.repoRoot ?? options.repoRoot,
    root: input.root ?? options.root,
    snapshotRoot: input.snapshotRoot ?? options.snapshotRoot,
  };
  const before = await listRecords(storeOptions);
  const plan = planElasticGoalMissionAdmissions(input.scheduler, before, storeOptions);
  if (!plan.ok) return plan;

  const created = [];
  const existing = [];
  const held = [...plan.held];
  for (const admission of plan.admitted) {
    if (admission.existing) {
      existing.push(admission.mission);
      continue;
    }
    try {
      const result = await createRecord(admission.missionInput, {
        ...storeOptions,
        createdBy: 'durable-flywheel-controller',
      });
      if (result?.state) created.push(result.state);
      else held.push({ issueNumber: admission.issueNumber, reason: 'MISSION_CREATE_RESULT_INVALID' });
    } catch (error) {
      const refreshed = await listRecords(storeOptions);
      const raced = refreshed.find((state) => missionMatchesIssue(state, admission.issueNumber));
      if (raced) existing.push(raced);
      else held.push({ issueNumber: admission.issueNumber, reason: `MISSION_CREATE_FAILED:${text(error?.message, 'unknown')}` });
    }
  }
  const after = await listRecords(storeOptions);
  const candidateIssues = new Set(plan.admitted.map(({ issueNumber }) => issueNumber));
  const elasticMissions = after.filter((state) => candidateIssues.has(issueFromMissionId(state?.missionId)));
  const runnableMissions = elasticMissions.filter(missionRunnable);
  return freeze({
    schemaVersion: ELASTIC_GOAL_MISSION_ADMISSION_SCHEMA,
    ok: true,
    classification: created.length
      ? 'ELASTIC_GOAL_MISSIONS_CREATED'
      : runnableMissions.length
        ? 'ELASTIC_GOAL_MISSIONS_AVAILABLE'
        : 'ELASTIC_GOAL_MISSIONS_HELD',
    createdMissionCount: created.length,
    existingMissionCount: existing.length,
    admittedIssueNumbers: [...candidateIssues],
    createdMissions: created,
    existingMissions: existing,
    runnableMissions,
    held,
    desiredWidth: plan.desiredWidth,
    remainingAdmissionSlots: plan.remainingAdmissionSlots,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}
