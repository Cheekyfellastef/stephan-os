import os from 'node:os';
import { resolve } from 'node:path';
import {
  createMissionRecord,
  listMissionRecords,
} from './missionOrchestratorStore.js';
import {
  MAXIMUM_BUILD_LANES,
  projectCanonicalResourceIds,
  selectResourceDisjointCandidates,
} from '../../shared/agents/elasticBuildCapacityV1.mjs';
import { readSharedWorkspaceDashboardFeed } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';

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
  const match = text(value).toLowerCase().match(/^critical-([1-9]\d*)-elastic-goal(?:$|[-_.])/);
  return positiveInteger(match?.[1]);
}

function issueFromGoalRecord(record = {}) {
  const direct = positiveInteger(record.issue ?? record.issueNumber ?? record.relatedIssue);
  if (direct) return direct;
  const match = text(record.goalId).toLowerCase().match(/(?:^|[-_.])(?:goal|issue)-([1-9]\d*)(?:$|[-_.])/);
  return positiveInteger(match?.[1]);
}

function missionIdForIssue(issueNumber) {
  return `critical-${issueNumber}-elastic-goal`;
}

function branchForIssue(issueNumber) {
  return `openclaw/elastic-goal-${issueNumber}`;
}

function defaultWorktreeRoot(options = {}) {
  const env = options.env ?? process.env;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return resolve(home, 'Documents', 'GitHub', 'stephan-os-worktrees');
}

