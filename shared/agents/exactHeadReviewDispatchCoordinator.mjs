import {
  INDEPENDENT_REVIEW_JOB,
  PROTECTED_REVIEW_MARKER,
  parseIndependentReviewSessionId,
  validateTrustedProtectedReviewReceipt,
} from './operatorMergeApprovalGate.mjs';
import {
  validateExactHeadIndependentReviewRunV1,
} from './exactHeadIndependentReviewRunV1.mjs';

export const EXACT_HEAD_REVIEW_DISPATCH_SCHEMA = 'stephanos.exact-head-review-dispatch.v1';
export const EXACT_HEAD_REVIEW_DISPATCH_VERSION = '1.1.1';

export const REQUIRED_EXACT_HEAD_WORKFLOWS = Object.freeze([
  'OpenClaw GitHub Operator',
  'PR Clean Guard',
  'Build Stephanos UI',
  'Battle Bridge Publisher Proof',
  'Codex Dispatch Queue Proof',
]);

export const REQUIRED_EXACT_HEAD_WORKFLOW_PATHS = Object.freeze({
  'OpenClaw GitHub Operator': '.github/workflows/openclaw-github-operator.yml',
  'PR Clean Guard': '.github/workflows/pr-clean.yml',
  'Build Stephanos UI': '.github/workflows/build-stephanos-ui.yml',
  'Battle Bridge Publisher Proof': '.github/workflows/battle-bridge-publisher-proof.yml',
  'Codex Dispatch Queue Proof': '.github/workflows/codex-dispatch-queue-proof.yml',
});

export const EXACT_HEAD_REVIEW_DECISION = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INELIGIBLE: 'INELIGIBLE',
  WAIT_WORKFLOWS: 'WAIT_WORKFLOWS',
  WAIT_WORKFLOWS_REVIEW_READY: 'WAIT_WORKFLOWS_REVIEW_READY',
  BLOCKED_WORKFLOWS: 'BLOCKED_WORKFLOWS',
  BLOCKED_REVIEW_THREADS: 'BLOCKED_REVIEW_THREADS',
  DISPATCH_REVIEW: 'DISPATCH_REVIEW',
  WAIT_REVIEW_RECEIPT: 'WAIT_REVIEW_RECEIPT',
  ESCALATE_MISSING_RECEIPT: 'ESCALATE_MISSING_RECEIPT',
  STALLED_MISSING_RECEIPT: 'STALLED_MISSING_RECEIPT',
  RECORD_REVIEW_RECEIPT: 'RECORD_REVIEW_RECEIPT',
  REVIEW_RECEIPT_RECORDED: 'REVIEW_RECEIPT_RECORDED',
});

export const EXACT_HEAD_REVIEW_PROGRESS = Object.freeze({
  VERIFIED_ONLY: 'VERIFIED_ONLY',
  WAITING_FOR_WORKFLOWS: 'WAITING_FOR_WORKFLOWS',
  REVIEW_PRECOMPUTED: 'REVIEW_PRECOMPUTED',
  REVIEW_DISPATCHED: 'REVIEW_DISPATCHED',
  WAITING_FOR_RECEIPT: 'WAITING_FOR_RECEIPT',
  STALLED_MISSING_RECEIPT: 'STALLED_MISSING_RECEIPT',
  RECEIPT_RECORDED: 'RECEIPT_RECORDED',
  REVIEW_COMPLETE: 'REVIEW_COMPLETE',
  BLOCKED: 'BLOCKED',
});

export const EXACT_HEAD_REVIEW_MARKERS = Object.freeze({
  AUTO: 'stephanos:exact-head-review:auto:v1',
  DISPATCH: 'stephanos:exact-head-review-dispatch:v1',
  RECEIPT: 'stephanos:exact-head-review-receipt:v1',
  ARTIFACT_INDEX: 'stephanos:independent-review-artifact-index:v1',
  ESCALATION: 'stephanos:exact-head-review-escalation:v1',
});

