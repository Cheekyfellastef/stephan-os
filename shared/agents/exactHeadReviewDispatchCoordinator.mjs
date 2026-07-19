export const EXACT_HEAD_REVIEW_DISPATCH_SCHEMA = 'stephanos.exact-head-review-dispatch.v1';
export const EXACT_HEAD_REVIEW_DISPATCH_VERSION = '1.0.3';

export const REQUIRED_EXACT_HEAD_WORKFLOWS = Object.freeze([
  'OpenClaw GitHub Operator',
  'PR Clean Guard',
  'Build Stephanos UI',
  'Battle Bridge Publisher Proof',
  'Codex Dispatch Queue Proof',
]);

export const EXACT_HEAD_REVIEW_DECISION = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INELIGIBLE: 'INELIGIBLE',
  WAIT_WORKFLOWS: 'WAIT_WORKFLOWS',
  BLOCKED_WORKFLOWS: 'BLOCKED_WORKFLOWS',
  DISPATCH_REVIEW: 'DISPATCH_REVIEW',
  WAIT_REVIEW_RECEIPT: 'WAIT_REVIEW_RECEIPT',
  ESCALATE_MISSING_RECEIPT: 'ESCALATE_MISSING_RECEIPT',
  RECORD_REVIEW_RECEIPT: 'RECORD_REVIEW_RECEIPT',
  REVIEW_RECEIPT_RECORDED: 'REVIEW_RECEIPT_RECORDED',
});

export const EXACT_HEAD_REVIEW_MARKERS = Object.freeze({
  AUTO: 'stephanos:exact-head-review:auto:v1',
  DISPATCH: 'stephanos:exact-head-review-dispatch:v1',
  RECEIPT: 'stephanos:exact-head-review-receipt:v1',
  ESCALATION: 'stephanos:exact-head-review-escalation:v1',
});

export const DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS = 10 * 60 * 1000;

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'bot',
  id: 199175422,
});
const ACTIVE_LANE_REFERENCE_PATTERN = /\bactive lane:\s*PR\s*#(\d+)\b/gi;
const PR_THEN_LANE_REFERENCE_PATTERN = /\bPR\s*#(\d+)\b(?=[^\n.]{0,120}\b(?:sole|single|canonical|active)\b[^\n.]{0,80}\b(?:implementation|review|github)?\s*lane\b)/gi;
const LANE_THEN_PR_REFERENCE_PATTERN = /\b(?:sole|single|canonical|active)\b[^\n.]{0,100}\b(?:implementation|review|github)?\s*lane\b[^\n.]{0,60}\bPR\s*#(\d+)\b/gi;
const SELF_REFERENTIAL_LANE_PATTERN = /(?:\bthis\s+(?:existing\s+|current\s+)?(?:draft\s+)?PR\b[^\n.]{0,120}\b(?:sole|single|canonical|active)\b[^\n.]{0,80}\blane\b|\b(?:sole|single|canonical|active)\b[^\n.]{0,100}\blane\b[^\n.]{0,80}\bthis\s+(?:existing\s+|current\s+)?(?:draft\s+)?PR\b)/i;
const SELF_REFERENTIAL_PR_PATTERN = /^\s*(?:[-*]\s*)?(?:this\s+(?:existing\s+|current\s+)?(?:draft\s+)?PR\b|this\s+lane\b)/i;
const NEGATIVE_LANE_STATE_PATTERN = /\bnon[- ]canonical\b|\bqueued\b|\bsupersed(?:e|ed|ing)\b|\bno longer\b[^\n.]{0,100}\b(?:canonical|active|sole|single|lane)\b|\bnot\b[^\n.]{0,100}\b(?:canonical|active|sole|single)\b[^\n.]{0,60}\blane\b/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asTime(value) {
  const time = Date.parse(text(value));
  return Number.isFinite(time) ? time : null;
}

