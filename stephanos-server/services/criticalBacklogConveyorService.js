import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CRITICAL_BACKLOG_DECISION,
  DEFAULT_CRITICAL_BACKLOG,
  buildCriticalBacklogMissionInput,
  buildCriticalBacklogProjection,
  validateCriticalBacklog,
} from '../../shared/agents/criticalBacklogConveyor.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceGoalRecord,
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  createMissionRecord,
  listMissionRecords,
} from './missionOrchestratorStore.js';

export const CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA = 'stephanos.critical-backlog-conveyor-service.v1';
export const CRITICAL_BACKLOG_CURRENT_GOAL_FILE = 'critical-backlog-current.json';

const CRITICAL_BACKLOG_GOAL_AUTHORITY = 'source-controlled-critical-backlog';

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

async function readPreviousCriticalGoal(paths) {
  const resolved = resolveSharedWorkspacePath({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    segments: ['goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE],
  });
  if (!resolved.ok) return null;
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    const validation = validateSharedWorkspaceRecord(record);
    return validation.valid
      && record?.schemaVersion === SHARED_WORKSPACE_RECORD_SCHEMA_VERSION
      && record?.kind === SHARED_WORKSPACE_RECORD_KINDS.GOAL
      && record?.sourceAuthority === CRITICAL_BACKLOG_GOAL_AUTHORITY
      && record?.participantId === 'critical-backlog-conveyor'
      ? record
      : null;
  } catch {
    return null;
  }
}

function selectedCriticalGoalRecord(projection, timestampUtc) {
  const selectedItem = projection?.selectedItem;
  const selectedDecision = projection?.decision === CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION
    || projection?.decision === CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION;
  if (!selectedItem || !selectedDecision) return Object.freeze({ ok: true, record: null });
  const validation = validateCriticalBacklog([selectedItem]);
  const issueNumber = Number(selectedItem.issueNumbers?.[0]);
  if (!validation.valid || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return Object.freeze({
      ok: false,
      reason: 'SELECTED_CRITICAL_BACKLOG_GOAL_INVALID',
      blockers: validation.errors,
      record: null,
    });
  }
  const mission = selectedItem.mission;
  const activePhase = text(projection?.activeMission?.currentPhase).toUpperCase();
  const held = activePhase === 'BLOCKED' || activePhase === 'AWAITING_OPERATOR_APPROVAL';
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      ...createSharedWorkspaceGoalRecord({
        goalId: `goal-${issueNumber}`,
        participantId: 'critical-backlog-conveyor',
        timestampUtc,
        title: mission.title,
        status: held ? 'WAITING_FOR_EXTERNAL_CONDITION' : 'READY',
      }),
      sourceAuthority: CRITICAL_BACKLOG_GOAL_AUTHORITY,
      sourceItemId: selectedItem.itemId,
      missionId: mission.missionId,
      headlineApprovalRef: selectedItem.headlineApprovalRef,
      issueNumber,
      relatedIssue: `#${issueNumber}`,
      repository: mission.repository,
      branch: mission.branch,
      state: 'READY',
      prerequisites: [],
      priority: selectedItem.priority,
      criticalPathWeight: selectedItem.priority,
      reversibility: 'HIGH',
      route: held ? 'WAITING_FOR_EXTERNAL_CONDITION' : 'CHATGPT_GITHUB',
      approvalRequired: false,
      operatorPriority: false,
      evidenceAt: timestampUtc,
      resultProofRefs: [],
      repairCycleCount: 0,
      chatMemoryAuthoritative: false,
      oneActiveMissionEnforced: true,
      duplicateCodexDispatchAllowed: false,
      mergeAuthority: false,
      exactHeadApprovalRequired: true,
      holdDecision: held ? projection.decision : '',
      holdReason: held ? text(projection.exactNextAction) : '',
    }),
  });
}

