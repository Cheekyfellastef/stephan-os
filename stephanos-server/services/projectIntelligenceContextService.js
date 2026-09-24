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

function goalKey(goal = {}) {
  return text(goal.candidateId || goal.goalId || goal.issue || goal.id || goal.title).toLowerCase();
}

function goalTitle(goal = {}, identity = '') {
  return text(goal.title || goal.summary || goal.name, identity || 'Goal');
}

function goalStatus(goal = {}, lane = '') {
  return text(goal.status || goal.lifecycle || goal.state || goal.phase, lane);
}

function uniqueGoals(goals = []) {
  const seen = new Set();
  return list(goals).filter((goal, index) => {
    const key = goalKey(goal) || `anonymous-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildGoalKnowledgeItem(goal = {}, lane = 'GOAL', index = 0, { proven = false } = {}) {
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
    proven,
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
    truthState: 'unavailable',
    finalVerdict: 'PROJECT_INTELLIGENCE_GROUNDING_UNAVAILABLE',
  });
}

export function buildProjectIntelligenceGrounding({ prompt = '', liveGoalProjection = {} } = {}) {
  if (!liveGoalProjection || liveGoalProjection.schemaVersion !== 'stephanos.live-goal-projection.v1') {
    return unavailable('live-goal-projection-unavailable');
  }

  const sourceTruth = text(liveGoalProjection.sourceTruth, 'unknown').toLowerCase();
  const projectionLive = sourceTruth === 'live' && liveGoalProjection.heartbeat?.backendLive === true;
  const importedVerificationState = text(liveGoalProjection.importedGoals?.verificationState, 'none').toLowerCase();
  const unverifiedImportedKeys = importedVerificationState === 'imported_unverified'
    ? new Set(list(liveGoalProjection.importedGoals?.candidates).map((goal) => goalKey(goal)).filter(Boolean))
    : new Set();

  const blockedGoals = uniqueGoals(liveGoalProjection.blockedCandidates);
  const blockedKeys = new Set(blockedGoals.map((goal) => goalKey(goal)).filter(Boolean));
  const activeGoals = uniqueGoals(liveGoalProjection.activeProofLane)
    .filter((goal) => !blockedKeys.has(goalKey(goal)));
  const activeKeys = new Set(activeGoals.map((goal) => goalKey(goal)).filter(Boolean));
  const queuedGoals = uniqueGoals(liveGoalProjection.queuedCandidates)
    .filter((goal) => {
      const key = goalKey(goal);
      return !key || (!blockedKeys.has(key) && !activeKeys.has(key));
    });

  const goalIsProven = (goal) => {
    const key = goalKey(goal);
    return projectionLive && (!key || !unverifiedImportedKeys.has(key));
  };

  const blockers = list(liveGoalProjection.blockers).map((value) => text(value)).filter(Boolean);
  const nextOperatorAction = projectionLive ? text(liveGoalProjection.nextOperatorAction) : '';
  const items = [
    ...blockedGoals.map((goal, index) => buildGoalKnowledgeItem(goal, 'BLOCKED', index, { proven: goalIsProven(goal) })),
    ...activeGoals.map((goal, index) => buildGoalKnowledgeItem(goal, 'ACTIVE', index, { proven: goalIsProven(goal) })),
    ...queuedGoals.map((goal, index) => buildGoalKnowledgeItem(goal, 'QUEUED', index, { proven: goalIsProven(goal) })),
    {
      id: 'live-goal-projection-runtime',
      kind: 'RUNTIME',
      title: 'Live Goal Projection runtime',
      summary: `sourceTruth=${sourceTruth}; backendLive=${liveGoalProjection.heartbeat?.backendLive === true}; generatedAt=${text(liveGoalProjection.generatedAt, 'unknown')}`,
      status: sourceTruth,
      refs: [],
      proven: projectionLive,
      source: 'live-goal-projection',
    },
    ...blockers.map((blocker, index) => ({
      id: `live-blocker-${index + 1}`,
      kind: 'BLOCKER',
      title: `Live blocker ${index + 1}`,
      summary: blocker,
      status: 'BLOCKED',
      refs: [],
      proven: projectionLive,
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
    'Stephanos Project Intelligence V1 synthesis from the live goal projection:',
    `truthState: ${projectionLive ? 'live-verified' : 'unverified'}`,
    `sourceTruth: ${sourceTruth}`,
    `importedGoalsVerification: ${importedVerificationState}`,
    `finalVerdict: ${answer.finalVerdict}`,
    `provenFacts: ${answer.provenFacts.join(' | ') || 'none matched'}`,
    `hypotheses: ${answer.hypotheses.join(' | ') || 'none'}`,
    `nextActions: ${answer.nextActions.join(' | ') || 'none reported'}`,
    `projectedBlockers: ${blockers.join(' | ') || 'none reported'}`,
    'Only provenFacts are verified project evidence. Hypotheses and projectedBlockers not repeated in provenFacts are unverified context. Never promote mixed/static-fallback or imported_unverified goal state to fact; say unknown when current proof is missing.',
  ].join('\n');

  return Object.freeze({
    schemaVersion: PROJECT_INTELLIGENCE_GROUNDING_SCHEMA_VERSION,
    available: true,
    itemCount: items.length,
    answer,
    contextBlock,
    reason: projectionLive ? '' : 'live-goal-projection-not-fully-verified',
    truthState: projectionLive ? 'live-verified' : 'unverified',
    finalVerdict: projectionLive
      ? 'PROJECT_INTELLIGENCE_GROUNDING_READY'
      : 'PROJECT_INTELLIGENCE_GROUNDING_UNVERIFIED',
  });
}
