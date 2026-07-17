import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CRITICAL_BACKLOG_DECISION,
  DEFAULT_CRITICAL_BACKLOG,
  buildCriticalBacklogMissionInput,
  buildCriticalBacklogProjection,
} from '../../shared/agents/criticalBacklogConveyor.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  createMissionRecord,
  listMissionRecords,
} from './missionOrchestratorStore.js';

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
    oneActiveMissionEnforced: true,
    duplicateCodexDispatchAllowed: false,
    mergeAuthority: false,
    exactHeadApprovalRequired: true,
  });
  const statusWrite = await writeAtomicJson(
    paths.workspaceRoot,
    ['status', 'critical-backlog-conveyor-current.json'],
    statusRecord,
    { repoRoot: paths.repoRoot },
  );
  if (!statusWrite.ok) return Object.freeze({ ok: false, reason: statusWrite.reason, statusWrite, eventWrite: null });

  let eventWrite = null;
  if (changed) {
    const eventRecord = Object.freeze({
      ...createSharedWorkspaceEventRecord({
        eventId: eventId(`${timestampUtc}:${projectionSignature(projection)}`),
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
    eventWrite = await appendWorkspaceJsonl(
      paths.workspaceRoot,
      ['events', 'critical-backlog-conveyor.jsonl'],
      eventRecord,
      { repoRoot: paths.repoRoot },
    );
    if (!eventWrite.ok) return Object.freeze({ ok: false, reason: eventWrite.reason, statusWrite, eventWrite });
  }
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
} = {}) {
  let missionRecords = await listMissions({ root: paths.orchestratorRoot, snapshotRoot: paths.snapshotRoot, env });
  let projection = buildCriticalBacklogProjection({ backlog, missionRecords });
  let createdMission = false;
  let duplicateCreateObserved = false;
  let missionRecord = null;

  if (projection.decision === CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION) {
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
    publication,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    duplicateActiveMissionAllowed: false,
    mergeAuthority: false,
    finalVerdict: ok ? 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS' : 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
  });
}
