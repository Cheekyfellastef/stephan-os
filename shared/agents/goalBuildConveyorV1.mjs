export const GOAL_BUILD_CONVEYOR_SCHEMA = 'stephanos.goal-build-conveyor.v1';

export const GOAL_BUILD_CONVEYOR_STAGES = Object.freeze([
  Object.freeze({ id: 'GOAL', label: 'Goal' }),
  Object.freeze({ id: 'READY', label: 'Ready' }),
  Object.freeze({ id: 'SELECTED', label: 'Selected' }),
  Object.freeze({ id: 'MISSION', label: 'Mission' }),
  Object.freeze({ id: 'DISPATCHED', label: 'Dispatched' }),
  Object.freeze({ id: 'PICKED_UP', label: 'Picked up' }),
  Object.freeze({ id: 'BUILDING', label: 'Building' }),
  Object.freeze({ id: 'BUILT', label: 'Built' }),
  Object.freeze({ id: 'TESTED', label: 'Tested' }),
  Object.freeze({ id: 'COMPLETED', label: 'Completed' }),
]);

const GATE_BY_STAGE = Object.freeze({
  READY: 'ELIGIBLE_GOAL',
  SELECTED: 'SELECT',
  MISSION: 'MISSION',
  DISPATCHED: 'CLAIM',
  PICKED_UP: 'WORKER',
  BUILT: 'SOURCE_CHANGED',
  TESTED: 'TESTED',
  COMPLETED: 'TERMINAL_RECEIPT',
});

