import { createHash } from 'node:crypto';

export const GOAL_COCKPIT_CHAT_SCHEMA_VERSION = 'stephanos.goal-cockpit-chat.v1';
export const GOAL_COCKPIT_CHAT_TRUTH = Object.freeze({
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
  CONFLICT: 'CONFLICT',
});

export const GOAL_COCKPIT_CHAT_WORK_STATES = Object.freeze([
  'BACKLOG',
  'READY',
  'QUEUED',
  'RUNNING',
  'STALLED',
  'BLOCKED',
  'VERIFYING',
  'AWAITING_APPROVAL',
  'MERGE_READY',
  'MERGED',
  'RUNTIME_PROOF',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
]);

const DEFAULT_MAX_CURRENT_AGE_MS = 120_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 30_000;
const DEFAULT_REFRESH_AFTER_MS = 30_000;
const MAX_GOALS = 24;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function unique(values) {
  return [...new Set(list(values).filter(Boolean))];
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampTruth(value, {
  nowMs,
  maxCurrentAgeMs,
  maxFutureSkewMs,
} = {}) {
  const observedMs = timestampMs(value);
  if (observedMs === null) return GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN;
  if (observedMs - nowMs > maxFutureSkewMs) return GOAL_COCKPIT_CHAT_TRUTH.CONFLICT;
  if (nowMs - observedMs > maxCurrentAgeMs) return GOAL_COCKPIT_CHAT_TRUTH.STALE;
  return GOAL_COCKPIT_CHAT_TRUTH.CURRENT;
}

function normalizedTruth(value, fallback = GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN) {
  const normalized = text(value).toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('CONFLICT')) return GOAL_COCKPIT_CHAT_TRUTH.CONFLICT;
  if (normalized.includes('STALE')) return GOAL_COCKPIT_CHAT_TRUTH.STALE;
  if (normalized.includes('CURRENT') || normalized === 'LIVE' || normalized === 'READY' || normalized === 'EMPTY') {
    return GOAL_COCKPIT_CHAT_TRUTH.CURRENT;
  }
  if (normalized.includes('UNKNOWN') || normalized.includes('UNAVAILABLE') || normalized.includes('ERROR')) {
    return GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN;
  }
  return fallback;
}

function normalizedEvidenceTruth(value) {
  const normalized = text(value).toUpperCase().replace(/[\s-]+/g, '_');
  if (!normalized || normalized.includes('UNKNOWN') || normalized.includes('UNAVAILABLE')) {
    return GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN;
  }
  if (normalized.includes('CONFLICT')) return GOAL_COCKPIT_CHAT_TRUTH.CONFLICT;
  if (normalized.includes('STALE')) return GOAL_COCKPIT_CHAT_TRUTH.STALE;
  return GOAL_COCKPIT_CHAT_TRUTH.CURRENT;
}

function worstTruth(values, fallback = GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN) {
  const rank = {
    [GOAL_COCKPIT_CHAT_TRUTH.CURRENT]: 0,
    [GOAL_COCKPIT_CHAT_TRUTH.STALE]: 1,
    [GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN]: 2,
    [GOAL_COCKPIT_CHAT_TRUTH.CONFLICT]: 3,
  };
  const truths = list(values).map((value) => normalizedTruth(value)).filter(Boolean);
  if (!truths.length) return fallback;
  return truths.sort((left, right) => rank[right] - rank[left])[0];
}

function workState(value) {
  const normalized = text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const rules = [
    [/CANCEL/, 'CANCELLED'],
    [/FAIL|REJECT/, 'FAILED'],
    [/COMPLETE|DONE|CLOSED/, 'COMPLETE'],
    [/RUNTIME/, 'RUNTIME_PROOF'],
    [/MERGED/, 'MERGED'],
    [/MERGE_READY|READY_TO_MERGE/, 'MERGE_READY'],
    [/AWAITING.*APPROVAL|OPERATOR.*NEEDED|APPROVAL/, 'AWAITING_APPROVAL'],
    [/VERIFY|PROOF/, 'VERIFYING'],
    [/BLOCK/, 'BLOCKED'],
    [/STALL/, 'STALLED'],
    [/RUNNING|ACTIVE|IN_PROGRESS/, 'RUNNING'],
    [/QUEUE/, 'QUEUED'],
    [/READY/, 'READY'],
    [/BACKLOG|OPEN/, 'BACKLOG'],
  ];
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] || 'UNKNOWN';
}

