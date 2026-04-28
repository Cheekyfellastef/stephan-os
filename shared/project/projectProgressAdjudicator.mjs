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
    id: 'wire-openclaw-kill-switch-and-adapter',
    title: 'Wire OpenClaw Kill Switch + Adapter Contract',
    reason: 'Policy harness exists in policy-only mode; next unmet dependency is kill-switch wiring + adapter execution contract.',
    blocks: ['Safe UI/browser/local automation'],
    dependencyImpact: 60,
    whyThisMatters: 'Keeps OpenClaw policy adjudication shared while preventing policy-only mode from being treated as direct automation.',
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

function normalizeAgentTaskReadinessSummary(summary = {}) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const toText = (value, fallback = 'unknown') => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  const toLower = (value, fallback = 'unknown') => toText(value, fallback).toLowerCase();
  const blockersSource = Array.isArray(source.blockers) ? source.blockers : source.agentTaskLayerBlockers;
  const blockers = Array.isArray(blockersSource)
    ? blockersSource.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const warnings = Array.isArray(source.warnings)
    ? source.warnings.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const evidence = Array.isArray(source.evidence)
    ? source.evidence.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const nextActions = Array.isArray(source.nextActions)
    ? source.nextActions
      .map((entry) => ({
        title: toText(entry?.title, ''),
        reason: toText(entry?.reason, ''),
        blocks: Array.isArray(entry?.blocks) ? entry.blocks.map((item) => toText(item, '')).filter(Boolean) : [],
      }))
      .filter((entry) => entry.title.length > 0)
    : [];
  const nextAgentTaskAction = toText(source.nextAgentTaskAction || nextActions[0]?.title, '');

  return {
    available: Object.keys(source).length > 0,
    systemId: toText(source.systemId, 'agent-task-layer'),
    label: toText(source.label, 'Agent Task Layer'),
    status: toLower(source.status, ''),
    phase: toText(source.phase, 'unknown'),
    agentTaskLayerStatus: toLower(source.agentTaskLayerStatus || source.status),
    codexReadiness: toLower(source.codexReadiness),
    openClawReadiness: toLower(source.openClawReadiness),
    verificationStatus: toLower(source.verificationStatus, 'unknown'),
    verificationReturnStatus: toLower(source.verificationReturnStatus, 'unknown'),
    verificationDecision: toLower(source.verificationDecision, 'not_ready'),
    mergeReadiness: toLower(source.mergeReadiness, 'not_ready'),
    verificationReturnReady: source.verificationReturnReady === true,
    verificationReturnBlockers: Array.isArray(source.verificationReturnBlockers)
      ? source.verificationReturnBlockers.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    verificationReturnWarnings: Array.isArray(source.verificationReturnWarnings)
      ? source.verificationReturnWarnings.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    verificationReturnNextAction: toText(source.verificationReturnNextAction, ''),
    missingRequiredChecks: Array.isArray(source.missingRequiredChecks)
      ? source.missingRequiredChecks.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    highestPriorityGate: toText(source.highestPriorityGate, 'none'),
    nextAgentTaskAction,
    nextActions,
    readinessScore: Number.isFinite(Number(source.readinessScore)) ? Math.max(0, Math.min(100, Number(source.readinessScore))) : null,
    blockers,
    warnings,
    evidence,
  };
}

function resolveAgentTaskActionIndex(nextAgentTaskAction = '') {
  const normalized = String(nextAgentTaskAction || '').trim().toLowerCase();
  if (!normalized) return -1;
  if (normalized.includes('build canonical agent task model')) return 0;
  if (normalized.includes('wire existing agent tile')) return 1;
  if (normalized.includes('codex manual handoff')) return 2;
  if (normalized.includes('verification return state')) return 3;
  if (normalized.includes('openclaw policy harness')) return 4;
  if (normalized.includes('openclaw kill switch')) return 4;
  if (normalized.includes('kill-switch lifecycle')) return 4;
  if (normalized.includes('paste codex result for verification')) return 3;
  return -1;
}

function mapDashboardStatusToProjectStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'preparing') return 'not-started';
  if (normalized === 'started') return 'started';
  if (normalized === 'in_progress') return 'started';
  if (normalized === 'partial') return 'partial';
  if (normalized === 'ready') return 'ready';
  if (normalized === 'complete') return 'complete';
  if (normalized === 'blocked') return 'blocked';
  return 'unknown';
}

function mapCodexReadinessToLaneStatus(readiness = '') {
  const normalized = String(readiness || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'manual_handoff_only') return 'started';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'unavailable') return 'not-started';
  return 'partial';
}

function mapOpenClawReadinessToLaneStatus(readiness = '') {
  const normalized = String(readiness || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (['needs_policy', 'needs_adapter', 'blocked', 'unavailable'].includes(normalized)) return 'blocked';
  return 'partial';
}

function mapVerificationToLaneStatus(verificationStatus = '') {
  const normalized = String(verificationStatus || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'started') return 'started';
  if (normalized === 'partial') return 'partial';
  return 'unknown';
}

export function adjudicateProjectProgress({
  model = createSeedProjectProgressModel(),
  runtimeStatus = {},
  finalRouteTruth = null,
  orchestrationSelectors = {},
  agentTaskReadinessSummary = {},
} = {}) {
  const normalized = normalizeProjectProgressModel(model);
  const agentTaskSummary = normalizeAgentTaskReadinessSummary(agentTaskReadinessSummary);
  const nextAction = agentTaskSummary.nextActions[0] || null;
  const overlayAgentLaneStatus = agentTaskSummary.available
    ? mapDashboardStatusToProjectStatus(agentTaskSummary.status || agentTaskSummary.agentTaskLayerStatus)
    : null;
  const overlayCodexLaneStatus = agentTaskSummary.available
    ? mapCodexReadinessToLaneStatus(agentTaskSummary.codexReadiness)
    : null;
  const overlayOpenClawLaneStatus = agentTaskSummary.available
    ? mapOpenClawReadinessToLaneStatus(agentTaskSummary.openClawReadiness)
    : null;
  const overlayVerificationLaneStatus = agentTaskSummary.available
    ? mapVerificationToLaneStatus(agentTaskSummary.verificationStatus)
    : null;
  const lanes = normalized.lanes.map((lane) => {
    if (lane.id === 'agent-task-layer' && overlayAgentLaneStatus) {
      return {
        ...lane,
        status: overlayAgentLaneStatus,
        why: nextAction?.reason || `Agent Task Layer phase: ${agentTaskSummary.phase}.`,
        blockers: agentTaskSummary.blockers.length > 0 ? agentTaskSummary.blockers : lane.blockers,
        evidence: agentTaskSummary.evidence.length > 0 ? agentTaskSummary.evidence : lane.evidence,
        lastMilestone: nextAction?.title || lane.lastMilestone,
      };
    }
    if (lane.id === 'codex-handoff' && overlayCodexLaneStatus) {
      return {
        ...lane,
        status: overlayCodexLaneStatus,
      };
    }
    if (lane.id === 'openclaw-control' && overlayOpenClawLaneStatus) {
      return {
        ...lane,
        status: overlayOpenClawLaneStatus,
      };
    }
    if (lane.id === 'verification-loop' && overlayVerificationLaneStatus) {
      return {
        ...lane,
        status: overlayVerificationLaneStatus,
      };
    }
    return lane;
  });
  const weightedTotal = lanes.reduce((sum, lane) => sum + lane.weight, 0);
  const weightedScore = lanes.reduce((sum, lane) => sum + (getProjectStatusScore(lane.status) * lane.weight), 0);
  const overallReadinessScore = weightedTotal > 0 ? Math.round(weightedScore / weightedTotal) : 0;
  const phase = resolvePhase(overallReadinessScore);

  const codexLane = pickLane(lanes, 'codex-handoff');
  const openClawLane = pickLane(lanes, 'openclaw-control');
  const verificationLane = pickLane(lanes, 'verification-loop');
  const agentTaskLane = pickLane(lanes, 'agent-task-layer');

  const blockers = lanes
    .filter((lane) => lane.status === 'blocked' || lane.blockers.length > 0)
    .map((lane) => ({ id: lane.id, title: lane.title, details: lane.blockers.length > 0 ? lane.blockers : ['Blocker details pending.'] }));

  const risks = lanes
    .filter((lane) => lane.status === 'unknown' || lane.status === 'not-started' || lane.status === 'partial')
    .map((lane) => ({ id: lane.id, title: lane.title, risk: lane.why || 'Risk details pending.' }));

  const nextBestActions = [...DEFAULT_NEXT_ACTIONS]
    .sort((a, b) => b.dependencyImpact - a.dependencyImpact)
    .filter((action, index) => {
      const nextIndex = resolveAgentTaskActionIndex(agentTaskSummary.nextAgentTaskAction || nextAction?.title);
      if (nextIndex < 0) return true;
      return index >= nextIndex;
    });

  const currentActionIndex = resolveAgentTaskActionIndex(agentTaskSummary.nextAgentTaskAction || nextAction?.title);
  if (agentTaskSummary.available && currentActionIndex >= 3 && agentTaskSummary.verificationReturnReady !== true) {
    nextBestActions.sort((a, b) => (a.id === 'add-verification-return-loop' ? -1 : b.id === 'add-verification-return-loop' ? 1 : 0));
  }
  if (agentTaskSummary.available
    && agentTaskSummary.verificationReturnReady === true
    && ['safe_to_accept', 'needs_review'].includes(agentTaskSummary.verificationDecision)
    && agentTaskSummary.openClawReadiness !== 'ready') {
    nextBestActions.sort((a, b) => (a.id === 'add-openclaw-policy-harness' ? -1 : b.id === 'add-openclaw-policy-harness' ? 1 : 0));
  }

  const verificationStatus = {
    buildVerifyScriptsPresent: true,
    taskCompletionBound: agentTaskSummary.available
      ? ['started', 'partial', 'ready', 'complete'].includes(agentTaskSummary.status || agentTaskSummary.agentTaskLayerStatus)
      : laneStatusIs(agentTaskLane, ['partial', 'started', 'mostly-ready', 'ready', 'complete']),
    status: laneStatusIs(verificationLane, ['started', 'partial', 'mostly-ready', 'ready', 'complete']) ? 'started' : 'not-started',
    summary: laneStatusIs(verificationLane, ['started', 'partial', 'mostly-ready', 'ready', 'complete'])
      ? 'Build/verify truth gates exist; task-linked closure loop still needed.'
      : 'Verification loop not started.',
  };

  const doctrineWarnings = [];
  if (agentTaskSummary.available
    ? ['unknown', 'preparing'].includes(agentTaskSummary.agentTaskLayerStatus)
    : laneStatusIs(agentTaskLane, ['not-started', 'unknown'])) {
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
    lanes,
    readiness: {
      codex: codexLane ? codexLane.status : 'unknown',
      agent: agentTaskSummary.available
        ? agentTaskSummary.agentTaskLayerStatus
        : agentTaskLane
          ? agentTaskLane.status
          : 'unknown',
      openClaw: openClawLane ? openClawLane.status : 'unknown',
    },
    blockers,
    risks,
    recentMilestones: lanes
      .filter((lane) => lane.lastMilestone)
      .slice(0, 6)
      .map((lane) => ({ id: lane.id, title: lane.title, milestone: lane.lastMilestone })),
    verificationStatus,
    doctrineWarnings,
    nextBestActions,
    agentTaskEvidence: agentTaskSummary.available ? agentTaskSummary : null,
  };
}