function heldCriticalGoalRecord(previousGoal, projection, timestampUtc) {
  if (!previousGoal) return null;
  const complete = projection?.decision === CRITICAL_BACKLOG_DECISION.BACKLOG_COMPLETE;
  return Object.freeze({
    ...previousGoal,
    timestampUtc,
    status: complete ? 'CLOSED' : 'WAITING_FOR_EXTERNAL_CONDITION',
    state: complete ? 'CLOSED' : 'READY',
    route: 'WAITING_FOR_EXTERNAL_CONDITION',
    evidenceAt: timestampUtc,
    holdDecision: text(projection?.decision, 'UNKNOWN'),
    holdReason: text(projection?.exactNextAction, 'Critical backlog work is not currently admissible.'),
    approvalRequired: false,
    operatorPriority: false,
    chatMemoryAuthoritative: false,
    mergeAuthority: false,
  });
}

function runnableCriticalGoal(record) {
  return record?.state === 'READY' && record?.route === 'CHATGPT_GITHUB';
}

export async function publishCriticalBacklogProjection(projection, {
  paths,
  now = new Date(),
  writeJson = writeAtomicJson,
} = {}) {
  const timestampUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const selectedGoal = selectedCriticalGoalRecord(projection, timestampUtc);
  if (!selectedGoal.ok) {
    return Object.freeze({
      ok: false,
      reason: selectedGoal.reason,
      blockers: selectedGoal.blockers,
      goalWrite: null,
      statusWrite: null,
      eventWrite: null,
    });
  }
  const previousGoal = await readPreviousCriticalGoal(paths);
  const goalRecord = selectedGoal.record || heldCriticalGoalRecord(previousGoal, projection, timestampUtc);
  const identityChanges = previousGoal && goalRecord && previousGoal.goalId !== goalRecord.goalId;
  const authorityMustBeNeutralized = runnableCriticalGoal(previousGoal)
    && (!runnableCriticalGoal(goalRecord) || identityChanges);
  let goalPreflightWrite = null;
  if (authorityMustBeNeutralized) {
    const neutralizedGoal = heldCriticalGoalRecord(previousGoal, projection, timestampUtc);
    goalPreflightWrite = await writeJson(
      paths.workspaceRoot,
      ['goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE],
      neutralizedGoal,
      { repoRoot: paths.repoRoot },
    );
    if (!goalPreflightWrite.ok) {
      return Object.freeze({
        ok: false,
        reason: goalPreflightWrite.reason,
        goalPreflightWrite,
        goalWrite: null,
        statusWrite: null,
        eventWrite: null,
      });
    }
  }
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
    eventWrite = await writeJson(
      paths.workspaceRoot,
      ['events', 'critical-backlog-conveyor', `${transitionEventId}.json`],
      eventRecord,
      { repoRoot: paths.repoRoot },
    );
    if (!eventWrite.ok) return Object.freeze({
      ok: false,
      reason: eventWrite.reason,
      goalPreflightWrite,
      goalWrite: null,
      statusWrite: null,
      eventWrite,
    });
  }

  const statusWrite = await writeJson(
    paths.workspaceRoot,
    ['status', 'critical-backlog-conveyor-current.json'],
    statusRecord,
    { repoRoot: paths.repoRoot },
  );
  if (!statusWrite.ok) return Object.freeze({
    ok: false,
    reason: statusWrite.reason,
    goalPreflightWrite,
    goalWrite: null,
    statusWrite,
    eventWrite,
  });

  let goalWrite = authorityMustBeNeutralized && !runnableCriticalGoal(goalRecord) ? goalPreflightWrite : null;
  if (goalRecord && !goalWrite) {
    goalWrite = await writeJson(
      paths.workspaceRoot,
      ['goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE],
      goalRecord,
      { repoRoot: paths.repoRoot },
    );
    if (!goalWrite.ok) {
      return Object.freeze({
        ok: false,
        reason: goalWrite.reason,
        goalPreflightWrite,
        goalWrite,
        statusWrite,
        eventWrite,
      });
    }
  }

  return Object.freeze({
    ok: true,
    reason: changed ? 'CONVEYOR_GOAL_STATUS_AND_EVENT_PUBLISHED' : 'CONVEYOR_GOAL_AND_STATUS_REFRESHED',
    changed,
    goalPreflightWrite,
    goalWrite,
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
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    duplicateActiveMissionAllowed: false,
    mergeAuthority: false,
    finalVerdict: ok ? 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS' : 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
  });
}
