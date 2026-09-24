import { createProjectIntelligenceAnswer } from '../../shared/agents/projectIntelligenceV1.mjs';

export const PROJECT_INTELLIGENCE_GROUNDING_SCHEMA_VERSION = 'stephanos.project-intelligence-grounding.v1';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function compactId(value, fallback) {
  return text(value, fallback).toLowerCase().replace(/[^a-z0-9#._-]+/g, '-');
}

function goalIdentity(goal = {}, index = 0) {
  return text(goal.candidateId || goal.goalId || goal.issue || goal.id || goal.title, `goal-${index + 1}`);
}

function goalTitle(goal = {}, identity = '') {
  return text(goal.title || goal.summary || goal.name, identity || 'Goal');
}

function goalStatus(goal = {}, lane = '') {
  return text(goal.status || goal.lifecycle || goal.state || goal.phase, lane);
}

function buildGoalKnowledgeItem(goal = {}, lane = 'GOAL', index = 0) {
  const identity = goalIdentity(goal, index);
  const title = goalTitle(goal, identity);
  const status = goalStatus(goal, lane);
  const refs = [
    goal.url,
    goal.displayUrl,
    goal.pr?.url,
    goal.pullRequest?.url,
  ].map((value) => text(value)).filter(Boolean);
  return {
    id: `${lane.toLowerCase()}-${compactId(identity, `goal-${index + 1}`)}`,
    kind: 'GOAL',
    title: `${identity} ${title}`.trim(),
    summary: `${lane}: ${status || 'state present in live projection'}`,
    status,
    refs,
    proven: true,
    source: 'live-goal-projection',
  };
}

function unavailable(reason) {
  return Object.freeze({
    schemaVersion: PROJECT_INTELLIGENCE_GROUNDING_SCHEMA_VERSION,
    available: false,
    itemCount: 0,
    answer: null,
    contextBlock: '',
    reason,
    finalVerdict: 'PROJECT_INTELLIGENCE_GROUNDING_UNAVAILABLE',
  });
}

export function buildProjectIntelligenceGrounding({ prompt = '', liveGoalProjection = {} } = {}) {
  if (!liveGoalProjection || liveGoalProjection.schemaVersion !== 'stephanos.live-goal-projection.v1') {
    return unavailable('live-goal-projection-unavailable');
  }

  const activeGoals = list(liveGoalProjection.activeProofLane);
  const queuedGoals = list(liveGoalProjection.queuedCandidates);
  const blockedGoals = list(liveGoalProjection.blockedCandidates);
  const blockers = list(liveGoalProjection.blockers).map((value) => text(value)).filter(Boolean);
  const nextOperatorAction = text(liveGoalProjection.nextOperatorAction);
  const items = [
    ...activeGoals.map((goal, index) => buildGoalKnowledgeItem(goal, 'ACTIVE', index)),
    ...queuedGoals.map((goal, index) => buildGoalKnowledgeItem(goal, 'QUEUED', index)),
    ...blockedGoals.map((goal, index) => buildGoalKnowledgeItem(goal, 'BLOCKED', index)),
    {
      id: 'live-goal-projection-runtime',
      kind: 'RUNTIME',
      title: 'Live Goal Projection runtime',
      summary: `sourceTruth=${text(liveGoalProjection.sourceTruth, 'unknown')}; backendLive=${liveGoalProjection.heartbeat?.backendLive === true}; generatedAt=${text(liveGoalProjection.generatedAt, 'unknown')}`,
      status: text(liveGoalProjection.sourceTruth, 'unknown'),
      refs: [],
      proven: true,
      source: 'live-goal-projection',
    },
    ...blockers.map((blocker, index) => ({
      id: `live-blocker-${index + 1}`,
      kind: 'BLOCKER',
      title: `Live blocker ${index + 1}`,
      summary: blocker,
      status: 'BLOCKED',
      refs: [],
      proven: true,
      source: 'live-goal-projection',
    })),
  ];

  const nextActions = nextOperatorAction ? [nextOperatorAction] : [];
  const requestedAnswer = createProjectIntelligenceAnswer({
    question: text(prompt, 'What is the current Stephanos project state?'),
    items,
    nextActions,
  });
  const requestedHasEvidence = requestedAnswer.provenFacts.length > 0 || requestedAnswer.hypotheses.length > 0;
  const answer = requestedHasEvidence
    ? requestedAnswer
    : createProjectIntelligenceAnswer({
      question: 'goal runtime blocker next action',
      items,
      nextActions,
    });

  const contextBlock = [
    'Stephanos Project Intelligence V1 grounded synthesis from the live goal projection:',
    `finalVerdict: ${answer.finalVerdict}`,
    `provenFacts: ${answer.provenFacts.join(' | ') || 'none matched'}`,
    `hypotheses: ${answer.hypotheses.join(' | ') || 'none'}`,
    `nextActions: ${answer.nextActions.join(' | ') || 'none reported'}`,
    `liveBlockers: ${blockers.join(' | ') || 'none reported'}`,
    'Treat provenFacts and liveBlockers as bounded project evidence from the current live projection. Do not promote hypotheses to facts, and say unknown when the projection does not contain the answer.',
  ].join('\n');

  return Object.freeze({
    schemaVersion: PROJECT_INTELLIGENCE_GROUNDING_SCHEMA_VERSION,
    available: true,
    itemCount: items.length,
    answer,
    contextBlock,
    reason: '',
    finalVerdict: 'PROJECT_INTELLIGENCE_GROUNDING_READY',
  });
}