function sameSha(left, right) {
  return FULL_SHA_PATTERN.test(text(left))
    && FULL_SHA_PATTERN.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

function markerFor(kind, headSha) {
  return `<!-- ${kind} head=${text(headSha).toLowerCase()} -->`;
}

function commentBody(item) {
  return text(item?.body);
}

function actorLogin(item) {
  return text(item?.user?.login ?? item?.author?.login);
}

function normalizedLogin(value) {
  return text(value).toLowerCase();
}

function isTrustedCoordinatorActor(item, trustedCoordinatorLogin) {
  const trusted = normalizedLogin(trustedCoordinatorLogin);
  return Boolean(trusted) && normalizedLogin(actorLogin(item)) === trusted;
}

function newest(items = []) {
  return [...items].sort((left, right) => (
    (asTime(right?.createdAt ?? right?.created_at ?? right?.submittedAt ?? right?.submitted_at) ?? 0)
      - (asTime(left?.createdAt ?? left?.created_at ?? left?.submittedAt ?? left?.submitted_at) ?? 0)
      || (Number(right?.id) || 0) - (Number(left?.id) || 0)
  ))[0] || null;
}

export function parseOptionalManualPrNumber(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error('STEPHANOS_EXACT_HEAD_REVIEW_PR must be a positive decimal integer when provided');
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('STEPHANOS_EXACT_HEAD_REVIEW_PR must be a safe positive decimal integer');
  }
  return parsed;
}

function itemTimestamp(item) {
  return asTime(item?.createdAt ?? item?.created_at ?? item?.submittedAt ?? item?.submitted_at);
}

function markerComment(comments, kind, headSha, { trustedCoordinatorLogin, notBeforeMs = null } = {}) {
  const marker = markerFor(kind, headSha);
  return newest((comments || []).filter((comment) => {
    if (!isTrustedCoordinatorActor(comment, trustedCoordinatorLogin)) return false;
    if (!commentBody(comment).includes(marker)) return false;
    if (notBeforeMs === null) return true;
    const timestamp = itemTimestamp(comment);
    return timestamp !== null && timestamp >= notBeforeMs;
  }));
}

function reviewedCommitPrefix(body) {
  const match = text(body).match(/Reviewed commit:\*?\*?\s*`?([0-9a-f]{7,40})`?/i);
  return match?.[1]?.toLowerCase() || '';
}

function isKnownCodexReviewer(item) {
  const actor = item?.user ?? item?.author ?? {};
  return normalizedLogin(actor?.login) === TRUSTED_CODEX_REVIEWER.login
    && normalizedLogin(actor?.type) === TRUSTED_CODEX_REVIEWER.type
    && Number(actor?.id) === TRUSTED_CODEX_REVIEWER.id;
}

function reviewMatchesHead(item, headSha) {
  if (!isKnownCodexReviewer(item)) return false;
  const commitId = text(item?.commitId ?? item?.commit_id);
  if (commitId && sameSha(commitId, headSha)) return true;
  const prefix = reviewedCommitPrefix(commentBody(item));
  return prefix.length >= 7 && text(headSha).toLowerCase().startsWith(prefix);
}

function latestExternalReceipt(comments, reviews, headSha, notBeforeMs) {
  return newest([
    ...(comments || []).filter((item) => reviewMatchesHead(item, headSha)),
    ...(reviews || []).filter((item) => reviewMatchesHead(item, headSha)),
  ].filter((item) => {
    const timestamp = itemTimestamp(item);
    return timestamp !== null && timestamp >= notBeforeMs;
  }));
}

function latestRunByWorkflow(workflowRuns, headSha, requiredWorkflows) {
  const latestByName = new Map();
  for (const run of workflowRuns || []) {
    const name = text(run?.name);
    const runHead = text(run?.headSha ?? run?.head_sha);
    if (!requiredWorkflows.includes(name) || !sameSha(runHead, headSha)) continue;
    const prior = latestByName.get(name);
    const priorTime = asTime(prior?.updatedAt ?? prior?.updated_at ?? prior?.createdAt ?? prior?.created_at) ?? 0;
    const runTime = asTime(run?.updatedAt ?? run?.updated_at ?? run?.createdAt ?? run?.created_at) ?? 0;
    const priorAttempt = Number(prior?.runAttempt ?? prior?.run_attempt ?? 0);
    const runAttempt = Number(run?.runAttempt ?? run?.run_attempt ?? 0);
    if (!prior || runTime > priorTime || (runTime === priorTime && runAttempt > priorAttempt)) {
      latestByName.set(name, run);
    }
  }
  return latestByName;
}

