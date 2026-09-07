import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CRITICAL_BACKLOG_CONVEYOR_SCHEMA,
  CRITICAL_BACKLOG_DECISION,
  DEFAULT_CRITICAL_BACKLOG,
  buildCriticalBacklogMissionInput,
  buildCriticalBacklogProjection,
} from '../../shared/agents/criticalBacklogConveyor.mjs';
import { MAXIMUM_BUILD_LANES } from '../../shared/agents/elasticBuildCapacityV1.mjs';
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  MISSION_CONTROLLER_ROUTE,
  routeMissionControllerCapacity,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  OPENCLAW_PROVIDER_ROUTE,
  routeWithQualifiedOpenClawProvider,
} from '../../shared/agents/openClawProviderPoolQualificationV1.mjs';
import {
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  createMissionRecord,
  listMissionRecords,
} from './missionOrchestratorStore.js';
import {
  readAuthoritativeProgrammeProjection,
  readMissionControllerCapacityRoutingInput,
} from './programmeAuthorityService.js';
import { ensureElasticGoalMissions } from './elasticGoalMissionAdmissionService.js';
import { publishNextMissionWorkerAction } from './missionOrchestratorWorkerService.js';

export const CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA = 'stephanos.critical-backlog-conveyor-service.v1';
export const ELASTIC_GOAL_BUILD_IGNITION_SCHEMA = 'stephanos.elastic-goal-build-ignition.v1';

