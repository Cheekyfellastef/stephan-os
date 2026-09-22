import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
  projectMissionWorkerHeartbeat,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { validateSourceMutationLease } from '../../shared/agents/programmeAuthorityV1.mjs';
import {
  parkSafelyBlockedCriticalMission,
  resolveCriticalBacklogRuntimePaths,
} from './criticalBacklogConveyorService.js';
import { appendMissionEvent, listMissionRecords } from './missionOrchestratorStore.js';

export const STALLED_LEGACY_MISSION_SIDING_SCHEMA = 'stephanos.stalled-legacy-mission-siding.v1';
export const DEFAULT_STALLED_LEGACY_MISSION_AFTER_MS = 15 * 60_000;

const SHA_40 = /^[0-9a-f]{40}$/i;
const SOURCE_PHASES = new Set(['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']);
const SAFE_NON_RUNNING_DISPATCH = new Set(['', 'pending', 'failed', 'complete', 'stopped', 'idle']);
const ELASTIC_MISSION_ID = /^critical-[1-9]\d*-elastic-goal(?:$|[-_.])/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function idleHeartbeatHasNoClaim(record = {}) {
  return text(record.lastTickVerdict) === 'MISSION_WORKER_TICK_PASS'
    && !text(record.activeTaskId)
    && !text(record.activeReceiptId)
    && !text(record.executionPhase);
}

function candidateMission(records = [], nowMs, stallAfterMs) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => !ELASTIC_MISSION_ID.test(text(record?.missionId)))
    .filter((record) => text(record?.continuity?.parkingStatus, 'ACTIVE').toUpperCase() === 'ACTIVE')
    .filter((record) => SOURCE_PHASES.has(text(record?.currentPhase).toUpperCase()))
    .filter((record) => SAFE_NON_RUNNING_DISPATCH.has(text(record?.dispatch?.status).toLowerCase()))
    .map((record) => {
      const movementMs = timestampMs(record?.updatedAt || record?.lastProgressAtUtc || record?.createdAt);
      return { record, movementMs, ageMs: movementMs === null ? null : Math.max(0, nowMs - movementMs) };
    })
    .filter(({ ageMs }) => ageMs !== null && ageMs >= stallAfterMs)
    .sort((left, right) => right.ageMs - left.ageMs)[0] || null;
}

function blocked(classification, additions = {}) {
  return Object.freeze({
    schemaVersion: STALLED_LEGACY_MISSION_SIDING_SCHEMA,
    ok: true,
    classification,
    transitioned: false,
    parked: false,
    missionId: '',
    sourceMutationAllowed: false,
    leaseSeizureAllowed: false,
    mergeAuthority: false,
    ...additions,
  });
}