export const DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS = 10 * 60 * 1000;

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'bot',
  id: 199175422,
});
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});
const POSITIVE_LANE_STATE_PATTERN = /\b(?:sole active implementation lane|single active(?: GitHub)? implementation lane|sole canonical implementation lane|canonical implementation lane|canonical-lane receipt|active lane)\b/gi;
const SELF_REFERENTIAL_LANE_PATTERN = /(?:\bthis\s+(?:existing\s+|current\s+)?(?:draft\s+)?PR\b[^\n.]{0,120}\b(?:sole|single|canonical|active)\b[^\n.]{0,80}\blane\b|\b(?:sole|single|canonical|active)\b[^\n.]{0,100}\blane\b[^\n.]{0,80}\bthis\s+(?:existing\s+|current\s+)?(?:draft\s+)?PR\b)/i;
const SELF_REFERENTIAL_PR_PATTERN = /^\s*(?:[-*]\s*)?(?:this\s+(?:existing\s+|current\s+)?(?:draft\s+)?PR\b|this\s+lane\b)/i;
const NEGATIVE_LANE_STATE_PATTERN = /\bnon[- ]canonical\b|\bqueued\b|\bsuperseded\b|\bno longer\b[^\n.]{0,100}\b(?:canonical|active|sole|single|lane)\b|\bnot\b[^\n.]{0,100}\b(?:canonical|active|sole|single)\b[^\n.]{0,60}\blane\b/i;

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

export function explicitOwnerExactHeadReviewRequest({ event = {}, laneAuthorityLogin = '' } = {}) {
  const authority = normalizedLogin(laneAuthorityLogin);
  const comment = event?.comment && typeof event.comment === 'object' ? event.comment : {};
  const issue = event?.issue && typeof event.issue === 'object' ? event.issue : {};
  const prNumber = Number(issue?.number);
  const author = normalizedLogin(comment?.user?.login);
  const authorType = normalizedLogin(comment?.user?.type);
  const body = commentBody(comment);
  const match = body.match(/^\s*\/stephanos-review\s+([0-9a-f]{40})(?=\s|$)/i);
  const headSha = match?.[1]?.toLowerCase() || '';
  const authorized = Boolean(
    authority
    && issue?.pull_request
    && Number.isSafeInteger(prNumber)
    && prNumber > 0
    && author === authority
    && authorType === 'user'
    && FULL_SHA_PATTERN.test(headSha)
  );
  return Object.freeze({
    authorized,
    prNumber: authorized ? prNumber : null,
    headSha: authorized ? headSha : '',
    commentId: authorized && Number.isSafeInteger(Number(comment?.id)) ? Number(comment.id) : null,
  });
}

export function candidateReviewPrNumbers({ event = {}, manualPrNumber = null } = {}) {
  if (manualPrNumber !== null && manualPrNumber !== undefined) {
    const parsed = Number(manualPrNumber);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('manual review PR number must be a safe positive integer');
    return Object.freeze([parsed]);
  }
  const directNumbers = [
    event?.pull_request?.number,
    event?.issue?.pull_request ? event?.issue?.number : null,
    ...(Array.isArray(event?.workflow_run?.pull_requests)
      ? event.workflow_run.pull_requests.map((pr) => pr?.number)
      : []),
  ].map(Number).filter((number) => Number.isSafeInteger(number) && number > 0);
  return Object.freeze([...new Set(directNumbers)]);
}

export function exactHeadReviewProgress(decision) {
  switch (text(decision)) {
    case EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS:
      return EXACT_HEAD_REVIEW_PROGRESS.WAITING_FOR_WORKFLOWS;
    case EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS_REVIEW_READY:
      return EXACT_HEAD_REVIEW_PROGRESS.REVIEW_PRECOMPUTED;
    case EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW:
      return EXACT_HEAD_REVIEW_PROGRESS.REVIEW_DISPATCHED;
    case EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT:
      return EXACT_HEAD_REVIEW_PROGRESS.WAITING_FOR_RECEIPT;
    case EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT:
    case EXACT_HEAD_REVIEW_DECISION.STALLED_MISSING_RECEIPT:
      return EXACT_HEAD_REVIEW_PROGRESS.STALLED_MISSING_RECEIPT;
    case EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT:
      return EXACT_HEAD_REVIEW_PROGRESS.RECEIPT_RECORDED;
    case EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED:
      return EXACT_HEAD_REVIEW_PROGRESS.REVIEW_COMPLETE;
    default:
      return EXACT_HEAD_REVIEW_PROGRESS.BLOCKED;
  }
}

