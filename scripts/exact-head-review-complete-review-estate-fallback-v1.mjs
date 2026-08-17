#!/usr/bin/env node

import { TextDecoder } from 'node:util';

import {
  PULL_REQUEST_REVIEW_ESTATE_MAX_BYTES,
  PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES,
  PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
  assertExactReviewFallbackIdentity,
  finalizeCompleteGraphqlReviewEstate,
  isExactPullRequestReviewsGlobalId404,
  restCompatibleReviewEstatePage,
  sha256Text,
  validateGraphqlReviewEstatePage,
} from '../shared/agents/pullRequestReviewEstateFallbackV1.mjs';

const REST_ROOT = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-exact-head-review-complete-review-estate-fallback-v1';
const ORIGINAL_FETCH = globalThis.fetch?.bind(globalThis);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ALLOWED_EVENTS = new Set(['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch']);
const ALLOWED_JOBS = new Set(['plan', 'coordinate']);
const MAX_DISTINCT_REVIEW_ACTORS = 100;
const GRAPHQL_QUERY = `
  query StephanosCoordinatorPullRequestReviewEstate(
    $owner: String!
    $name: String!
    $number: Int!
    $pageSize: Int!
    $cursor: String
  ) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      pullRequest(number: $number) {
        id
        number
        state
        headRefName
        headRefOid
        baseRefName
        baseRefOid
        reviews(first: $pageSize, after: $cursor) {
          totalCount
          nodes {
            id
            fullDatabaseId
            state
            body
            submittedAt
            commit { oid }
            author { login }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const cache = new Map();

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function repositoryIdentity() {
  const repository = text(process.env.GITHUB_REPOSITORY);
  const [owner, repo] = repository.split('/');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !owner || !repo) {
    throw new Error('Coordinator review-estate fallback requires exact GITHUB_REPOSITORY.');
  }
  return Object.freeze({ repository, owner, repo });
}

function token() {
  const value = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!value) throw new Error('GitHub token is required for coordinator review-estate fallback.');
  return value;
}

function requestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return new URL(input);
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  return null;
}

function requestMethod(input, init = {}) {
  if (init?.method) return text(init.method).toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return text(input.method).toUpperCase();
  return 'GET';
}

function parseCoordinatorReviewRequest(url) {
  const { owner, repo } = repositoryIdentity();
  if (!(url instanceof URL) || url.origin !== REST_ROOT) return Object.freeze({ eligible: false });
  const match = url.pathname.match(new RegExp(`^/repos/${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pulls/([1-9][0-9]*)/reviews$`));
  if (!match) return Object.freeze({ eligible: false });
  const keys = [...url.searchParams.keys()];
  const pageValues = url.searchParams.getAll('page');
  const perPageValues = url.searchParams.getAll('per_page');
  const page = positiveInteger(pageValues[0]);
  const perPage = positiveInteger(perPageValues[0]);
  const eligible = keys.length === 2
    && new Set(keys).size === 2
    && keys.every((key) => key === 'page' || key === 'per_page')
    && pageValues.length === 1
    && perPageValues.length === 1
    && page > 0
    && page <= PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES
    && perPage === PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE;
  return Object.freeze({
    eligible,
    prNumber: positiveInteger(match[1]),
    page,
    perPage,
  });
}

async function boundedJsonResponse(response, expectedUrl, maxBytes) {
  if (response.url !== expectedUrl) throw new Error('Coordinator fallback response URL did not remain exact.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Coordinator fallback response exceeded ${maxBytes} bytes.`);
  const raw = UTF8.decode(bytes);
  if (!response.ok) throw new Error(`Coordinator fallback read failed (${response.status}): ${raw.slice(0, 300)}`);
  return raw ? JSON.parse(raw) : null;
}

async function restJson(path, maxBytes = 256 * 1024) {
  const url = `${REST_ROOT}${path}`;
  const response = await ORIGINAL_FETCH(url, {
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });
  return boundedJsonResponse(response, url, maxBytes);
}

async function loadExactIdentity(prNumber) {
  const { repository, owner, repo } = repositoryIdentity();
  const [pullRequest, mainRef] = await Promise.all([
    restJson(`/repos/${owner}/${repo}/pulls/${prNumber}`),
    restJson(`/repos/${owner}/${repo}/git/ref/heads/main`, 65_536),
  ]);
  const expected = Object.freeze({
    repository,
    prNumber,
    nodeId: text(pullRequest?.node_id),
    headRef: text(pullRequest?.head?.ref),
    headSha: text(pullRequest?.head?.sha).toLowerCase(),
    baseSha: text(pullRequest?.base?.sha).toLowerCase(),
  });
  assertExactReviewFallbackIdentity({ expected, pullRequest, mainRef });
  return expected;
}

async function revalidateExactIdentity(expected) {
  const { owner, repo } = repositoryIdentity();
  const [pullRequest, mainRef] = await Promise.all([
    restJson(`/repos/${owner}/${repo}/pulls/${expected.prNumber}`),
    restJson(`/repos/${owner}/${repo}/git/ref/heads/main`, 65_536),
  ]);
  assertExactReviewFallbackIdentity({ expected, pullRequest, mainRef });
}

