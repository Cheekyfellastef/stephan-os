import { buildConciergeAntiStallMergeLane, buildConciergePostMergeSync, buildConciergeQueue, buildConciergeRoadmap } from '../agents/battleBridgeBuildConciergeV2.mjs';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const GOAL_DASHBOARD_REFRESH_TRUTH = 'MANUAL_REFRESH_REQUIRED';
export const GOAL_DASHBOARD_PROJECTION_SOURCE = 'static-goal-dashboard-seed';

export const STATIC_GOAL_DASHBOARD_GOALS = Object.freeze([
  Object.freeze({
    issue: '#1278',
    title: 'Clean /standalone /scout-coder /scout_coder wiring',
    status: 'Active',
    currentOwner: 'Codex',
    nextOwner: 'OpenClaw',
    handoffState: 'source command wiring -> local WhatsApp proof',
    milestone: 'MILESTONE_2_COMMAND_WIRING_IMPLEMENTATION_NEEDED',
    operatorNeeded: 'No',
    proofIndex: 2,
    nextAction: 'Build source-controlled command replacement, then prove real WhatsApp command behavior.',
  }),
  Object.freeze({
    issue: '#1280',
    title: 'Make /stephanos more alive and useful over WhatsApp',
    status: 'Active',
    currentOwner: 'ChatGPT',
    nextOwner: 'Codex',
    handoffState: 'awareness contract -> implementation packet',
    milestone: 'MILESTONE_1_STEPHANOS_ALIVE_LANE_DESIGN_READY',
    operatorNeeded: 'No',
    proofIndex: 2,
    nextAction: 'Define safe awareness sources and compact /stephanos reply contract.',
  }),
  Object.freeze({
    issue: '#1281',
    title: 'Professional PC ignition splash/autofix/boot concierge',
    status: 'Waiting for proof',
    currentOwner: 'OpenClaw',
    nextOwner: 'Codex',
    handoffState: 'Windows blocker inventory -> safe launcher implementation',
    milestone: 'MILESTONE_1_IGNITION_BLOCKER_INVENTORY_READY',
    operatorNeeded: 'Not yet',
    proofIndex: 1,
    nextAction: 'Run bounded Windows ignition inventory before building risky cleanup behavior.',
  }),
  Object.freeze({
    issue: '#1282',
    title: 'Goal Dashboard landing-page tile',
    status: 'Waiting for browser proof',
    currentOwner: 'OpenClaw',
    nextOwner: 'Operator',
    handoffState: 'landing tile code -> local browser proof',
    milestone: 'MILESTONE_2_GOAL_DASHBOARD_LANDING_TILE_IMPLEMENTED',
    operatorNeeded: 'Proof only',
    proofIndex: 4,
    nextAction: 'Launch the Stephanos UI locally and capture DOM/browser proof that Goal Dashboard appears beside existing tiles.',
  }),
  Object.freeze({
    issue: '#1291',
    title: 'Platform proof projection surfaced in Mission Operations',
    status: 'Blocked - proof unknown',
    currentOwner: 'Codex',
    nextOwner: 'Operator',
    handoffState: 'canonical projection -> operator-visible proof fields',
    milestone: 'PLATFORM_STATUS_PROOF_FLOW_VISIBLE',
    operatorNeeded: 'Manual dispatch explicit',
    proofIndex: 3,
    nextAction: 'Keep status blocked until support snapshot, UI reality, and command proof refs are present.',
  }),
  Object.freeze({
    issue: '#1371',
    title: 'Exact-head merge hold and platform loop proof state',
    status: 'Manual dispatch required',
    currentOwner: 'Operator',
    nextOwner: 'Codex',
    handoffState: 'missing integration blocker -> manual dispatch',
    milestone: 'BLOCKED_BY_MISSING_INTEGRATION_VISIBLE',
    operatorNeeded: 'Yes - dispatch manually',
    proofIndex: 3,
    nextAction: 'Do not claim automated dispatch; use manual dispatch until integration capabilities are available.',
  }),
]);

export function buildGoalDashboardStatusProjection(input = {}) {
  const goals = Array.isArray(input.goals) && input.goals.length ? input.goals : STATIC_GOAL_DASHBOARD_GOALS;
  const normalizedGoals = goals.map((goal) => ({
    issue: text(goal.issue, 'untracked'),
    title: text(goal.title, 'Untitled goal'),
    status: text(goal.status, 'Unknown'),
    currentOwner: text(goal.currentOwner, 'unknown'),
    nextOwner: text(goal.nextOwner, 'unknown'),
    handoffState: text(goal.handoffState, 'unknown'),
    milestone: text(goal.milestone, 'unknown'),
    operatorNeeded: text(goal.operatorNeeded, 'unknown'),
    proofIndex: number(goal.proofIndex, 0),
    nextAction: text(goal.nextAction, 'Manual refresh required before claiming progress.'),
  }));

  return Object.freeze({
    schemaVersion: 'stephanos.goal-dashboard-status-projection.v1',
    projectionSource: GOAL_DASHBOARD_PROJECTION_SOURCE,
    readOnly: true,
    refreshTruth: GOAL_DASHBOARD_REFRESH_TRUTH,
    liveAutomationClaim: 'none',
    githubTruth: 'not-live-readonly-static-seed',
    localAutomationTruth: 'not-live-readonly-static-seed',
    totalGoals: normalizedGoals.length,
    activeGoalCount: normalizedGoals.filter((goal) => /active/i.test(goal.status)).length,
    blockedGoalCount: normalizedGoals.filter((goal) => /blocked/i.test(goal.status)).length,
    manualRefreshRequired: true,
    goals: normalizedGoals,
    buildConcierge: Object.freeze({
      roadmap: buildConciergeRoadmap(input.buildConcierge || {}),
      autoPickTruth: text(input.buildConcierge?.autoPickTruth || input.autoPickTruth, 'supplied-candidate-records-only'),
      postMergeSync: buildConciergePostMergeSync(input.buildConcierge?.postMergeSync || input.postMergeSync || {}),
      queue: buildConciergeQueue(input.buildConcierge || {}),
      antiStallMergeLane: buildConciergeAntiStallMergeLane(input.buildConcierge?.antiStallMergeLane || input.antiStallMergeLane || {}),
    }),
    nextAction: 'Refresh the static Goal Dashboard seed manually before making live GitHub/local automation claims.',
  });
}