function revokesCanonicalLane(value, prNumber) {
  const segments = value.split(/\r?\n|(?<=[.!?])\s+/).map((segment) => segment.trim()).filter(Boolean);
  return segments.some((segment) => {
    if (!NEGATIVE_LANE_STATE_PATTERN.test(segment)) return false;
    const explicitReferences = [...segment.matchAll(/\bPR\s*#(\d+)\b/gi)].map((match) => Number(match[1]));
    const targetsCurrentPr = explicitReferences.length
      ? explicitReferences.includes(prNumber)
      : SELF_REFERENTIAL_PR_PATTERN.test(segment);
    return targetsCurrentPr;
  });
}

function canonicalReviewLaneCommentState(comment, { prNumber: candidatePrNumber, trustedCoordinatorLogin } = {}) {
  const value = commentBody(comment);
  const prNumber = Number(candidatePrNumber);
  if (!value || !Number.isSafeInteger(prNumber) || prNumber <= 0) return null;
  if (!isTrustedCoordinatorActor(comment, trustedCoordinatorLogin)) return null;
  if (value.includes(`<!-- ${EXACT_HEAD_REVIEW_MARKERS.AUTO}`)) return true;
  if (!/Programme Completion Controller/i.test(value)) return null;
  if (revokesCanonicalLane(value, prNumber)) return false;
  if (!/sole active implementation lane|single active(?: GitHub)? implementation lane|sole canonical implementation lane|canonical implementation lane|canonical-lane receipt|active lane:\s*PR\s*#/i.test(value)) return null;

  const referencedPrs = [
    ...value.matchAll(ACTIVE_LANE_REFERENCE_PATTERN),
    ...value.matchAll(PR_THEN_LANE_REFERENCE_PATTERN),
    ...value.matchAll(LANE_THEN_PR_REFERENCE_PATTERN),
  ].map((match) => Number(match[1]));
  if (referencedPrs.length) return referencedPrs.every((reference) => reference === prNumber) || null;
  return SELF_REFERENTIAL_LANE_PATTERN.test(value) || null;
}

export function isCanonicalReviewLaneComment(comment, options = {}) {
  return canonicalReviewLaneCommentState(comment, options) === true;
}

export function canonicalLaneEvidence(comments = [], { prNumber, trustedCoordinatorLogin } = {}) {
  const states = comments.map((comment) => ({
    comment,
    state: canonicalReviewLaneCommentState(comment, { prNumber, trustedCoordinatorLogin }),
  })).filter(({ state }) => state !== null);
  const latestComment = newest(states.map(({ comment }) => comment));
  const latest = states.find(({ comment }) => comment === latestComment) ?? null;
  return Object.freeze({
    confirmed: latest?.state === true,
    revoked: latest?.state === false,
    commentId: latest?.comment?.id ?? null,
    timestamp: latest ? (latest.comment?.createdAt ?? latest.comment?.created_at ?? null) : null,
  });
}

export function evaluateExactHeadReviewDispatch(input = {}) {
  const nowMs = asTime(input.now ?? new Date().toISOString());
  const pr = input.pr || {};
  const headSha = text(pr.headSha ?? pr.head_sha).toLowerCase();
  const requiredWorkflows = Array.isArray(input.requiredWorkflows) && input.requiredWorkflows.length
    ? [...new Set(input.requiredWorkflows.map((value) => text(value)).filter(Boolean))]
    : [...REQUIRED_EXACT_HEAD_WORKFLOWS];
  const receiptTimeoutMs = Number.isFinite(Number(input.receiptTimeoutMs)) && Number(input.receiptTimeoutMs) > 0
    ? Number(input.receiptTimeoutMs)
    : DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS;
  const trustedCoordinatorLogin = normalizedLogin(input.trustedCoordinatorLogin);
  const base = {
    schemaVersion: EXACT_HEAD_REVIEW_DISPATCH_SCHEMA,
    version: EXACT_HEAD_REVIEW_DISPATCH_VERSION,
    prNumber: Number.isInteger(Number(pr.number)) ? Number(pr.number) : null,
    exactHead: headSha,
    requiredWorkflows,
    actionRequired: false,
    duplicateDispatchAllowed: false,
    mergeAllowed: false,
    markReadyAllowed: false,
    implementationDispatchAllowed: false,
  };

  if (nowMs === null || !Number.isInteger(base.prNumber) || !FULL_SHA_PATTERN.test(headSha) || !trustedCoordinatorLogin) {
    return Object.freeze({ ...base, decision: EXACT_HEAD_REVIEW_DECISION.INVALID_INPUT, reason: 'valid time, PR number, exact 40-character head SHA and trusted coordinator login are required' });
  }

  const canonicalConfirmed = input.canonicalLaneConfirmed === true;
  const sameRepository = pr.sameRepository !== false;
  const open = text(pr.state, 'open').toLowerCase() === 'open';
  const baseRef = text(pr.baseRef ?? pr.base_ref, 'main');
  if (!canonicalConfirmed || !sameRepository || !open || baseRef !== 'main') {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.INELIGIBLE,
      reason: !canonicalConfirmed
        ? 'canonical implementation lane evidence is missing'
        : (!sameRepository ? 'cross-repository pull requests are not eligible' : (!open ? 'pull request is not open' : 'pull request does not target main')),
    });
  }

  const latestRuns = latestRunByWorkflow(input.workflowRuns, headSha, requiredWorkflows);
  const missingWorkflows = requiredWorkflows.filter((name) => !latestRuns.has(name));
  const pendingWorkflows = requiredWorkflows.filter((name) => {
    const run = latestRuns.get(name);
    return run && text(run.status).toLowerCase() !== 'completed';
  });
  const failedWorkflows = requiredWorkflows.filter((name) => {
    const run = latestRuns.get(name);
    return run
      && text(run.status).toLowerCase() === 'completed'
      && text(run.conclusion).toLowerCase() !== 'success';
  });
  const unboundWorkflows = requiredWorkflows.filter((name) => {
    const run = latestRuns.get(name);
    return run
      && text(run.status).toLowerCase() === 'completed'
      && text(run.conclusion).toLowerCase() === 'success'
      && asTime(run.completedAt ?? run.completed_at ?? run.updatedAt ?? run.updated_at) === null;
  });

  if (missingWorkflows.length || pendingWorkflows.length || unboundWorkflows.length) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS,
      reason: 'required exact-head workflows are missing, still running or lack completion timestamps',
      missingWorkflows: Object.freeze(missingWorkflows),
      pendingWorkflows: Object.freeze(pendingWorkflows),
      unboundWorkflows: Object.freeze(unboundWorkflows),
      failedWorkflows: Object.freeze(failedWorkflows),
    });
  }

  if (failedWorkflows.length) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.BLOCKED_WORKFLOWS,
      reason: 'one or more required exact-head workflows did not succeed',
      missingWorkflows: Object.freeze([]),
      pendingWorkflows: Object.freeze([]),
      failedWorkflows: Object.freeze(failedWorkflows),
    });
  }

  const comments = Array.isArray(input.comments) ? input.comments : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const workflowsCompletedAtMs = Math.max(...requiredWorkflows.map((name) => {
    const run = latestRuns.get(name);
    return asTime(run?.completedAt ?? run?.completed_at ?? run?.updatedAt ?? run?.updated_at);
  }));
  const externalReceipt = latestExternalReceipt(comments, reviews, headSha, workflowsCompletedAtMs);
  const externalReceiptTime = itemTimestamp(externalReceipt);
  const recordedReceipt = externalReceipt && externalReceiptTime !== null
    ? markerComment(comments, EXACT_HEAD_REVIEW_MARKERS.RECEIPT, headSha, {
      trustedCoordinatorLogin,
      notBeforeMs: Math.max(workflowsCompletedAtMs, externalReceiptTime),
    })
    : null;
  if (externalReceipt && !recordedReceipt) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT,
      reason: 'a Codex exact-head review receipt exists and needs one durable coordinator receipt',
      actionRequired: true,
      externalReceiptId: externalReceipt.id ?? null,
      externalReceiptTimestamp: externalReceipt.createdAt ?? externalReceipt.created_at ?? externalReceipt.submittedAt ?? externalReceipt.submitted_at ?? null,
    });
  }
  if (recordedReceipt) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED,
      reason: 'exact-head review receipt is already durable',
      receiptCommentId: recordedReceipt.id ?? null,
    });
  }

  const dispatch = markerComment(comments, EXACT_HEAD_REVIEW_MARKERS.DISPATCH, headSha, {
    trustedCoordinatorLogin,
    notBeforeMs: workflowsCompletedAtMs,
  });
  if (!dispatch) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW,
      reason: 'all required workflows succeeded and no exact-head review dispatch exists',
      actionRequired: true,
    });
  }

  const dispatchTime = itemTimestamp(dispatch);
  const ageMs = dispatchTime === null ? receiptTimeoutMs : Math.max(0, nowMs - dispatchTime);
  const escalation = markerComment(comments, EXACT_HEAD_REVIEW_MARKERS.ESCALATION, headSha, {
    trustedCoordinatorLogin,
    notBeforeMs: dispatchTime,
  });
  if (ageMs >= receiptTimeoutMs && !escalation) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT,
      reason: 'review dispatch has no matching receipt within the bounded timeout',
      actionRequired: true,
      dispatchCommentId: dispatch.id ?? null,
      dispatchAgeMs: ageMs,
    });
  }

  return Object.freeze({
    ...base,
    decision: EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT,
    reason: escalation
      ? 'missing review receipt has already been escalated once'
      : 'review dispatch exists and remains inside the bounded receipt window',
    dispatchCommentId: dispatch.id ?? null,
    dispatchAgeMs: ageMs,
    escalated: Boolean(escalation),
  });
}