const BLOCKED_DECISIONS = new Set([
  CRITICAL_BACKLOG_DECISION.BLOCKED_BY_INVALID_BACKLOG,
  CRITICAL_BACKLOG_DECISION.BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS,
  CRITICAL_BACKLOG_DECISION.BLOCKED_BY_TERMINAL_MISSION,
]);
const SHA_40 = /^[0-9a-f]{40}$/i;
const ELASTIC_MISSION_ID = /^critical-([1-9]\d*)-elastic-goal(?:$|[-_.])/i;
const EXTERNAL_ELASTIC_ADAPTERS = new Set(['chatgpt-github', 'foundry-forge', 'openclaw-local']);
const EXTERNAL_ELASTIC_ROUTES = new Set([
  MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
  MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL,
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function eventId(value) {
  return `critical-backlog-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function elasticIssueNumber(mission = {}) {
  const match = text(mission.missionId).toLowerCase().match(ELASTIC_MISSION_ID);
  const parsed = Number(match?.[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function elasticControllerProjection(admission = {}) {
  const mission = admission.selectedMission;
  const issueNumber = elasticIssueNumber(mission);
  if (!mission || !issueNumber) return null;
  return Object.freeze({
    schemaVersion: CRITICAL_BACKLOG_CONVEYOR_SCHEMA,
    validation: Object.freeze({ valid: true, errors: Object.freeze([]), finalVerdict: 'CRITICAL_BACKLOG_PASS' }),
    decision: CRITICAL_BACKLOG_DECISION.WAIT_EXTERNAL_ACTIVE_MISSION,
    selectedItem: Object.freeze({
      itemId: `elastic-goal-${issueNumber}`,
      priority: 0,
      issueNumbers: Object.freeze([issueNumber]),
      headlineApprovalRef: 'mission-scheduler-elastic-admission',
      mission,
    }),
    activeMission: mission,
    completedItemIds: Object.freeze([]),
    remainingItemIds: Object.freeze([]),
    elasticMissionIds: Object.freeze((admission.elasticMissions || []).map((item) => text(item.missionId)).filter(Boolean)),
    exactNextAction: `Advance scheduler-admitted elastic goal mission ${text(mission.missionId)} by one bounded Mission Worker action.`,
    oneActiveMissionEnforced: false,
    elasticGoalMissionsUseSchedulerCapacity: true,
    duplicateCodexDispatchAllowed: false,
    mergeAuthority: false,
    exactHeadApprovalRequired: true,
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
  });
}

function normalizeScope(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/\*\*$/, '').replace(/\/+$/, '');
}

function missionScopes(mission = {}) {
  return [...new Set((Array.isArray(mission.allowedFiles) ? mission.allowedFiles : [])
    .map(normalizeScope)
    .filter(Boolean))].sort();
}

function scopesOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function scopeSetConflicts(scopes, occupied) {
  return scopes.some((scope) => occupied.some((held) => scopesOverlap(scope, held)));
}

function prePrElasticMission(mission = {}) {
  const issueNumber = elasticIssueNumber(mission);
  const branch = text(mission.git?.branch || mission.branch);
  const prNumber = Number(mission.pullRequest?.number || mission.prNumber || 0);
  const headSha = text(mission.pullRequest?.headSha || mission.headSha || mission.git?.headSha).toLowerCase();
  return Boolean(
    issueNumber
    && branch === `openclaw/elastic-goal-${issueNumber}`
    && !(Number.isSafeInteger(prNumber) && prNumber > 0)
    && !SHA_40.test(headSha),
  );
}

function externalCandidateKey(candidate = {}) {
  return [text(candidate.adapter), text(candidate.workerId), text(candidate.receiptId)].join(':').toLowerCase();
}

function normalizedExternalCandidate(candidate = {}) {
  const route = text(candidate.route).toUpperCase();
  const adapter = text(candidate.adapter).toLowerCase();
  const workerId = text(candidate.workerId);
  if (!EXTERNAL_ELASTIC_ROUTES.has(route) || !EXTERNAL_ELASTIC_ADAPTERS.has(adapter) || !workerId) return null;
  return Object.freeze({
    route,
    adapter,
    workerId,
    receiptId: text(candidate.receiptId || candidate.selectedCapacityReceiptId),
    proofRefs: Object.freeze(Array.isArray(candidate.proofRefs) ? [...candidate.proofRefs] : []),
    queueDepth: Number.isSafeInteger(candidate.queueDepth) ? candidate.queueDepth : 0,
    p95StartLatencySeconds: Number.isFinite(candidate.p95StartLatencySeconds) ? candidate.p95StartLatencySeconds : 0,
  });
}

function defaultExternalCapacityCandidates(mission, capacityRouting, sourceRevision, nowUtc) {
  if (!capacityRouting || !SHA_40.test(sourceRevision)) return [];
  const baseInput = {
    ...capacityRouting,
    nowUtc,
    sourceHead: sourceRevision,
    mission,
  };
  const fallback = routeMissionControllerCapacity({
    ...baseInput,
    codexStatus: null,
  });
  const candidates = (Array.isArray(fallback?.fallbackCandidates) ? fallback.fallbackCandidates : [])
    .map(normalizedExternalCandidate)
    .filter(Boolean);
  const openClaw = routeWithQualifiedOpenClawProvider({
    ...baseInput,
    mission: { ...mission, preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
    task: { preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
  }, capacityRouting.openClawHostContext);
  if (openClaw?.dispatchAllowed === true && text(openClaw.adapter).toLowerCase() === 'openclaw-local') {
    const receipt = openClaw.openClawCapacity?.receipt;
    const candidate = normalizedExternalCandidate({
      route: openClaw.route,
      adapter: openClaw.adapter,
      workerId: openClaw.workerId,
      receiptId: openClaw.selectedCapacityReceiptId,
      proofRefs: openClaw.proofRefs,
      queueDepth: receipt?.queueDepth,
      p95StartLatencySeconds: receipt?.p95StartLatencySeconds,
    });
    if (candidate) candidates.push(candidate);
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const key = externalCandidateKey(candidate);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((left, right) => (
    left.p95StartLatencySeconds - right.p95StartLatencySeconds
    || left.queueDepth - right.queueDepth
    || left.route.localeCompare(right.route)
  ));
}

function exactElasticExternalGrant(mission, candidate, sourceRevision, now) {
  if (!prePrElasticMission(mission) || !SHA_40.test(sourceRevision)) return null;
  const issueNumber = elasticIssueNumber(mission);
  const actionState = projectMissionWorkerActionState(mission, { now });
  const currentPhase = text(actionState?.currentPhase).toUpperCase();
  if (!['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(currentPhase)) return null;
  const provisionalGrant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: text(actionState.missionId).toLowerCase(),
    capacityRoute: candidate.route,
    adapter: candidate.adapter,
    workerId: candidate.workerId,
    capacityReceiptId: candidate.receiptId,
    capacityProofRefs: candidate.proofRefs,
  };
  const action = buildMissionWorkerAction(actionState, { now, actionGrant: provisionalGrant });
  if (
    action?.executable !== true
    || action?.actionKind !== 'agent-handoff'
    || text(action.adapter).toLowerCase() !== candidate.adapter
    || text(action.workerId) !== candidate.workerId
  ) return null;
  const missionId = text(actionState.missionId).toLowerCase();
  const actionId = text(action.actionId).toLowerCase();
  const branch = text(actionState.git?.branch || actionState.branch);
  if (!missionId || !actionId || !branch) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${actionId}`.slice(0, 80),
    controllerId: 'durable-flywheel-controller',
    sourceRevision: sourceRevision.toLowerCase(),
    missionId,
    missionRevision: Number(actionState.revision),
    currentPhase,
    actionId,
    actionKind: 'agent-handoff',
    adapter: candidate.adapter,
    operation: text(action.operation),
    providerRouteIntent: text(actionState.providerRouteIntent, 'AUTO').toUpperCase(),
    capacityRoute: candidate.route,
    capacityReceiptId: candidate.receiptId || null,
    capacityProofRefs: candidate.proofRefs,
    workerId: candidate.workerId,
    laneId: missionId,
    repository: text(actionState.repository),
    issueNumber,
    prNumber: null,
    branch,
    headSha: null,
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export async function dispatchElasticGoalBuilds(admission = {}, {
  env = process.env,
  now = new Date(),
  paths = resolveCriticalBacklogRuntimePaths({ env }),
  sourceRevision = text(env.STEPHANOS_MISSION_WORKER_HEAD_SHA).toLowerCase(),
  capacityRouting = null,
  resolveCapacityCandidates = defaultExternalCapacityCandidates,
  publishWorkerAction = publishNextMissionWorkerAction,
} = {}) {
  const desiredWidth = Math.max(0, Math.min(MAXIMUM_BUILD_LANES, Number(admission.desiredWidth) || 0));
  const selectedMissionId = text(admission.selectedMission?.missionId).toLowerCase();
  const running = (Array.isArray(admission.activeMissions) ? admission.activeMissions : [])
    .filter((mission) => text(mission.dispatch?.status).toLowerCase() === 'running');
  const selectedConsumesSlot = Boolean(
    selectedMissionId
    && !running.some((mission) => text(mission.missionId).toLowerCase() === selectedMissionId),
  );
  const availableSlots = Math.max(0, desiredWidth - running.length - (selectedConsumesSlot ? 1 : 0));
  const occupiedScopes = running.flatMap(missionScopes);
  const usedCapacity = new Set(running.map((mission) => [
    text(mission.dispatch?.adapter),
    text(mission.dispatch?.workerId),
    text(mission.dispatch?.capacityReceiptId),
  ].join(':').toLowerCase()).filter((value) => value !== '::'));
  const candidates = (Array.isArray(admission.runnableMissions) ? admission.runnableMissions : [])
    .filter((mission) => text(mission.missionId).toLowerCase() !== selectedMissionId);
  const dispatched = [];
  const held = [];

  if (!SHA_40.test(sourceRevision)) {
    return Object.freeze({
      schemaVersion: ELASTIC_GOAL_BUILD_IGNITION_SCHEMA,
      ok: false,
      classification: 'ELASTIC_IGNITION_SOURCE_REVISION_UNPROVEN',
      desiredWidth,
      availableSlots,
      dispatched,
      held: candidates.map((mission) => Object.freeze({ missionId: text(mission.missionId), reason: 'SOURCE_REVISION_REQUIRED' })),
      dispatchCount: 0,
      resourceDisjointOneWriterProven: false,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }

  for (const mission of candidates) {
    if (dispatched.length >= availableSlots) break;
    const missionId = text(mission.missionId).toLowerCase();
    const scopes = missionScopes(mission);
    if (!prePrElasticMission(mission)) {
      held.push(Object.freeze({ missionId, reason: 'EXACT_PR_HEAD_LANE_REQUIRES_CANONICAL_LEASE_PATH' }));
      continue;
    }
    if (!['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(text(mission.currentPhase).toUpperCase())) {
      held.push(Object.freeze({ missionId, reason: 'NATIVE_CONTROL_PHASE_REMAINS_PRIMARY_LANE' }));
      continue;
    }
    if (!scopes.length || scopeSetConflicts(scopes, occupiedScopes)) {
      held.push(Object.freeze({ missionId, reason: scopes.length ? 'RESOURCE_SCOPE_CONFLICT' : 'RESOURCE_SCOPE_REQUIRED' }));
      continue;
    }
    const routeCandidates = resolveCapacityCandidates(mission, capacityRouting, sourceRevision, now.toISOString());
    const capacity = routeCandidates.find((candidate) => !usedCapacity.has(externalCandidateKey(candidate)));
    if (!capacity) {
      held.push(Object.freeze({ missionId, reason: 'DISTINCT_PROVEN_EXTERNAL_CAPACITY_UNAVAILABLE' }));
      continue;
    }
    const grant = exactElasticExternalGrant(mission, capacity, sourceRevision, now);
    if (!grant) {
      held.push(Object.freeze({ missionId, reason: 'EXACT_EXTERNAL_ACTION_GRANT_UNAVAILABLE' }));
      continue;
    }
    let publication;
    try {
      publication = await publishWorkerAction({
        env,
        now,
        nowUtc: now.toISOString(),
        sourceRevision: sourceRevision.toLowerCase(),
        repoRoot: paths.repoRoot,
        sharedWorkspaceRoot: paths.workspaceRoot,
        root: paths.orchestratorRoot,
        snapshotRoot: paths.snapshotRoot,
        actionGrant: grant,
      });
    } catch (error) {
      publication = { published: false, actionGrantAccepted: false, reason: `publication-exception:${text(error?.message, 'unknown')}` };
    }
    if (publication?.published !== true || publication?.actionGrantAccepted !== true) {
      held.push(Object.freeze({
        missionId,
        reason: `EXTERNAL_DISPATCH_BLOCKED:${text(publication?.reason, 'not-published')}`,
      }));
      continue;
    }
    dispatched.push(Object.freeze({
      missionId,
      issueNumber: elasticIssueNumber(mission),
      adapter: capacity.adapter,
      route: capacity.route,
      workerId: capacity.workerId,
      capacityReceiptId: capacity.receiptId || null,
      actionId: grant.actionId,
      grantId: grant.grantId,
      resourceScopes: Object.freeze([...scopes]),
    }));
    occupiedScopes.push(...scopes);
    usedCapacity.add(externalCandidateKey(capacity));
  }

  return Object.freeze({
    schemaVersion: ELASTIC_GOAL_BUILD_IGNITION_SCHEMA,
    ok: true,
    classification: dispatched.length
      ? 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE'
      : candidates.length
        ? 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD'
        : 'ELASTIC_EXTERNAL_BUILD_DISPATCH_NOT_REQUIRED',
    desiredWidth,
    availableSlots,
    dispatchCount: dispatched.length,
    dispatched: Object.freeze(dispatched),
    held: Object.freeze(held),
    resourceDisjointOneWriterProven: dispatched.every((item, index) => dispatched
      .slice(index + 1)
      .every((other) => !scopeSetConflicts(item.resourceScopes, other.resourceScopes))),
    blockedLaneDoesNotStallFleet: held.length === 0 || dispatched.length > 0,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}

export function resolveCriticalBacklogRuntimePaths({
  env = process.env,
  home = os.homedir(),
  repoRoot,
  workspaceRoot,
  worktreeRoot,
  orchestratorRoot,
  snapshotRoot,
} = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const resolved = (override, ...segments) => path.resolve(override || path.join(userHome, ...segments));
  return Object.freeze({
    repoRoot: resolved(repoRoot, 'Documents', 'GitHub', 'stephan-os'),
    workspaceRoot: resolved(workspaceRoot, 'Documents', 'Stephanos-openclaw-workspace'),
    worktreeRoot: resolved(worktreeRoot, 'Documents', 'GitHub', 'stephan-os-worktrees'),
    orchestratorRoot: resolved(orchestratorRoot, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'orchestrator'),
    snapshotRoot: resolved(snapshotRoot, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'proof', 'mission-operations'),
  });
}

function projectionSignature(projection = {}) {
  return JSON.stringify({
    decision: projection.decision || '',
    selectedItemId: projection.selectedItem?.itemId || '',
    activeMissionId: projection.activeMission?.missionId || '',
    activePhase: projection.activeMission?.currentPhase || '',
    completedItemIds: projection.completedItemIds || [],
    remainingItemIds: projection.remainingItemIds || [],
  });
}

async function readPreviousProjection(paths) {
  const resolved = resolveSharedWorkspacePath({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    segments: ['status', 'critical-backlog-conveyor-current.json'],
  });
  if (!resolved.ok) return null;
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    return {
      decision: record.decision,
      selectedItem: record.selectedItemId ? { itemId: record.selectedItemId } : null,
      activeMission: record.activeMissionId ? { missionId: record.activeMissionId, currentPhase: record.activePhase } : null,
      completedItemIds: Array.isArray(record.completedItemIds) ? record.completedItemIds : [],
      remainingItemIds: Array.isArray(record.remainingItemIds) ? record.remainingItemIds : [],
    };
  } catch {
    return null;
  }
}

export async function publishCriticalBacklogProjection(projection, {
  paths,
  now = new Date(),
} = {}) {
  const timestampUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const selectedItemId = text(projection.selectedItem?.itemId);
  const activeMissionId = text(projection.activeMission?.missionId);
  const activePhase = text(projection.activeMission?.currentPhase);
  const summary = selectedItemId
    ? `Critical backlog ${projection.decision}: ${selectedItemId}.`
    : `Critical backlog ${projection.decision}.`;
  const previous = await readPreviousProjection(paths);
  const changed = !previous || projectionSignature(previous) !== projectionSignature(projection);
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'critical-backlog-conveyor-current',
      participantId: 'critical-backlog-conveyor',
      timestampUtc,
      status: projection.finalVerdict,
      summary,
      proofRefs: [],
    }),
    schema: CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
    decision: projection.decision,
    selectedItemId,
    activeMissionId,
    activePhase,
    completedItemIds: [...(projection.completedItemIds || [])],
    remainingItemIds: [...(projection.remainingItemIds || [])],
    exactNextAction: text(projection.exactNextAction),
    oneActiveMissionEnforced: projection.oneActiveMissionEnforced !== false,
    elasticGoalMissionsUseSchedulerCapacity: projection.elasticGoalMissionsUseSchedulerCapacity === true,
    duplicateCodexDispatchAllowed: false,
    mergeAuthority: false,
    exactHeadApprovalRequired: true,
  });

  let eventWrite = null;
  if (changed) {
    const transitionEventId = eventId(projectionSignature(projection));
    const eventRecord = Object.freeze({
      ...createSharedWorkspaceEventRecord({
        eventId: transitionEventId,
        participantId: 'critical-backlog-conveyor',
        timestampUtc,
        eventKind: 'critical-backlog-state-changed',
        summary,
      }),
      decision: projection.decision,
      selectedItemId,
      activeMissionId,
      activePhase,
    });
    eventWrite = await writeAtomicJson(
      paths.workspaceRoot,
      ['events', 'critical-backlog-conveyor', `${transitionEventId}.json`],
      eventRecord,
      { repoRoot: paths.repoRoot },
    );
    if (!eventWrite.ok) return Object.freeze({ ok: false, reason: eventWrite.reason, statusWrite: null, eventWrite });
  }

  const statusWrite = await writeAtomicJson(
    paths.workspaceRoot,
    ['status', 'critical-backlog-conveyor-current.json'],
    statusRecord,
    { repoRoot: paths.repoRoot },
  );
  if (!statusWrite.ok) return Object.freeze({ ok: false, reason: statusWrite.reason, statusWrite, eventWrite });

  return Object.freeze({
    ok: true,
    reason: changed ? 'CONVEYOR_STATUS_AND_EVENT_PUBLISHED' : 'CONVEYOR_STATUS_REFRESHED',
    changed,
    statusWrite,
    eventWrite,
  });
}

export async function ensureCriticalBacklogMission({
  backlog = DEFAULT_CRITICAL_BACKLOG,
  env = process.env,
  now = new Date(),
  paths = resolveCriticalBacklogRuntimePaths({ env }),
  listMissions = listMissionRecords,
  createMission = createMissionRecord,
  publishProjection = publishCriticalBacklogProjection,
  readProgrammeProjection = readAuthoritativeProgrammeProjection,
  ensureElasticMissions = ensureElasticGoalMissions,
  readCapacityRouting = readMissionControllerCapacityRoutingInput,
  dispatchElasticBuilds = dispatchElasticGoalBuilds,
} = {}) {
  const nowUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  let elasticAdmission = null;
  let elasticIgnition = null;
  try {
    const authoritative = await readProgrammeProjection({
      env,
      nowUtc,
      root: paths.workspaceRoot,
      repoRoot: paths.repoRoot,
      orchestratorRoot: paths.orchestratorRoot,
      snapshotRoot: paths.snapshotRoot,
    });
    if (
      authoritative?.status === 'READY'
      && authoritative?.scheduler?.failClosed === false
      && authoritative?.scheduler?.elasticCapacity?.status === 'RUNNING'
    ) {
      elasticAdmission = await ensureElasticMissions({
        scheduler: authoritative.scheduler,
        env,
        now,
        repoRoot: paths.repoRoot,
        workspaceRoot: paths.workspaceRoot,
        worktreeRoot: paths.worktreeRoot,
        orchestratorRoot: paths.orchestratorRoot,
        snapshotRoot: paths.snapshotRoot,
      });
      const elasticProjection = elasticAdmission?.ok === true
        ? elasticControllerProjection(elasticAdmission)
        : null;
      if (elasticProjection) {
        const sourceRevision = text(env.STEPHANOS_MISSION_WORKER_HEAD_SHA).toLowerCase();
        const capacityRouting = SHA_40.test(sourceRevision)
          ? await readCapacityRouting({
              root: paths.workspaceRoot,
              repoRoot: paths.repoRoot,
              nowUtc,
              sourceRevision,
              env,
            })
          : null;
        elasticIgnition = await dispatchElasticBuilds(elasticAdmission, {
          env,
          now,
          paths,
          sourceRevision,
          capacityRouting,
        });
        return Object.freeze({
          schemaVersion: CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
          ok: true,
          classification: 'ELASTIC_GOAL_MISSION_SELECTED',
          projection: elasticProjection,
          createdMission: Number(elasticAdmission.createdMissionCount || 0) > 0,
          duplicateCreateObserved: false,
          missionRecord: Object.freeze({
            missionId: elasticAdmission.selectedMission.missionId,
            currentPhase: elasticAdmission.selectedMission.currentPhase,
          }),
          preflightPublication: null,
          publication: null,
          elasticAdmission,
          elasticIgnition,
          arbitraryShellAllowed: false,
          destructiveGitAllowed: false,
          duplicateActiveMissionAllowed: false,
          mergeAuthority: false,
          finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS',
        });
      }
    }
  } catch (error) {
    elasticAdmission = Object.freeze({
      ok: false,
      classification: 'ELASTIC_GOAL_ADMISSION_DIAGNOSTIC_FAILED',
      reason: text(error?.message, 'unknown'),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }

  let missionRecords = await listMissions({ root: paths.orchestratorRoot, snapshotRoot: paths.snapshotRoot, env });
  let projection = buildCriticalBacklogProjection({ backlog, missionRecords });
  let createdMission = false;
  let duplicateCreateObserved = false;
  let missionRecord = null;
  let preflightPublication = null;

  if (projection.decision === CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION) {
    preflightPublication = await publishProjection(projection, { paths, now });
    if (!preflightPublication.ok) {
      return Object.freeze({
        schemaVersion: CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
        ok: false,
        classification: 'CREATE_NEXT_MISSION_PUBLICATION_BLOCKED',
        projection,
        createdMission: false,
        duplicateCreateObserved: false,
        missionRecord: null,
        preflightPublication,
        publication: preflightPublication,
        elasticAdmission,
        elasticIgnition,
        arbitraryShellAllowed: false,
        destructiveGitAllowed: false,
        duplicateActiveMissionAllowed: false,
        mergeAuthority: false,
        finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
      });
    }
    const worktreePath = path.resolve(paths.worktreeRoot, projection.selectedItem.mission.missionId);
    const built = buildCriticalBacklogMissionInput(projection.selectedItem, {
      repositoryRoot: paths.repoRoot,
      worktreePath,
    });
    if (!built.ok) {
      projection = buildCriticalBacklogProjection({ backlog: [], missionRecords });
    } else {
      try {
        missionRecord = await createMission(built.mission, {
          root: paths.orchestratorRoot,
          snapshotRoot: paths.snapshotRoot,
          env,
          now,
          createdBy: 'critical-backlog-conveyor',
        });
        createdMission = true;
      } catch (error) {
        if (!/Mission already exists:/i.test(text(error?.message))) throw error;
        duplicateCreateObserved = true;
      }
      missionRecords = await listMissions({ root: paths.orchestratorRoot, snapshotRoot: paths.snapshotRoot, env });
      projection = buildCriticalBacklogProjection({ backlog, missionRecords });
    }
  }

  const publication = await publishProjection(projection, { paths, now });
  const blocked = BLOCKED_DECISIONS.has(projection.decision);
  const ok = !blocked && publication.ok === true;
  return Object.freeze({
    schemaVersion: CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
    ok,
    classification: projection.decision,
    projection,
    createdMission,
    duplicateCreateObserved,
    missionRecord: missionRecord?.state
      ? Object.freeze({ missionId: missionRecord.state.missionId, currentPhase: missionRecord.state.currentPhase })
      : null,
    preflightPublication,
    publication,
    elasticAdmission,
    elasticIgnition,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    duplicateActiveMissionAllowed: false,
    mergeAuthority: false,
    finalVerdict: ok ? 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS' : 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
  });
}
