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

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableBoolean(value) {
  return value === true || value === false ? value : null;
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function integer(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  const normalized = text(value);
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const SUPPORTED_LINKED_PR_STATES = new Set(['open', 'closed', 'merged', 'unknown']);
const AFFIRMATIVE_EVIDENCE_PATTERN = /(?:^|[-_:])(verified|green|pass(?:ed)?|complete(?:d)?|success|current|healthy|ready|receipt)(?:$|[-_:])/i;

function status(value) {
  const normalized = text(value, 'unknown').toLowerCase();
  return SUPPORTED_LINKED_PR_STATES.has(normalized) ? normalized : 'unknown';
}

function affirmativeEvidence(value) {
  return typeof value === 'string' && AFFIRMATIVE_EVIDENCE_PATTERN.test(value.trim());
}

function parseStrictIsoTimestamp(value) {
  const normalized = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(normalized);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisText = '000', zone, sign, offsetHourText, offsetMinuteText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText, millisText].map(Number);
  const [year, month, day, hour, minute, second, millis] = parts;
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;

  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  if (
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute ||
    wallClock.getUTCSeconds() !== second ||
    wallClock.getUTCMilliseconds() !== millis
  ) return null;

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
  return freeze({
    lastProofStatus: text(proof.lastProofStatus ?? goal.lastProofStatus, 'unknown'),
    browserProof: text(proof.browserProof ?? goal.browserProof, 'unknown'),
    automationReceipt: text(proof.automationReceipt ?? goal.automationReceipt, 'unknown'),
  });
}

function normalizeTruth(goal = {}) {
  const truth = goal.truth || {};
  return freeze({
    github: text(truth.github ?? goal.githubTruth, 'unknown'),
    local: text(truth.local ?? goal.localTruth, 'unknown'),
    automation: text(truth.automation ?? goal.automationTruth, 'unknown'),
  });
}

function normalizeLastUpdated(goal = {}) {
  const updated = goal.lastUpdated || {};
  return freeze({ source: text(updated.source ?? goal.lastUpdatedSource, 'unknown'), at: text(updated.at ?? goal.lastUpdatedAt, 'unknown') });
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

function goalHasCurrentEvidence(goal, nowMs, freshnessWindowMs) {
  const timestampMs = parseStrictIsoTimestamp(goal.lastUpdated.at);
  const ageMs = timestampMs === null ? Number.POSITIVE_INFINITY : nowMs - timestampMs;
  const timestampCurrent = ageMs >= -GOAL_DASHBOARD_MAX_FUTURE_SKEW_MS && ageMs <= freshnessWindowMs;
  const proofCurrent = Object.values(goal.proof).some(affirmativeEvidence);
  const truthCurrent = Object.values(goal.truth).some(affirmativeEvidence);
  return goal.manualRefreshRequired === false
    && affirmativeEvidence(goal.lastUpdated.source)
    && timestampCurrent
    && (proofCurrent || truthCurrent);
}

export function buildGoalDashboardStatusProjection(input = {}) {
  const liveGoalCandidates = Array.isArray(input.buildConcierge?.createdGoalCandidates) ? input.buildConcierge.createdGoalCandidates : [];
  const goals = Array.isArray(input.goals) && input.goals.length ? input.goals : STATIC_GOAL_DASHBOARD_GOALS;
  const githubAdapterVerified = input.githubAdapter?.verified === true;
  const localAdapterVerified = input.localAdapter?.verified === true;
  const automationReceiptVerified = input.automationReceipt?.verified === true;
  const requestedNow = typeof input.now === 'number' ? input.now : Date.parse(text(input.now));
  const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const requestedWindow = Number(input.freshnessWindowMs);
  const freshnessWindowMs = Number.isFinite(requestedWindow) && requestedWindow > 0 ? requestedWindow : GOAL_DASHBOARD_FRESHNESS_WINDOW_MS;
  const normalizedGoals = goals.map(normalizeGoal);
  const adaptersCurrent = githubAdapterVerified && localAdapterVerified;
  const goalsCurrent = normalizedGoals.every((goal) => goalHasCurrentEvidence(goal, nowMs, freshnessWindowMs));
  const manualRefreshRequired = !adaptersCurrent || !goalsCurrent;

  return freeze({
    schemaVersion: 'stephanos.goal-dashboard-status-projection.v1',
    projectionSource: text(input.projectionSource, githubAdapterVerified ? 'verified-readonly-goal-status-adapter' : GOAL_DASHBOARD_PROJECTION_SOURCE),
    readOnly: true,
    refreshTruth: manualRefreshRequired ? GOAL_DASHBOARD_REFRESH_TRUTH : 'VERIFIED_READONLY_SOURCES_CURRENT',
    freshnessVerdict: manualRefreshRequired ? 'STALE_REFRESH_REQUIRED' : 'CURRENT_VERIFIED_READONLY_SOURCES',
    freshnessWindowMs,
    liveAutomationClaim: automationReceiptVerified ? 'receipt-backed-readonly' : 'none',
    githubTruth: githubAdapterVerified ? 'live-readonly-adapter-verified' : 'not-live-readonly-static-seed',
    localAutomationTruth: localAdapterVerified
      ? (automationReceiptVerified ? 'local-readonly-adapter-and-receipt-verified' : 'local-readonly-adapter-verified')
      : 'not-live-readonly-static-seed',
    sourceTruth: freeze({ githubVerified: githubAdapterVerified, localVerified: localAdapterVerified, automationReceiptVerified, adaptersCurrent, goalsCurrent }),
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
    nextAction: manualRefreshRequired
      ? 'Refresh stale goal or adapter truth before making live GitHub/local automation claims.'
      : 'Render the verified read-only goal and linked-PR projection without inferring unreceipted automation.',
  });
}