function itemTimestamp(item) {
  return asTime(item?.createdAt ?? item?.created_at ?? item?.submittedAt ?? item?.submitted_at);
}

function itemCausallyFollows(candidate, precedent) {
  const candidateTime = itemTimestamp(candidate);
  const precedentTime = itemTimestamp(precedent);
  if (candidateTime === null || precedentTime === null) return false;
  if (candidateTime !== precedentTime) return candidateTime > precedentTime;
  const precedentIsComment = precedent?.createdAt !== undefined || precedent?.created_at !== undefined;
  const candidateId = Number(candidate?.id);
  const precedentId = Number(precedent?.id);
  return precedentIsComment
    && Number.isSafeInteger(candidateId)
    && Number.isSafeInteger(precedentId)
    && candidateId > precedentId;
}

function markerComment(comments, kind, headSha, { trustedCoordinatorLogin, notBeforeMs = null, afterItem = null } = {}) {
  const marker = markerFor(kind, headSha);
  return newest((comments || []).filter((comment) => {
    if (!isTrustedCoordinatorActor(comment, trustedCoordinatorLogin)) return false;
    if (!commentBody(comment).includes(marker)) return false;
    if (afterItem && !itemCausallyFollows(comment, afterItem)) return false;
    if (notBeforeMs === null) return true;
    const timestamp = itemTimestamp(comment);
    return timestamp !== null && timestamp >= notBeforeMs;
  }));
}

function reviewedCommitSha(body) {
  const match = text(body).match(/Reviewed commit:\*?\*?\s*`?([0-9a-f]{40})`?(?![0-9a-f])/i);
  return match?.[1]?.toLowerCase() || '';
}

function actorMatches(item, expected) {
  const actor = item?.user ?? item?.author ?? {};
  return normalizedLogin(actor?.login) === expected.login
    && normalizedLogin(actor?.type) === expected.type
    && Number(actor?.id) === expected.id;
}

function isKnownCodexReviewer(item) {
  return actorMatches(item, TRUSTED_CODEX_REVIEWER);
}

function isKnownGitHubActionsReviewer(item) {
  return actorMatches(item, TRUSTED_GITHUB_ACTIONS_REVIEWER);
}

function isTrustedCoordinatorArtifactIndex(item, context = {}) {
  return normalizedLogin((item?.user ?? item?.author ?? {})?.login)
    === normalizedLogin(context.trustedCoordinatorLogin)
    && commentBody(item).includes(`<!-- ${EXACT_HEAD_REVIEW_MARKERS.ARTIFACT_INDEX} -->`);
}

function fencedJsonObjects(body) {
  const objects = [];
  for (const match of text(body).matchAll(/```json\s*([\s\S]*?)```/gi)) {
    try {
      const value = JSON.parse(match[1]);
      if (value && typeof value === 'object' && !Array.isArray(value)) objects.push(value);
    } catch {
      // Malformed display JSON is not review evidence.
    }
  }
  return objects;
}

