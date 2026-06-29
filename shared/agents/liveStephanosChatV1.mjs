import { createMissionOperationsPacket } from './missionIntegrationV1.mjs';
import { createMissionOrchestratorPacket } from './missionOrchestratorControlLoopV1.mjs';
import { createProjectIntelligenceAnswer } from './projectIntelligenceV1.mjs';

export const LIVE_STEPHANOS_CHAT_SCHEMA_VERSION = 'live-stephanos-chat.v1';

export const CHAT_INTENT = Object.freeze({
  STATUS: 'STATUS',
  IDEA: 'IDEA',
  BLOCKER: 'BLOCKER',
  NEXT_ACTION: 'NEXT_ACTION',
  UNKNOWN: 'UNKNOWN',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function lower(value) {
  return text(value).toLowerCase();
}

function classifyMessage(message = '') {
  const value = lower(message);
  if (/idea|thinking|concept|what if|could we/i.test(value)) return CHAT_INTENT.IDEA;
  if (/blocked|stuck|why|fail|error|problem/i.test(value)) return CHAT_INTENT.BLOCKER;
  if (/next|do now|what should|move/i.test(value)) return CHAT_INTENT.NEXT_ACTION;
  if (/status|where are we|goal|progress|dashboard|running/i.test(value)) return CHAT_INTENT.STATUS;
  return CHAT_INTENT.UNKNOWN;
}

export function buildLiveStephanosChatContract() {
  return {
    schemaVersion: LIVE_STEPHANOS_CHAT_SCHEMA_VERSION,
    contractKind: 'stephanos.live_chat.contract',
    chatIntents: Object.values(CHAT_INTENT),
    requiredSources: ['missionOperations', 'missionOrchestrator', 'projectIntelligence'],
    finalVerdict: 'LIVE_STEPHANOS_CHAT_CONTRACT_READY',
  };
}

export function createLiveChatContext(input = {}) {
  const missionOperations = input.missionOperations || createMissionOperationsPacket({
    goalId: text(input.goalId, '#1280'),
    idea: text(input.idea, 'Make Stephanos useful from chat.'),
    branch: input.branch,
    proofCommand: input.proofCommand,
    sourceFiles: input.sourceFiles || [],
    returnRecord: input.returnRecord,
    blocker: input.blocker,
  });
  const orchestrator = input.orchestrator || createMissionOrchestratorPacket({
    intent: text(input.intent, input.idea || 'Answer from live mission state.'),
    branch: input.branch,
    sourceFiles: input.sourceFiles || [],
    summary: input.summary,
    changedFiles: input.changedFiles,
    proofCommand: input.proofCommand,
    proofResult: input.proofResult,
    approval: input.approval,
    prNumber: input.prNumber,
    headSha: input.headSha,
    completionSha: input.completionSha,
    missionUpdate: input.missionUpdate,
    updateApplied: input.updateApplied,
  });
  const projectIntelligence = input.projectIntelligence || createProjectIntelligenceAnswer({
    question: text(input.question, 'What is the current mission state?'),
    items: [
      { id: missionOperations.currentGoal, kind: 'GOAL', title: missionOperations.currentGoal, summary: missionOperations.currentIdea, proven: missionOperations.state === 'DONE' },
      { id: 'orchestrator-state', kind: 'SYSTEM', title: 'Mission Orchestrator', summary: orchestrator.state, proven: true },
    ],
    nextActions: [missionOperations.nextAction || orchestrator.nextAction],
  });
  return {
    schemaVersion: LIVE_STEPHANOS_CHAT_SCHEMA_VERSION,
    kind: 'stephanos.live_chat.context',
    missionOperations,
    orchestrator,
    projectIntelligence,
    finalVerdict: 'LIVE_STEPHANOS_CHAT_CONTEXT_READY',
  };
}

function makeAnswer(intent, context, message) {
  const ops = context.missionOperations;
  const orch = context.orchestrator;
  const blocker = text(ops.blocker || orch.blocker);
  if (intent === CHAT_INTENT.IDEA) {
    return `Idea captured: ${text(message)}. Current mission link: ${ops.currentGoal}. Recommended next action: ${ops.nextAction || orch.nextAction}.`;
  }
  if (intent === CHAT_INTENT.BLOCKER) {
    return blocker ? `Current blocker: ${blocker}` : `No exact blocker is recorded. Current state is ${ops.state}; next action is ${ops.nextAction || orch.nextAction}.`;
  }
  if (intent === CHAT_INTENT.NEXT_ACTION) {
    return `Next action: ${ops.nextAction || orch.nextAction}`;
  }
  if (intent === CHAT_INTENT.STATUS) {
    return `Mission status: ${ops.currentGoal} is ${ops.state}. Worker: ${ops.currentWorker}. Return: ${ops.returnState}. Update: ${ops.updateState}.`;
  }
  return `I can answer from Mission Operations. Current goal: ${ops.currentGoal}. Current state: ${ops.state}. Next action: ${ops.nextAction || orch.nextAction}.`;
}

export function createLiveStephanosChatResponse(input = {}) {
  const message = text(input.message);
  const intent = classifyMessage(message);
  const context = input.context?.kind === 'stephanos.live_chat.context' ? input.context : createLiveChatContext(input);
  const answer = makeAnswer(intent, context, message);
  return {
    schemaVersion: LIVE_STEPHANOS_CHAT_SCHEMA_VERSION,
    kind: 'stephanos.live_chat.response',
    intent,
    message,
    answer,
    missionState: context.missionOperations.state,
    goalId: context.missionOperations.currentGoal,
    nextAction: context.missionOperations.nextAction || context.orchestrator.nextAction,
    blocker: context.missionOperations.blocker || context.orchestrator.blocker || '',
    facts: context.projectIntelligence.facts || [],
    hypotheses: context.projectIntelligence.hypotheses || [],
    finalVerdict: 'LIVE_STEPHANOS_CHAT_RESPONSE_READY',
  };
}

export function validateLiveStephanosChatResponse(response = {}) {
  const errors = [];
  if (response.schemaVersion !== LIVE_STEPHANOS_CHAT_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (response.kind !== 'stephanos.live_chat.response') errors.push('invalid-kind');
  if (!Object.values(CHAT_INTENT).includes(response.intent)) errors.push('invalid-intent');
  if (!text(response.answer)) errors.push('missing-answer');
  if (!text(response.goalId)) errors.push('missing-goal-id');
  if (!text(response.nextAction)) errors.push('missing-next-action');
  if (!Array.isArray(response.facts) || !Array.isArray(response.hypotheses)) errors.push('missing-fact-hypothesis-split');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'LIVE_STEPHANOS_CHAT_RESPONSE_PASS' : 'LIVE_STEPHANOS_CHAT_RESPONSE_BLOCKED',
  };
}
