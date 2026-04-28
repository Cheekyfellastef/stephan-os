import {
  createSeedProjectProgressModel,
  getProjectStatusScore,
  normalizeProjectProgressModel,
} from './projectProgressModel.mjs';

const PHASES = Object.freeze([
  { min: 85, id: 'deployment-readiness', label: 'Deployment Readiness' },
  { min: 70, id: 'stabilization', label: 'Stabilization & Hardening' },
  { min: 52, id: 'integration', label: 'Integration Buildout' },
  { min: 0, id: 'foundation', label: 'Foundation & Dependency Closure' },
]);

const DEFAULT_NEXT_ACTIONS = Object.freeze([
  {
    id: 'build-agent-task-layer-v1',
    title: 'Build Agent Task Layer v1',
    reason: 'Required before safe Codex/OpenClaw orchestration.',
    blocks: ['Codex handoff', 'OpenClaw control', 'Verification loop'],
    dependencyImpact: 100,
    whyThisMatters: 'Creates canonical task packet lifecycle so project progress, approvals, and execution are adjudicated from one truth source.',
  },
  {
    id: 'upgrade-agents-tile-status-surface',
    title: 'Upgrade Agents Tile / Agent Status Surface',
    reason: 'Operator needs visual feedback for task state, approvals, and agent progress.',
    blocks: ['Safe multi-agent workflow'],
    dependencyImpact: 82,
    whyThisMatters: 'Without a clear operator surface, supervision and approvals degrade as agent complexity grows.',
  },
  {
    id: 'add-codex-handoff-mode',
    title: 'Add Codex Handoff Mode',
    reason: 'Allows structured task packets to be generated and passed to Codex.',
    blocks: ['Supervised coding task loop'],
    dependencyImpact: 74,
    whyThisMatters: 'Turns free-form summaries into machine-readable handoffs with expectations and evidence links.',
  },
  {
    id: 'add-verification-return-loop',
    title: 'Add Verification Return Loop',
    reason: 'Allows Codex/OpenClaw output to be checked against build, verify, doctrine, and runtime truth.',
    blocks: ['Safe merge/deploy decisions'],
    dependencyImpact: 67,
    whyThisMatters: 'Prevents merges from relying on claimed completion without truth-gated verification evidence.',
  },
  {
    id: 'add-openclaw-policy-harness',
    title: 'Add OpenClaw Policy Harness',
    reason: 'OpenClaw should be controlled as an actuator, not given broad unsupervised authority.',
    blocks: ['Safe UI/browser/local automation'],
    dependencyImpact: 60,
    whyThisMatters: 'Makes automation enforceable, reviewable, and interruptible under mission guardrails.',
  },
]);

function resolvePhase(score) {
  return PHASES.find((phase) => score >= phase.min) || PHASES[PHASES.length - 1];
}

function pickLane(lanes, id) {
  return lanes.find((lane) => lane.id === id) || null;
}

function laneStatusIs(lane, statuses = []) {
  if (!lane) return false;
  return statuses.includes(lane.status);
}

export function adjudicateProjectProgress({
  model = createSeedProjectProgressModel(),
  runtimeStatus = {},
  finalRouteTruth = null,
  orchestrationSelectors = {},
} = {}) {
  const normalized = normalizeProjectProgressModel(model);
  const weightedTotal = normalized.lanes.reduce((sum, lane) => sum + lane.weight, 0);
  const weightedScore = normalized.lanes.reduce((sum, lane) => sum + (getProjectStatusScore(lane.status) * lane.weight), 0);
  const overallReadinessScore = weightedTotal > 0 ? Math.round(weightedScore / weightedTotal) : 0;
  const phase = resolvePhase(overallReadinessScore);

  const codexLane = pickLane(normalized.lanes, 'codex-handoff');
  const openClawLane = pickLane(normalized.lanes, 'openclaw-control');
  const verificationLane = pickLane(normalized.lanes, 'verification-loop');
  const agentTaskLane = pickLane(normalized.lanes, 'agent-task-layer');

  const blockers = normalized.lanes
    .filter((lane) => lane.status === 'blocked' || lane.blockers.length > 0)
    .map((lane) => ({ id: lane.id, title: lane.title, details: lane.blockers.length > 0 ? lane.blockers : ['Blocker details pending.'] }));

  const risks = normalized.lanes
    .filter((lane) => lane.status === 'unknown' || lane.status === 'not-started' || lane.status === 'partial')
    .map((lane) => ({ id: lane.id, title: lane.title, risk: lane.why || 'Risk details pending.' }));

  const nextBestActions = [...DEFAULT_NEXT_ACTIONS].sort((a, b) => b.dependencyImpact - a.dependencyImpact);

  const verificationStatus = {
    buildVerifyScriptsPresent: true,
    taskCompletionBound: laneStatusIs(agentTaskLane, ['partial', 'started', 'mostly-ready', 'ready', 'complete']),
    status: laneStatusIs(verificationLane, ['started', 'partial', 'mostly-ready', 'ready', 'complete']) ? 'started' : 'not-started',
    summary: laneStatusIs(verificationLane, ['started', 'partial', 'mostly-ready', 'ready', 'complete'])
      ? 'Build/verify truth gates exist; task-linked closure loop still needed.'
      : 'Verification loop not started.',
  };

  const doctrineWarnings = [];
  if (laneStatusIs(agentTaskLane, ['not-started', 'unknown'])) {
    doctrineWarnings.push('Agent Task Layer is not canonical yet; keep Codex/OpenClaw orchestration as supervised/manual projection only.');
  }
  if (laneStatusIs(openClawLane, ['blocked', 'not-started', 'partial'])) {
    doctrineWarnings.push('OpenClaw control is not policy-harness ready; do not treat actuator automation as production-safe.');
  }
  if (runtimeStatus?.healthy === true && finalRouteTruth?.launchable !== true) {
    doctrineWarnings.push('Backend reachability is not equivalent to route launchability; continue route truth adjudication.');
  }
  if (orchestrationSelectors?.capabilityPosture?.localAuthorityAvailable !== true && finalRouteTruth?.routeKind === 'localhost') {
    doctrineWarnings.push('Hosted or remote sessions must not inherit localhost authority assumptions.');
  }

  return {
    generatedAt: new Date().toISOString(),
    overallReadinessScore,
    phase,
    lanes: normalized.lanes,
    readiness: {
      codex: codexLane ? codexLane.status : 'unknown',
      agent: agentTaskLane ? agentTaskLane.status : 'unknown',
      openClaw: openClawLane ? openClawLane.status : 'unknown',
    },
    blockers,
    risks,
    recentMilestones: normalized.lanes
      .filter((lane) => lane.lastMilestone)
      .slice(0, 6)
      .map((lane) => ({ id: lane.id, title: lane.title, milestone: lane.lastMilestone })),
    verificationStatus,
    doctrineWarnings,
    nextBestActions,
  };
}