function providerNeutralReviewReceipt(item, context = {}) {
  if (!isKnownGitHubActionsReviewer(item) && !isTrustedCoordinatorArtifactIndex(item, context)) return null;
  const body = commentBody(item);
  if (!body.includes(PROTECTED_REVIEW_MARKER)) return null;
  const receipt = fencedJsonObjects(body).find((candidate) => (
    candidate?.kind === 'stephanos.provider-neutral.review'
  ));
  const session = parseIndependentReviewSessionId(receipt?.reviewerSessionId);
  if (!receipt || receipt.verdict !== 'clean' || !session) return null;

  const workflowRunId = Number(session.workflowRunId);
  const workflowRunAttempt = Number(session.workflowRunAttempt);
  const workflowId = Number(context.independentReviewWorkflowId);
  const allRuns = Array.isArray(context.independentReviewRuns) ? context.independentReviewRuns : [];
  const run = allRuns.find((candidate) => (
    Number(candidate?.id) === workflowRunId
    && Number(candidate?.run_attempt ?? candidate?.runAttempt) === workflowRunAttempt
  ));
  const jobsByRunId = context.independentReviewJobsByRunId
    && typeof context.independentReviewJobsByRunId === 'object'
    && !Array.isArray(context.independentReviewJobsByRunId)
    ? context.independentReviewJobsByRunId
    : {};
  const jobs = Array.isArray(jobsByRunId[String(workflowRunId)])
    ? jobsByRunId[String(workflowRunId)]
    : [];

  const receiptValidation = validateTrustedProtectedReviewReceipt(receipt, {
    repository: text(context.repository),
    prNumber: Number(context.prNumber),
    branch: text(context.branch),
    expectedHead: text(context.headSha).toLowerCase(),
    workflowRunId,
    workflowRunAttempt,
  });
  if (!receiptValidation.valid || receiptValidation.operatorBootstrapRequired === true) return null;

  const workflowValidation = validateExactHeadIndependentReviewRunV1({
    run: run || {},
    allRuns,
    jobs,
    comments: Array.isArray(context.comments) ? context.comments : [],
    repository: text(context.repository),
    prNumber: Number(context.prNumber),
    expectedHead: text(context.headSha).toLowerCase(),
    expectedBranch: text(context.branch),
    expectedBaseBranch: text(context.baseRef),
    expectedBaseSha: text(context.baseSha).toLowerCase(),
    expectedWorkflowId: workflowId,
    workflowRunId,
    workflowRunAttempt,
  });
  return workflowValidation.valid
    && jobs.some((job) => text(job?.name) === INDEPENDENT_REVIEW_JOB)
    ? receipt
    : null;
}

function providerNeutralReviewMatchesHead(item, context = {}) {
  return Boolean(providerNeutralReviewReceipt(item, context));
}

function reviewMatchesHead(item, context = {}) {
  if (isKnownCodexReviewer(item)) {
    const commitId = text(item?.commitId ?? item?.commit_id);
    if (commitId && sameSha(commitId, context.headSha)) return true;
    return sameSha(reviewedCommitSha(commentBody(item)), context.headSha);
  }
  return providerNeutralReviewMatchesHead(item, context);
}

function latestPrecomputedProviderNeutralReceipt(comments, context) {
  return newest((comments || []).filter((item) => (
    providerNeutralReviewMatchesHead(item, context)
    && itemTimestamp(item) !== null
  )));
}

function latestExternalReceipt(comments, reviews, context, notBeforeMs) {
  return newest([
    ...(comments || []).filter((item) => reviewMatchesHead(item, context)),
    ...(reviews || []).filter((item) => reviewMatchesHead(item, context)),
  ].filter((item) => {
    const timestamp = itemTimestamp(item);
    if (timestamp === null) return false;
    // A protected provider-neutral receipt is already bound to the exact PR,
    // head, base, workflow run and successful review job. It may be computed
    // while CI is still running and consumed once CI becomes green. A generic
    // app review is not exact-base-bound, so it retains the post-workflow rule.
    return providerNeutralReviewMatchesHead(item, context) || timestamp > notBeforeMs;
  }));
}

