import { createHash } from 'node:crypto';

export const INTEGRATION_BURST_COALESCER_SCHEMA = 'stephanos.integration-burst-coalescer.v1';
export const INTEGRATION_BURST_DECISION = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NO_MAIN_MOVEMENT: 'NO_MAIN_MOVEMENT',
  WAIT_FOR_SETTLE_WINDOW: 'WAIT_FOR_SETTLE_WINDOW',
  RELEASE_REVALIDATION_BATCH: 'RELEASE_REVALIDATION_BATCH',
  URGENT_REVALIDATION: 'URGENT_REVALIDATION',
});

export const INTEGRATION_BURST_URGENCY = Object.freeze({
  ROUTINE: 'ROUTINE',
  OPERATOR_GATE: 'OPERATOR_GATE',
  SECURITY_FINDING: 'SECURITY_FINDING',
  MERGE_QUEUE_FAILURE: 'MERGE_QUEUE_FAILURE',
  RUNTIME_BLOCKER: 'RUNTIME_BLOCKER',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[a-z0-9](?:[a-z0-9._/-]{0,238}[a-z0-9])?$/i;
const SAFE_GOAL = /^#?[0-9]{1,10}$/;
const MAX_OBSERVATIONS = 100;
const MAX_CANDIDATES = 50;
const DEFAULT_SETTLE_WINDOW_MS = 120_000;
const MAX_SETTLE_WINDOW_MS = 15 * 60_000;
const DEFAULT_MAX_BURST_AGE_MS = 10 * 60_000;
const MAX_BURST_AGE_MS = 30 * 60_000;
const URGENT_CLASSES = new Set([
  INTEGRATION_BURST_URGENCY.OPERATOR_GATE,
  INTEGRATION_BURST_URGENCY.SECURITY_FINDING,
  INTEGRATION_BURST_URGENCY.MERGE_QUEUE_FAILURE,
  INTEGRATION_BURST_URGENCY.RUNTIME_BLOCKER,
]);
const CANDIDATE_STATES = new Set([
  'READY_FOR_INTEGRATION',
  'REVIEW_WAITING',
  'REVIEWED',
  'MERGE_READY',
  'APPROVAL_REQUIRED',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sha(value) {
  const candidate = text(value).toLowerCase();
  return FULL_SHA.test(candidate) ? candidate : '';
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : null;
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function normalizeUrgency(value) {
  const urgency = text(value).toUpperCase();
  return Object.values(INTEGRATION_BURST_URGENCY).includes(urgency)
    ? urgency
    : INTEGRATION_BURST_URGENCY.ROUTINE;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function normalizeObservations(input) {
  if (!denseArray(input) || input.length === 0 || input.length > MAX_OBSERVATIONS) return null;
  const rows = [];
  for (const observation of input) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return null;
    const head = sha(observation.head);
    const observedAtMs = timestamp(observation.observedAt);
    if (!head || observedAtMs === null) return null;
    rows.push({
      head,
      observedAt: new Date(observedAtMs).toISOString(),
      observedAtMs,
      urgency: normalizeUrgency(observation.urgency),
      source: text(observation.source) || 'github-main',
    });
  }
  rows.sort((left, right) => left.observedAtMs - right.observedAtMs || left.head.localeCompare(right.head));
  return rows;
}

function normalizeCandidates(input) {
  if (!denseArray(input) || input.length > MAX_CANDIDATES) return null;
  const seenPrs = new Set();
  const seenBranches = new Set();
  const rows = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const prNumber = Number(candidate.prNumber);
    const goalId = text(candidate.goalId);
    const branch = text(candidate.branch);
    const head = sha(candidate.head);
    const baseSha = sha(candidate.baseSha);
    const lastRevalidatedMainHead = candidate.lastRevalidatedMainHead == null
      ? ''
      : sha(candidate.lastRevalidatedMainHead);
    const state = text(candidate.state).toUpperCase();
    const priority = candidate.priority === undefined ? 100 : Number(candidate.priority);
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0
      || !SAFE_GOAL.test(goalId)
      || !SAFE_BRANCH.test(branch)
      || branch.includes('..')
      || !head
      || !baseSha
      || (candidate.lastRevalidatedMainHead != null && !lastRevalidatedMainHead)
      || !CANDIDATE_STATES.has(state)
      || !Number.isSafeInteger(priority)
      || priority < 0
      || priority > 10_000
      || seenPrs.has(prNumber)
      || seenBranches.has(branch.toLowerCase())) {
      return null;
    }
    seenPrs.add(prNumber);
    seenBranches.add(branch.toLowerCase());
    rows.push({
      prNumber,
      goalId,
      branch,
      head,
      baseSha,
      lastRevalidatedMainHead,
      state,
      priority,
      urgency: normalizeUrgency(candidate.urgency),
    });
  }
  return rows.sort((left, right) => (
    left.priority - right.priority
    || left.prNumber - right.prNumber
    || left.branch.localeCompare(right.branch)
  ));
}

function uniqueHeadTimeline(observations) {
  const timeline = [];
  for (const observation of observations) {
    const previous = timeline.at(-1);
    if (previous?.head === observation.head) timeline[timeline.length - 1] = observation;
    else timeline.push(observation);
  }
  return timeline;
}

function receiptId(payload) {
  return `integration-burst-${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 24)}`;
}

function baseResult({ decision, reason, targetMainHead = '', burst = null, candidates = [] }) {
  const identity = {
    decision,
    targetMainHead,
    burstStartAt: burst?.startedAt ?? null,
    burstLastObservedAt: burst?.lastObservedAt ?? null,
    candidatePrs: candidates.map((candidate) => candidate.prNumber),
  };
  return freeze({
    schemaVersion: INTEGRATION_BURST_COALESCER_SCHEMA,
    decision,
    reason,
    targetMainHead: targetMainHead || null,
    burst,
    candidates,
    revalidationCount: candidates.length,
    receiptId: receiptId(identity),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    approvalAuthority: false,
    runtimeMutationAllowed: false,
    destructiveGitAllowed: false,
  });
}

export function planIntegrationBurstRevalidation(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return baseResult({
      decision: INTEGRATION_BURST_DECISION.INVALID_INPUT,
      reason: 'one object input is required',
    });
  }

  const nowMs = timestamp(input.now);
  const settleWindowMs = boundedInteger(
    input.settleWindowMs,
    DEFAULT_SETTLE_WINDOW_MS,
    MAX_SETTLE_WINDOW_MS,
  );
  const maxBurstAgeMs = boundedInteger(
    input.maxBurstAgeMs,
    DEFAULT_MAX_BURST_AGE_MS,
    MAX_BURST_AGE_MS,
  );
  const observations = normalizeObservations(input.mainObservations);
  const candidates = normalizeCandidates(input.candidates);
  if (nowMs === null || settleWindowMs === null || maxBurstAgeMs === null || !observations || !candidates) {
    return baseResult({
      decision: INTEGRATION_BURST_DECISION.INVALID_INPUT,
      reason: 'valid clock, bounded windows, dense observations and unique exact-head candidates are required',
    });
  }
  if (observations.some((observation) => observation.observedAtMs > nowMs + 60_000)) {
    return baseResult({
      decision: INTEGRATION_BURST_DECISION.INVALID_INPUT,
      reason: 'future main observations beyond bounded clock skew are not accepted',
    });
  }

  const timeline = uniqueHeadTimeline(observations);
  const first = timeline[0];
  const latest = timeline.at(-1);
  const burst = freeze({
    observationCount: observations.length,
    distinctHeadCount: new Set(observations.map((observation) => observation.head)).size,
    transitionCount: Math.max(0, timeline.length - 1),
    startedAt: first.observedAt,
    lastObservedAt: latest.observedAt,
    ageMs: Math.max(0, nowMs - first.observedAtMs),
    quietForMs: Math.max(0, nowMs - latest.observedAtMs),
    latestUrgency: latest.urgency,
  });

  const staleCandidates = candidates.filter((candidate) => (
    candidate.baseSha !== latest.head
    || candidate.lastRevalidatedMainHead !== latest.head
  ));
  if (staleCandidates.length === 0) {
    return baseResult({
      decision: INTEGRATION_BURST_DECISION.NO_MAIN_MOVEMENT,
      reason: 'no queued candidate requires revalidation for the latest main head',
      targetMainHead: latest.head,
      burst,
    });
  }

  const urgent = URGENT_CLASSES.has(latest.urgency)
    || staleCandidates.some((candidate) => URGENT_CLASSES.has(candidate.urgency));
  if (urgent) {
    return baseResult({
      decision: INTEGRATION_BURST_DECISION.URGENT_REVALIDATION,
      reason: 'operator, security, merge-queue or runtime gates bypass routine coalescing',
      targetMainHead: latest.head,
      burst,
      candidates: staleCandidates,
    });
  }

  const settled = burst.quietForMs >= settleWindowMs;
  const forcedByAge = burst.ageMs >= maxBurstAgeMs;
  if (!settled && !forcedByAge) {
    return baseResult({
      decision: INTEGRATION_BURST_DECISION.WAIT_FOR_SETTLE_WINDOW,
      reason: 'main is still moving inside the bounded settle window',
      targetMainHead: latest.head,
      burst,
    });
  }

  return baseResult({
    decision: INTEGRATION_BURST_DECISION.RELEASE_REVALIDATION_BATCH,
    reason: forcedByAge && !settled
      ? 'maximum burst age reached; release one bounded revalidation batch'
      : 'main movement settled; revalidate each stale candidate once',
    targetMainHead: latest.head,
    burst,
    candidates: staleCandidates,
  });
}
