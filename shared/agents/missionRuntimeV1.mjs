import { createDirectorStatusPacket, GOAL_STATE } from './missionFlywheelDirectorV1.mjs';
import { createMissionExecutiveSnapshot, EXECUTIVE_PHASE } from './missionExecutiveV1.mjs';
import { createMissionRoom, createRoomMessage, createWorkspaceObject, PARTICIPANT_ROLE, WORKSPACE_OBJECT_KIND } from './sharedWorkspaceMissionRoomV2.mjs';
import { createProjectIntelligenceAnswer } from './projectIntelligenceV1.mjs';

export const MISSION_RUNTIME_SCHEMA_VERSION = 'mission-runtime.v1';

export const RUNTIME_PHASE = Object.freeze({
  PLANNED: 'PLANNED',
  BUILDING: 'BUILDING',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  DONE: 'DONE',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function hasBuildEvidence(input = {}) {
  return Boolean(text(input.branch) || text(input.prNumber) || text(input.headSha) || text(input.proofCommand) || input.sourceSliceReady === true || input.workerAssigned === true);
}

function doneEvidence(input = {}) {
  return input.sourceMerged === true && input.focusedProofRecorded === true && input.missionStateUpdated === true;
}

export function buildMissionRuntimeContract() {
  return {
    schemaVersion: MISSION_RUNTIME_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_runtime.contract',
    composedContracts: [
      'missionExecutiveV1',
      'missionFlywheelDirectorV1',
      'sharedWorkspaceMissionRoomV2',
      'projectIntelligenceV1',
      'chatToPublishBridgeV1',
      'platformRuntimeState',
    ],
    commandDeckFields: ['currentGoal', 'currentIdea', 'currentWorker', 'currentPhase', 'currentPr', 'currentProof', 'currentBlocker', 'currentNextAction', 'lastActivity'],
    finalVerdict: 'MISSION_RUNTIME_CONTRACT_READY',
  };
}

export function deriveRuntimePhase(input = {}) {
  if (doneEvidence(input)) return RUNTIME_PHASE.DONE;
  if (text(input.blocker)) return RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (text(input.prNumber) && input.focusedProofRecorded === true && input.sourceMerged !== true) return RUNTIME_PHASE.WAITING_FOR_OPERATOR_APPROVAL;
  if (text(input.prNumber) && input.focusedProofRecorded !== true) return RUNTIME_PHASE.WAITING_FOR_PROOF;
  if (input.requestedPhase === RUNTIME_PHASE.BUILDING && !hasBuildEvidence(input)) return RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (hasBuildEvidence(input)) return RUNTIME_PHASE.BUILDING;
  return RUNTIME_PHASE.PLANNED;
}

export function createMissionRuntimeSnapshot(input = {}) {
  const currentGoal = text(input.currentGoal, input.goalId || '#unknown');
  const currentIdea = text(input.currentIdea, input.idea || 'No active idea captured.');
  const runtimeInput = { ...input, currentGoal, currentIdea };
  const currentPhase = deriveRuntimePhase(runtimeInput);
  const exactBlocker = currentPhase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    ? text(input.blocker, 'Add build evidence or exact unblock action before reporting BUILDING.')
    : '';
  const executive = input.executive || createMissionExecutiveSnapshot({
    idea: currentIdea,
    sourceFiles: hasBuildEvidence(runtimeInput) ? [{ path: text(input.evidencePath, 'shared/agents/missionRuntimeV1.mjs'), content: 'runtime source evidence' }] : [],
    phase: currentPhase === RUNTIME_PHASE.BUILDING ? EXECUTIVE_PHASE.SOURCE_SLICE_READY : undefined,
  });
  const director = input.director || createDirectorStatusPacket({
    goals: [
      {
        goalId: currentGoal,
        title: text(input.goalTitle, currentGoal),
        activeBranch: text(input.branch),
        prNumber: text(input.prNumber),
        proofCommand: text(input.proofCommand),
        sourceMerged: input.sourceMerged === true,
        focusedProofRecorded: input.focusedProofRecorded === true,
        missionStateUpdated: input.missionStateUpdated === true,
        blocker: exactBlocker,
      },
    ],
  });
  const intelligence = input.projectIntelligence || createProjectIntelligenceAnswer({
    question: currentIdea,
    items: [
      { id: currentGoal, kind: 'GOAL', title: text(input.goalTitle, currentGoal), summary: currentIdea, proven: doneEvidence(runtimeInput) },
    ],
    nextActions: [text(input.nextAction, exactBlocker || 'Continue the mission runtime source slice.')],
  });
  const room = input.missionRoom || createMissionRoom({
    roomId: text(input.roomId, 'mission-runtime-room'),
    participants: [{ role: PARTICIPANT_ROLE.OPERATOR }, { role: PARTICIPANT_ROLE.STEPHANOS }],
    objects: [createWorkspaceObject({ objectId: currentGoal, kind: WORKSPACE_OBJECT_KIND.GOAL, title: currentGoal, summary: currentIdea, proven: doneEvidence(runtimeInput) })],
    threads: [],
    messages: [createRoomMessage({ messageId: 'runtime-status', role: PARTICIPANT_ROLE.STEPHANOS, body: `Mission runtime phase: ${currentPhase}`, proven: true })],
    memoryHooks: ['projectIntelligenceV1'],
  });

  return {
    schemaVersion: MISSION_RUNTIME_SCHEMA_VERSION,
    kind: 'stephanos.mission_runtime.snapshot',
    currentGoal,
    currentIdea,
    currentWorker: text(input.currentWorker, executive.currentWorker || 'STEPHANOS'),
    currentPhase,
    currentPr: text(input.prNumber),
    currentProof: text(input.proofCommand),
    currentBlocker: exactBlocker,
    currentNextAction: text(input.nextAction, exactBlocker || executive.nextDeterministicAction || 'Determine next mission action.'),
    lastActivity: text(input.lastActivity, 'mission-runtime-snapshot-created'),
    evidence: {
      branch: text(input.branch),
      prNumber: text(input.prNumber),
      headSha: text(input.headSha),
      proofCommand: text(input.proofCommand),
      sourceMerged: input.sourceMerged === true,
      focusedProofRecorded: input.focusedProofRecorded === true,
      missionStateUpdated: input.missionStateUpdated === true,
    },
    executive,
    director,
    projectIntelligence: intelligence,
    missionRoom: room,
    commandDeck: {
      currentGoal,
      currentIdea,
      currentWorker: text(input.currentWorker, executive.currentWorker || 'STEPHANOS'),
      currentPhase,
      currentPr: text(input.prNumber),
      currentProof: text(input.proofCommand),
      currentBlocker: exactBlocker,
      currentNextAction: text(input.nextAction, exactBlocker || executive.nextDeterministicAction || 'Determine next mission action.'),
      lastActivity: text(input.lastActivity, 'mission-runtime-snapshot-created'),
    },
    finalVerdict: currentPhase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'MISSION_RUNTIME_BLOCKED' : 'MISSION_RUNTIME_READY',
  };
}

export function validateMissionRuntimeSnapshot(snapshot = {}) {
  const errors = [];
  if (snapshot.schemaVersion !== MISSION_RUNTIME_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (snapshot.kind !== 'stephanos.mission_runtime.snapshot') errors.push('invalid-kind');
  if (!text(snapshot.currentGoal)) errors.push('missing-current-goal');
  if (!text(snapshot.currentIdea)) errors.push('missing-current-idea');
  if (!Object.values(RUNTIME_PHASE).includes(snapshot.currentPhase)) errors.push('invalid-current-phase');
  if (!snapshot.commandDeck) errors.push('missing-command-deck');
  if (snapshot.currentPhase === RUNTIME_PHASE.BUILDING) {
    const evidence = snapshot.evidence || {};
    if (!hasBuildEvidence(evidence)) errors.push('building-without-evidence');
  }
  if (snapshot.currentPhase === RUNTIME_PHASE.DONE) {
    const evidence = snapshot.evidence || {};
    if (!doneEvidence(evidence)) errors.push('done-without-required-evidence');
  }
  if (snapshot.currentPhase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !text(snapshot.currentBlocker)) errors.push('blocked-without-exact-unblock-action');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_RUNTIME_SNAPSHOT_PASS' : 'MISSION_RUNTIME_SNAPSHOT_BLOCKED',
  };
}
