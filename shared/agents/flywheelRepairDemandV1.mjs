import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const FLYWHEEL_REPAIR_DEMAND_SCHEMA_VERSION = 'stephanos.flywheel-repair-demand.v1';
export const FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION = 'stephanos.flywheel-repair-patrol-runner.v1';
export const FLYWHEEL_REPAIR_DEMAND_MAX_HANDOFFS = 64;
export const FLYWHEEL_REPAIR_DEMAND_STALE_AFTER_MS = 60 * 60_000;

const GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const MISSION_SCHEDULER_OWNER = '#1556';
const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  goalMutationAllowed: false,
  goalCreationAllowed: false,
  schedulerMutationAllowed: false,
  dispatchAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  authorityWideningAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function goalRef(value) {
  const normalized = text(value);
  return GOAL_REF.test(normalized) ? normalized : '';
}

function issueNumber(value) {
  const normalized = typeof value === 'number' ? value : Number(text(value).replace(/^#/, ''));
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function safeJson(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function noDemand(reason = 'NO_FLYWHEEL_REPAIR_DEMAND') {
  return Object.freeze({
    schemaVersion: FLYWHEEL_REPAIR_DEMAND_SCHEMA_VERSION,
    valid: true,
    state: 'NONE',
    reason,
    handoffId: '',
    generatedAtUtc: '',
    routes: Object.freeze([]),
    actionableRouteCount: 0,
    unresolvedRouteCount: 0,
    authority: AUTHORITY,
  });
}

function blocked(reason) {
  return Object.freeze({
    schemaVersion: FLYWHEEL_REPAIR_DEMAND_SCHEMA_VERSION,
    valid: false,
    state: 'BLOCKED',
    reason,
    handoffId: '',
    generatedAtUtc: '',
    routes: Object.freeze([]),
    actionableRouteCount: 0,
    unresolvedRouteCount: 0,
    authority: AUTHORITY,
  });
}

function schedulerIssueSet(values = []) {
  return new Set(list(values).map((value) => issueNumber(value?.issue ?? value?.candidateId ?? value)).filter(Boolean));
}

function portfolioRow(scheduler = {}, issue) {
  return list(scheduler.portfolio).find((goal) => issueNumber(goal?.issue ?? goal?.issueNumber) === issue) ?? null;
}

function routeAgainstScheduler(route, scheduler = {}) {
  const ownerIssue = issueNumber(route.canonicalOwner);
  const downstreamOwner = goalRef(route.downstreamOwner);
  const activeIssues = schedulerIssueSet(scheduler.activeGoals);
  const candidateIssues = schedulerIssueSet(scheduler.parallelCandidateDetails);
  const ownerGoal = portfolioRow(scheduler, ownerIssue);
  const lifecycle = text(ownerGoal?.lifecycle ?? ownerGoal?.state).toUpperCase();

  let disposition = 'WAITING_FOR_CANONICAL_OWNER';
  if (downstreamOwner !== MISSION_SCHEDULER_OWNER) {
    disposition = 'DOWNSTREAM_OWNER_NOT_MISSION_SCHEDULER';
  } else if (activeIssues.has(ownerIssue)) {
    disposition = 'EXISTING_OWNER_ACTIVE';
  } else if (candidateIssues.has(ownerIssue) && lifecycle === 'READY') {
    disposition = 'READY_FOR_EXISTING_ELASTIC_ADMISSION';
  } else if (lifecycle === 'READY') {
    disposition = 'READY_BUT_NOT_ADMITTED_BY_CURRENT_CAPACITY';
  } else if (ownerGoal) {
    disposition = `WAITING_FOR_CANONICAL_SCHEDULER_${lifecycle || 'STATE'}`;
  } else {
    disposition = 'OWNER_NOT_PRESENT_IN_CANONICAL_SCHEDULER';
  }

  return Object.freeze({
    findingId: text(route.findingId),
    canonicalOwner: goalRef(route.canonicalOwner),
    downstreamOwner,
    ownerIssue,
    schedulerLifecycle: lifecycle || null,
    disposition,
    schedulerMutationPerformed: false,
    missionCreationPerformed: false,
  });
}

function validateRepairHandoff(record, scheduler, nowMs) {
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs,
    staleAfterMs: FLYWHEEL_REPAIR_DEMAND_STALE_AFTER_MS,
  });
  if (!validation.valid || validation.stale) return null;
  if (record.kind !== SHARED_WORKSPACE_RECORD_KINDS.HANDOFF) return null;
  if (text(record.participantId) !== 'flywheel-repair-patrol') return null;
  if (text(record.fromParticipantId) !== 'flywheel-repair-patrol') return null;
  if (text(record.toParticipantId) !== 'mission-orchestrator') return null;
  if (text(record.relatedIssue) !== '#1903') return null;

  const body = safeJson(record.body);
  if (!body || body.schemaVersion !== FLYWHEEL_REPAIR_PATROL_RUNNER_SCHEMA_VERSION) return null;
  const continuation = body.continuation;
  const constraints = body.constraints;
  if (!continuation || continuation.kind !== 'FLYWHEEL_CONTINUITY_REPAIR_REQUIRED') return null;
  if (!constraints || constraints.existingOwnerFirst !== true || constraints.duplicateGoalForbidden !== true || constraints.duplicateControllerForbidden !== true) return null;
  if (
    constraints.sourceMutationAllowed !== false
    || constraints.mergeAuthority !== false
    || constraints.deploymentAuthority !== false
    || constraints.runtimeMutationAuthority !== false
    || constraints.authorityWideningAllowed !== false
  ) return null;
  if (continuation.ownerResolutionRequired === true) return null;

  const suppliedRoutes = list(continuation.repairRoutes);
  if (suppliedRoutes.length === 0 || suppliedRoutes.length > 24) return null;
  const unique = new Set();
  const routes = [];
  for (const route of suppliedRoutes) {
    const findingId = text(route?.findingId);
    const canonicalOwner = goalRef(route?.canonicalOwner);
    const downstreamOwner = goalRef(route?.downstreamOwner);
    if (!findingId || !canonicalOwner || !downstreamOwner) return null;
    const key = `${findingId}:${canonicalOwner}:${downstreamOwner}`;
    if (unique.has(key)) return null;
    unique.add(key);
    routes.push(routeAgainstScheduler({ findingId, canonicalOwner, downstreamOwner }, scheduler));
  }
  const actionable = routes.filter((route) => [
    'EXISTING_OWNER_ACTIVE',
    'READY_FOR_EXISTING_ELASTIC_ADMISSION',
  ].includes(route.disposition)).length;
  return Object.freeze({
    schemaVersion: FLYWHEEL_REPAIR_DEMAND_SCHEMA_VERSION,
    valid: true,
    state: 'REPAIR_DEMAND_PRESENT',
    reason: actionable > 0 ? 'OWNED_REPAIR_DEMAND_ACTIONABLE' : 'OWNED_REPAIR_DEMAND_WAITING_FOR_CANONICAL_SCHEDULER',
    handoffId: text(record.handoffId),
    generatedAtUtc: text(record.timestampUtc),
    routes: Object.freeze(routes),
    actionableRouteCount: actionable,
    unresolvedRouteCount: routes.length - actionable,
    authority: AUTHORITY,
  });
}

export function projectFlywheelRepairDemandV1({ handoff, scheduler, nowMs = Date.now() } = {}) {
  if (!handoff) return noDemand();
  const projected = validateRepairHandoff(handoff, scheduler, nowMs);
  return projected ?? blocked('FLYWHEEL_REPAIR_HANDOFF_INVALID_OR_STALE');
}

export function reconcileFlywheelRepairDemandAdmissionV1(demand = {}, admission = {}) {
  if (demand?.state !== 'REPAIR_DEMAND_PRESENT' || demand?.valid !== true) return demand;
  const admitted = new Set(list(admission?.admittedIssueNumbers).map(issueNumber).filter(Boolean));
  const active = new Set(list(admission?.activeMissions).map((mission) => issueNumber(text(mission?.missionId).match(/^critical-([1-9]\d*)-elastic-goal/i)?.[1])).filter(Boolean));
  const routes = demand.routes.map((route) => {
    let disposition = route.disposition;
    if (route.downstreamOwner === MISSION_SCHEDULER_OWNER && admitted.has(route.ownerIssue)) {
      disposition = 'ROUTED_TO_EXISTING_ELASTIC_ADMISSION';
    } else if (route.downstreamOwner === MISSION_SCHEDULER_OWNER && active.has(route.ownerIssue)) {
      disposition = 'EXISTING_OWNER_ACTIVE';
    }
    return Object.freeze({ ...route, disposition });
  });
  const routed = routes.filter((route) => [
    'ROUTED_TO_EXISTING_ELASTIC_ADMISSION',
    'EXISTING_OWNER_ACTIVE',
  ].includes(route.disposition)).length;
  return Object.freeze({
    ...demand,
    state: routed > 0 ? 'REPAIR_DEMAND_ROUTED' : 'REPAIR_DEMAND_PRESENT',
    reason: routed > 0 ? 'OWNED_REPAIR_DEMAND_ROUTED_THROUGH_EXISTING_GOAL_FLYWHEEL' : demand.reason,
    routes: Object.freeze(routes),
    routedRouteCount: routed,
    authority: AUTHORITY,
  });
}

export async function readFlywheelRepairDemandV1({
  workspaceRoot,
  repoRoot,
  scheduler,
  nowMs = Date.now(),
  readFileFn = readFile,
  readdirFn = readdir,
} = {}) {
  if (!text(workspaceRoot) || !text(repoRoot)) return noDemand('FLYWHEEL_REPAIR_WORKSPACE_NOT_CONFIGURED');
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments: ['handoffs'] });
  if (!resolved.ok) return blocked(resolved.reason);
  let names;
  try {
    names = await readdirFn(resolved.path);
  } catch (error) {
    return error?.code === 'ENOENT' ? noDemand() : blocked('FLYWHEEL_REPAIR_HANDOFF_DIRECTORY_READ_FAILED');
  }
  const candidates = [];
  for (const name of names.filter((entry) => typeof entry === 'string' && entry.endsWith('.json')).slice(0, FLYWHEEL_REPAIR_DEMAND_MAX_HANDOFFS)) {
    try {
      const record = JSON.parse(await readFileFn(join(resolved.path, name), 'utf8'));
      const projection = validateRepairHandoff(record, scheduler, nowMs);
      if (projection) candidates.push(projection);
    } catch {
      // Malformed unrelated handoffs cannot manufacture repair demand.
    }
  }
  candidates.sort((left, right) => Date.parse(right.generatedAtUtc) - Date.parse(left.generatedAtUtc) || right.handoffId.localeCompare(left.handoffId));
  return candidates[0] ?? noDemand();
}
