import { createChatToPublishPacket } from './chatToPublishBridgeV1.mjs';
import { createIdeaFlywheelTurn, createProjectIntelligenceAnswer } from './projectIntelligenceV1.mjs';
import { createFlywheelTurn, routeWorkspaceWork, WORKSPACE_OBJECT_KIND } from './sharedWorkspaceMissionRoomV2.mjs';

export const MISSION_EXECUTIVE_SCHEMA_VERSION = 'mission-executive.v1';

export const EXECUTIVE_PHASE = Object.freeze({
  IDEA_CAPTURED: 'IDEA_CAPTURED',
  QUESTIONING: 'QUESTIONING',
  DESIGNING: 'DESIGNING',
  SOURCE_SLICE_READY: 'SOURCE_SLICE_READY',
  WAITING_FOR_CODEX: 'WAITING_FOR_CODEX',
  WAITING_FOR_OPENCLAW: 'WAITING_FOR_OPENCLAW',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  MERGED: 'MERGED',
  MEMORY_UPDATED: 'MEMORY_UPDATED',
  NEXT_IDEA_READY: 'NEXT_IDEA_READY',
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

function phase(value) {
  const out = text(value, EXECUTIVE_PHASE.IDEA_CAPTURED).toUpperCase();
  return Object.values(EXECUTIVE_PHASE).includes(out) ? out : EXECUTIVE_PHASE.IDEA_CAPTURED;
}

function ideaIdFrom(value) {
  return `idea-${text(value, 'untitled').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`;
}

function needsQuestions(input = {}) {
  return text(input.idea).length < 20 || list(input.knownFacts).length === 0;
}

export function buildMissionExecutiveContract() {
  return {
    schemaVersion: MISSION_EXECUTIVE_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_executive.contract',
    phases: Object.values(EXECUTIVE_PHASE),
    requiredInputs: ['idea'],
    requiredOutputs: ['missionRoomTurn', 'projectIntelligence', 'route', 'nextAction'],
    finalVerdict: 'MISSION_EXECUTIVE_CONTRACT_READY',
  };
}

export function captureIdea(input = {}) {
  const idea = text(input.idea);
  return {
    schemaVersion: MISSION_EXECUTIVE_SCHEMA_VERSION,
    kind: 'stephanos.mission_executive.idea_capture',
    ideaId: text(input.ideaId, ideaIdFrom(idea)),
    idea,
    operatorIntent: text(input.operatorIntent, idea),
    knownFacts: list(input.knownFacts),
    hypotheses: list(input.hypotheses),
    finalVerdict: idea ? 'MISSION_EXECUTIVE_IDEA_CAPTURED' : 'MISSION_EXECUTIVE_IDEA_MISSING',
  };
}

export function createClarifyingQuestions(input = {}) {
  const captured = input.kind === 'stephanos.mission_executive.idea_capture' ? input : captureIdea(input);
  const questions = [
    'What user-visible behaviour should change first?',
    'What existing Stephanos/OpenClaw system should this connect to?',
    'What is the smallest source slice that proves the idea is real?',
  ];
  return {
    schemaVersion: MISSION_EXECUTIVE_SCHEMA_VERSION,
    kind: 'stephanos.mission_executive.questions',
    ideaId: captured.ideaId,
    questions,
    phase: EXECUTIVE_PHASE.QUESTIONING,
    finalVerdict: 'MISSION_EXECUTIVE_QUESTIONS_READY',
  };
}

export function createIdeaToSystemPlan(input = {}) {
  const captured = input.capture?.kind === 'stephanos.mission_executive.idea_capture' ? input.capture : captureIdea(input);
  const sourceSummary = text(input.sourceSummary, 'Create the smallest source contract and focused proof for this idea.');
  const missionRoomTurn = createFlywheelTurn({
    ideaId: captured.ideaId,
    title: text(input.title, 'Operator idea'),
    idea: captured.idea,
    question: text(input.question, 'What source slice makes this idea testable?'),
    nextAction: sourceSummary,
  });
  const projectIntelligence = createProjectIntelligenceAnswer({
    question: captured.idea,
    items: [
      { id: captured.ideaId, kind: 'IDEA', title: text(input.title, 'Operator idea'), summary: captured.idea, proven: false },
      ...list(input.relatedFacts).map((fact, index) => ({ id: `fact-${index + 1}`, kind: 'SYSTEM', title: `Related fact ${index + 1}`, summary: fact, proven: true })),
    ],
    nextActions: [sourceSummary],
  });
  const route = routeWorkspaceWork({ kind: WORKSPACE_OBJECT_KIND.TASK, summary: sourceSummary });
  return {
    schemaVersion: MISSION_EXECUTIVE_SCHEMA_VERSION,
    kind: 'stephanos.mission_executive.idea_to_system_plan',
    idea: captured,
    phase: needsQuestions(captured) ? EXECUTIVE_PHASE.QUESTIONING : EXECUTIVE_PHASE.DESIGNING,
    missionRoomTurn,
    projectIntelligence,
    route,
    nextAction: sourceSummary,
    finalVerdict: 'MISSION_EXECUTIVE_PLAN_READY',
  };
}

export function createExecutiveSourcePacket(input = {}) {
  const plan = input.plan?.kind === 'stephanos.mission_executive.idea_to_system_plan' ? input.plan : createIdeaToSystemPlan(input);
  const goalId = text(input.goalId, '#1321');
  const sourceFiles = Array.isArray(input.sourceFiles) ? input.sourceFiles : [];
  const proofCommand = text(input.proofCommand, 'node --test shared/agents/missionExecutiveV1.test.mjs');
  const packet = createChatToPublishPacket({
    goalId,
    branch: text(input.branch, 'feature/mission-executive-v1'),
    title: text(input.title, 'Mission Executive V1 source slice'),
    proofCommand,
    sourceFiles,
    prTitle: text(input.prTitle, 'Add Mission Executive V1'),
    prBody: text(input.prBody, `Implements ${goalId}. Proof: ${proofCommand}`),
  });
  return {
    schemaVersion: MISSION_EXECUTIVE_SCHEMA_VERSION,
    kind: 'stephanos.mission_executive.source_packet',
    plan,
    phase: sourceFiles.length ? EXECUTIVE_PHASE.SOURCE_SLICE_READY : EXECUTIVE_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    packet,
    exactUnblockAction: sourceFiles.length ? '' : 'Add sourceFiles before publishing through the chat-to-publish bridge.',
    finalVerdict: sourceFiles.length ? 'MISSION_EXECUTIVE_SOURCE_PACKET_READY' : 'MISSION_EXECUTIVE_SOURCE_PACKET_BLOCKED',
  };
}

export function createMissionExecutiveSnapshot(input = {}) {
  const plan = input.plan?.kind === 'stephanos.mission_executive.idea_to_system_plan' ? input.plan : createIdeaToSystemPlan(input);
  const sourcePacket = input.sourcePacket || createExecutiveSourcePacket({ ...input, plan });
  const currentPhase = phase(input.phase || sourcePacket.phase || plan.phase);
  return {
    schemaVersion: MISSION_EXECUTIVE_SCHEMA_VERSION,
    kind: 'stephanos.mission_executive.snapshot',
    ideaId: plan.idea.ideaId,
    currentIdea: plan.idea.idea,
    currentMission: text(input.currentMission, 'idea-to-system pipeline'),
    currentWorker: plan.route.assignedRole,
    currentPhase,
    lastActivity: text(input.lastActivity, 'mission-executive-snapshot-created'),
    nextDeterministicAction: currentPhase === EXECUTIVE_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? sourcePacket.exactUnblockAction : plan.nextAction,
    blocker: currentPhase === EXECUTIVE_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? sourcePacket.exactUnblockAction : '',
    plan,
    sourcePacket,
    finalVerdict: currentPhase === EXECUTIVE_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'MISSION_EXECUTIVE_BLOCKED' : 'MISSION_EXECUTIVE_ACTIVE',
  };
}

export function validateMissionExecutiveSnapshot(snapshot = {}) {
  const errors = [];
  if (snapshot.schemaVersion !== MISSION_EXECUTIVE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (snapshot.kind !== 'stephanos.mission_executive.snapshot') errors.push('invalid-kind');
  if (!text(snapshot.ideaId)) errors.push('missing-idea-id');
  if (!text(snapshot.currentIdea)) errors.push('missing-current-idea');
  if (!Object.values(EXECUTIVE_PHASE).includes(snapshot.currentPhase)) errors.push('invalid-phase');
  if (!snapshot.plan) errors.push('missing-plan');
  if (!snapshot.sourcePacket) errors.push('missing-source-packet');
  if (!text(snapshot.nextDeterministicAction)) errors.push('missing-next-action');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_EXECUTIVE_SNAPSHOT_PASS' : 'MISSION_EXECUTIVE_SNAPSHOT_BLOCKED',
  };
}
