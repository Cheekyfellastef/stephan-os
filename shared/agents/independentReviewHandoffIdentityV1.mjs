import {
  parseIndependentReviewHandoffProvenanceV1,
} from './independentReviewHandoffProvenanceV1.mjs';

export const INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA = 'stephanos.independent-review-handoff-identity.v1';
export const EXACT_HEAD_REVIEW_DISPATCH_MARKER = 'stephanos:exact-head-review-dispatch:v1';
export const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  id: 41898282,
});

const FULL_SHA = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

export function exactHeadReviewDispatchMarker(headSha) {
  const head = text(headSha).toLowerCase();
  if (!FULL_SHA.test(head)) throw new Error('exact review head is required');
  return `<!-- ${EXACT_HEAD_REVIEW_DISPATCH_MARKER} head=${head} -->`;
}

export function validateIndependentReviewHandoffIdentityV1(input = {}) {
  const event = input.event;
  const repository = text(input.repository);
  const prNumber = positiveInteger(input.prNumber);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const branch = text(input.branch);

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('issue-comment event is required');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || !prNumber
    || !FULL_SHA.test(sourceHead)
    || !FULL_SHA.test(baseSha)
    || !branch
    || branch.length > 255) {
    throw new Error('normalized review identity is incomplete');
  }

  const eventRepository = text(event?.repository?.full_name);
  const issueNumber = positiveInteger(event?.issue?.number);
  const hasPullRequest = Boolean(event?.issue?.pull_request);
  const actorLogin = text(event?.comment?.user?.login).toLowerCase();
  const actorId = positiveInteger(event?.comment?.user?.id);
  const commentId = positiveInteger(event?.comment?.id);
  const body = text(event?.comment?.body);
  const marker = exactHeadReviewDispatchMarker(sourceHead);

  if (eventRepository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('handoff repository does not match workflow repository');
  }
  if (!hasPullRequest || issueNumber !== prNumber) {
    throw new Error('handoff is not bound to the exact pull request');
  }
  if (actorLogin !== TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    || actorId !== TRUSTED_GITHUB_ACTIONS_REVIEWER.id) {
    throw new Error('handoff actor is not the trusted GitHub Actions coordinator');
  }
  if (!commentId) {
    throw new Error('handoff comment id is missing');
  }
  if (!body.startsWith(marker)) {
    throw new Error('handoff marker is missing or bound to a different exact head');
  }
  if (!body.includes('## Provider-neutral exact-head review handoff')) {
    throw new Error('handoff body is not the canonical coordinator review request');
  }

  const coordinatorProvenance = parseIndependentReviewHandoffProvenanceV1(body, {
    repository,
    currentMainSha: baseSha,
    handoffCommentId: commentId,
  });
  if (!sameSha(coordinatorProvenance.coordinatorSourceSha, baseSha)) {
    throw new Error('handoff coordinator source is not exact current main');
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA,
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch: 'main',
    marker,
    coordinatorProvenance,
    authority: Object.freeze({
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
    }),
  });
}