function latestRunByWorkflow(workflowRuns, headSha, requiredWorkflows) {
  const latestByName = new Map();
  for (const run of workflowRuns || []) {
    const name = text(run?.name);
    const runHead = text(run?.headSha ?? run?.head_sha);
    if (!requiredWorkflows.includes(name) || !sameSha(runHead, headSha)) continue;
    const requiredPath = text(REQUIRED_EXACT_HEAD_WORKFLOW_PATHS[name]);
    const runPath = text(run?.workflowPath ?? run?.path);
    if (requiredPath && runPath !== requiredPath) continue;
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
  const segments = value.split(/\r?\n|(?<=[.!?;])\s+/).map((segment) => segment.trim()).filter(Boolean);
  return segments.some((segment) => {
    const negativeMatch = segment.match(NEGATIVE_LANE_STATE_PATTERN);
    if (!negativeMatch) return false;
    const explicitReferences = [...segment.matchAll(/\bPR\s*#(\d+)\b/gi)].map((match) => ({
      number: Number(match[1]),
      index: match.index ?? 0,
    }));
    const precedingReferences = explicitReferences.filter(({ index }) => index <= (negativeMatch.index ?? 0));
    const subjectReference = precedingReferences.at(-1) ?? explicitReferences[0] ?? null;
    const targetsCurrentPr = subjectReference
      ? subjectReference.number === prNumber
      : SELF_REFERENTIAL_PR_PATTERN.test(segment);
    return targetsCurrentPr;
  });
}

