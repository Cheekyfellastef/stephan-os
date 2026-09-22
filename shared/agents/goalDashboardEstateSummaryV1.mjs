export const GOAL_DASHBOARD_ESTATE_SUMMARY_SCHEMA = 'stephanos.goal-dashboard-estate-summary.v1';

const TERMINAL_STATES = new Set(['CLOSED', 'COMPLETE', 'COMPLETED', 'DONE', 'MERGED', 'SUPERSEDED', 'CANCELLED']);
const ELIGIBLE_STATES = new Set(['ELIGIBLE', 'READY', 'DISCOVERED', 'SELECTABLE', 'QUEUED']);
const ACTIVE_STATES = new Set(['ACTIVE', 'BUILDING', 'RUNNING', 'SELECTED', 'CLAIMED', 'SOURCE_CHANGED', 'TESTED', 'VERIFYING', 'CHECKS_RUNNING', 'REVIEW_REQUIRED', 'REVIEWING']);
const PARKED_STATES = new Set(['PARKED', 'PARKED_EXACT_BLOCKER', 'BLOCKED', 'SAFE_HOLD', 'SURFACE_BLOCKED_FOR_RUN']);
const WAITING_STATES = new Set(['WAITING', 'WAITING_DEPENDENCY', 'DEPENDENCY_BLOCKED', 'WAITING_PREREQUISITE']);
const OPERATOR_READY_STATES = new Set(['OPERATOR_READY_PARKED', 'APPROVAL_REQUIRED', 'AWAITING_OPERATOR_APPROVAL', 'WAITING_FOR_OPERATOR_APPROVAL']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function canonicalIdentity(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^goal-\d+$/i.test(raw)) return `#${raw.replace(/^goal-/i, '')}`;
  if (/^#?\d+$/.test(raw)) return `#${raw.replace(/^#/, '')}`;
  return raw.toLowerCase();
}

function goalIdentity(record = {}) {
  return canonicalIdentity(record.relatedIssue || record.issue || record.issueNumber || record.relatedGoal || record.goalId);
}

function recordMatchesIdentity(record = {}, identity = '') {
  const expected = canonicalIdentity(identity);
  if (!expected) return false;
  return [record.relatedGoal, record.relatedIssue, record.issue, record.issueNumber, record.goalId, record.correlationId]
    .some((value) => canonicalIdentity(value) === expected);
}

function latestForIdentity(records, identity) {
  return list(records)
    .filter((record) => recordMatchesIdentity(record, identity))
    .sort((left, right) => (timestampMs(right.timestampUtc || right.checkedAtUtc || right.publishedAtUtc || right.createdAt) || 0)
      - (timestampMs(left.timestampUtc || left.checkedAtUtc || left.publishedAtUtc || left.createdAt) || 0))[0] || null;
}

function uniqueLatestGoalRecords(records) {
  const sorted = [...list(records)].sort((left, right) => (timestampMs(right.timestampUtc || right.checkedAtUtc || right.createdAt) || 0)
    - (timestampMs(left.timestampUtc || left.checkedAtUtc || left.createdAt) || 0));
  const seen = new Set();
  const output = [];
  for (const record of sorted) {
    const identity = goalIdentity(record);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    if (TERMINAL_STATES.has(text(record.status, 'UNKNOWN').toUpperCase())) continue;
    output.push(record);
  }
  return output;
}

function bucketForState(value) {
  const state = text(value, 'UNKNOWN').toUpperCase();
  if (OPERATOR_READY_STATES.has(state)) return 'operatorReady';
  if (PARKED_STATES.has(state)) return 'parked';
  if (WAITING_STATES.has(state)) return 'waitingDependency';
  if (ACTIVE_STATES.has(state)) return 'active';
  if (ELIGIBLE_STATES.has(state)) return 'eligible';
  return 'unknown';
}

function proofTruth(record, nowMs, staleAfterMs) {
  if (!record) return 'UNKNOWN';
  const observed = timestampMs(record.timestampUtc || record.checkedAtUtc || record.publishedAtUtc || record.createdAt);
  if (!Number.isFinite(observed)) return 'UNKNOWN';
  return Math.max(0, nowMs - observed) > staleAfterMs ? 'STALE' : 'CURRENT';
}

export function buildGoalDashboardEstateSummary(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : 60 * 60 * 1000;
  const latestGoalRecords = uniqueLatestGoalRecords(input.goalRecords);
  const stateCounts = { eligible: 0, active: 0, parked: 0, waitingDependency: 0, operatorReady: 0, unknown: 0 };
  const proofCounts = { current: 0, stale: 0, unknown: 0 };

  const goals = latestGoalRecords.map((record) => {
    const identity = goalIdentity(record);
    const state = text(record.status, 'UNKNOWN').toUpperCase();
    const bucket = bucketForState(state);
    stateCounts[bucket] += 1;
    const proofRecord = latestForIdentity(input.proofRecords, identity);
    const proof = proofTruth(proofRecord, nowMs, staleAfterMs);
    proofCounts[proof.toLowerCase()] += 1;
    return Object.freeze({
      goalId: identity,
      title: text(record.title, 'Untitled durable goal'),
      state,
      bucket,
      proofTruth: proof,
      summary: text(record.summary, ''),
      nextAction: text(record.nextAction || record.exactNextAction, ''),
      observedAtUtc: text(record.timestampUtc || record.checkedAtUtc || record.createdAt, ''),
      source: 'shared-workspace-goal-record',
    });
  });

  const latestObservedMs = goals.reduce((latest, goal) => Math.max(latest, timestampMs(goal.observedAtUtc) || 0), 0);
  return Object.freeze({
    schemaVersion: GOAL_DASHBOARD_ESTATE_SUMMARY_SCHEMA,
    source: 'SHARED_WORKSPACE_GOAL_RECORDS',
    observedAtUtc: latestObservedMs ? new Date(latestObservedMs).toISOString() : '',
    totalOpenGoals: goals.length,
    stateCounts: Object.freeze({ ...stateCounts }),
    proofCounts: Object.freeze({ ...proofCounts }),
    goals: Object.freeze(goals),
    truthBoundary: 'Counts represent the latest non-terminal Shared Workspace record for each durable goal identity. Missing or stale proof remains explicit and does not reduce the open-goal count.',
  });
}
