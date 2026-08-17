import { createHash } from 'node:crypto';

export const PULL_REQUEST_REVIEW_ESTATE_FALLBACK_SCHEMA_VERSION = 'stephanos.pull-request-review-estate-fallback.v1';
export const PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE = 100;
export const PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES = 20;
export const PULL_REQUEST_REVIEW_ESTATE_MAX_BYTES = 1024 * 1024;

const FULL_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REVIEW_NODE_ID = /^PRR_[A-Za-z0-9_-]+$/;
const PR_NODE_ID = /^PR_[A-Za-z0-9_-]+$/;
const GLOBAL_ID_404 = /Could not resolve to a node with the global id of ['"]?PR_[A-Za-z0-9_-]+['"]?/i;
const REVIEW_STATES = new Set([
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'DISMISSED',
  'PENDING',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function sameSha(left, right) {
  const leftSha = text(left).toLowerCase();
  const rightSha = text(right).toLowerCase();
  return FULL_SHA.test(leftSha) && FULL_SHA.test(rightSha) && leftSha === rightSha;
}

function unique(values) {
  return [...new Set(values)];
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizedExpected(input = {}) {
  const repository = text(input.repository);
  const [owner, repo] = repository.split('/');
  const prNumber = positiveInteger(input.prNumber);
  const nodeId = text(input.nodeId);
  const headRef = text(input.headRef);
  const headSha = text(input.headSha).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  if (!REPOSITORY.test(repository)
    || !owner
    || !repo
    || !prNumber
    || !PR_NODE_ID.test(nodeId)
    || !headRef
    || !FULL_SHA.test(headSha)
    || !FULL_SHA.test(baseSha)) {
    throw new Error('Complete review-estate fallback identity is invalid.');
  }
  return Object.freeze({
    repository,
    owner,
    repo,
    prNumber,
    nodeId,
    headRef,
    headSha,
    baseSha,
  });
}

export function parseExactPullRequestReviewsRequest(input = {}) {
  const expected = normalizedExpected(input.expected);
  let url;
  try {
    url = input.url instanceof URL ? input.url : new URL(String(input.url ?? ''));
  } catch {
    return Object.freeze({ eligible: false, page: 0, perPage: 0 });
  }
  const expectedPath = `/repos/${expected.owner}/${expected.repo}/pulls/${expected.prNumber}/reviews`;
  const keys = [...url.searchParams.keys()];
  const pageValues = url.searchParams.getAll('page');
  const perPageValues = url.searchParams.getAll('per_page');
  const page = positiveInteger(pageValues[0]);
  const perPage = positiveInteger(perPageValues[0]);
  const eligible = url.origin === 'https://api.github.com'
    && url.pathname === expectedPath
    && keys.length === 2
    && new Set(keys).size === 2
    && keys.every((key) => key === 'page' || key === 'per_page')
    && pageValues.length === 1
    && perPageValues.length === 1
    && page > 0
    && page <= PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES
    && perPage === PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE;
  return Object.freeze({ eligible, page, perPage });
}

export function isExactPullRequestReviewsGlobalId404(input = {}) {
  return Number(input.status) === 404 && GLOBAL_ID_404.test(text(input.body));
}

export function exactReviewFallbackIdentityBlockers(input = {}) {
  const expected = normalizedExpected(input.expected);
  const pullRequest = input.pullRequest || {};
  const mainRef = input.mainRef || {};
  const blockers = [];

  if (positiveInteger(pullRequest?.number) !== expected.prNumber) blockers.push('fallback-pr-number-drift');
  if (text(pullRequest?.node_id) !== expected.nodeId) blockers.push('fallback-pr-node-id-drift');
  if (text(pullRequest?.state).toLowerCase() !== 'open') blockers.push('fallback-pr-not-open');
  if (text(pullRequest?.head?.ref) !== expected.headRef) blockers.push('fallback-head-ref-drift');
  if (!sameSha(pullRequest?.head?.sha, expected.headSha)) blockers.push('fallback-head-sha-drift');
  if (text(pullRequest?.base?.ref) !== 'main') blockers.push('fallback-base-ref-drift');
  if (!sameSha(pullRequest?.base?.sha, expected.baseSha)) blockers.push('fallback-pr-base-sha-drift');
  if (!sameSha(mainRef?.object?.sha, expected.baseSha)) blockers.push('fallback-main-base-sha-drift');
  if (text(pullRequest?.head?.repo?.full_name).toLowerCase() !== expected.repository.toLowerCase()) {
    blockers.push('fallback-head-repository-drift');
  }
  if (text(pullRequest?.base?.repo?.full_name).toLowerCase() !== expected.repository.toLowerCase()) {
    blockers.push('fallback-base-repository-drift');
  }

  return Object.freeze(unique(blockers));
}

export function assertExactReviewFallbackIdentity(input = {}) {
  const blockers = exactReviewFallbackIdentityBlockers(input);
  if (blockers.length) {
    throw new Error(`Complete review-estate fallback identity changed: ${blockers.join(', ')}`);
  }
  return true;
}

function reviewDatabaseId(value) {
  const raw = text(value);
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('GraphQL review fullDatabaseId is invalid.');
  }
  const parsed = BigInt(raw);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('GraphQL review fullDatabaseId exceeds the safe integer bound.');
  }
  return Number(parsed);
}

function normalizeGraphqlReview(node = {}) {
  const id = reviewDatabaseId(node?.fullDatabaseId);
  const nodeId = text(node?.id);
  const state = text(node?.state).toUpperCase();
  const submittedAt = text(node?.submittedAt);
  const commitId = text(node?.commit?.oid).toLowerCase();
  const login = text(node?.author?.login);
  if (!REVIEW_NODE_ID.test(nodeId)) throw new Error('GraphQL review node ID is invalid.');
  if (!REVIEW_STATES.has(state)) throw new Error('GraphQL review state is unsupported.');
  if (submittedAt && !Number.isFinite(Date.parse(submittedAt))) {
    throw new Error('GraphQL review submittedAt is invalid.');
  }
  if (commitId && !FULL_SHA.test(commitId)) {
    throw new Error('GraphQL review commit oid is invalid.');
  }
  return Object.freeze({
    id,
    node_id: nodeId,
    state,
    body: String(node?.body ?? ''),
    submitted_at: submittedAt,
    commit_id: commitId,
    user: Object.freeze({ login }),
  });
}

export function validateGraphqlReviewEstatePage(input = {}) {
  const expected = normalizedExpected(input.expected);
  const payload = input.payload || {};
  const repository = payload?.data?.repository;
  const pullRequest = repository?.pullRequest;
  const connection = pullRequest?.reviews;
  const blockers = [];

  if (Array.isArray(payload?.errors) && payload.errors.length) blockers.push('graphql-errors-present');
  if (text(repository?.nameWithOwner).toLowerCase() !== expected.repository.toLowerCase()) {
    blockers.push('graphql-repository-drift');
  }
  if (text(pullRequest?.id) !== expected.nodeId) blockers.push('graphql-pr-node-id-drift');
  if (positiveInteger(pullRequest?.number) !== expected.prNumber) blockers.push('graphql-pr-number-drift');
  if (text(pullRequest?.state).toUpperCase() !== 'OPEN') blockers.push('graphql-pr-not-open');
  if (text(pullRequest?.headRefName) !== expected.headRef) blockers.push('graphql-head-ref-drift');
  if (!sameSha(pullRequest?.headRefOid, expected.headSha)) blockers.push('graphql-head-sha-drift');
  if (text(pullRequest?.baseRefName) !== 'main') blockers.push('graphql-base-ref-drift');
  if (!sameSha(pullRequest?.baseRefOid, expected.baseSha)) blockers.push('graphql-base-sha-drift');

  const totalCount = nonNegativeInteger(connection?.totalCount);
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : null;
  const pageInfo = connection?.pageInfo;
  if (totalCount < 0) blockers.push('graphql-total-count-invalid');
  if (!nodes || nodes.length > PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE) blockers.push('graphql-page-nodes-invalid');
  if (!pageInfo || typeof pageInfo.hasNextPage !== 'boolean') blockers.push('graphql-page-info-invalid');
  if (pageInfo?.hasNextPage === true && !text(pageInfo?.endCursor)) {
    blockers.push('graphql-next-cursor-missing');
  }
  if (blockers.length) {
    throw new Error(`GraphQL complete review-estate page is invalid: ${unique(blockers).join(', ')}`);
  }

  const reviews = nodes.map(normalizeGraphqlReview);
  const ids = reviews.map((review) => review.id);
  const nodeIds = reviews.map((review) => review.node_id);
  if (new Set(ids).size !== ids.length || new Set(nodeIds).size !== nodeIds.length) {
    throw new Error('GraphQL review page contains duplicate review identities.');
  }

  return Object.freeze({
    schemaVersion: PULL_REQUEST_REVIEW_ESTATE_FALLBACK_SCHEMA_VERSION,
    totalCount,
    reviews: Object.freeze(reviews),
    hasNextPage: pageInfo.hasNextPage,
    endCursor: text(pageInfo.endCursor),
  });
}

export function finalizeCompleteGraphqlReviewEstate(input = {}) {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  if (!pages.length || pages.length > PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES) {
    throw new Error('A bounded non-empty GraphQL review page estate is required.');
  }
  const reviews = [];
  const ids = new Set();
  const nodeIds = new Set();
  const totalCount = nonNegativeInteger(pages[0]?.totalCount);
  if (totalCount < 0
    || totalCount > PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES * PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE) {
    throw new Error('GraphQL review totalCount exceeds the bounded estate.');
  }

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const finalPage = index === pages.length - 1;
    if (nonNegativeInteger(page?.totalCount) !== totalCount) {
      throw new Error('GraphQL review totalCount changed during pagination.');
    }
    if (page?.hasNextPage === finalPage) {
      throw new Error('GraphQL review pagination termination is inconsistent.');
    }
    if (!finalPage && !text(page?.endCursor)) {
      throw new Error('GraphQL review pagination cursor is missing.');
    }
    for (const review of Array.isArray(page?.reviews) ? page.reviews : []) {
      const id = positiveInteger(review?.id);
      const nodeId = text(review?.node_id);
      if (!id || !REVIEW_NODE_ID.test(nodeId) || ids.has(id) || nodeIds.has(nodeId)) {
        throw new Error('GraphQL complete review estate contains an invalid or duplicate identity.');
      }
      ids.add(id);
      nodeIds.add(nodeId);
      reviews.push(review);
    }
  }

  if (reviews.length !== totalCount) {
    throw new Error('GraphQL complete review estate does not equal totalCount.');
  }
  return Object.freeze(reviews);
}

export function restCompatibleReviewEstatePage(input = {}) {
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const page = positiveInteger(input.page);
  const perPage = positiveInteger(input.perPage);
  if (!page
    || page > PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES
    || perPage !== PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE) {
    throw new Error('A bounded REST-compatible review page is required.');
  }
  const start = (page - 1) * perPage;
  return Object.freeze(reviews.slice(start, start + perPage));
}