function parseIssueNumber(card = {}) {
  const direct = Number(card.issueNumber);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = text(card.issue).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function pullRequestNumbers(card = {}) {
  return unique([
    card.linkedPr?.number,
    ...list(card.linkedPrs).map((pr) => pr?.number),
    ...list(card.pullRequests).map((pr) => pr?.number),
    ...list(card.linkedPullRequests).map((pr) => pr?.number),
  ]).map(Number).filter((number) => Number.isInteger(number) && number > 0);
}

function goalId(card = {}, index = 0) {
  const issueNumber = parseIssueNumber(card);
  if (issueNumber) return `issue-${issueNumber}`;
  if (text(card.goalId)) return text(card.goalId);
  if (text(card.candidateId)) return text(card.candidateId);
  const prNumber = pullRequestNumbers(card)[0];
  if (prNumber) return `pr-${prNumber}`;
  return `goal-${index + 1}`;
}

function sharedHeadConflict(card = {}, sharedWorkspaceFeed = {}) {
  const captain = sharedWorkspaceFeed?.projection?.captainsBridge || {};
  const goalPrs = pullRequestNumbers(card);
  const activePr = Number(captain.currentPr);
  if (!goalPrs.length || !Number.isInteger(activePr) || !goalPrs.includes(activePr)) return false;
  const sharedHead = text(captain.exactHead);
  if (!sharedHead || sharedHead === 'UNKNOWN') return false;
  const matchingPr = [
    card.linkedPr,
    ...list(card.linkedPrs),
    ...list(card.pullRequests),
    ...list(card.linkedPullRequests),
  ].find((pr) => Number(pr?.number) === activePr);
  const goalHead = text(matchingPr?.headSha);
  return Boolean(goalHead && goalHead !== sharedHead);
}

function safeBlocker(card = {}) {
  const explicit = list(card.blockers).map((value) => text(value)).find(Boolean);
  if (explicit) return explicit;
  if (/BLOCK|FAIL|REJECT/i.test(text(card.status))) {
    return text(card.status, 'Goal is blocked by current evidence.');
  }
  return null;
}

function goalTruth(card, sharedWorkspaceFeed, timing) {
  if (sharedHeadConflict(card, sharedWorkspaceFeed)) {
    return GOAL_COCKPIT_CHAT_TRUTH.CONFLICT;
  }
  const declared = normalizedTruth(card.statusTruth);
  const evidenceAt = card.lastUpdatedAt || card.updatedAt || card.observedAt;
  const freshness = timestampTruth(evidenceAt, timing);
  const proofTruths = card.proofTruth && typeof card.proofTruth === 'object'
    ? Object.values(card.proofTruth).map(normalizedEvidenceTruth)
    : [];
  return worstTruth([declared, freshness, ...proofTruths]);
}

function mapGoal(card = {}, index, sharedWorkspaceFeed, timing) {
  const issueNumber = parseIssueNumber(card);
  const prs = pullRequestNumbers(card);
  const exactHead = text(card.linkedPr?.headSha) || null;
  const operatorRequired = card.operatorActionRequired === true || /^yes\b/i.test(text(card.operatorNeeded));
  const blocker = safeBlocker(card);
  return Object.freeze({
    id: goalId(card, index),
    issueNumber,
    title: text(card.title, issueNumber ? `Goal #${issueNumber}` : 'Untitled goal'),
    status: text(card.status, 'UNKNOWN'),
    truth: goalTruth(card, sharedWorkspaceFeed, timing),
    workState: workState(card.status),
    currentOwner: text(card.currentOwner, 'Unknown'),
    nextOwner: text(card.nextOwner, operatorRequired ? 'Operator' : 'Unknown'),
    prNumbers: prs,
    exactHead,
    lastEvidenceAt: text(card.lastUpdatedAt || card.updatedAt || card.observedAt) || null,
    blocker,
    nextSafeAction: text(card.nextAction, 'Inspect the canonical goal evidence; unknown stays unknown.'),
    operatorRequired,
    operatorReason: operatorRequired
      ? text(card.operatorReason || card.handoffState || blocker, 'Current evidence requires operator attention.')
      : null,
    proof: Object.freeze({
      github: normalizedTruth(card.proofTruth?.github),
      checks: normalizedTruth(card.proofTruth?.checks),
      review: normalizedTruth(card.proofTruth?.review),
      runtime: normalizedTruth(card.proofTruth?.runtime),
      browser: normalizedTruth(card.proofTruth?.browser),
    }),
  });
}

function sourceError(sourceErrors, source) {
  return list(sourceErrors).find((error) => error?.source === source) || null;
}

function validLiveGoalProjection(liveGoalProjection) {
  return liveGoalProjection?.schemaVersion === 'stephanos.live-goal-projection.v1'
    && typeof liveGoalProjection.dashboardGoals === 'object'
    && Array.isArray(liveGoalProjection.dashboardGoals?.cards)
    && liveGoalProjection.commandExecutionAllowed === false
    && liveGoalProjection.mergeAllowed === false
    && liveGoalProjection.codexDispatchAllowed === false;
}

function liveSourceSystem(liveGoalProjection, sourceErrors, timing) {
  const error = sourceError(sourceErrors, 'live_goal_projection');
  if (error || !validLiveGoalProjection(liveGoalProjection)) {
    return {
      id: 'stephanos',
      truth: GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN,
      observedAt: null,
      detail: error?.message || 'Live goal projection is unavailable or invalid.',
    };
  }
  const observedAt = text(liveGoalProjection.generatedAt);
  return {
    id: 'stephanos',
    truth: timestampTruth(observedAt, timing),
    observedAt: observedAt || null,
    detail: text(liveGoalProjection.finalVerdict, 'Live goal projection returned no verdict.'),
  };
}

function system(id, truth, observedAt, detail) {
  return Object.freeze({
    id,
    truth: normalizedTruth(truth),
    observedAt: text(observedAt) || null,
    detail: text(detail, 'No current evidence supplied.'),
  });
}

function buildSystems(liveGoalProjection = {}, sharedWorkspaceFeed = {}, sourceErrors = [], timing) {
  const liveSystem = liveSourceSystem(liveGoalProjection, sourceErrors, timing);
  const github = liveGoalProjection.githubTelemetry || {};
  const sharedState = sourceError(sourceErrors, 'shared_workspace')
    ? GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN
    : normalizedTruth(sharedWorkspaceFeed.state);
  const missionStatus = liveGoalProjection.missionOperationsStatus || {};
  const githubTruth = github.adapterAvailable === true
    && github.issueInventoryObserved === true
    && github.issueInventoryComplete === true
    && github.pullRequestInventoryObserved === true
    && github.pullRequestInventoryComplete === true
      ? GOAL_COCKPIT_CHAT_TRUTH.CURRENT
      : GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN;
  const agents = liveGoalProjection.currentAgentStates || {};
  return Object.freeze([
    system('stephanos', liveSystem.truth, liveSystem.observedAt, liveSystem.detail),
    system('github', githubTruth, github.observedAt || liveGoalProjection.generatedAt, github.adapterAvailable === true ? 'Verified read-only GitHub adapter.' : 'GitHub adapter evidence is incomplete.'),
    system('shared_workspace', sharedState, null, sharedWorkspaceFeed.reason || sourceError(sourceErrors, 'shared_workspace')?.message),
    system('mission_operations', missionStatus.status, liveGoalProjection.generatedAt, missionStatus.source || missionStatus.status),
    system('battle_bridge', agents.battleBridge?.truth, liveGoalProjection.generatedAt, agents.battleBridge?.state),
    system('codex', agents.codex?.truth, liveGoalProjection.generatedAt, agents.codex?.state),
    system('openclaw', agents.openclaw?.truth, liveGoalProjection.generatedAt, agents.openclaw?.state),
  ]);
}

function stableSnapshotId(snapshot) {
  const substantive = {
    schemaVersion: snapshot.schemaVersion,
    truth: snapshot.truth,
    summary: snapshot.summary,
    priorityAction: snapshot.priorityAction,
    goals: snapshot.goals,
    systems: snapshot.systems.map(({ id, truth, detail }) => ({ id, truth, detail })),
    guardrails: snapshot.guardrails,
  };
  return createHash('sha256').update(JSON.stringify(substantive)).digest('hex').slice(0, 24);
}

export function buildGoalCockpitChatProjection(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const nowMs = now.getTime();
  const timing = {
    nowMs,
    maxCurrentAgeMs: Number.isFinite(input.maxCurrentAgeMs)
      ? input.maxCurrentAgeMs
      : DEFAULT_MAX_CURRENT_AGE_MS,
    maxFutureSkewMs: Number.isFinite(input.maxFutureSkewMs)
      ? input.maxFutureSkewMs
      : DEFAULT_MAX_FUTURE_SKEW_MS,
  };
  const liveGoalProjection = input.liveGoalProjection || {};
  const sharedWorkspaceFeed = input.sharedWorkspaceFeed || {};
  const canonicalCockpitProjection = input.canonicalCockpitProjection || {};
  const sourceErrors = list(input.sourceErrors);
  const authoritativeCards = liveGoalProjection?.dashboardGoals?.cards;
  const goals = Array.isArray(authoritativeCards)
    ? authoritativeCards.slice(0, MAX_GOALS).map((card, index) => mapGoal(card, index, sharedWorkspaceFeed, timing))
    : [];
  const systems = buildSystems(liveGoalProjection, sharedWorkspaceFeed, sourceErrors, timing);
  const liveTruth = systems.find((entry) => entry.id === 'stephanos')?.truth || GOAL_COCKPIT_CHAT_TRUTH.UNKNOWN;
  const goalTruths = goals.map((goal) => goal.truth);
  const truth = worstTruth([liveTruth, ...goalTruths], liveTruth);
  const summary = Object.freeze({
    totalGoals: goals.length,
    activePrs: unique(goals.flatMap((goal) => goal.prNumbers)).length,
    blocked: goals.filter((goal) => ['BLOCKED', 'FAILED', 'STALLED'].includes(goal.workState)).length,
    ready: goals.filter((goal) => ['READY', 'MERGE_READY'].includes(goal.workState)).length,
    operatorAttention: goals.filter((goal) => goal.operatorRequired).length,
  });
  const projection = {
    schemaVersion: GOAL_COCKPIT_CHAT_SCHEMA_VERSION,
    snapshotId: '',
    sourceSchemaVersion: text(liveGoalProjection.schemaVersion, 'UNKNOWN'),
    sourceGeneratedAt: text(liveGoalProjection.generatedAt) || null,
    receivedAt: now.toISOString(),
    truth,
    summary,
    currentMission: text(canonicalCockpitProjection.currentMission, goals[0]?.title || 'No current goal estate returned.'),
    currentStatus: text(canonicalCockpitProjection.currentStatus, text(liveGoalProjection.finalVerdict, truth)),
    priorityAction: text(
      canonicalCockpitProjection.nextBestAction,
      liveGoalProjection.nextOperatorAction || liveGoalProjection.dashboardGoals?.nextAction,
    ) || 'Inspect canonical sources; unknown stays unknown.',
    goals: Object.freeze(goals),
    systems,
    guardrails: Object.freeze({
      readOnly: true,
      commandExecutionAllowed: false,
      mergeAllowed: false,
      codexDispatchAllowed: false,
      openClawMutationAllowed: false,
      repoMutationAllowed: false,
    }),
    refreshAfterMs: Number.isFinite(input.refreshAfterMs)
      ? Math.max(15_000, Math.floor(input.refreshAfterMs))
      : DEFAULT_REFRESH_AFTER_MS,
  };
  projection.snapshotId = stableSnapshotId(projection);
  return Object.freeze(projection);
}

export function selectGoalCockpitDetail(snapshot = {}, goalIdValue = '') {
  const requested = text(goalIdValue);
  const goal = list(snapshot.goals).find((candidate) => candidate.id === requested);
  if (!goal) return null;
  return Object.freeze({
    schemaVersion: GOAL_COCKPIT_CHAT_SCHEMA_VERSION,
    snapshotId: text(snapshot.snapshotId),
    goal,
    guardrails: snapshot.guardrails,
  });
}
