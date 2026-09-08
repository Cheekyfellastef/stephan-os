import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { SELF_HOSTING_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  createSharedWorkspaceEventRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
  ELASTIC_GOAL_BUILD_IGNITION_SCHEMA,
  dispatchElasticGoalBuilds as dispatchElasticGoalBuildsCore,
  ensureCriticalBacklogMission as ensureCriticalBacklogMissionCore,
  publishCriticalBacklogProjection as publishCriticalBacklogProjectionCore,
  resolveCriticalBacklogRuntimePaths,
} from './criticalBacklogConveyorServiceCore.js';
import { readAuthoritativeProgrammeProjection } from './programmeAuthorityService.js';
import {
  readElasticMissionControllerCapacityRoutingInput,
  resolveElasticExternalCapacityCandidates,
} from './elasticOpenClawProviderPoolService.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';

const SHA_40 = /^[0-9a-f]{40}$/i;
const ACTIVE_SOURCE_PHASES = new Set(['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function parkedProjection(projection = {}) {
  return Object.freeze({
    parkedItemIds: Object.freeze(Array.isArray(projection.parkedItemIds) ? [...projection.parkedItemIds] : []),
    parkedMissionIds: Object.freeze(Array.isArray(projection.parkedMissionIds) ? [...projection.parkedMissionIds] : []),
    parkedApprovalCount: Number.isSafeInteger(projection.parkedApprovalCount)
      ? projection.parkedApprovalCount
      : Array.isArray(projection.parkedMissionIds)
        ? projection.parkedMissionIds.length
        : 0,
  });
}

function parkedSignature(value = {}) {
  const parked = parkedProjection(value);
  return JSON.stringify(parked);
}

async function readCurrentConveyorStatus(paths) {
  const resolved = resolveSharedWorkspacePath({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    segments: ['status', 'critical-backlog-conveyor-current.json'],
  });
  if (!resolved.ok) return null;
  try {
    return JSON.parse(await readFile(resolved.path, 'utf8'));
  } catch {
    return null;
  }
}

export function canonicalElasticSourceRevision(authoritative = {}) {
  const sourceRevision = text(authoritative?.machineryInventory?.sourceHead).toLowerCase();
  return SHA_40.test(sourceRevision) ? sourceRevision : '';
}

export async function publishCriticalBacklogProjection(projection, options = {}) {
  const normalized = options && typeof options === 'object' ? options : {};
  const paths = normalized.paths;
  const before = paths ? await readCurrentConveyorStatus(paths) : null;
  const result = await publishCriticalBacklogProjectionCore(projection, normalized);
  if (result?.ok !== true || !paths) return result;

  const parked = parkedProjection(projection);
  const status = await readCurrentConveyorStatus(paths);
  if (!status) return Object.freeze({ ...result, ok: false, reason: 'CONVEYOR_STATUS_RELOAD_FAILED' });

  const statusWrite = await writeAtomicJson(
    paths.workspaceRoot,
    ['status', 'critical-backlog-conveyor-current.json'],
    Object.freeze({ ...status, ...parked }),
    { repoRoot: paths.repoRoot },
  );
  if (!statusWrite.ok) return Object.freeze({ ...result, ok: false, reason: statusWrite.reason, statusWrite });

  const parkedChanged = parkedSignature(before || {}) !== parkedSignature(parked);
  let eventWrite = result.eventWrite;
  if (parkedChanged && result.changed !== true) {
    const timestampUtc = normalized.now instanceof Date ? normalized.now.toISOString() : new Date().toISOString();
    const digest = createHash('sha256')
      .update(`${text(projection.decision)}:${parkedSignature(parked)}`)
      .digest('hex')
      .slice(0, 20);
    const transitionEventId = `critical-backlog-${digest}`;
    const eventRecord = Object.freeze({
      ...createSharedWorkspaceEventRecord({
        eventId: transitionEventId,
        participantId: 'critical-backlog-conveyor',
        timestampUtc,
        eventKind: 'critical-backlog-state-changed',
        summary: `Critical backlog ${text(projection.decision)} parked approval set changed.`,
      }),
      decision: projection.decision,
      selectedItemId: text(projection.selectedItem?.itemId),
      activeMissionId: text(projection.activeMission?.missionId),
      activePhase: text(projection.activeMission?.currentPhase),
      ...parked,
    });
    eventWrite = await writeAtomicJson(
      paths.workspaceRoot,
      ['events', 'critical-backlog-conveyor', `${transitionEventId}.json`],
      eventRecord,
      { repoRoot: paths.repoRoot },
    );
    if (!eventWrite.ok) return Object.freeze({ ...result, ok: false, reason: eventWrite.reason, statusWrite, eventWrite });
  }

  return Object.freeze({
    ...result,
    changed: result.changed === true || parkedChanged,
    reason: result.changed === true || parkedChanged
      ? 'CONVEYOR_STATUS_AND_EVENT_PUBLISHED'
      : 'CONVEYOR_STATUS_REFRESHED',
    statusWrite,
    eventWrite,
  });
}

export async function dispatchElasticGoalBuildsFromCanonicalMain(admission = {}, options = {}) {
  const normalized = options && typeof options === 'object' ? options : {};
  const env = normalized.env || process.env;
  const now = normalized.now instanceof Date ? normalized.now : new Date();
  const paths = normalized.paths || resolveCriticalBacklogRuntimePaths({ env });
  const readProgrammeProjection = normalized.testOnly === true && typeof normalized.readProgrammeProjection === 'function'
    ? normalized.readProgrammeProjection
    : readAuthoritativeProgrammeProjection;
  const authoritative = await readProgrammeProjection({
    env,
    nowUtc: now.toISOString(),
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    orchestratorRoot: paths.orchestratorRoot,
    snapshotRoot: paths.snapshotRoot,
  });
  const sourceRevision = canonicalElasticSourceRevision(authoritative);
  return dispatchElasticGoalBuildsCore(admission, {
    ...normalized,
    env,
    now,
    paths,
    sourceRevision,
    resolveCapacityCandidates: normalized.resolveCapacityCandidates ?? resolveElasticExternalCapacityCandidates,
  });
}

export async function dispatchActiveCriticalMissionFromCanonicalMain(serviceResult = {}, options = {}) {
  const normalized = options && typeof options === 'object' ? options : {};
  const mission = serviceResult?.classification === 'WAIT_ACTIVE_MISSION'
    ? serviceResult?.projection?.activeMission
    : null;
  const currentPhase = text(mission?.currentPhase).toUpperCase();
  if (!mission || !ACTIVE_SOURCE_PHASES.has(currentPhase)) {
    return Object.freeze({
      ok: true,
      classification: 'CRITICAL_ACTIVE_MISSION_DISPATCH_NOT_REQUIRED',
      published: false,
      missionId: text(mission?.missionId),
      currentPhase,
      blockers: Object.freeze([]),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }
  if (text(mission?.dispatch?.status).toLowerCase() === 'running') {
    return Object.freeze({
      ok: true,
      classification: 'CRITICAL_ACTIVE_MISSION_ALREADY_RUNNING',
      published: false,
      missionId: text(mission.missionId),
      currentPhase,
      blockers: Object.freeze([]),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }

  const env = normalized.env || process.env;
  const now = normalized.now instanceof Date ? normalized.now : new Date();
  const paths = normalized.paths || resolveCriticalBacklogRuntimePaths({ env });
  const readProgrammeProjection = normalized.testOnly === true && typeof normalized.readProgrammeProjection === 'function'
    ? normalized.readProgrammeProjection
    : readAuthoritativeProgrammeProjection;
  const readCapacityRouting = normalized.readCapacityRouting ?? readElasticMissionControllerCapacityRoutingInput;
  const publishActiveMission = normalized.publishActiveMission ?? publishMissionWorkerAction;
  const authoritative = await readProgrammeProjection({
    env,
    nowUtc: now.toISOString(),
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    orchestratorRoot: paths.orchestratorRoot,
    snapshotRoot: paths.snapshotRoot,
  });
  const sourceRevision = canonicalElasticSourceRevision(authoritative);
  if (!sourceRevision) {
    return Object.freeze({
      ok: false,
      classification: 'CRITICAL_ACTIVE_MISSION_SOURCE_REVISION_UNPROVEN',
      published: false,
      missionId: text(mission.missionId),
      currentPhase,
      sourceRevision: '',
      blockers: Object.freeze(['canonical-source-revision-unproven']),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }

  const capacityRouting = await readCapacityRouting({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    nowUtc: now.toISOString(),
    sourceRevision,
    env,
  });
  if (!capacityRouting) {
    return Object.freeze({
      ok: false,
      classification: 'CRITICAL_ACTIVE_MISSION_CAPACITY_ROUTING_UNAVAILABLE',
      published: false,
      missionId: text(mission.missionId),
      currentPhase,
      sourceRevision,
      blockers: Object.freeze(['provider-independent-capacity-routing-unavailable']),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }

  let publication;
  try {
    publication = await publishActiveMission(mission, {
      ...normalized,
      env,
      now,
      root: paths.orchestratorRoot,
      snapshotRoot: paths.snapshotRoot,
      repoRoot: paths.repoRoot,
      sharedWorkspaceRoot: paths.workspaceRoot,
      sourceRevision,
      capacityRouting,
    });
  } catch (error) {
    publication = {
      published: false,
      reason: `publication-exception:${text(error?.message, 'unknown')}`,
      action: null,
    };
  }
  if (publication?.published === true) {
    return Object.freeze({
      ok: true,
      classification: 'CRITICAL_ACTIVE_MISSION_DISPATCH_LIVE',
      published: true,
      missionId: text(mission.missionId),
      currentPhase,
      sourceRevision,
      adapter: text(publication?.adapter || publication?.action?.adapter),
      capacityRoute: text(publication?.action?.capacityRoute),
      capacityReceiptId: text(publication?.action?.capacityReceiptId),
      blockers: Object.freeze([]),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }
  if (publication?.reason === 'agent-already-running') {
    return Object.freeze({
      ok: true,
      classification: 'CRITICAL_ACTIVE_MISSION_ALREADY_RUNNING',
      published: false,
      missionId: text(mission.missionId),
      currentPhase,
      sourceRevision,
      blockers: Object.freeze([]),
      mergeAuthority: false,
      runtimeMutationAuthority: false,
    });
  }
  const blockers = Array.isArray(publication?.action?.blockers) && publication.action.blockers.length
    ? publication.action.blockers.map((item) => text(item)).filter(Boolean)
    : [text(publication?.reason, 'active-mission-dispatch-not-published')];
  return Object.freeze({
    ok: false,
    classification: 'CRITICAL_ACTIVE_MISSION_DISPATCH_HELD',
    published: false,
    missionId: text(mission.missionId),
    currentPhase,
    sourceRevision,
    blockers: Object.freeze(blockers),
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}

export const dispatchElasticGoalBuilds = dispatchElasticGoalBuildsCore;

export {
  CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
  ELASTIC_GOAL_BUILD_IGNITION_SCHEMA,
  resolveCriticalBacklogRuntimePaths,
};

export async function ensureCriticalBacklogMission(options = {}) {
  const normalized = options && typeof options === 'object' ? options : {};
  const result = await ensureCriticalBacklogMissionCore({
    ...normalized,
    backlog: normalized.backlog ?? SELF_HOSTING_CRITICAL_BACKLOG,
    publishProjection: normalized.publishProjection ?? publishCriticalBacklogProjection,
    readCapacityRouting: normalized.readCapacityRouting ?? readElasticMissionControllerCapacityRoutingInput,
    dispatchElasticBuilds: normalized.dispatchElasticBuilds ?? dispatchElasticGoalBuildsFromCanonicalMain,
  });
  if (result?.ok !== true) return result;
  const dispatchActiveCriticalMission = normalized.dispatchActiveCriticalMission ?? dispatchActiveCriticalMissionFromCanonicalMain;
  const activeMissionIgnition = await dispatchActiveCriticalMission(result, normalized);
  if (activeMissionIgnition?.ok === false) {
    return Object.freeze({
      ...result,
      ok: false,
      activeMissionIgnition,
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
    });
  }
  return Object.freeze({ ...result, activeMissionIgnition });
}