function sourceScope(candidate = {}, portfolioGoal = {}) {
  const projection = projectCanonicalResourceIds(candidate.resourceIds ?? portfolioGoal.resourceIds ?? []);
  if (!projection.valid || projection.resourceIds.length === 0) {
    return freeze({ valid: false, repository: '', allowedFiles: [], resourceIds: [], reason: 'RESOURCE_SCOPE_REQUIRED' });
  }
  const repositories = new Set();
  const paths = [];
  for (const resourceId of projection.resourceIds) {
    const match = resourceId.match(REPOSITORY_PATH_RESOURCE);
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

function recordForIssue(goalRecords, issueNumber) {
  return list(goalRecords).find((record) => issueFromGoalRecord(record) === issueNumber) ?? null;
}

function candidateIssue(candidate = {}) {
  return positiveInteger(candidate.issue ?? candidate.candidateId);
}

function missionMatchesIssue(state, issueNumber) {
  return issueFromMissionId(state?.missionId) === issueNumber;
}

function missionTerminal(state = {}) {
  return TERMINAL_PHASES.has(text(state.currentPhase).toUpperCase());
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

function compatibilityCandidateInventory(scheduler = {}, goalRecords = []) {
  if (scheduler.parallelCandidateDetails.length > 0) {
    return freeze({
      candidates: scheduler.parallelCandidateDetails,
      held: [],
      compatibilityEnrichmentUsed: false,
    });
  }
  const activeIssues = new Set(list(scheduler.activeGoals).map(positiveInteger).filter(Boolean));
  const activeResourceIds = [];
  for (const issueNumber of activeIssues) {
    const record = recordForIssue(goalRecords, issueNumber);
    const resourceProjection = projectCanonicalResourceIds(record?.resourceIds ?? []);
    if (resourceProjection.valid) activeResourceIds.push(...resourceProjection.resourceIds);
  }
  const ready = list(scheduler.portfolio)
    .filter((goal) => text(goal.lifecycle).toUpperCase() === 'READY')
    .map((goal) => {
      const issueNumber = positiveInteger(goal.issue);
      const record = recordForIssue(goalRecords, issueNumber);
      return {
        candidateId: `#${issueNumber}`,
        issue: issueNumber,
        route: goal.route,
        resourceIds: record?.resourceIds ?? [],
      };
    });
  const selection = selectResourceDisjointCandidates(ready, {
    limit: Math.min(
      MAXIMUM_BUILD_LANES,
      Number.isSafeInteger(scheduler.elasticCapacity?.remainingAdmissionSlots)
        ? scheduler.elasticCapacity.remainingAdmissionSlots
        : 0,
    ),
    activeResourceIds,
  });
  return freeze({
    candidates: selection.selected,
    held: selection.held,
    compatibilityEnrichmentUsed: true,
  });
}

function missionInput(issueNumber, goal, scope, options = {}) {
  const title = text(goal?.title, `Goal #${issueNumber}`);
  const missionId = missionIdForIssue(issueNumber);
  const worktreeRoot = text(options.worktreeRoot) || defaultWorktreeRoot(options);
  return {
    missionId,
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
    worktreePath: resolve(worktreeRoot, missionId),
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
  const inventory = compatibilityCandidateInventory(scheduler, options.goalRecords);
  const admitted = [];
  const held = inventory.held.map((item) => ({
    issueNumber: candidateIssue(item),
    reason: text(item.reasonCode, 'ELASTIC_SELECTION_HELD'),
    resourceIds: list(item.conflictingResourceIds),
  }));
  const runnableMissions = records.filter(missionRunnable);
  for (const candidate of inventory.candidates) {
    const issueNumber = candidateIssue(candidate);
    if (!issueNumber) {
      held.push({ issueNumber: null, reason: 'CANDIDATE_ISSUE_INVALID' });
      continue;
    }
    const existing = records.find((state) => missionMatchesIssue(state, issueNumber));
    if (existing) {
      if (missionTerminal(existing)) {
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
    const record = recordForIssue(options.goalRecords, issueNumber);
    const scope = sourceScope(candidate, record ? { ...goal, resourceIds: record.resourceIds } : goal);
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
    compatibilityEnrichmentUsed: inventory.compatibilityEnrichmentUsed,
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
  const readWorkspaceFeed = deps.readWorkspaceFeed ?? readSharedWorkspaceDashboardFeed;
  const missionStoreOptions = {
    env,
    now,
    repoRoot: input.repoRoot ?? options.repoRoot,
    root: input.orchestratorRoot ?? options.orchestratorRoot,
    snapshotRoot: input.snapshotRoot ?? options.snapshotRoot,
  };
  const workspaceRoot = input.workspaceRoot
    ?? options.workspaceRoot
    ?? env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  const before = await listRecords(missionStoreOptions);
  let goalRecords = list(input.goalRecords);
  let workspaceFeed = null;
  if (goalRecords.length === 0 && workspaceRoot) {
    workspaceFeed = await readWorkspaceFeed({
      root: workspaceRoot,
      repoRoot: missionStoreOptions.repoRoot,
      nowMs: now.getTime(),
    });
    if (['ready', 'stale'].includes(text(workspaceFeed?.state).toLowerCase())) {
      goalRecords = list(workspaceFeed?.records?.goalRecords);
    }
  }
  const plan = planElasticGoalMissionAdmissions(input.scheduler, before, {
    ...missionStoreOptions,
    env,
    worktreeRoot: input.worktreeRoot ?? options.worktreeRoot,
    goalRecords,
  });
  if (!plan.ok) return freeze({ ...plan, workspaceFeedState: text(workspaceFeed?.state, 'not-read') });

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
        ...missionStoreOptions,
        createdBy: 'durable-flywheel-controller',
      });
      if (result?.state) created.push(result.state);
      else held.push({ issueNumber: admission.issueNumber, reason: 'MISSION_CREATE_RESULT_INVALID' });
    } catch (error) {
      const refreshed = await listRecords(missionStoreOptions);
      const raced = refreshed.find((state) => missionMatchesIssue(state, admission.issueNumber));
      if (raced) existing.push(raced);
      else held.push({ issueNumber: admission.issueNumber, reason: `MISSION_CREATE_FAILED:${text(error?.message, 'unknown')}` });
    }
  }
  const after = await listRecords(missionStoreOptions);
  const candidateIssues = new Set(plan.admitted.map(({ issueNumber }) => issueNumber));
  const elasticMissions = after.filter((state) => issueFromMissionId(state?.missionId) !== null);
  const runnableMissions = elasticMissions.filter(missionRunnable);
  const activeMissions = elasticMissions.filter((state) => !missionTerminal(state));
  const selectedMission = runnableMissions[0] ?? activeMissions[0] ?? null;
  return freeze({
    schemaVersion: ELASTIC_GOAL_MISSION_ADMISSION_SCHEMA,
    ok: true,
    classification: created.length
      ? 'ELASTIC_GOAL_MISSIONS_CREATED'
      : runnableMissions.length
        ? 'ELASTIC_GOAL_MISSIONS_AVAILABLE'
        : activeMissions.length
          ? 'ELASTIC_GOAL_MISSIONS_OCCUPIED'
          : 'ELASTIC_GOAL_MISSIONS_HELD',
    createdMissionCount: created.length,
    existingMissionCount: existing.length,
    admittedIssueNumbers: [...candidateIssues],
    createdMissions: created,
    existingMissions: existing,
    elasticMissions,
    activeMissions,
    runnableMissions,
    selectedMission,
    held,
    desiredWidth: plan.desiredWidth,
    remainingAdmissionSlots: plan.remainingAdmissionSlots,
    compatibilityEnrichmentUsed: plan.compatibilityEnrichmentUsed,
    workspaceFeedState: text(workspaceFeed?.state, goalRecords.length ? 'supplied' : 'not-read'),
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}