export function buildReviewDispatchComment({ prNumber, headSha, workflowNames = REQUIRED_EXACT_HEAD_WORKFLOWS } = {}) {
  const head = text(headSha).toLowerCase();
  if (!Number.isInteger(Number(prNumber)) || !FULL_SHA_PATTERN.test(head)) throw new Error('valid PR number and exact head SHA are required');
  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.DISPATCH, head),
    '@codex review',
    '',
    `Automated bounded exact-head review request for PR #${Number(prNumber)}.`,
    '',
    `Review exact head \`${head}\` only.`,
    '',
    'All required exact-head workflows succeeded:',
    ...workflowNames.map((name) => `- ${name}`),
    '',
    'Return any current P0/P1/P2 findings with exact file references and explicitly confirm when no unresolved P0 or P1 remains.',
    '',
    'Constraints: read-only review only; do not modify the branch, open another PR or implementation job, merge, mark ready, or touch Battle Bridge/runtime state. Any later head change voids this review.',
  ].join('\n');
}

export function buildReviewReceiptComment({ prNumber, headSha, externalReceiptId = null } = {}) {
  const head = text(headSha).toLowerCase();
  if (!Number.isInteger(Number(prNumber)) || !FULL_SHA_PATTERN.test(head)) throw new Error('valid PR number and exact head SHA are required');
  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.RECEIPT, head),
    '## Exact-head review receipt recorded',
    '',
    `PR: #${Number(prNumber)}`,
    `Exact head: \`${head}\``,
    `External review receipt: ${externalReceiptId ?? 'present'}`,
    '',
    'The review was observed after all required workflows succeeded. This receipt does not authorise merge and becomes stale if the PR head changes.',
  ].join('\n');
}

export function buildMissingReceiptEscalationComment({ prNumber, headSha, timeoutMinutes = 10, dispatchCommentId = null } = {}) {
  const head = text(headSha).toLowerCase();
  if (!Number.isInteger(Number(prNumber)) || !FULL_SHA_PATTERN.test(head)) throw new Error('valid PR number and exact head SHA are required');
  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.ESCALATION, head),
    '## Exact-head review receipt delay',
    '',
    `PR: #${Number(prNumber)}`,
    `Exact head: \`${head}\``,
    `Dispatch receipt: ${dispatchCommentId ?? 'present'}`,
    `Bounded wait exceeded: ${Number(timeoutMinutes)} minutes`,
    '',
    'One exact-head review request was posted, but no matching Codex review receipt has appeared. Duplicate review dispatch is rejected. The Programme Completion Controller should inspect the external review route; no merge, mark-ready action, implementation dispatch, or runtime mutation is authorised.',
  ].join('\n');
}
