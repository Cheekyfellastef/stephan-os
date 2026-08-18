#!/usr/bin/env node

import fs from 'node:fs';
import { TextDecoder } from 'node:util';

import {
  PULL_REQUEST_REVIEW_ESTATE_MAX_BYTES,
  PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES,
  PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
  assertExactReviewFallbackIdentity,
  finalizeCompleteGraphqlReviewEstate,
  isExactPullRequestReviewsGlobalId404,
  parseExactPullRequestReviewsRequest,
  restCompatibleReviewEstatePage,
  sha256Text,
  validateGraphqlReviewEstatePage,
} from '../shared/agents/pullRequestReviewEstateFallbackV1.mjs';

const REST_ROOT = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-complete-review-estate-fallback-v1';
const ORIGINAL_FETCH = globalThis.fetch?.bind(globalThis);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const GRAPHQL_QUERY = `
  query StephanosCompletePullRequestReviewEstate(
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

let cachedIdentity = null;
let cachedReviewEstate = null;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function eventIdentity() {
  if (cachedIdentity) return cachedIdentity;
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error('GitHub pull_request_target event payload is required for complete review-estate fallback.');
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const repository = text(process.env.GITHUB_REPOSITORY || event?.repository?.full_name);
  const [owner, repo] = repository.split('/');
  const prNumber = positiveInteger(event?.pull_request?.number);
  const nodeId = text(event?.pull_request?.node_id);
  const headRef = text(event?.pull_request?.head?.ref);
  const headSha = text(event?.pull_request?.head?.sha).toLowerCase();
  const baseSha = text(event?.pull_request?.base?.sha).toLowerCase();
  const baseRef = text(event?.pull_request?.base?.ref);
  const headRepository = text(event?.pull_request?.head?.repo?.full_name);
  if (!owner
    || !repo
    || !prNumber
    || !nodeId.startsWith('PR_')
    || !headRef
    || !/^[a-f0-9]{40}$/.test(headSha)
    || !/^[a-f0-9]{40}$/.test(baseSha)
    || baseRef !== 'main'
    || headRepository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('Complete review-estate fallback event identity is incomplete or unsafe.');
  }
  cachedIdentity = Object.freeze({
    repository,
    owner,
    repo,
    prNumber,
    nodeId,
    headRef,
    headSha,
    baseSha,
  });
  return cachedIdentity;
}

function token() {
  const value = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!value) throw new Error('GitHub token is required for complete review-estate fallback.');
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

async function boundedJsonResponse(response, expectedUrl, maxBytes) {
  if (response.url !== expectedUrl) {
    throw new Error('GitHub fallback response URL did not remain exact.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new Error(`GitHub fallback response exceeded ${maxBytes} bytes.`);
  }
  const raw = UTF8.decode(bytes);
  if (!response.ok) {
    throw new Error(`GitHub fallback read failed (${response.status}): ${raw.slice(0, 300)}`);
  }
  return raw ? JSON.parse(raw) : null;
}

async function githubRestJson(path, maxBytes = 256 * 1024) {
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

async function revalidateExactIdentity() {
  const identity = eventIdentity();
  const [pullRequest, mainRef] = await Promise.all([
    githubRestJson(`/repos/${identity.owner}/${identity.repo}/pulls/${identity.prNumber}`),
    githubRestJson(`/repos/${identity.owner}/${identity.repo}/git/ref/heads/main`, 65_536),
  ]);
  assertExactReviewFallbackIdentity({
    expected: identity,
    pullRequest,
    mainRef,
  });
}

async function graphqlReviewEstatePage(cursor) {
  const identity = eventIdentity();
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
        owner: identity.owner,
        name: identity.repo,
        number: identity.prNumber,
        pageSize: PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
        cursor: cursor || null,
      },
    }),
  });
  const payload = await boundedJsonResponse(
    response,
    GRAPHQL_URL,
    PULL_REQUEST_REVIEW_ESTATE_MAX_BYTES,
  );
  return validateGraphqlReviewEstatePage({
    expected: identity,
    payload,
  });
}

async function loadCompleteReviewEstate() {
  if (cachedReviewEstate) return cachedReviewEstate;
  const pages = [];
  let cursor = null;
  for (let page = 1; page <= PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES; page += 1) {
    const result = await graphqlReviewEstatePage(cursor);
    pages.push(result);
    if (!result.hasNextPage) {
      cachedReviewEstate = finalizeCompleteGraphqlReviewEstate({ pages });
      return cachedReviewEstate;
    }
    cursor = result.endCursor;
  }
  throw new Error('Complete GraphQL review estate exceeded the fixed page bound.');
}

function syntheticRestReviewPage(reviews, request) {
  const page = restCompatibleReviewEstatePage({
    reviews,
    page: request.page,
    perPage: request.perPage,
  });
  return new Response(JSON.stringify(page), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.github+json; charset=utf-8',
      'X-Stephanos-Review-Evidence-Source': 'graphql-complete',
    },
  });
}

async function serveCachedReviewEstate(request) {
  await revalidateExactIdentity();
  const response = syntheticRestReviewPage(cachedReviewEstate, request);
  await revalidateExactIdentity();
  return response;
}

export function installCompleteReviewEstateFallback() {
  if (!ORIGINAL_FETCH) throw new Error('Global fetch is required for complete review-estate fallback.');
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.GITHUB_EVENT_NAME !== 'pull_request_target'
    || process.env.GITHUB_JOB !== 'independent-security-review') {
    return false;
  }
  const identity = eventIdentity();
  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    if (!url || method !== 'GET') return ORIGINAL_FETCH(input, init);

    const request = parseExactPullRequestReviewsRequest({
      url,
      expected: identity,
    });
    if (!request.eligible) return ORIGINAL_FETCH(input, init);
    if (cachedReviewEstate) return serveCachedReviewEstate(request);

    const response = await ORIGINAL_FETCH(input, init);
    if (response.status !== 404) return response;
    const body = await response.clone().text();
    if (!isExactPullRequestReviewsGlobalId404({
      status: response.status,
      body,
    })) {
      return response;
    }

    // A complete fallback may begin only at page one. Starting after a REST
    // page would mix two independently paginated evidence estates.
    if (request.page !== 1) return response;

    try {
      await revalidateExactIdentity();
      const reviews = await loadCompleteReviewEstate();
      await revalidateExactIdentity();
      console.warn('INDEPENDENT_REVIEW_COMPLETE_ESTATE_FALLBACK=graphql-complete');
      console.warn(`INDEPENDENT_REVIEW_COMPLETE_ESTATE_FALLBACK_COUNT=${reviews.length}`);
      return syntheticRestReviewPage(reviews, request);
    } catch (error) {
      const digest = sha256Text(error instanceof Error ? error.message : String(error));
      console.warn(`INDEPENDENT_REVIEW_COMPLETE_ESTATE_FALLBACK_BLOCKED_SHA256=${digest}`);
      // Return the original exact 404. The existing reviewer owns bounded
      // retries, identity checks and the immutable infrastructure-blocked
      // artifact after its retry budget is exhausted.
      return response;
    }
  };
  return true;
}

installCompleteReviewEstateFallback();
