import { CODEX_QUEUE_STATUS } from './codexDispatchQueue.mjs';
import { createDispatcherDashboard } from './automatedCodexDispatcher.mjs';
import { buildBattleBridgeServiceRegistry, BATTLE_BRIDGE_SERVICE_STATE } from './battleBridgeSupervisor.mjs';
import { projectOpenClawOperatorAutomation } from './openClawCapabilityLadder.mjs';
import { projectCaptainsBridgeBuildOrchestrator, CAPTAINS_BRIDGE_IMPLEMENTED_GUARDED, CAPTAINS_BRIDGE_PLANNED_GUARDED } from './captainsBridgeBuildOrchestrator.mjs';
import { projectCaptainsBridgeMergePipeline } from './captainsBridgeMergePipeline.mjs';
import { projectCaptainsBridgeRuntimeHealth } from './captainsBridgeRuntimeHealth.mjs';
import { projectOperatorTimeline } from './operatorTimeline.mjs';
import { projectWorkspaceAutoDiscovery } from './workspaceAutoDiscovery.mjs';
import { projectSelfExplainingStephanos } from './selfExplainingStephanos.mjs';
import { buildGoalDashboardOperatorAttention } from './goalDashboardOperatorAttention.mjs';

export const LANDING_GOAL_DASHBOARD_SCHEMA_VERSION = 'stephanos.landing-goal-dashboard-projection.v1';
export const LANDING_DASHBOARD_GOALS = Object.freeze([
  ['#1290', 'Shared Agent Workspace'],
  ['#1287', 'Verification Harness'],
  ['#1291', 'Battle Bridge Supervisor'],
  ['#1292', 'Codex Dispatch Queue'],
  ['#1293', 'Automated Codex Dispatcher'],
  ['#1284', 'OpenClaw Capability Ladder'],
  ['#1286', 'OpenClaw Capability Ladder Enablement'],
  ['G10', 'Build Lane Manager'],
  ['G11', 'Live Goal Dashboard'],
  ['G12', 'Professional Ignition Cockpit'],
  ['G13', 'Automatic Build Orchestrator'],
  ['G14', 'Merge Pipeline'],
  ['G15', 'Runtime Health Observatory'],
  ['G16', 'Operator Timeline'],
  ['G17', 'Workspace Auto Discovery'],
  ['G18', 'Visual Mission Control'],
  ['G19', 'Self-Explaining Stephanos'],
]);

export const CAPTAINS_BRIDGE_MILESTONE = Object.freeze({
  id: 'captains-bridge-v1',
  title: "Captain's Bridge V1",
  goal: 'Make Stephan feel like the captain, not the click worker.',
  implementedGoals: ['G10', 'G11', 'G12', ...CAPTAINS_BRIDGE_IMPLEMENTED_GUARDED],
  plannedGoals: [...CAPTAINS_BRIDGE_PLANNED_GUARDED],
  status: 'complete_guarded',
});

