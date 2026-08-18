import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES,
  PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
  assertExactReviewFallbackIdentity,
  exactReviewFallbackIdentityBlockers,
  finalizeCompleteGraphqlReviewEstate,
  isExactPullRequestReviewsGlobalId404,
  parseExactPullRequestReviewsRequest,
  restCompatibleReviewEstatePage,
  validateGraphqlReviewEstatePage,
} from './pullRequestReviewEstateFallbackV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const EXPECTED = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1830,
  nodeId: 'PR_kwDORkv-6s7_yejv',
  headRef: 'agent/github-continuity-mode-m2-execution-grants-v1',
  headSha: HEAD,
  baseSha: BASE,
});

function restIdentity() {
  return {
    expected: EXPECTED,
    pullRequest: {
      number: EXPECTED.prNumber,
      node_id: EXPECTED.nodeId,
      state: 'open',
      head: {
        ref: EXPECTED.headRef,
        sha: HEAD,
        repo: { full_name: EXPECTED.repository },
      },
      base: {
        ref: 'main',
        sha: BASE,
        repo: { full_name: EXPECTED.repository },
      },
    },
    mainRef: { object: { sha: BASE } },
  };
}

function review(index) {
  return {
    id: `PRR_review${index}`,
    fullDatabaseId: String(4_950_000_000 + index),
    state: index % 2 ? 'APPROVED' : 'COMMENTED',
    body: `review ${index}`,
    submittedAt: '2026-08-17T13:00:00Z',
    commit: { oid: HEAD },
    author: { login: index % 2 ? 'chatgpt-codex-connector' : 'other-reviewer' },
  };
}

function graphqlPayload({
  nodes = [review(1)],
  totalCount = nodes.length,
  hasNextPage = false,
  endCursor = null,
} = {}) {
  return {
    data: {
      repository: {
        nameWithOwner: EXPECTED.repository,
        pullRequest: {
          id: EXPECTED.nodeId,
          number: EXPECTED.prNumber,
          state: 'OPEN',
          headRefName: EXPECTED.headRef,
          headRefOid: HEAD,
          baseRefName: 'main',
          baseRefOid: BASE,
          reviews: {
            totalCount,
            nodes,
            pageInfo: { hasNextPage, endCursor },
          },
        },
      },
    },
  };
}

test('only the exact bounded REST review page is eligible', () => {
  const accepted = parseExactPullRequestReviewsRequest({
    url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=100&page=1',
    expected: EXPECTED,
  });
  assert.deepEqual(accepted, { eligible: true, page: 1, perPage: 100 });

  for (const url of [
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1830/files?per_page=100&page=1',
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1831/reviews?per_page=100&page=1',
    'https://example.com/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=100&page=1',
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=99&page=1',
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=100&page=21',
    'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=100&page=1&extra=true',
  ]) {
    assert.equal(parseExactPullRequestReviewsRequest({
      url,
      expected: EXPECTED,
    }).eligible, false);
  }
});

test('the actual quoted GitHub global-ID 404 is recognized and ordinary 404 is not', () => {
  assert.equal(isExactPullRequestReviewsGlobalId404({
    status: 404,
    body: '{"message":"Not Found","errors":[{"message":"Could not resolve to a node with the global id of \'PR_kwDORkv-6s7_yejv\'."}]}',
  }), true);
  assert.equal(isExactPullRequestReviewsGlobalId404({
    status: 404,
    body: '{"message":"Not Found"}',
  }), false);
  assert.equal(isExactPullRequestReviewsGlobalId404({
    status: 503,
    body: "Could not resolve to a node with the global id of 'PR_kwDORkv-6s7_yejv'.",
  }), false);
});

test('fallback identity binds repository, PR node, head, base and canonical main', () => {
  assert.equal(assertExactReviewFallbackIdentity(restIdentity()), true);
  const drifted = restIdentity();
  drifted.pullRequest.node_id = 'PR_wrong';
  drifted.mainRef.object.sha = 'c'.repeat(40);
  assert.deepEqual(exactReviewFallbackIdentityBlockers(drifted), [
    'fallback-pr-node-id-drift',
    'fallback-main-base-sha-drift',
  ]);
  assert.throws(
    () => assertExactReviewFallbackIdentity(drifted),
    /fallback-pr-node-id-drift, fallback-main-base-sha-drift/,
  );
});

test('GraphQL review page normalizes the exact REST specialist fields', () => {
  const page = validateGraphqlReviewEstatePage({
    payload: graphqlPayload(),
    expected: EXPECTED,
  });
  assert.equal(page.totalCount, 1);
  assert.equal(page.hasNextPage, false);
  assert.deepEqual(page.reviews[0], {
    id: 4950000001,
    node_id: 'PRR_review1',
    state: 'APPROVED',
    body: 'review 1',
    submitted_at: '2026-08-17T13:00:00Z',
    commit_id: HEAD,
    user: { login: 'chatgpt-codex-connector' },
  });
});

