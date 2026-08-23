import { createChatToPublishCompletion } from './chatToPublishBridgeV1.mjs';
import { GOAL_STATE, classifyGoal, createDirectorStatusPacket } from './missionFlywheelDirectorV1.mjs';
import { EXECUTIVE_PHASE, createMissionExecutiveSnapshot } from './missionExecutiveV1.mjs';
import { createProjectIntelligenceAnswer } from './projectIntelligenceV1.mjs';
import { createFlywheelTurn } from './sharedWorkspaceMissionRoomV2.mjs';

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

function evidence(input = {}) {
  return {
    sourceMerged: input.sourceMerged === true,
    focusedProofRecorded: input.focusedProofRecorded === true,
    missionStateUpdated: input.missionStateUpdated === true,
    activeBranch: text(input.activeBranch || input.branch),
    prNumber: text(input.prNumber),
    headSha: text(input.headSha),
    mergeSha: text(input.mergeSha),
    proofCommand: text(input.proofCommand),
    proofPassed: input.proofPassed === true,
    runtimeStateObserved: input.runtimeStateObserved === true,
    platformStateObserved: input.platformStateObserved === true,
    lastActivity: text(input.lastActivity),
  };
}

function hasBuildEvidence(record = {}) {
  return Boolean(text(record.activeBranch) || text(record.prNumber) || text(record.headSha) || text(record.proofCommand));
}

function doneEvidence(record = {}) {
  return record.sourceMerged === true && record.focusedProofRecorded === true && record.missionStateUpdated === true;
}

function missingEvidence(record = {}) {
  const missing = [];
  if (!hasBuildEvidence(record)) missing.push('build evidence: activeBranch, prNumber, headSha, or proofCommand');
  if (text(record.prNumber) && !record.focusMerged && !record.focusedProofRecorded && !record.proofPassed) missing.push('focused proof result');
  if (record.sourceMerged && !record.focusedProofRecorded) missing.push('focused proof recorded');
  if (record.sourceMerged && !record.missionStateUpdated) missing.push('mission state updated');
  if (record.focusedProofRecorded && !record.sourceMerged) missing.push('merge to main evidence');
  return missing;
}

function exactUnblockAction(missing = []) {
  return missing.length
    ? `Record ${missing.join(', ')} before Mission Runtime V1 can report BUILDING or DONE.`
    : '';
}

function phaseFrom(record = {}, classifiedGoal = {}) {
  if (doneEvidence(record)) return RUNTIME_PHASE.DONE;
  const missing = missingEvidence(record);
  if (!hasBuildEvidence(record)) return RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (text(record.prNumber) && !record.focusedProofRecorded) return RUNTIME_PHASE.WAITING_FOR_PROOF;
  if (text(record.prNumber) && record.focusedProofRecorded && !record.sourceMerged) return RUNTIME_PHASE.WAITING_FOR_OPERATOR_APPROVAL;
  if (classifiedGoal.state === GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION) return RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  return missing.length ? RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : RUNTIME_PHASE.BUILDING;
}

function commandDeckSnapshot(runtime = {}) {
  return {
    title: runtime.currentGoal.title,
    status: runtime.phase,
    primaryLine: `${runtime.currentGoal.goalId} · ${runtime.currentIdea}`,
    worker: runtime.currentWorker,
    pr: runtime.currentPr,
    proof: runtime.currentProof,
    blocker: runtime.blocker,
    nextAction: runtime.nextAction,
    lastActivity: runtime.lastActivity,
    chips: [runtime.phase, runtime.currentWorker, runtime.currentProof.status].filter(Boolean),
    finalVerdict: runtime.phase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
      ? 'COMMAND_DECK_RUNTIME_BLOCKED'
      : 'COMMAND_DECK_RUNTIME_READY',
  };
}

export function buildMissionRuntimeContract() {
  return {
    schemaVersion: MISSION_RUNTIME_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_runtime.contract',
    composedSystems: [
      'Mission Executive V1',
      'Mission Flywheel Director V1',
      'Shared Workspace Mission Room V2',
      'Project Intelligence V1',
      'Chat-to-Publish Bridge V1',
      'Platform/Runtime state',
    ],
    requiredFields: ['currentGoal', 'currentIdea', 'currentWorker', 'phase', 'currentPr', 'currentProof', 'blocker', 'nextAction', 'lastActivity'],
    truthRules: [
      'Never report BUILDING without branch, PR, head SHA, or proof command evidence.',
      'DONE requires merged to main, focused proof, and mission state update evidence.',
      'Missing evidence emits BLOCKED_WITH_EXACT_UNBLOCK_ACTION with an exact unblock action.',
    ],
    finalVerdict: 'MISSION_RUNTIME_CONTRACT_READY',
  };
}