const UNKNOWN = 'UNKNOWN';
const STALE = 'STALE';
const CURRENT = 'CURRENT';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function ms(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function freshness(record, nowMs, staleAfterMs) {
  if (!record) return { truth: UNKNOWN, ageMs: null, exactNextAction: 'Publish the missing Shared Workspace status/proof/capability record before claiming live progress.' };
  const timestamp = record.timestampUtc || record.checkedAtUtc || record.publishedAtUtc || record.createdAt;
  const recordMs = ms(timestamp);
  if (!Number.isFinite(recordMs)) return { truth: UNKNOWN, ageMs: null, exactNextAction: 'Republish the record with a valid UTC timestamp before claiming current status.' };
  const ageMs = Math.max(0, nowMs - recordMs);
  if (ageMs > staleAfterMs) return { truth: STALE, ageMs, exactNextAction: 'Refresh the stale Shared Workspace record and attach current proof before advancing.' };
  return { truth: CURRENT, ageMs, exactNextAction: '' };
}

function latestForIssue(records, issue) {
  const normalized = String(issue).replace(/^#/, '').toLowerCase();
  const matchesIssue = (value) => String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .includes(normalized);
  return list(records)
    .filter((record) => [record.relatedIssue, record.relatedGoal, record.issue, record.issueNumber, record.goalId, record.currentClaim, record.correlationId, record.statusId, record.proofId]
      .some(matchesIssue))
    .sort((a, b) => (ms(b.timestampUtc || b.checkedAtUtc || b.createdAt) || 0) - (ms(a.timestampUtc || a.checkedAtUtc || a.createdAt) || 0))[0] || null;
}

function cardFor(issue, title, input, options) {
  // Per-goal truth must be issue-bound. A workspace-wide latest record proves that
  // the feed is fresh, but it cannot prove the status or proof state of every goal.
  const statusRecord = latestForIssue(input.statusRecords, issue);
  const proofRecord = latestForIssue(input.proofRecords, issue);
  const capabilityRecord = latestForIssue(input.capabilityRecords, issue) || (/#1284|#1286/.test(issue) ? input.latest?.capability : null);
  const statusFreshness = freshness(statusRecord, options.nowMs, options.staleAfterMs);
  const proofFreshness = freshness(proofRecord, options.nowMs, options.staleAfterMs);
  const capabilityFreshness = freshness(capabilityRecord, options.nowMs, options.staleAfterMs);
  const proofRefs = list(proofRecord?.refs);
  const blockers = [];
  if (statusFreshness.truth !== CURRENT) blockers.push(`${statusFreshness.truth}_STATUS_RECORD`);
  if (proofFreshness.truth !== CURRENT) blockers.push(`${proofFreshness.truth}_PROOF_RECORD`);
  if ((/#1284|#1286/.test(issue)) && capabilityFreshness.truth !== CURRENT) blockers.push(`${capabilityFreshness.truth}_CAPABILITY_RECORD`);
  return Object.freeze({
    issue,
    title,
    statusTruth: statusFreshness.truth,
    proofTruth: proofFreshness.truth,
    capabilityTruth: /#1284|#1286/.test(issue) ? capabilityFreshness.truth : 'not-required',
    summary: text(statusRecord?.summary || proofRecord?.summary, blockers.length ? 'Live workspace evidence is missing or stale.' : 'Current workspace evidence found.'),
    proofRefs: proofRefs.length ? proofRefs : list(proofRecord?.proofRefs || statusRecord?.proofRefs),
    blockers,
    exactNextAction: blockers.length ? (proofFreshness.exactNextAction || statusFreshness.exactNextAction || capabilityFreshness.exactNextAction) : 'Review current proof refs and continue through approval-gated platform loop.',
  });
}

export function buildLandingGoalDashboardProjection(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : 60 * 60 * 1000;
  const latest = input.sharedWorkspace?.latest || input.latest || {};
  const sourceFreshness = freshness(latest.status || latest.proof || latest.capability, nowMs, staleAfterMs);
  const queueRecords = list(input.queueRecords);
  const dispatcher = input.dispatcherDashboard || createDispatcherDashboard({ queueRecords, dispatcherState: input.dispatcherState, capabilityMode: input.capabilityMode, operatorActionRequired: input.operatorActionRequired });
  const supervisorRecords = list(input.supervisorHealthRecords);
  const serviceRegistry = buildBattleBridgeServiceRegistry({ timestampUtc: input.timestampUtc || 'pending' });
  const supervisorHealth = serviceRegistry.services.map((service) => {
    const record = supervisorRecords.find((candidate) => candidate.serviceId === service.serviceId) || null;
    const state = text(record?.state, BATTLE_BRIDGE_SERVICE_STATE.UNKNOWN);
    const recordFreshness = freshness(record, nowMs, staleAfterMs);
    return Object.freeze({ serviceId: service.serviceId, state: recordFreshness.truth === CURRENT ? state : recordFreshness.truth, reachable: record?.health?.reachable === true, usable: record?.health?.usable === true, browserCompatible: record?.health?.browserCompatible === true, exactNextAction: recordFreshness.truth === CURRENT ? 'Keep monitoring supervisor health records.' : recordFreshness.exactNextAction });
  });
  const openClaw = input.openClawProjection || projectOpenClawOperatorAutomation({ timestampUtc: input.timestampUtc || 'pending' });
  const goals = LANDING_DASHBOARD_GOALS.map(([issue, title]) => cardFor(issue, title, { ...input, latest }, { nowMs, staleAfterMs }));
  const buildOrchestration = projectCaptainsBridgeBuildOrchestrator({ ...input, dispatcherDashboard: dispatcher, battleBridgeSupervisor: { overallState: supervisorHealth.some((s) => ['STALE', 'UNKNOWN', 'FAILED', 'DEGRADED'].includes(s.state)) ? 'ATTENTION_REQUIRED' : 'CURRENT' } });
  const mergePipeline = projectCaptainsBridgeMergePipeline(input.mergePipeline || input);
  const runtimeHealth = projectCaptainsBridgeRuntimeHealth({ ...input, nowMs, staleAfterMs, supervisorHealthRecords: supervisorRecords });
  const operatorTimeline = projectOperatorTimeline({ ...input, timestampUtc: input.timestampUtc, buildLaneManager: input.buildLaneManager, mergePipeline, runtimeHealth, openClawProjection: openClaw });
  const workspaceDiscovery = projectWorkspaceAutoDiscovery({ ...input, nowMs, staleAfterMs });
  const firstOfficerBriefing = projectSelfExplainingStephanos({ buildOrchestration, mergePipeline, runtimeHealth, timeline: operatorTimeline, workspaceDiscovery });
  const captainBridge = Object.freeze({
    milestone: CAPTAINS_BRIDGE_MILESTONE,
    activeLane: input.buildLaneManager?.activeLane || null,
    currentPr: input.buildLaneManager?.activeLane?.prNumber || null,
    branch: input.buildLaneManager?.activeLane?.branch || UNKNOWN,
    exactHead: input.buildLaneManager?.activeLane?.headSha || UNKNOWN,
    latestProof: input.buildLaneManager?.activeLane?.latestProof?.status || input.buildLaneManager?.latestProofState || UNKNOWN,
    blocker: input.buildLaneManager?.activeLane?.blocker || (input.buildLaneManager ? '' : 'BUILD_LANE_MANAGER_FEED_MISSING'),
    nextAction: input.buildLaneManager?.exactNextAction || 'Load Build Lane Manager projection before claiming active lane truth.',
    queueState: input.buildLaneManager?.queueState || dispatcher.dispatcherState || UNKNOWN,
    mergeReadiness: input.buildLaneManager?.mergeReadiness || mergePipeline.phase || 'HELD_UNKNOWN',
    buildOrchestration,
    mergePipeline,
    runtimeHealth,
    operatorTimeline,
    workspaceDiscovery,
    firstOfficerBriefing,
    visualMissionControl: Object.freeze({ timelinePanel: true, workspaceLaneMap: true, runtimeHealthLights: true, mergePipelineSteps: ['PR','PROOF','EXACT_HEAD_APPROVAL','MERGE_RECEIPT','MAIN_SYNC','IGNITION_PROOF','COMPLETE'], orchestrationStatus: buildOrchestration.phase, captainStatusBanner: firstOfficerBriefing.finalVerdict }),
    operatorNeeded: buildOrchestration.signals.OPERATOR_NEEDED || mergePipeline.phase === 'EXACT_HEAD_APPROVAL' || runtimeHealth.overallTrafficLight !== 'GREEN',
    exactNextAction: buildOrchestration.signals.OPERATOR_NEEDED ? buildOrchestration.exactNextAction : (mergePipeline.phase !== 'COMPLETE' ? mergePipeline.exactNextAction : runtimeHealth.exactNextAction),
    consumesSharedProjections: ['Shared Agent Workspace', 'Codex Dispatch Queue', 'Automated Codex Dispatcher', 'Battle Bridge Supervisor', 'Git Branch Intelligence'],
  });
  const blockers = [...new Set(goals.flatMap((goal) => goal.blockers))];
  const operatorAttention = buildGoalDashboardOperatorAttention({
    goals,
    blockers,
    exactNextAction: blockers.length
      ? 'Codex and Housekeeper must publish or refresh missing Shared Workspace status, proof, and capability records; do not claim live proof until records are current.'
      : 'Review any genuine approval-gated next step and keep the dashboard truth-preserving.',
  });
  return Object.freeze({
    schemaVersion: LANDING_GOAL_DASHBOARD_SCHEMA_VERSION,
    kind: 'stephanos.landing_goal_dashboard.projection',
    readOnly: true,
    uiShellAllowed: false,
    uiRepoMutationAllowed: false,
    fakeLiveProofAllowed: false,
    sourceTruth: sourceFreshness.truth,
    goals,
    queueDispatcher: Object.freeze({ queueDepth: dispatcher.queueDepth, currentJob: dispatcher.currentJob || UNKNOWN, dispatcherState: dispatcher.dispatcherState, capabilityMode: dispatcher.capabilityMode, operatorActionRequired: dispatcher.operatorActionRequired, queued: queueRecords.filter((r) => r.status === CODEX_QUEUE_STATUS.QUEUED).length, blocked: queueRecords.filter((r) => r.status === CODEX_QUEUE_STATUS.BLOCKED).length }),
    battleBridgeSupervisor: Object.freeze({ services: supervisorHealth, overallState: supervisorHealth.some((s) => ['STALE', 'UNKNOWN', 'FAILED', 'DEGRADED'].includes(s.state)) ? 'ATTENTION_REQUIRED' : 'CURRENT' }),
    openClawCapabilityLadder: Object.freeze({ canRunNow: openClaw.canRunNow, needsApproval: openClaw.needsApproval, blocked: openClaw.blocked, exactNextAction: openClaw.exactNextAction, guardrails: openClaw.guardrails }),
    captainsBridge: captainBridge,
    operatorAttention,
    finalVerdict: blockers.length ? 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED' : 'LANDING_GOAL_DASHBOARD_CURRENT',
  });
}