export async function reconcileStalledLegacyMissionToSiding(options = {}) {
  const env = options.env || process.env;
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const sourceHead = text(options.sourceHead).toLowerCase();
  const repoRoot = path.resolve(text(options.repoRoot));
  const workspaceRoot = path.resolve(text(options.workspaceRoot));
  const stallAfterMs = Number.isFinite(options.stallAfterMs) && options.stallAfterMs >= 60_000
    ? options.stallAfterMs
    : DEFAULT_STALLED_LEGACY_MISSION_AFTER_MS;
  if (!SHA_40.test(sourceHead) || !text(options.repoRoot) || !text(options.workspaceRoot)) {
    return Object.freeze({
      ...blocked('SIDING_SOURCE_IDENTITY_UNPROVEN'),
      ok: false,
      blocker: 'SIDING_SOURCE_IDENTITY_UNPROVEN',
    });
  }

  const runtimePaths = options.runtimePaths || resolveCriticalBacklogRuntimePaths({ env });
  const listMissions = options.listMissions || listMissionRecords;
  const appendEvent = options.appendEvent || appendMissionEvent;
  const parkBlocked = options.parkBlocked || parkSafelyBlockedCriticalMission;
  const readJsonImpl = options.readJson || readJson;
  const heartbeatProjector = options.projectHeartbeat || projectMissionWorkerHeartbeat;
  const leaseValidator = options.validateLease || validateSourceMutationLease;

  const records = await listMissions({
    root: runtimePaths.orchestratorRoot,
    snapshotRoot: runtimePaths.snapshotRoot,
    env,
  });
  const candidate = candidateMission(records, nowMs, stallAfterMs);
  if (!candidate) return blocked('NO_STALLED_LEGACY_SOURCE_MISSION');

  const mission = candidate.record;
  if (!Number.isSafeInteger(mission.revision) || mission.revision < 0) {
    return Object.freeze({
      ...blocked('STALLED_MISSION_REVISION_UNPROVEN', { missionId: text(mission.missionId) }),
      ok: false,
      blocker: 'STALLED_MISSION_REVISION_UNPROVEN',
    });
  }

  const heartbeatPath = path.join(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json');
  const leasePath = path.join(workspaceRoot, 'status', 'source-mutation-lease-current.json');
  const heartbeat = await readJsonImpl(heartbeatPath);
  if (!heartbeat) return blocked('WORKER_HEARTBEAT_UNAVAILABLE', { missionId: text(mission.missionId) });
  const heartbeatProjection = heartbeatProjector(heartbeat, {
    nowUtc: now.toISOString(),
    maxAgeMs: DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
    expectedRepositoryRoot: repoRoot,
    expectedHeadSha: sourceHead,
  });
  if (heartbeatProjection?.valid !== true || heartbeatProjection?.fresh !== true) {
    return blocked('WORKER_HEARTBEAT_NOT_FRESH_EXACT_HEAD', {
      missionId: text(mission.missionId),
      heartbeatErrors: Object.freeze([...(heartbeatProjection?.errors || [])]),
    });
  }
  if (!idleHeartbeatHasNoClaim(heartbeat)) {
    return blocked('WORKER_NOT_PROVEN_IDLE', {
      missionId: text(mission.missionId),
      lastTickVerdict: text(heartbeat.lastTickVerdict),
    });
  }

  const lease = await readJsonImpl(leasePath);
  if (lease) {
    const leaseProjection = leaseValidator(lease, { nowUtc: now.toISOString() });
    if (leaseProjection?.valid !== true) {
      return blocked('SOURCE_MUTATION_LEASE_UNVERIFIABLE', {
        missionId: text(mission.missionId),
        leaseErrors: Object.freeze([...(leaseProjection?.errors || [])]),
      });
    }
    if (leaseProjection.active === true) {
      return blocked('SOURCE_MUTATION_LEASE_ACTIVE', {
        missionId: text(mission.missionId),
        leaseId: text(lease.leaseId),
      });
    }
  }

  const reason = `stale active mission contradicted by fresh exact-head idle worker for ${candidate.ageMs}ms`;
  const blockedResult = await appendEvent(mission.missionId, {
    eventId: `stalled-idle-block-${text(mission.missionId)}-${mission.revision}`.slice(0, 128),
    eventType: 'MISSION_BLOCKED',
    expectedRevision: mission.revision,
    expectedCurrentPhase: text(mission.currentPhase).toUpperCase(),
    timestamp: now.toISOString(),
    reason,
    summary: 'Authoritatively block a stale legacy mission after exact-head worker-idle contradiction proof.',
  }, {
    root: runtimePaths.orchestratorRoot,
    snapshotRoot: runtimePaths.snapshotRoot,
    env,
    now,
  });
  if (blockedResult?.preconditionFailed === true) {
    return blocked('STALLED_MISSION_PRECONDITION_MOVED', { missionId: text(mission.missionId) });
  }
  if (text(blockedResult?.state?.currentPhase).toUpperCase() !== 'BLOCKED') {
    return Object.freeze({
      ...blocked('MISSION_BLOCK_TRANSITION_FAILED', { missionId: text(mission.missionId) }),
      ok: false,
      blocker: 'MISSION_BLOCK_TRANSITION_FAILED',
    });
  }

  const parking = await parkBlocked({
    env,
    now,
    paths: runtimePaths,
    listMissions,
    appendEvent,
  });
  const parked = parking?.parked === true;
  return Object.freeze({
    schemaVersion: STALLED_LEGACY_MISSION_SIDING_SCHEMA,
    ok: parking?.ok !== false && parked,
    classification: parked
      ? 'STALLED_LEGACY_MISSION_PARKED_FOR_REPAIR'
      : text(parking?.classification, 'STALLED_LEGACY_MISSION_BLOCKED_PENDING_PARK'),
    transitioned: true,
    parked,
    missionId: text(mission.missionId),
    priorPhase: text(mission.currentPhase).toUpperCase(),
    staleAgeMs: candidate.ageMs,
    heartbeatAtUtc: heartbeatProjection.timestampUtc || '',
    sourceHead,
    parking,
    sourceMutationAllowed: false,
    leaseSeizureAllowed: false,
    mergeAuthority: false,
  });
}