export function createMissionRuntimeSnapshot(input = {}) {
  const platformRuntime = evidence(input.platformRuntime || input.runtime || input);
  const goal = classifyGoal({
    goalId: text(input.goalId, '#1323'),
    title: text(input.goalTitle, 'Mission Runtime V1'),
    activeBranch: platformRuntime.activeBranch,
    prNumber: platformRuntime.prNumber,
    proofCommand: platformRuntime.proofCommand,
    sourceMerged: platformRuntime.sourceMerged,
    focusedProofRecorded: platformRuntime.focusedProofRecorded,
    missionStateUpdated: platformRuntime.missionStateUpdated,
    blocker: text(input.blocker),
    nextAction: text(input.nextAction),
    priority: input.priority,
  });
  const phase = phaseFrom(platformRuntime, goal);
  const missing = missingEvidence(platformRuntime);
  const blocker = phase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    ? text(input.blocker, exactUnblockAction(missing) || goal.blocker)
    : '';
  const nextAction = blocker || text(input.nextAction, goal.nextAction || 'Continue the smallest source slice and record proof.');
  const idea = text(input.idea, 'Compose the merged mission stack into one live mission snapshot.');
  const missionExecutive = input.missionExecutive || createMissionExecutiveSnapshot({
    idea,
    title: goal.title,
    sourceFiles: list(input.sourceFiles),
    proofCommand: platformRuntime.proofCommand || 'node --test shared/agents/missionRuntimeV1.test.mjs',
    phase: phase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? EXECUTIVE_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : EXECUTIVE_PHASE.DESIGNING,
    lastActivity: platformRuntime.lastActivity || input.lastActivity,
  });
  const director = input.director || createDirectorStatusPacket({ goals: [goal], lastActivity: platformRuntime.lastActivity || input.lastActivity });
  const missionRoom = input.missionRoom || createFlywheelTurn({ ideaId: goal.goalId, title: goal.title, idea, nextAction });
  const projectIntelligence = input.projectIntelligence || createProjectIntelligenceAnswer({
    question: idea,
    items: [
      { id: goal.goalId, kind: 'GOAL', title: goal.title, summary: idea, proven: platformRuntime.runtimeStateObserved },
      { id: `proof-${goal.goalId}`, kind: 'PROOF', title: platformRuntime.proofCommand || 'Focused proof', summary: platformRuntime.proofPassed ? 'Proof passed.' : 'Proof not yet recorded.', proven: platformRuntime.focusedProofRecorded },
    ],
    nextActions: [nextAction],
  });
  const chatToPublish = input.chatToPublish || createChatToPublishCompletion({
    goalId: goal.goalId,
    prNumber: platformRuntime.prNumber,
    headSha: platformRuntime.headSha,
    mergeSha: platformRuntime.mergeSha,
    proofCommand: platformRuntime.proofCommand,
    proofPassed: platformRuntime.proofPassed,
  });
  const runtime = {
    schemaVersion: MISSION_RUNTIME_SCHEMA_VERSION,
    kind: 'stephanos.mission_runtime.snapshot',
    currentGoal: { goalId: goal.goalId, title: goal.title, state: phase },
    currentIdea: idea,
    currentWorker: text(input.worker, goal.activeBranch ? 'CODEX' : missionExecutive.currentWorker),
    phase,
    currentPr: { prNumber: platformRuntime.prNumber, headSha: platformRuntime.headSha, mergeSha: platformRuntime.mergeSha, status: platformRuntime.sourceMerged ? 'MERGED_TO_MAIN' : platformRuntime.prNumber ? 'OPEN_OR_DRAFT' : 'MISSING' },
    currentProof: { command: platformRuntime.proofCommand, passed: platformRuntime.proofPassed, focusedProofRecorded: platformRuntime.focusedProofRecorded, status: platformRuntime.focusedProofRecorded ? 'FOCUSED_PROOF_RECORDED' : 'MISSING' },
    blocker,
    exactUnblockAction: blocker,
    nextAction,
    lastActivity: text(platformRuntime.lastActivity, 'mission-runtime-snapshot-created'),
    platformRuntime,
    stack: { missionExecutive, director, missionRoom, projectIntelligence, chatToPublish },
    truth: {
      neverReportBuildingWithoutEvidence: phase !== RUNTIME_PHASE.BUILDING || hasBuildEvidence(platformRuntime),
      doneRequiresMergedProofAndMissionState: phase !== RUNTIME_PHASE.DONE || doneEvidence(platformRuntime),
    },
    finalVerdict: phase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'MISSION_RUNTIME_BLOCKED_WITH_EXACT_UNBLOCK_ACTION' : 'MISSION_RUNTIME_READY',
  };
  return { ...runtime, commandDeck: commandDeckSnapshot(runtime) };
}

export function validateMissionRuntimeSnapshot(snapshot = {}) {
  const errors = [];
  if (snapshot.schemaVersion !== MISSION_RUNTIME_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (snapshot.kind !== 'stephanos.mission_runtime.snapshot') errors.push('invalid-kind');
  for (const field of ['currentGoal', 'currentIdea', 'currentWorker', 'phase', 'currentPr', 'currentProof', 'nextAction', 'lastActivity']) {
    if (!snapshot[field] || (typeof snapshot[field] === 'string' && !text(snapshot[field]))) errors.push(`missing-${field}`);
  }
  if (snapshot.phase === RUNTIME_PHASE.BUILDING && snapshot.truth?.neverReportBuildingWithoutEvidence !== true) errors.push('building-without-evidence');
  if (snapshot.phase === RUNTIME_PHASE.DONE && snapshot.truth?.doneRequiresMergedProofAndMissionState !== true) errors.push('done-without-required-evidence');
  if (snapshot.phase === RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !text(snapshot.exactUnblockAction)) errors.push('missing-exact-unblock-action');
  if (!snapshot.commandDeck) errors.push('missing-command-deck-snapshot');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_RUNTIME_SNAPSHOT_PASS' : 'MISSION_RUNTIME_SNAPSHOT_BLOCKED',
  };
}