test('GraphQL review page fails closed on identity, pagination and ID defects', () => {
  const headDrift = graphqlPayload();
  headDrift.data.repository.pullRequest.headRefOid = 'c'.repeat(40);
  assert.throws(
    () => validateGraphqlReviewEstatePage({ payload: headDrift, expected: EXPECTED }),
    /graphql-head-sha-drift/,
  );

  const missingCursor = graphqlPayload({ hasNextPage: true });
  assert.throws(
    () => validateGraphqlReviewEstatePage({ payload: missingCursor, expected: EXPECTED }),
    /graphql-next-cursor-missing/,
  );

  const unsafeId = graphqlPayload({
    nodes: [{ ...review(1), fullDatabaseId: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n) }],
  });
  assert.throws(
    () => validateGraphqlReviewEstatePage({ payload: unsafeId, expected: EXPECTED }),
    /safe integer bound/,
  );

  const duplicated = graphqlPayload({ nodes: [review(1), review(1)] });
  assert.throws(
    () => validateGraphqlReviewEstatePage({ payload: duplicated, expected: EXPECTED }),
    /duplicate review identities/,
  );
});

test('complete estate requires stable totalCount, exact count and terminal pagination', () => {
  const first = validateGraphqlReviewEstatePage({
    payload: graphqlPayload({
      nodes: [review(1), review(2)],
      totalCount: 3,
      hasNextPage: true,
      endCursor: 'cursor-1',
    }),
    expected: EXPECTED,
  });
  const second = validateGraphqlReviewEstatePage({
    payload: graphqlPayload({
      nodes: [review(3)],
      totalCount: 3,
      hasNextPage: false,
    }),
    expected: EXPECTED,
  });
  const estate = finalizeCompleteGraphqlReviewEstate({ pages: [first, second] });
  assert.equal(estate.length, 3);

  assert.throws(
    () => finalizeCompleteGraphqlReviewEstate({
      pages: [first, { ...second, totalCount: 4 }],
    }),
    /totalCount changed/,
  );
  assert.throws(
    () => finalizeCompleteGraphqlReviewEstate({
      pages: [first, { ...second, reviews: [] }],
    }),
    /does not equal totalCount/,
  );
  assert.throws(
    () => finalizeCompleteGraphqlReviewEstate({
      pages: [{ ...first, hasNextPage: false }, second],
    }),
    /termination is inconsistent/,
  );
});

test('complete GraphQL estate projects into REST pages including an exact multiple of 100', () => {
  const estate = Array.from({ length: 100 }, (_, index) => Object.freeze({
    id: index + 1,
    node_id: `PRR_${index + 1}`,
  }));
  assert.equal(restCompatibleReviewEstatePage({
    reviews: estate,
    page: 1,
    perPage: PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
  }).length, 100);
  assert.deepEqual(restCompatibleReviewEstatePage({
    reviews: estate,
    page: 2,
    perPage: PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
  }), []);
  assert.throws(() => restCompatibleReviewEstatePage({
    reviews: estate,
    page: PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES + 1,
    perPage: PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE,
  }), /bounded REST-compatible/);
});

test('trusted workflow wires the fallback without widening permissions', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/independent-merge-security-review.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /NODE_OPTIONS:\s*--import=\.\/scripts\/independent-review-complete-review-estate-fallback-v1\.mjs/,
  );
  assert.match(workflow, /pull-requests:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write|actions:\s*write|deployments:\s*write/);
});

test('preload uses one exact complete GraphQL route and no mutation authority', async () => {
  const source = await readFile(
    new URL('../../scripts/independent-review-complete-review-estate-fallback-v1.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /globalThis\.fetch = async/);
  assert.match(source, /pullRequest\(number: \$number\)/);
  assert.match(source, /reviews\(first: \$pageSize, after: \$cursor\)/);
  assert.match(source, /fullDatabaseId/);
  assert.match(source, /finalizeCompleteGraphqlReviewEstate/);
  assert.match(source, /await revalidateExactIdentity\(\);[\s\S]*loadCompleteReviewEstate\(\)[\s\S]*await revalidateExactIdentity\(\);/);
  assert.match(source, /if \(request\.page !== 1\) return response/);
  assert.match(source, /INDEPENDENT_REVIEW_COMPLETE_ESTATE_FALLBACK=graphql-complete/);
  assert.doesNotMatch(
    source,
    /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|Restart-Computer|Invoke-Expression|node:child_process|spawnSync|execSync/i,
  );
});
