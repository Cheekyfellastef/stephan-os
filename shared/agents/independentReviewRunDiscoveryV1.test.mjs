import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewRunQueryV1,
  selectIndependentReviewRunCandidatesV1,
} from './independentReviewRunDiscoveryV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const BRANCH = 'fix/recovery-mesh-launch-liveness-specialist-v1';

function run(overrides = {}) {
  return {
    id: 123,
    event: 'pull_request_target',
    head_sha: BASE,
    pull_requests: [{
      number: 1894,
      head: { ref: BRANCH, sha: HEAD },
      base: { ref: 'main', sha: BASE },
    }],
    ...overrides,
  };
}

function select(runs) {
  return selectIndependentReviewRunCandidatesV1({
    runs,
    prNumber: 1894,
    headRef: BRANCH,
    expectedHead: HEAD,
    expectedBase: BASE,
  });
}

test('queries pull_request_target runs by the trusted base SHA, not the feature head', () => {
  const query = buildIndependentReviewRunQueryV1({ workflowId: 456, expectedBase: BASE });
  assert.equal(
    query,
    `/actions/workflows/456/runs?event=pull_request_target&head_sha=${BASE}&per_page=100&page=1`,
  );
  assert.doesNotMatch(query, new RegExp(HEAD));
});

test('accepts a base-bound workflow run whose embedded PR is bound to the exact feature head', () => {
  assert.deepEqual(select([run()]).map((item) => item.id), [123]);
});

test('rejects the old incorrect feature-head workflow-run identity', () => {
  assert.deepEqual(select([run({ head_sha: HEAD })]), []);
});

test('rejects wrong PR, branch, feature head, base SHA and non-target events', () => {
  const cases = [
    run({ pull_requests: [{ number: 7, head: { ref: BRANCH, sha: HEAD }, base: { ref: 'main', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1894, head: { ref: 'other', sha: HEAD }, base: { ref: 'main', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1894, head: { ref: BRANCH, sha: OTHER }, base: { ref: 'main', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1894, head: { ref: BRANCH, sha: HEAD }, base: { ref: 'main', sha: OTHER } }] }),
    run({ pull_requests: [{ number: 1894, head: { ref: BRANCH, sha: HEAD }, base: { ref: 'other', sha: BASE } }] }),
    run({ event: 'pull_request' }),
  ];
  for (const candidate of cases) assert.deepEqual(select([candidate]), []);
});

test('orders exact candidates newest-first for bounded detail loading', () => {
  assert.deepEqual(select([run({ id: 3 }), run({ id: 9 }), run({ id: 5 })]).map((item) => item.id), [9, 5, 3]);
});

test('fails closed without complete exact identity', () => {
  assert.throws(() => buildIndependentReviewRunQueryV1({ workflowId: 0, expectedBase: BASE }));
  assert.throws(() => selectIndependentReviewRunCandidatesV1({
    runs: [], prNumber: 1894, headRef: BRANCH, expectedHead: 'bad', expectedBase: BASE,
  }));
});
