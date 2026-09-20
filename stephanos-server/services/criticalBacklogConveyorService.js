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
import { dispatchElasticPrHeadBuildsFromCanonicalLease } from './elasticPrHeadLeaseService.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { appendMissionEvent, listMissionRecords } from './missionOrchestratorStore.js';

const SHA_40 = /^[0-9a-f]{40}$/i;
const ACTIVE_SOURCE_PHASES = new Set(['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']);
const LEGACY_CAPACITY_PARKED_PHASES = new Set(['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL', 'MERGE_PULL_REQUEST']);
const ELASTIC_GOAL_MISSION_ID = /^critical-[1-9]\d*-elastic-goal(?:$|[-_.])/i;
const REENTRY_READY = 'REENTRY_READY';
const ACTIVE_CONTINUITY = 'ACTIVE';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function continuityStatus(record = {}) {
  return text(record?.continuity?.parkingStatus, ACTIVE_CONTINUITY).toUpperCase();
}

function isElasticGoalMission(record = {}) {
  return ELASTIC_GOAL_MISSION_ID.test(text(record?.missionId).toLowerCase());
}

function isLegacyCapacityActive(record = {}) {
  if (isElasticGoalMission(record)) return false;
  if (continuityStatus(record) !== ACTIVE_CONTINUITY) return false;
  return !LEGACY_CAPACITY_PARKED_PHASES.has(text(record?.currentPhase).toUpperCase());
}

function criticalBacklogPriority(backlog = [], missionId = '') {
  const wanted = text(missionId).toLowerCase();
  const entry = (Array.isArray(backlog) ? backlog : []).find((item) => text(item?.mission?.missionId).toLowerCase() === wanted);
  return Number.isSafeInteger(entry?.priority) ? entry.priority : Number.MAX_SAFE_INTEGER;
}

export async function readmitReentryReadyCriticalMission({
  backlog = SELF_HOSTING_CRITICAL_BACKLOG,
  env = process.env,
  now = new Date(),
  paths = resolveCriticalBacklogRuntimePaths({ env }),
  listMissions = listMissionRecords,
  appendEvent = appendMissionEvent,
} = {}) {
  const records = await listMissions({ root: paths.orchestratorRoot, snapshotRoot: paths.snapshotRoot, env });
  const active = records.filter(isLegacyCapacityActive);
  const ready = records
    .filter((record) => !isElasticGoalMission(record) && continuityStatus(record) === REENTRY_READY)
    .filter((record) => criticalBacklogPriority(backlog, record.missionId) !== Number.MAX_SAFE_INTEGER)
    .sort((left, right) => (
      criticalBacklogPriority(backlog, left.missionId) - criticalBacklogPriority(backlog, right.missionId)
      || text(left.missionId).localeCompare(text(right.missionId))
    ));

  if (!ready.length) return Object.freeze({
    ok: true,
    classification: 'NO_REENTRY_READY_MISSION',
    reentered: false,
    missionId: '',
  });
  if (active.length) return Object.freeze({
    ok: true,
    classification: 'REENTRY_HELD_BY_ACTIVE_LEGACY_MISSION',
    reentered: false,
    missionId: text(ready[0].missionId),
    activeMissionIds: Object.freeze(active.map((record) => text(record.missionId)).sort()),
  });

  const candidate = ready[0];
  if (text(candidate.currentPhase).toUpperCase() !== 'BLOCKED') return Object.freeze({
    ok: false,
    classification: 'REENTRY_READY_PHASE_CONTRADICTION',
    reentered: false,
    missionId: text(candidate.missionId),
  });
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 0) return Object.freeze({
    ok: false,
    classification: 'REENTRY_READY_REVISION_UNPROVEN',
    reentered: false,
    missionId: text(candidate.missionId),
  });

  const timestamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const digest = createHash('sha256')
    .update(`${text(candidate.missionId)}:${candidate.revision}:${timestamp}`)
    .digest('hex')
    .slice(0, 20);
  const receiptId = `critical-reentry-${digest}`;
  const result = await appendEvent(candidate.missionId, {
    eventId: `reentry-${digest}`,
    eventType: 'MISSION_REENTERED',
    expectedRevision: candidate.revision,
    expectedCurrentPhase: 'BLOCKED',
    capacityAvailable: true,
    timestamp,
    receipt: {
      receiptId,
      requirement: 'canonical scheduler mission re-entry',
      source: 'critical-backlog-conveyor',
      evidenceType: 'scheduler-admission',
      verified: true,
      createdAt: timestamp,
      exitCode: 0,
    },
    summary: `Canonical critical backlog slot re-admitted ${text(candidate.missionId)} after repair proof.`,
  }, {
    root: paths.orchestratorRoot,
    snapshotRoot: paths.snapshotRoot,
    env,
    now,
  });
  if (result?.preconditionFailed === true) return Object.freeze({
    ok: true,
    classification: 'REENTRY_PRECONDITION_MOVED',
    reentered: false,
    missionId: text(candidate.missionId),
  });
  const state = result?.state;
  const reentered = continuityStatus(state) === ACTIVE_CONTINUITY && text(state?.currentPhase).toUpperCase() !== 'BLOCKED';
  return Object.freeze({
    ok: reentered,
    classification: reentered ? 'REENTRY_ADMITTED' : 'REENTRY_ADMISSION_BLOCKED',
    reentered,
    missionId: text(candidate.missionId),
    revision: Number(state?.revision),
    currentPhase: text(state?.currentPhase).toUpperCase(),
    receiptId,
  });
}

