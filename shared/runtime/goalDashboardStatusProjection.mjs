import {
  buildConciergeAntiStallMergeLane,
  buildConciergePostMergeSync,
  buildConciergeQueue,
  buildConciergeRoadmap,
} from '../agents/battleBridgeBuildConciergeV2.mjs';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function stringValue(value, fallback = 'unknown') {
  return typeof value === 'string' ? text(value, fallback) : fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableBoolean(value) {
  return value === true || value === false ? value : null;
}

function sha(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function integer(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const SUPPORTED_LINKED_PR_STATES = new Set(['open', 'closed', 'merged', 'unknown']);
const AFFIRMATIVE_EVIDENCE_TOKENS = new Set(['verified', 'green', 'pass', 'passed', 'complete', 'completed', 'success', 'current', 'healthy', 'ready']);
const EVIDENCE_CONTEXT_TOKENS = new Set(['adapter', 'automation', 'browser', 'ci', 'github', 'goal', 'linked', 'local', 'pr', 'proof', 'readonly', 'receipt', 'runtime', 'source', 'status']);
const NEGATIVE_EVIDENCE_TOKENS = new Set(['aborted', 'blocked', 'canceled', 'cancelled', 'denied', 'error', 'expired', 'fail', 'failed', 'failing', 'invalid', 'missing', 'none', 'pending', 'rejected', 'stale', 'stalled', 'stopped', 'timeout', 'unavailable', 'unknown', 'unverified']);
const VERIFIED_RESULT_SOURCES = new Set(['verified-readonly-goal-status-adapter']);
const RECEIPT_IDENTIFIER_PATTERN = /^receipt-(?:\d+|[0-9a-f]{12,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function status(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_LINKED_PR_STATES.has(normalized) ? normalized : 'unknown';
}

function evidenceTokens(value) {
  if (typeof value !== 'string') return [];
  return value.trim().toLowerCase().split(/[-_:]/).filter(Boolean);
}

function tokenEncodesNegativeState(token) {
  if (NEGATIVE_EVIDENCE_TOKENS.has(token)) return true;
  return [...NEGATIVE_EVIDENCE_TOKENS].some((negative) => token.startsWith(negative) && token.length > negative.length);
}

function validReceiptIdentifier(value) {
  return typeof value === 'string' && RECEIPT_IDENTIFIER_PATTERN.test(value.trim().toLowerCase());
}

function affirmativeEvidence(value) {
  const tokens = evidenceTokens(value);
  if (!tokens.length || tokens.some(tokenEncodesNegativeState)) return false;
  if (tokens.length === 1) return AFFIRMATIVE_EVIDENCE_TOKENS.has(tokens[0]);
  if (tokens[0] === 'receipt') {
    const receiptTokens = tokens.slice(1);
    const affirmativeStatus = receiptTokens.some((token) => AFFIRMATIVE_EVIDENCE_TOKENS.has(token))
      && receiptTokens.every((token) => AFFIRMATIVE_EVIDENCE_TOKENS.has(token) || EVIDENCE_CONTEXT_TOKENS.has(token) || /^\d+$/.test(token));
    return affirmativeStatus || validReceiptIdentifier(value);
  }
  return tokens.some((token) => AFFIRMATIVE_EVIDENCE_TOKENS.has(token))
    && tokens.every((token) => AFFIRMATIVE_EVIDENCE_TOKENS.has(token) || EVIDENCE_CONTEXT_TOKENS.has(token) || /^\d+$/.test(token));
}

function receiptDerivedEvidence(value) {
  return evidenceTokens(value).includes('receipt');
}

function currentEvidence(value, automationReceiptVerified) {
  return affirmativeEvidence(value) && (!receiptDerivedEvidence(value) || automationReceiptVerified);
}

function canonicalSource(value) {
  return typeof value === 'string' && VERIFIED_RESULT_SOURCES.has(value.trim().toLowerCase());
}

function parseStrictIsoTimestamp(value) {
  const normalized = stringValue(value, '');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(normalized);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisText = '000', zone, sign, offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second, millis] = [yearText, monthText, dayText, hourText, minuteText, secondText, millisText].map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  if (wallClock.getUTCFullYear() !== year || wallClock.getUTCMonth() !== month - 1 || wallClock.getUTCDate() !== day || wallClock.getUTCHours() !== hour || wallClock.getUTCMinutes() !== minute || wallClock.getUTCSeconds() !== second || wallClock.getUTCMilliseconds() !== millis) return null;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHours = Number(offsetHourText);
    const offsetMins = Number(offsetMinuteText);
    if (offsetHours > 23 || offsetMins > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetMins) * (sign === '+' ? 1 : -1);
  }
  const expected = wallClock.getTime() - offsetMinutes * 60_000;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed === expected ? parsed : null;
}

function freeze(value) {
  return Object.freeze(value);
}

function normalizeOptionalStrings(entries) {
  const normalized = {};
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    normalized[key] = stringValue(value);
  }
  return freeze(normalized);
}

export const GOAL_DASHBOARD_REFRESH_TRUTH = 'MANUAL_REFRESH_REQUIRED';
export const GOAL_DASHBOARD_PROJECTION_SOURCE = 'static-goal-dashboard-seed';
export const GOAL_DASHBOARD_FRESHNESS_WINDOW_MS = 15 * 60 * 1000;
export const GOAL_DASHBOARD_MAX_FUTURE_SKEW_MS = 60 * 1000;

export const STATIC_GOAL_DASHBOARD_GOALS = Object.freeze([
  freeze({ issue: '#1278', title: 'Clean /standalone /scout-coder /scout_coder wiring', status: 'Active', currentOwner: 'Codex', nextOwner: 'OpenClaw', handoffState: 'source command wiring -> local WhatsApp proof', milestone: 'MILESTONE_2_COMMAND_WIRING_IMPLEMENTATION_NEEDED', operatorNeeded: 'No', proofIndex: 2, nextAction: 'Build source-controlled command replacement, then prove real WhatsApp command behavior.' }),
  freeze({ issue: '#1280', title: 'Make /stephanos more alive and useful over WhatsApp', status: 'Active', currentOwner: 'ChatGPT', nextOwner: 'Codex', handoffState: 'awareness contract -> implementation packet', milestone: 'MILESTONE_1_STEPHANOS_ALIVE_LANE_DESIGN_READY', operatorNeeded: 'No', proofIndex: 2, nextAction: 'Define safe awareness sources and compact /stephanos reply contract.' }),
  freeze({ issue: '#1281', title: 'Professional PC ignition splash/autofix/boot concierge', status: 'Waiting for proof', currentOwner: 'OpenClaw', nextOwner: 'Codex', handoffState: 'Windows blocker inventory -> safe launcher implementation', milestone: 'MILESTONE_1_IGNITION_BLOCKER_INVENTORY_READY', operatorNeeded: 'Not yet', proofIndex: 1, nextAction: 'Run bounded Windows ignition inventory before building risky cleanup behavior.' }),
  freeze({ issue: '#1282', title: 'Goal Dashboard landing-page tile', status: 'Waiting for browser proof', currentOwner: 'OpenClaw', nextOwner: 'Operator', handoffState: 'landing tile code -> local browser proof', milestone: 'MILESTONE_2_GOAL_DASHBOARD_LANDING_TILE_IMPLEMENTED', operatorNeeded: 'Proof only', proofIndex: 4, nextAction: 'Launch the Stephanos UI locally and capture DOM/browser proof that Goal Dashboard appears beside existing tiles.' }),
  freeze({ issue: '#1291', title: 'Platform proof projection surfaced in Mission Operations', status: 'Blocked - proof unknown', currentOwner: 'Codex', nextOwner: 'Operator', handoffState: 'canonical projection -> operator-visible proof fields', milestone: 'PLATFORM_STATUS_PROOF_FLOW_VISIBLE', operatorNeeded: 'Manual dispatch explicit', proofIndex: 3, nextAction: 'Keep status blocked until support snapshot, UI reality, and command proof refs are present.' }),
  freeze({ issue: '#1371', title: 'Exact-head merge hold and platform loop proof state', status: 'Manual dispatch required', currentOwner: 'Operator', nextOwner: 'Codex', handoffState: 'missing integration blocker -> manual dispatch', milestone: 'BLOCKED_BY_MISSING_INTEGRATION_VISIBLE', operatorNeeded: 'Yes - dispatch manually', proofIndex: 3, nextAction: 'Do not claim automated dispatch; use manual dispatch until integration capabilities are available.' }),
  freeze({ issue: '#1385', title: 'Live Goal Dashboard index and merge update awareness', status: 'Active', currentOwner: 'GitHub-first ChatGPT', nextOwner: 'CI and review', handoffState: 'projection contract -> draft PR proof', milestone: 'V2_CANONICAL_GOAL_INDEX_PROJECTION_READY', operatorNeeded: 'No', proofIndex: 1, nextAction: 'Build the honest linked-PR projection contract and keep unavailable live sources explicitly unknown.' }),
  freeze({ issue: '#1568', title: 'Canonical execution receipts for implementation workers', status: 'Remediation isolated', currentOwner: 'Security repair lane', nextOwner: 'Independent review', handoffState: 'PR #1581 review repair -> exact-head approval', milestone: 'APP_BOUND_REQUIRED_CHECK_REPAIR_PENDING', operatorNeeded: 'No', proofIndex: 0, linkedPr: freeze({ number: 1581, state: 'open', draft: false, mergeable: true, headSha: '4857085caa008e0bca60a9b5015fdd8a16b2e83e', exactHeadMergeHold: 'blocked-by-unresolved-security-review' }), nextAction: 'Repair PR #1581 independently without blocking unrelated programme building.' }),
  freeze({ issue: '#1574', title: 'Provider-neutral build and review continuity', status: 'Queued', currentOwner: 'Programme Completion Controller', nextOwner: 'GitHub-first worker', handoffState: 'queued policy goal -> later bounded implementation', milestone: 'PROVIDER_NEUTRAL_CONTINUITY_QUEUED', operatorNeeded: 'No', proofIndex: 0, nextAction: 'Keep this queued while the Goal Dashboard product lane advances.' }),
]);

function normalizeLinkedPr(goal = {}) {
  const linkedPr = goal.linkedPr || {};
  return freeze({
    number: integer(linkedPr.number ?? goal.prNumber),
    state: status(linkedPr.state ?? goal.prState),
    draft: nullableBoolean(linkedPr.draft ?? goal.prDraft),
    mergeable: nullableBoolean(linkedPr.mergeable ?? goal.prMergeable),
    headSha: sha(linkedPr.headSha ?? goal.headSha),
    mergeSha: sha(linkedPr.mergeSha ?? goal.mergeSha),
    exactHeadMergeHold: text(linkedPr.exactHeadMergeHold ?? goal.exactHeadMergeHold, 'unknown'),
  });
}

function normalizeProof(goal = {}) {
  const proof = goal.proof || {};
  return normalizeOptionalStrings([
    ['lastProofStatus', proof.lastProofStatus ?? goal.lastProofStatus],
    ['browserProof', proof.browserProof ?? goal.browserProof],
    ['automationReceipt', proof.automationReceipt ?? goal.automationReceipt],
  ]);
}

function normalizeTruth(goal = {}) {
  const truth = goal.truth || {};
  return normalizeOptionalStrings([
    ['github', truth.github ?? goal.githubTruth],
    ['local', truth.local ?? goal.localTruth],
    ['automation', truth.automation ?? goal.automationTruth],
  ]);
}

function normalizeLastUpdated(goal = {}) {
  const updated = goal.lastUpdated || {};
  return freeze({ source: stringValue(updated.source ?? goal.lastUpdatedSource), at: stringValue(updated.at ?? goal.lastUpdatedAt) });
}

function normalizeGoal(goal = {}) {
  const nextAction = text(goal.nextAction, 'Manual refresh required before claiming progress.');
  return freeze({
    issue: text(goal.issue, 'untracked'),
    title: text(goal.title, 'Untitled goal'),
    status: text(goal.status, 'Unknown'),
    currentOwner: text(goal.currentOwner, 'unknown'),
    nextOwner: text(goal.nextOwner, 'unknown'),
    handoffState: text(goal.handoffState, 'unknown'),
    milestone: text(goal.milestone, 'unknown'),
    operatorNeeded: text(goal.operatorNeeded, 'unknown'),
    proofIndex: number(goal.proofIndex, 0),
    linkedPr: normalizeLinkedPr(goal),
    proof: normalizeProof(goal),
    truth: normalizeTruth(goal),
    lastUpdated: normalizeLastUpdated(goal),
    manualRefreshRequired: goal.manualRefreshRequired !== false,
    nextAction,
    nextOperatorAction: text(goal.nextOperatorAction, nextAction),
  });
}

function evidenceEntryCurrent(key, value, automationReceiptVerified) {
  if (key === 'automationReceipt') {
    return automationReceiptVerified && validReceiptIdentifier(value);
  }
  return currentEvidence(value, automationReceiptVerified);
}

function goalHasCurrentEvidence(goal, nowMs, freshnessWindowMs, automationReceiptVerified) {
  const timestampMs = parseStrictIsoTimestamp(goal.lastUpdated.at);
  const ageMs = timestampMs === null ? Number.POSITIVE_INFINITY : nowMs - timestampMs;
  const timestampCurrent = ageMs >= -GOAL_DASHBOARD_MAX_FUTURE_SKEW_MS && ageMs <= freshnessWindowMs;
  const evidenceEntries = [...Object.entries(goal.proof), ...Object.entries(goal.truth)];
  const evidenceCurrent = evidenceEntries.length > 0
    && evidenceEntries.every(([key, value]) => evidenceEntryCurrent(key, value, automationReceiptVerified));
  return goal.manualRefreshRequired === false
    && canonicalSource(goal.lastUpdated.source)
    && timestampCurrent
    && evidenceCurrent;
}

function emptyResultCurrent(input, nowMs, freshnessWindowMs, automationReceiptVerified) {
  if (!input.resultFreshness || typeof input.resultFreshness !== 'object') return false;
  const source = stringValue(input.resultFreshness.source).toLowerCase();
  const at = stringValue(input.resultFreshness.at);
  const evidence = stringValue(input.resultFreshness.evidence);
  const timestampMs = parseStrictIsoTimestamp(at);
  const ageMs = timestampMs === null ? Number.POSITIVE_INFINITY : nowMs - timestampMs;
  return VERIFIED_RESULT_SOURCES.has(source)
    && currentEvidence(evidence, automationReceiptVerified)
    && ageMs >= -GOAL_DASHBOARD_MAX_FUTURE_SKEW_MS
    && ageMs <= freshnessWindowMs;
}

function hasValidatedReceiptEvidence(goals, automationReceiptVerified) {
  return automationReceiptVerified
    && goals.some((goal) => validReceiptIdentifier(goal.proof.automationReceipt));
}

export function buildGoalDashboardStatusProjection(input = {}) {
  const liveGoalCandidates = Array.isArray(input.buildConcierge?.createdGoalCandidates) ? input.buildConcierge.createdGoalCandidates : [];
  const githubAdapterVerified = input.githubAdapter?.verified === true;
  const localAdapterVerified = input.localAdapter?.verified === true;
  const automationReceiptVerified = input.automationReceipt?.verified === true;
  const goals = githubAdapterVerified && Array.isArray(input.goals) ? input.goals : STATIC_GOAL_DASHBOARD_GOALS;
  const requestedNow = typeof input.now === 'number' ? input.now : Date.parse(stringValue(input.now, ''));
  const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const requestedWindow = Number(input.freshnessWindowMs);
  const freshnessWindowMs = Number.isFinite(requestedWindow) && requestedWindow > 0 ? Math.min(requestedWindow, GOAL_DASHBOARD_FRESHNESS_WINDOW_MS) : GOAL_DASHBOARD_FRESHNESS_WINDOW_MS;
  const normalizedGoals = goals.map(normalizeGoal);
  const receiptEvidenceVerified = hasValidatedReceiptEvidence(normalizedGoals, automationReceiptVerified);
  const adaptersCurrent = githubAdapterVerified && localAdapterVerified;
  const goalsCurrent = normalizedGoals.length > 0
    ? normalizedGoals.every((goal) => goalHasCurrentEvidence(goal, nowMs, freshnessWindowMs, automationReceiptVerified))
    : emptyResultCurrent(input, nowMs, freshnessWindowMs, automationReceiptVerified);
  const manualRefreshRequired = !adaptersCurrent || !goalsCurrent;
  const projectionSource = githubAdapterVerified ? stringValue(input.projectionSource, 'verified-readonly-goal-status-adapter') : GOAL_DASHBOARD_PROJECTION_SOURCE;

  return freeze({
    schemaVersion: 'stephanos.goal-dashboard-status-projection.v1',
    projectionSource,
    readOnly: true,
    refreshTruth: manualRefreshRequired ? GOAL_DASHBOARD_REFRESH_TRUTH : 'VERIFIED_READONLY_SOURCES_CURRENT',
    freshnessVerdict: manualRefreshRequired ? 'STALE_REFRESH_REQUIRED' : 'CURRENT_VERIFIED_READONLY_SOURCES',
    freshnessWindowMs,
    liveAutomationClaim: receiptEvidenceVerified ? 'receipt-backed-readonly' : 'none',
    githubTruth: githubAdapterVerified ? 'live-readonly-adapter-verified' : 'not-live-readonly-static-seed',
    localAutomationTruth: localAdapterVerified ? (receiptEvidenceVerified ? 'local-readonly-adapter-and-receipt-verified' : 'local-readonly-adapter-verified') : 'not-live-readonly-static-seed',
    sourceTruth: freeze({ githubVerified: githubAdapterVerified, localVerified: localAdapterVerified, automationReceiptVerified, receiptEvidenceVerified, adaptersCurrent, goalsCurrent }),
    totalGoals: normalizedGoals.length,
    activeGoalCount: normalizedGoals.filter((goal) => /active/i.test(goal.status)).length,
    blockedGoalCount: normalizedGoals.filter((goal) => /blocked/i.test(goal.status)).length,
    linkedPrCount: normalizedGoals.filter((goal) => goal.linkedPr.number !== null).length,
    mergedPrCount: normalizedGoals.filter((goal) => goal.linkedPr.number !== null && goal.linkedPr.state === 'merged').length,
    unknownPrStateCount: normalizedGoals.filter((goal) => goal.linkedPr.number !== null && goal.linkedPr.state === 'unknown').length,
    manualRefreshRequired,
    goals: normalizedGoals,
    buildConcierge: freeze({
      roadmap: buildConciergeRoadmap(input.buildConcierge || {}),
      autoPickTruth: text(input.buildConcierge?.autoPickTruth || input.autoPickTruth, 'supplied-candidate-records-only'),
      postMergeSync: buildConciergePostMergeSync(input.buildConcierge?.postMergeSync || input.postMergeSync || {}),
      liveAdapter: freeze({
        available: input.buildConcierge?.liveAdapter?.available === true,
        route: text(input.buildConcierge?.liveAdapter?.route, '/api/build-concierge/goals'),
        status: input.buildConcierge?.liveAdapter?.available === true ? 'available' : 'blocked_unavailable',
        blockerText: input.buildConcierge?.liveAdapter?.available === true ? '' : 'Build Concierge live adapter unavailable: backend route /api/build-concierge/goals has not returned availability proof; created-goal queue truth remains unknown.',
      }),
      queue: buildConciergeQueue({ ...(input.buildConcierge || {}), goals: [...(Array.isArray(input.buildConcierge?.goals) ? input.buildConcierge.goals : []), ...liveGoalCandidates] }),
      antiStallMergeLane: buildConciergeAntiStallMergeLane(input.buildConcierge?.antiStallMergeLane || input.antiStallMergeLane || {}),
    }),
    nextAction: manualRefreshRequired ? 'Refresh stale goal or adapter truth before making live GitHub/local automation claims.' : 'Render the verified read-only goal and linked-PR projection without inferring unreceipted automation.',
  });
}
