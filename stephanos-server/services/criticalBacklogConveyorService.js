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
import { readAuthoritativeProgrammeProjection } from './programmeAuthorityService.js';
import { ensureElasticGoalMissions } from './elasticGoalMissionAdmissionService.js';

export const CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA = 'stephanos.critical-backlog-conveyor-service.v1';

const BLOCKED_DECISIONS = new Set([
  CRITICAL_BACKLOG_DECISION.BLOCKED_BY_INVALID_BACKLOG,
  CRITICAL_BACKLOG_DECISION.BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS,
  CRITICAL_BACKLOG_DECISION.BLOCKED_BY_TERMINAL_MISSION,
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function eventId(value) {
  return `critical-backlog-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function elasticIssueNumber(mission = {}) {
  const match = /^critical-([1-9]\d*)-elastic-goal(?:$|[-_.])/.exec(text(mission.missionId).toLowerCase());
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
} = {}) {
  const nowUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  let elasticAdmission = null;
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
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    duplicateActiveMissionAllowed: false,
    mergeAuthority: false,
    finalVerdict: ok ? 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS' : 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
  });
}