function parkedProjection(projection = {}) {
  return Object.freeze({
    parkedItemIds: Object.freeze(Array.isArray(projection.parkedItemIds) ? [...projection.parkedItemIds] : []),
    parkedMissionIds: Object.freeze(Array.isArray(projection.parkedMissionIds) ? [...projection.parkedMissionIds] : []),
    parkedApprovalMissionIds: Object.freeze(Array.isArray(projection.parkedApprovalMissionIds) ? [...projection.parkedApprovalMissionIds] : []),
    parkedBlockedMissionIds: Object.freeze(Array.isArray(projection.parkedBlockedMissionIds) ? [...projection.parkedBlockedMissionIds] : []),
    parkedApprovalCount: Number.isSafeInteger(projection.parkedApprovalCount)
      ? projection.parkedApprovalCount
      : Array.isArray(projection.parkedApprovalMissionIds)
        ? projection.parkedApprovalMissionIds.length
        : 0,
    parkedBlockedCount: Number.isSafeInteger(projection.parkedBlockedCount)
      ? projection.parkedBlockedCount
      : Array.isArray(projection.parkedBlockedMissionIds)
        ? projection.parkedBlockedMissionIds.length
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
        summary: `Critical backlog ${text(projection.decision)} parked mission set changed.`,
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

function missionById(admission = {}, missionId = '') {
  const wanted = text(missionId).toLowerCase();
  const inventory = [
    admission.selectedMission,
    ...(Array.isArray(admission.elasticMissions) ? admission.elasticMissions : []),
    ...(Array.isArray(admission.activeMissions) ? admission.activeMissions : []),
    ...(Array.isArray(admission.runnableMissions) ? admission.runnableMissions : []),
  ];
  return inventory.find((mission) => text(mission?.missionId).toLowerCase() === wanted) ?? null;
}

function admissionAfterPrHeadDispatch(admission = {}, prHeadLease = {}) {
  const handled = new Set(Array.isArray(prHeadLease.handledMissionIds) ? prHeadLease.handledMissionIds : []);
  const newlyOccupied = new Set(Array.isArray(prHeadLease.newlyOccupiedMissionIds) ? prHeadLease.newlyOccupiedMissionIds : []);
  const dispatchedByMission = new Map(
    (Array.isArray(prHeadLease.dispatched) ? prHeadLease.dispatched : [])
      .map((item) => [text(item?.missionId).toLowerCase(), item]),
  );
  const activeById = new Map(
    (Array.isArray(admission.activeMissions) ? admission.activeMissions : [])
      .map((mission) => [text(mission?.missionId).toLowerCase(), mission])
      .filter(([missionId]) => missionId),
  );
  for (const missionId of newlyOccupied) {
    const mission = activeById.get(missionId) ?? missionById(admission, missionId);
    if (!mission) continue;
    const dispatched = dispatchedByMission.get(missionId) ?? {};
    activeById.set(missionId, Object.freeze({
      ...mission,
      dispatch: Object.freeze({
        ...(mission.dispatch ?? {}),
        status: 'running',
        adapter: text(dispatched.adapter),
        workerId: text(dispatched.workerId),
        capacityReceiptId: text(dispatched.capacityReceiptId),
      }),
    }));
  }
  const selectedMissionId = text(admission?.selectedMission?.missionId).toLowerCase();
  const selectedRunning = text(activeById.get(selectedMissionId)?.dispatch?.status).toLowerCase() === 'running';
  return Object.freeze({
    ...admission,
    selectedMission: handled.has(selectedMissionId) && !selectedRunning
      ? null
      : admission.selectedMission,
    activeMissions: Object.freeze([...activeById.values()]),
    runnableMissions: Object.freeze(
      (Array.isArray(admission.runnableMissions) ? admission.runnableMissions : [])
        .filter((mission) => !handled.has(text(mission?.missionId).toLowerCase())),
    ),
  });
}

function capacityReceiptKey(value = {}) {
  const adapter = text(value?.adapter).toLowerCase();
  const receiptId = text(value?.receiptId ?? value?.selectedCapacityReceiptId ?? value?.capacityReceiptId);
  return adapter && receiptId ? `${adapter}:${receiptId}` : '';
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
  const capacityRouting = normalized.capacityRouting ?? (sourceRevision
    ? await (normalized.readCapacityRouting ?? readElasticMissionControllerCapacityRoutingInput)({
        root: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        nowUtc: now.toISOString(),
        sourceRevision,
        env,
      })
    : null);
  const dispatchPrHeadBuilds = normalized.dispatchPrHeadBuilds ?? dispatchElasticPrHeadBuildsFromCanonicalLease;
  const prHeadLease = await dispatchPrHeadBuilds(admission, {
    ...normalized,
    env,
    now,
    paths,
    sourceRevision,
    capacityRouting,
  });
  const adjustedAdmission = admissionAfterPrHeadDispatch(admission, prHeadLease);
  const consumedCapacity = new Set(
    (Array.isArray(prHeadLease?.dispatched) ? prHeadLease.dispatched : [])
      .map(capacityReceiptKey)
      .filter(Boolean),
  );
  const baseResolver = normalized.resolveCapacityCandidates ?? resolveElasticExternalCapacityCandidates;
  const resolveCapacityCandidates = (...args) => baseResolver(...args)
    .filter((candidate) => !consumedCapacity.has(capacityReceiptKey(candidate)));
  const prePr = await dispatchElasticGoalBuildsCore(adjustedAdmission, {
    ...normalized,
    env,
    now,
    paths,
    sourceRevision,
    capacityRouting,
    resolveCapacityCandidates,
  });
  const dispatched = Object.freeze([
    ...(Array.isArray(prHeadLease?.dispatched) ? prHeadLease.dispatched : []),
    ...(Array.isArray(prePr?.dispatched) ? prePr.dispatched : []),
  ]);
  const held = Object.freeze([
    ...(Array.isArray(prHeadLease?.held) ? prHeadLease.held : []),
    ...(Array.isArray(prePr?.held) ? prePr.held : []),
  ]);
  const combinedOk = prHeadLease?.ok !== false && prePr?.ok === true;
  return Object.freeze({
    ...prePr,
    ok: combinedOk,
    classification: !combinedOk
      ? 'ELASTIC_GOAL_BUILD_DISPATCH_PARTIAL_BLOCKED'
      : dispatched.length
        ? 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE'
        : held.length
          ? 'ELASTIC_GOAL_BUILD_DISPATCH_HELD'
          : prePr?.classification,
    dispatchCount: dispatched.length,
    dispatched,
    held,
    prHeadLease,
    blockedLaneDoesNotStallFleet: held.length === 0 || dispatched.length > 0,
    resourceDisjointOneWriterProven: prePr?.resourceDisjointOneWriterProven !== false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
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
  const env = normalized.env || process.env;
  const now = normalized.now instanceof Date ? normalized.now : new Date();
  const paths = normalized.paths || resolveCriticalBacklogRuntimePaths({ env });
  const backlog = normalized.backlog ?? SELF_HOSTING_CRITICAL_BACKLOG;
  const reentry = await readmitReentryReadyCriticalMission({
    backlog,
    env,
    now,
    paths,
    listMissions: normalized.listMissions ?? listMissionRecords,
    appendEvent: normalized.appendMissionEvent ?? appendMissionEvent,
  });
  if (reentry?.ok === false) {
    return Object.freeze({
      schemaVersion: CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
      ok: false,
      classification: reentry.classification,
      reentry,
      arbitraryShellAllowed: false,
      destructiveGitAllowed: false,
      duplicateActiveMissionAllowed: false,
      mergeAuthority: false,
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
    });
  }
  const result = await ensureCriticalBacklogMissionCore({
    ...normalized,
    env,
    now,
    paths,
    backlog,
    publishProjection: normalized.publishProjection ?? publishCriticalBacklogProjection,
    readCapacityRouting: normalized.readCapacityRouting ?? readElasticMissionControllerCapacityRoutingInput,
    dispatchElasticBuilds: normalized.dispatchElasticBuilds ?? dispatchElasticGoalBuildsFromCanonicalMain,
  });
  if (result?.ok !== true) return Object.freeze({ ...result, reentry });
  const dispatchActiveCriticalMission = normalized.dispatchActiveCriticalMission ?? dispatchActiveCriticalMissionFromCanonicalMain;
  const activeMissionIgnition = await dispatchActiveCriticalMission(result, normalized);
  if (activeMissionIgnition?.ok === false) {
    return Object.freeze({
      ...result,
      ok: false,
      reentry,
      activeMissionIgnition,
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
    });
  }
  return Object.freeze({ ...result, reentry, activeMissionIgnition });
}