const READY_OR_BEYOND = new Set([
  'ELIGIBLE', 'READY', 'SELECTABLE', 'QUEUED', 'ACTIVE', 'BUILDING', 'RUNNING',
  'SELECTED', 'CLAIMED', 'SOURCE_CHANGED', 'TESTED', 'VERIFYING',
  'CHECKS_RUNNING', 'REVIEW_REQUIRED', 'REVIEWING',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function canonicalIssue(value) {
  const raw = text(value);
  if (!raw) return '';
  const match = raw.match(/#?(\d+)/);
  return match ? `#${match[1]}` : raw.toLowerCase();
}

function lightForGateState(value) {
  const state = text(value, 'UNKNOWN').toUpperCase();
  if (state === 'PASS') return 'GREEN';
  if (state === 'BLOCKED') return 'RED';
  if (state === 'WAITING') return 'AMBER';
  return 'GREY';
}

function stageRecord(id, label, trafficLight = 'GREY', proof = '', reason = '', source = '') {
  return Object.freeze({
    id,
    label,
    trafficLight,
    proven: trafficLight === 'GREEN',
    blocked: trafficLight === 'RED',
    waiting: trafficLight === 'AMBER',
    proof: text(proof),
    reason: text(reason),
    source: text(source),
  });
}

function exactTrackForGoal(goal, autonomyBuildTrack) {
  if (!autonomyBuildTrack || typeof autonomyBuildTrack !== 'object') return null;
  const goalIssue = canonicalIssue(goal?.issue || goal?.goalId);
  const trackIssue = canonicalIssue(autonomyBuildTrack?.issueNumber || autonomyBuildTrack?.issue);
  return goalIssue && trackIssue && goalIssue === trackIssue ? autonomyBuildTrack : null;
}

function gateMap(track) {
  return new Map((Array.isArray(track?.gates) ? track.gates : [])
    .map((gate) => [text(gate?.id).toUpperCase(), gate]));
}

function recordFromGate(definition, gate, track) {
  if (!gate) return stageRecord(definition.id, definition.label);
  const state = text(gate.state, 'UNKNOWN').toUpperCase();
  const light = lightForGateState(state);
  return stageRecord(
    definition.id,
    definition.label,
    light,
    light === 'GREEN' ? `${definition.label} handoff proven for this exact goal.` : '',
    gate.reason || (light === 'AMBER' ? `${definition.label} is waiting for downstream proof.` : ''),
    `autonomy-build-track:${text(track?.cycleId || track?.missionId || 'current')}`,
  );
}

function replaceStage(stages, id, replacement) {
  const index = stages.findIndex((stage) => stage.id === id);
  if (index >= 0) stages[index] = replacement;
}

function greenStage(stages, id, proof, source) {
  const definition = GOAL_BUILD_CONVEYOR_STAGES.find((stage) => stage.id === id);
  if (!definition) return;
  replaceStage(stages, id, stageRecord(id, definition.label, 'GREEN', proof, '', source));
}

function amberStage(stages, id, reason, source) {
  const definition = GOAL_BUILD_CONVEYOR_STAGES.find((stage) => stage.id === id);
  if (!definition) return;
  const current = stages.find((stage) => stage.id === id);
  if (current?.trafficLight === 'GREEN' || current?.trafficLight === 'RED') return;
  replaceStage(stages, id, stageRecord(id, definition.label, 'AMBER', '', reason, source));
}

function redStage(stages, id, reason, source) {
  const definition = GOAL_BUILD_CONVEYOR_STAGES.find((stage) => stage.id === id);
  if (!definition) return;
  replaceStage(stages, id, stageRecord(id, definition.label, 'RED', '', reason, source));
}

function firstUnprovenStage(stages) {
  return stages.find((stage) => stage.trafficLight !== 'GREEN') || stages.at(-1);
}

export function projectGoalBuildJourneyV1(goal = {}, autonomyBuildTrack = null) {
  const exactTrack = exactTrackForGoal(goal, autonomyBuildTrack);
  const gates = gateMap(exactTrack);
  const stages = GOAL_BUILD_CONVEYOR_STAGES.map((definition) => {
    if (definition.id === 'GOAL') {
      const truth = text(goal?.statusTruth || goal?.sourceTruth, 'UNKNOWN').toUpperCase();
      const light = truth === 'CURRENT' ? 'GREEN' : truth === 'STALE' ? 'AMBER' : 'GREY';
      return stageRecord(
        definition.id,
        definition.label,
        light,
        light === 'GREEN' ? 'Canonical goal record is current.' : '',
        light === 'AMBER' ? 'Goal record is stale and needs refreshing.' : '',
        text(goal?.source, 'goal-record'),
      );
    }
    const gateId = GATE_BY_STAGE[definition.id];
    return gateId ? recordFromGate(definition, gates.get(gateId), exactTrack) : stageRecord(definition.id, definition.label);
  });

  const goalState = text(goal?.state || goal?.status, 'UNKNOWN').toUpperCase();
  if (stages[0].trafficLight === 'GREEN' && READY_OR_BEYOND.has(goalState)) {
    greenStage(stages, 'READY', `Canonical goal state is ${goalState}.`, 'goal-record');
  }
  if (goal?.selectedForAdmission === true) {
    greenStage(stages, 'SELECTED', 'Logical goal controller selected this goal for admission.', 'stephanos-build-truth');
  }

  const buildState = text(goal?.buildState, 'UNKNOWN').toUpperCase();
  const builder = text(goal?.builder || exactTrack?.providerAdapter, 'UNKNOWN');
  if (buildState === 'BUILDING' && builder !== 'UNKNOWN') {
    greenStage(stages, 'DISPATCHED', `Current build truth binds the goal to ${builder}.`, 'stephanos-build-truth');
    greenStage(stages, 'PICKED_UP', `${builder} is the current execution owner for this goal.`, 'stephanos-build-truth');
    greenStage(stages, 'BUILDING', `Fresh build truth reports BUILDING on ${builder}.`, 'stephanos-build-truth');
  } else if (stages.find((stage) => stage.id === 'PICKED_UP')?.trafficLight === 'GREEN') {
    amberStage(stages, 'BUILDING', 'Builder pickup is proven; waiting for current material-build evidence.', 'autonomy-build-track');
  }

  if (stages.find((stage) => stage.id === 'BUILT')?.trafficLight === 'GREEN') {
    greenStage(stages, 'BUILDING', 'Material build completion proves the builder ran for this exact goal.', 'autonomy-build-track');
  }
  if (stages.find((stage) => stage.id === 'TESTED')?.trafficLight === 'GREEN') {
    greenStage(stages, 'BUILT', 'Focused test completion is downstream proof that the build stage completed.', 'autonomy-build-track');
  }
  if (stages.find((stage) => stage.id === 'COMPLETED')?.trafficLight === 'GREEN') {
    greenStage(stages, 'BUILDING', 'Terminal execution proof confirms the builder ran.', 'autonomy-build-track');
    greenStage(stages, 'BUILT', 'Terminal execution proof confirms build completion.', 'autonomy-build-track');
    greenStage(stages, 'TESTED', 'Terminal execution proof follows the canonical tested stage.', 'autonomy-build-track');
  }

  const exactBlocked = stages.find((stage) => stage.trafficLight === 'RED');
  if (!exactBlocked && buildState === 'BLOCKED') {
    const unresolved = firstUnprovenStage(stages);
    redStage(stages, unresolved?.id || 'READY', text(goal?.buildBlocker || goal?.blockers?.[0], 'Build truth reports this goal blocked.'), 'stephanos-build-truth');
  } else if (buildState === 'HELD' || goal?.bucket === 'parked' || goal?.bucket === 'waitingDependency' || goal?.bucket === 'operatorReady') {
    const unresolved = firstUnprovenStage(stages);
    amberStage(stages, unresolved?.id || 'READY', text(goal?.buildBlocker || goal?.blockers?.[0], 'Goal is waiting before the next build handoff.'), 'goal-build-truth');
  } else if (buildState === 'QUEUED') {
    const unresolved = firstUnprovenStage(stages);
    amberStage(stages, unresolved?.id || 'SELECTED', 'Goal is queued for the next proven handoff.', 'stephanos-build-truth');
  }

  const current = stages.find((stage) => stage.trafficLight === 'RED')
    || stages.find((stage) => stage.trafficLight === 'AMBER')
    || firstUnprovenStage(stages)
    || stages.at(-1);
  const provenStageCount = stages.filter((stage) => stage.proven).length;
  const proofRefs = Object.freeze([...(Array.isArray(goal?.buildProofRefs) ? goal.buildProofRefs : [])]);
  return Object.freeze({
    schemaVersion: GOAL_BUILD_CONVEYOR_SCHEMA,
    goal: canonicalIssue(goal?.issue || goal?.goalId),
    title: text(goal?.title, 'Untitled durable goal'),
    missionId: exactTrack ? text(exactTrack?.missionId) : '',
    builder,
    currentStage: current?.id || 'GOAL',
    currentStageLabel: current?.label || 'Goal',
    currentTrafficLight: current?.trafficLight || 'GREY',
    provenStageCount,
    totalStageCount: stages.length,
    progressPercent: Math.round((provenStageCount / stages.length) * 100),
    exactAutonomyTrackBound: Boolean(exactTrack),
    proofRefs,
    stages: Object.freeze(stages),
    truthBoundary: 'Green means this exact goal has evidence for that handoff. Amber means waiting/held, red means an evidenced blocker, and grey means no proof is available. Proof is never borrowed from another goal.',
  });
}

export function projectGoalBuildConveyorV1(goals = []) {
  const journeys = (Array.isArray(goals) ? goals : [])
    .map((goal) => goal?.buildJourney)
    .filter((journey) => journey?.schemaVersion === GOAL_BUILD_CONVEYOR_SCHEMA);
  const currentStageCounts = {};
  journeys.forEach((journey) => {
    currentStageCounts[journey.currentStage] = (currentStageCounts[journey.currentStage] || 0) + 1;
  });
  return Object.freeze({
    schemaVersion: GOAL_BUILD_CONVEYOR_SCHEMA,
    visibleGoalCount: journeys.length,
    provenToBuilderCount: journeys.filter((journey) => journey.stages.find((stage) => stage.id === 'PICKED_UP')?.proven === true).length,
    buildingCount: journeys.filter((journey) => journey.stages.find((stage) => stage.id === 'BUILDING')?.proven === true && journey.stages.find((stage) => stage.id === 'COMPLETED')?.proven !== true).length,
    completedCount: journeys.filter((journey) => journey.stages.find((stage) => stage.id === 'COMPLETED')?.proven === true).length,
    blockedCount: journeys.filter((journey) => journey.stages.some((stage) => stage.blocked)).length,
    exactTrackBoundCount: journeys.filter((journey) => journey.exactAutonomyTrackBound).length,
    currentStageCounts: Object.freeze(currentStageCounts),
    truthBoundary: 'This is a read-only projection over canonical goal, build-truth, and autonomy-track evidence. It creates no new scheduler, controller, worker, queue, or execution authority.',
  });
}