async function graphqlPage(expected, cursor) {
  const { owner, repo } = repositoryIdentity();
  const response = await ORIGINAL_FETCH(GRAPHQL_URL, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      query: GRAPHQL_QUERY,
      variables: {
        owner,
        name: repo,
        number: expected.prNumber,
        pageSize: PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
        cursor: cursor || null,
      },
    }),
  });
  const payload = await boundedJsonResponse(response, GRAPHQL_URL, PULL_REQUEST_REVIEW_ESTATE_MAX_BYTES);
  return validateGraphqlReviewEstatePage({ expected, payload });
}

async function actorIdentity(login) {
  const encoded = encodeURIComponent(login);
  const payload = await restJson(`/users/${encoded}`, 65_536);
  const id = positiveInteger(payload?.id);
  const type = text(payload?.type);
  if (!id || text(payload?.login).toLowerCase() !== login.toLowerCase() || !['User', 'Bot'].includes(type)) {
    throw new Error(`Coordinator fallback actor identity is invalid for ${login}.`);
  }
  return Object.freeze({ login: text(payload.login), type, id });
}

async function hydrateReviewActors(reviews) {
  const logins = [...new Set(reviews.map((review) => text(review?.user?.login)).filter(Boolean))];
  if (logins.length > MAX_DISTINCT_REVIEW_ACTORS) {
    throw new Error('Coordinator review estate exceeded the distinct actor bound.');
  }
  const actors = new Map();
  for (const login of logins) actors.set(login.toLowerCase(), await actorIdentity(login));
  return Object.freeze(reviews.map((review) => Object.freeze({
    ...review,
    user: actors.get(text(review?.user?.login).toLowerCase()) || Object.freeze({ login: '', type: '', id: 0 }),
  })));
}

async function loadCompleteReviewEstate(expected) {
  const pages = [];
  let cursor = null;
  for (let page = 1; page <= PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES; page += 1) {
    const result = await graphqlPage(expected, cursor);
    pages.push(result);
    if (!result.hasNextPage) {
      return hydrateReviewActors(finalizeCompleteGraphqlReviewEstate({ pages }));
    }
    cursor = result.endCursor;
  }
  throw new Error('Coordinator GraphQL review estate exceeded the fixed page bound.');
}

function syntheticPage(entry, request) {
  const page = restCompatibleReviewEstatePage({
    reviews: entry.reviews,
    page: request.page,
    perPage: request.perPage,
  });
  return new Response(JSON.stringify(page), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.github+json; charset=utf-8',
      'X-Stephanos-Review-Evidence-Source': 'graphql-complete-coordinator',
    },
  });
}

async function serveCached(entry, request) {
  await revalidateExactIdentity(entry.expected);
  const response = syntheticPage(entry, request);
  await revalidateExactIdentity(entry.expected);
  return response;
}

export function installExactHeadReviewCompleteEstateFallback() {
  if (!ORIGINAL_FETCH) throw new Error('Global fetch is required for coordinator review-estate fallback.');
  if (process.env.GITHUB_ACTIONS !== 'true'
    || !ALLOWED_EVENTS.has(text(process.env.GITHUB_EVENT_NAME))
    || !ALLOWED_JOBS.has(text(process.env.GITHUB_JOB))) {
    return false;
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    if (!url || method !== 'GET') return ORIGINAL_FETCH(input, init);
    const request = parseCoordinatorReviewRequest(url);
    if (!request.eligible) return ORIGINAL_FETCH(input, init);

    const cached = cache.get(request.prNumber);
    if (cached) return serveCached(cached, request);

    const response = await ORIGINAL_FETCH(input, init);
    if (response.status !== 404) return response;
    const body = await response.clone().text();
    if (!isExactPullRequestReviewsGlobalId404({ status: response.status, body }) || request.page !== 1) {
      return response;
    }

    try {
      const expected = await loadExactIdentity(request.prNumber);
      await revalidateExactIdentity(expected);
      const reviews = await loadCompleteReviewEstate(expected);
      await revalidateExactIdentity(expected);
      const entry = Object.freeze({ expected, reviews });
      cache.set(request.prNumber, entry);
      console.warn(`EXACT_HEAD_REVIEW_COMPLETE_ESTATE_FALLBACK=graphql-complete:pr-${request.prNumber}`);
      console.warn(`EXACT_HEAD_REVIEW_COMPLETE_ESTATE_FALLBACK_COUNT=${reviews.length}`);
      return syntheticPage(entry, request);
    } catch (error) {
      const digest = sha256Text(error instanceof Error ? error.message : String(error));
      console.warn(`EXACT_HEAD_REVIEW_COMPLETE_ESTATE_FALLBACK_BLOCKED_SHA256=${digest}`);
      return response;
    }
  };
  return true;
}

installExactHeadReviewCompleteEstateFallback();