function positiveCanonicalLaneSubjects(value) {
  const subjects = [];
  const segments = value.split(/\r?\n|(?<=[.!?;])\s+/).map((segment) => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    const explicitReferences = [...segment.matchAll(/\bPR\s*#(\d+)\b/gi)].map((match) => ({
      number: Number(match[1]),
      index: match.index ?? 0,
    }));
    for (const positiveMatch of segment.matchAll(POSITIVE_LANE_STATE_PATTERN)) {
      const phraseIndex = positiveMatch.index ?? 0;
      const phraseEnd = phraseIndex + positiveMatch[0].length;
      const prefix = segment.slice(0, phraseIndex);
      const passiveSupersession = prefix.match(/\bPR\s*#(\d+)\b\s+is\s+superseded\s+by\s+PR\s*#(\d+)\b\s*,?\s*(?:and\s+)?(?:is\s+)?(?:the\s+)?$/i);
      if (passiveSupersession) {
        subjects.push(Number(passiveSupersession[2]));
        continue;
      }
      const activeSupersession = prefix.match(/\bPR\s*#(\d+)\b\s+supersedes\s+PR\s*#(\d+)\b\s+and\s+(?:remains\s+|is\s+)?(?:the\s+)?$/i);
      if (activeSupersession) {
        subjects.push(Number(activeSupersession[1]));
        continue;
      }
      const preceding = explicitReferences.filter(({ index }) => index < phraseIndex).at(-1);
      const following = explicitReferences.find(({ index }) => index >= phraseEnd);
      const subject = preceding ?? following ?? null;
      if (subject) subjects.push(subject.number);
    }
  }
  return subjects;
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

  const referencedPrs = positiveCanonicalLaneSubjects(value);
  if (referencedPrs.length) return referencedPrs.every((reference) => reference === prNumber);
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
  const candidatePrNumber = Number(pr.number);
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
    prNumber: Number.isSafeInteger(candidatePrNumber) && candidatePrNumber > 0 ? candidatePrNumber : null,
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
  const ownerExactHeadReviewRequested = input.ownerExactHeadReviewRequested === true;
  const sameRepository = pr.sameRepository === true;
  const open = text(pr.state).toLowerCase() === 'open';
  const baseRef = text(pr.baseRef ?? pr.base_ref);
  if ((!canonicalConfirmed && !ownerExactHeadReviewRequested) || !sameRepository || !open || baseRef !== 'main') {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.INELIGIBLE,
      reason: (!canonicalConfirmed && !ownerExactHeadReviewRequested)
        ? 'canonical implementation lane evidence or exact owner review request is missing'
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

  const comments = Array.isArray(input.comments) ? input.comments : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const reviewContext = {
    repository: text(input.repository),
    prNumber: base.prNumber,
    branch: text(pr.headRef ?? pr.head_ref),
    headSha,
    baseRef,
    baseSha: text(pr.baseSha ?? pr.base_sha),
    independentReviewWorkflowId: input.independentReviewWorkflowId,
    independentReviewRuns: input.independentReviewRuns,
    independentReviewJobsByRunId: input.independentReviewJobsByRunId,
    trustedCoordinatorLogin,
    comments,
  };
  const precomputedReceipt = latestPrecomputedProviderNeutralReceipt(comments, reviewContext);

  if (missingWorkflows.length || pendingWorkflows.length || unboundWorkflows.length) {
    return Object.freeze({
      ...base,
      decision: precomputedReceipt
        ? EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS_REVIEW_READY
        : EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS,
      reason: precomputedReceipt
        ? 'exact-head and exact-base review is precomputed while required workflows finish'
        : 'required exact-head workflows are missing, still running or lack completion timestamps',
      missingWorkflows: Object.freeze(missingWorkflows),
      pendingWorkflows: Object.freeze(pendingWorkflows),
      unboundWorkflows: Object.freeze(unboundWorkflows),
      failedWorkflows: Object.freeze(failedWorkflows),
      reviewReady: Boolean(precomputedReceipt),
      externalReceiptId: precomputedReceipt?.id ?? null,
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

  const workflowsCompletedAtMs = Math.max(...requiredWorkflows.map((name) => {
    const run = latestRuns.get(name);
    return asTime(run?.completedAt ?? run?.completed_at ?? run?.updatedAt ?? run?.updated_at);
  }));
  const externalReceipt = latestExternalReceipt(
    comments,
    reviews,
    reviewContext,
    workflowsCompletedAtMs,
  );
  const externalReceiptTime = itemTimestamp(externalReceipt);
  const unresolvedThreadCount = input.unresolvedThreadCount;
  if (externalReceipt && (!Number.isSafeInteger(unresolvedThreadCount) || unresolvedThreadCount < 0 || unresolvedThreadCount > 0)) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.BLOCKED_REVIEW_THREADS,
      reason: !Number.isSafeInteger(unresolvedThreadCount) || unresolvedThreadCount < 0
        ? 'unresolved review-thread evidence is unavailable at receipt consumption'
        : `${unresolvedThreadCount} unresolved review thread(s) block receipt consumption`,
      unresolvedThreadCount: Number.isSafeInteger(unresolvedThreadCount) && unresolvedThreadCount >= 0
        ? unresolvedThreadCount
        : null,
      reviewReady: true,
      externalReceiptId: externalReceipt?.id ?? null,
    });
  }
  const recordedReceipt = externalReceipt && externalReceiptTime !== null
    ? (commentBody(externalReceipt).includes(markerFor(EXACT_HEAD_REVIEW_MARKERS.RECEIPT, headSha))
      && isTrustedCoordinatorActor(externalReceipt, trustedCoordinatorLogin)
      ? externalReceipt
      : markerComment(comments, EXACT_HEAD_REVIEW_MARKERS.RECEIPT, headSha, {
        trustedCoordinatorLogin,
        notBeforeMs: workflowsCompletedAtMs,
        afterItem: externalReceipt,
      }))
    : null;
  if (externalReceipt && !recordedReceipt) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT,
      reason: 'an authenticated exact-head review receipt exists and needs one durable coordinator receipt',
      actionRequired: true,
      externalReceiptId: externalReceipt.id ?? null,
      externalReceiptTimestamp: externalReceipt.createdAt ?? externalReceipt.created_at ?? externalReceipt.submittedAt ?? externalReceipt.submitted_at ?? null,
      providerNeutralReceipt: providerNeutralReviewReceipt(externalReceipt, reviewContext),
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

  if (escalation) {
    return Object.freeze({
      ...base,
      decision: EXACT_HEAD_REVIEW_DECISION.STALLED_MISSING_RECEIPT,
      reason: 'review dispatch remains without a matching receipt after its bounded escalation',
      dispatchCommentId: dispatch.id ?? null,
      dispatchAgeMs: ageMs,
      escalated: true,
    });
  }

  return Object.freeze({
    ...base,
    decision: EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT,
    reason: 'review dispatch exists and remains inside the bounded receipt window',
    dispatchCommentId: dispatch.id ?? null,
    dispatchAgeMs: ageMs,
    escalated: false,
  });
}

export function buildReviewDispatchComment({ prNumber, headSha, workflowNames = REQUIRED_EXACT_HEAD_WORKFLOWS } = {}) {
  const head = text(headSha).toLowerCase();
  if (!Number.isSafeInteger(Number(prNumber)) || Number(prNumber) <= 0 || !FULL_SHA_PATTERN.test(head)) throw new Error('valid PR number and exact head SHA are required');
  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.DISPATCH, head),
    '## Provider-neutral exact-head review handoff',
    '',
    `Automated bounded review handoff for PR #${Number(prNumber)} at exact head \`${head}\`.`,
    '',
    'All required exact-head workflows succeeded:',
    ...workflowNames.map((name) => `- ${name}`),
    '',
    'The trusted GitHub Actions independent-review lane is expected to publish an authenticated exact-head receipt. This coordinator does not request or consume Codex review capacity.',
    '',
    'Return any current P0/P1/P2 findings with exact file references and explicitly confirm when no unresolved P0 or P1 remains.',
    '',
    'Constraints: read-only review only; do not modify the branch, open another PR or implementation job, merge, mark ready, or touch Battle Bridge/runtime state. Any later head change voids this review.',
  ].join('\n');
}

