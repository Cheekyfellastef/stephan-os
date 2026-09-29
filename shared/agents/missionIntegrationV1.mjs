import { createAlwaysOnUpdateStatus } from './alwaysOnStephanosUpdateV1.mjs';
import { createChatToPublishPacket } from './chatToPublishBridgeV1.mjs';
import { classifyReturnConveyor } from './returnConveyorV1.mjs';
import { createMissionExecutiveSnapshot } from './missionExecutiveV1.mjs';
import { createMissionRuntimeSnapshot, RUNTIME_PHASE } from './missionRuntimeV1.mjs';
import { createDirectorStatusPacket } from './missionFlywheelDirectorV1.mjs';
import { createMissionRoom, createRoomMessage, createWorkspaceObject, PARTICIPANT_ROLE, WORKSPACE_OBJECT_KIND } from './sharedWorkspaceMissionRoomV2.mjs';
import { createProjectIntelligenceAnswer } from './projectIntelligenceV1.mjs';

export const MISSION_INTEGRATION_SCHEMA_VERSION = 'mission-integration.v1';

export const INTEGRATION_STATE = Object.freeze({
  IDEA_CAPTURED: 'IDEA_CAPTURED',
  SOURCE_READY: 'SOURCE_READY',
  WAITING_FOR_RETURN: 'WAITING_FOR_RETURN',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  READY_TO_UPDATE: 'READY_TO_UPDATE',
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

function hasSourceEvidence(input = {}) {
  return Boolean(text(input.branch) || text(input.prNumber) || text(input.headSha) || list(input.sourceFiles).length);
}

function returnDone(returnState = {}) {
  return returnState.state === 'DONE' || returnState.done === true;
}

function runtimeDone(runtime = {}) {
  return runtime.currentPhase === RUNTIME_PHASE.DONE;
}

export function buildMissionIntegrationContract() {
  return {
    schemaVersion: MISSION_INTEGRATION_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_integration.contract',
    integratedModules: [
      'missionExecutiveV1',
      'missionRuntimeV1',
      'missionFlywheelDirectorV1',
      'sharedWorkspaceMissionRoomV2',
      'projectIntelligenceV1',
      'chatToPublishBridgeV1',
      'returnConveyorV1',
      'alwaysOnStephanosUpdateV1',
    ],
    stateList: Object.values(INTEGRATION_STATE),
    finalVerdict: 'MISSION_INTEGRATION_CONTRACT_READY',
  };
}

export function deriveIntegrationState(input = {}) {
  const returnState = input.returnState || classifyReturnConveyor(input.returnRecord || {});
  if (text(input.blocker)) return INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (!text(input.idea)) return INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (!hasSourceEvidence(input)) return INTEGRATION_STATE.IDEA_CAPTURED;
  if (returnState.state === 'NEEDS_PROOF') return INTEGRATION_STATE.WAITING_FOR_PROOF;
  if (returnState.state === 'WAITING_FOR_APPROVAL') return INTEGRATION_STATE.WAITING_FOR_APPROVAL;
  if (returnState.state === 'READY_TO_COMPLETE') return INTEGRATION_STATE.READY_TO_UPDATE;
  if (returnState.state === 'PROOF_FAILED' || returnState.state === 'NEEDS_SUMMARY' || returnState.state === 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION') return INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (returnDone(returnState) && input.updateApplied === true) return INTEGRATION_STATE.DONE;
  if (returnDone(returnState)) return INTEGRATION_STATE.READY_TO_UPDATE;
  return INTEGRATION_STATE.SOURCE_READY;
}

export function createMissionOperationsPacket(input = {}) {
  const goalId = text(input.goalId, '#1329');
  const idea = text(input.idea, 'Integrate the merged Stephanos mission stack.');
  const returnState = input.returnState || classifyReturnConveyor(input.returnRecord || {});
  const integrationState = deriveIntegrationState({ ...input, idea, returnState });
  const blocker = integrationState === INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    ? text(input.blocker, returnState.nextAction || returnState.exactUnblockAction || 'Provide missing mission integration evidence.')
    : '';

  const sourceFiles = list(input.sourceFiles).map((path) => ({ path, content: 'source evidence recorded' }));
  const chatPacket = createChatToPublishPacket({
    goalId,
    branch: text(input.branch, 'feature/mission-integration-v1'),
    proofCommand: text(input.proofCommand, 'node --test shared/agents/missionIntegrationV1.test.mjs'),
    sourceFiles,
  });
  const executive = createMissionExecutiveSnapshot({
    idea,
    sourceFiles,
    currentMission: text(input.currentMission, 'mission integration'),
  });
  const runtime = createMissionRuntimeSnapshot({
    currentGoal: goalId,
    currentIdea: idea,
    branch: text(input.branch),
    prNumber: text(input.prNumber),
    headSha: text(input.headSha),
    proofCommand: text(input.proofCommand),
    sourceMerged: input.sourceMerged === true,
    focusedProofRecorded: input.focusedProofRecorded === true,
    missionStateUpdated: input.missionStateUpdated === true,
    blocker,
  });
  const director = createDirectorStatusPacket({
    goals: [{
      goalId,
      title: text(input.goalTitle, 'Mission Integration V1'),
      activeBranch: text(input.branch),
      prNumber: text(input.prNumber),
      proofCommand: text(input.proofCommand),
      blocker,
      sourceMerged: input.sourceMerged === true,
      focusedProofRecorded: input.focusedProofRecorded === true,
      missionStateUpdated: input.missionStateUpdated === true,
    }],
  });
  const intelligence = createProjectIntelligenceAnswer({
    question: idea,
    items: [
      { id: goalId, kind: 'GOAL', title: 'Mission Integration V1', summary: idea, proven: runtimeDone(runtime) },
      { id: 'return-conveyor', kind: 'SYSTEM', title: 'Return Conveyor V1', summary: `Return state: ${returnState.state}`, proven: true },
    ],
    nextActions: [blocker || text(input.nextAction, 'Continue mission integration loop.')],
  });
  const room = createMissionRoom({
    roomId: text(input.roomId, 'mission-integration-room'),
    participants: [{ role: PARTICIPANT_ROLE.OPERATOR }, { role: PARTICIPANT_ROLE.STEPHANOS }, { role: PARTICIPANT_ROLE.CODEX }, { role: PARTICIPANT_ROLE.OPENCLAW }],
    objects: [createWorkspaceObject({ objectId: goalId, kind: WORKSPACE_OBJECT_KIND.GOAL, title: 'Mission Integration V1', summary: idea, proven: runtimeDone(runtime) })],
    threads: [],
    messages: [createRoomMessage({ messageId: 'integration-status', role: PARTICIPANT_ROLE.STEPHANOS, body: `Mission integration state: ${integrationState}`, proven: true })],
    memoryHooks: ['projectIntelligenceV1', 'missionRuntimeV1'],
  });
  const updateStatus = createAlwaysOnUpdateStatus({
    localHead: text(input.localHead, input.headSha),
    remoteHead: text(input.remoteHead, input.headSha),
    runningBuildHead: text(input.runningBuildHead, input.headSha),
    workingTreeClean: input.workingTreeClean !== false,
    changedFiles: list(input.updateChangedFiles),
  });

  return {
    schemaVersion: MISSION_INTEGRATION_SCHEMA_VERSION,
    kind: 'stephanos.mission_integration.operations_packet',
    state: integrationState,
    currentIdea: idea,
    currentGoal: goalId,
    currentWorker: runtime.currentWorker,
    currentBranch: text(input.branch),
    currentPr: text(input.prNumber),
    currentProof: text(input.proofCommand),
    returnState: returnState.state,
    updateState: updateStatus.currentState,
    blocker,
    nextAction: blocker || returnState.nextAction || runtime.currentNextAction,
    executive,
    runtime,
    director,
    missionRoom: room,
    projectIntelligence: intelligence,
    chatPacket,
    returnConveyor: returnState,
    updateStatus,
    showInCommandDeck: true,
    showInSplash: true,
    finalVerdict: integrationState === INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'MISSION_INTEGRATION_BLOCKED' : 'MISSION_INTEGRATION_READY',
  };
}

export function validateMissionOperationsPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== MISSION_INTEGRATION_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.mission_integration.operations_packet') errors.push('invalid-kind');
  if (!Object.values(INTEGRATION_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!text(packet.currentIdea)) errors.push('missing-current-idea');
  if (!text(packet.currentGoal)) errors.push('missing-current-goal');
  if (!packet.runtime) errors.push('missing-runtime');
  if (!packet.director) errors.push('missing-director');
  if (!packet.returnConveyor) errors.push('missing-return-conveyor');
  if (!packet.updateStatus) errors.push('missing-update-status');
  if (packet.state === INTEGRATION_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !text(packet.blocker)) errors.push('blocked-without-exact-action');
  if (packet.state === INTEGRATION_STATE.DONE && (packet.returnState !== 'DONE' || packet.updateState === 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION')) errors.push('done-without-return-update-evidence');
  if (packet.showInCommandDeck !== true || packet.showInSplash !== true) errors.push('missing-visible-surfaces');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_INTEGRATION_PACKET_PASS' : 'MISSION_INTEGRATION_PACKET_BLOCKED',
  };
}
