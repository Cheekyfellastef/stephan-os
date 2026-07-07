import { CODEX_QUEUE_STATUS } from './codexDispatchQueue.mjs';
import { createDispatcherDashboard } from './automatedCodexDispatcher.mjs';
import { buildBattleBridgeServiceRegistry, BATTLE_BRIDGE_SERVICE_STATE } from './battleBridgeSupervisor.mjs';
import { projectOpenClawOperatorAutomation } from './openClawCapabilityLadder.mjs';

export const LANDING_GOAL_DASHBOARD_SCHEMA_VERSION = 'stephanos.landing-goal-dashboard-projection.v1';
export const LANDING_DASHBOARD_GOALS = Object.freeze([
  ['#1290', 'Shared Agent Workspace'],
  ['#1287', 'Verification Harness'],
  ['#1291', 'Battle Bridge Supervisor'],
  ['#1292', 'Codex Dispatch Queue'],
  ['#1293', 'Automated Codex Dispatcher'],
  ['#1284', 'OpenClaw Capability Ladder'],
  ['#1286', 'OpenClaw Capability Ladder Enablement'],
]);

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
  const normalized = String(issue).replace(/^#/, '');
  return list(records)
    .filter((record) => [record.relatedGoal, record.issue, record.issueNumber, record.goalId, record.currentClaim, record.correlationId]
      .some((value) => String(value || '').includes(normalized)))
    .sort((a, b) => (ms(b.timestampUtc || b.checkedAtUtc || b.createdAt) || 0) - (ms(a.timestampUtc || a.checkedAtUtc || a.createdAt) || 0))[0] || null;
}

function cardFor(issue, title, input, options) {
  const statusRecord = latestForIssue(input.statusRecords, issue) || input.latest?.status || null;
  const proofRecord = latestForIssue(input.proofRecords, issue) || input.latest?.proof || null;
  const capabilityRecord = latestForIssue(input.capabilityRecords, issue) || (/#1284|#1286/.test(issue) ? input.latest?.capability : null);
  const statusFreshness = freshness(statusRecord, options.nowMs, options.staleAfterMs);
  const proofFreshness = freshness(proofRecord, options.nowMs, options.staleAfterMs);
  const capabilityFreshness = freshness(capabilityRecord, options.nowMs, options.staleAfterMs);
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
    proofRefs: list(proofRecord?.refs || proofRecord?.proofRefs || statusRecord?.proofRefs),
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
  const approvals = goals.filter((goal) => goal.issue === '#1286' || goal.issue === '#1293' || goal.blockers.some((blocker) => blocker.includes('UNKNOWN'))).map((goal) => `${goal.issue}: ${goal.exactNextAction}`);
  const blockers = [...new Set(goals.flatMap((goal) => goal.blockers))];
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
    operatorAttention: Object.freeze({ approvals, localProofNeeded: goals.filter((goal) => goal.proofTruth !== CURRENT).map((goal) => goal.issue), blockers, exactNextAction: blockers.length ? 'Publish or refresh missing Shared Workspace status/proof/capability records; do not claim live proof until records are current.' : 'Review approval-gated next step and keep UI read-only.' }),
    finalVerdict: blockers.length ? 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED' : 'LANDING_GOAL_DASHBOARD_CURRENT',
  });
}