export function buildReviewReceiptComment({ prNumber, headSha, externalReceiptId = null, providerNeutralReceipt = null } = {}) {
  const head = text(headSha).toLowerCase();
  if (!Number.isSafeInteger(Number(prNumber)) || Number(prNumber) <= 0 || !FULL_SHA_PATTERN.test(head)) throw new Error('valid PR number and exact head SHA are required');
  const lines = [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.RECEIPT, head),
    '## Exact-head review receipt recorded',
    '',
    `PR: #${Number(prNumber)}`,
    `Exact head: \`${head}\``,
    `External review receipt: ${externalReceiptId ?? 'present'}`,
    '',
    'The review was observed after all required workflows succeeded. This receipt does not authorise merge and becomes stale if the PR head changes.',
  ];
  if (providerNeutralReceipt?.kind === 'stephanos.provider-neutral.review') {
    lines.push(
      '',
      `<!-- ${EXACT_HEAD_REVIEW_MARKERS.ARTIFACT_INDEX} -->`,
      PROTECTED_REVIEW_MARKER,
      '```json',
      JSON.stringify(providerNeutralReceipt, null, 2),
      '```',
      '',
      'This is a durable discovery index for the separately validated immutable workflow artifact and grants no merge authority.',
    );
  }
  return lines.join('\n');
}

export function buildMissingReceiptEscalationComment({ prNumber, headSha, timeoutMinutes = 10, dispatchCommentId = null } = {}) {
  const head = text(headSha).toLowerCase();
  if (!Number.isSafeInteger(Number(prNumber)) || Number(prNumber) <= 0 || !FULL_SHA_PATTERN.test(head)) throw new Error('valid PR number and exact head SHA are required');
  return [
    markerFor(EXACT_HEAD_REVIEW_MARKERS.ESCALATION, head),
    '## Exact-head review receipt delay',
    '',
    `PR: #${Number(prNumber)}`,
    `Exact head: \`${head}\``,
    `Dispatch receipt: ${dispatchCommentId ?? 'present'}`,
    `Bounded wait exceeded: ${Number(timeoutMinutes)} minutes`,
    '',
    'One exact-head review handoff was posted, but no matching authenticated provider-neutral or Codex receipt has appeared. Duplicate dispatch is rejected. The Programme Completion Controller should inspect the independent review route; no merge, mark-ready action, implementation dispatch, or runtime mutation is authorised.',
  ].join('\n');
}
