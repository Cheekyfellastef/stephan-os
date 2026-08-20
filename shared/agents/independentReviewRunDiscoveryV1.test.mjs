import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewRunQueryV1,
  buildIndependentReviewWorkflowDispatchRunQueryV1,
  independentReviewWorkflowDispatchRunNameV1,
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
    head_sha: HEAD,
    head_branch: BRANCH,
    display_title: 'legacy pull_request_target title is not authority',
    pull_requests: [{
      number: 1894,
      head: { ref: BRANCH, sha: HEAD },
      base: { ref: 'main', sha: BASE },
    }],
    ...overrides,
  };
}

function dispatchedRun(overrides = {}) {
  return {
    id: 456,
    event: 'workflow_dispatch',
    head_sha: BASE,
    head_branch: 'main',
    display_title: independentReviewWorkflowDispatchRunNameV1({
      prNumber: 1894,
      expectedHead: HEAD,
      expectedBase: BASE,
    }),
    pull_requests: [],
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

test('queries pull_request_target runs by the feature head reported by Actions REST', () => {
  const query = buildIndependentReviewRunQueryV1({ workflowId: 456, expectedHead: HEAD });
  assert.equal(
    query,
    `/actions/workflows/456/runs?event=pull_request_target&head_sha=${HEAD}&per_page=100&page=1`,
  );
  assert.doesNotMatch(query, new RegExp(BASE));
});

test('queries workflow_dispatch runs by exact trusted main while title carries PR/head/base identity', () => {
  const query = buildIndependentReviewWorkflowDispatchRunQueryV1({ workflowId: 456, expectedBase: BASE });
  assert.equal(
    query,
    `/actions/workflows/456/runs?event=workflow_dispatch&head_sha=${BASE}&per_page=100&page=1`,
  );
  assert.equal(
    independentReviewWorkflowDispatchRunNameV1({ prNumber: 1894, expectedHead: HEAD, expectedBase: BASE }),
    `Independent Merge Security Review PR #1894 head ${HEAD} base ${BASE}`,
  );
});

test('accepts the observed canonical pull_request_target run shape with exact embedded base binding', () => {
  assert.deepEqual(select([run()]).map((item) => item.id), [123]);
});

test('accepts an exact bounded workflow_dispatch run on trusted main', () => {
  assert.deepEqual(select([dispatchedRun()]).map((item) => item.id), [456]);
});

test('rejects workflow_dispatch lookalikes with wrong main head, branch or exact run title', () => {
  const cases = [
    dispatchedRun({ head_sha: OTHER }),
    dispatchedRun({ head_branch: 'feature' }),
    dispatchedRun({ display_title: independentReviewWorkflowDispatchRunNameV1({ prNumber: 1895, expectedHead: HEAD, expectedBase: BASE }) }),
    dispatchedRun({ display_title: independentReviewWorkflowDispatchRunNameV1({ prNumber: 1894, expectedHead: OTHER, expectedBase: BASE }) }),
    dispatchedRun({ display_title: independentReviewWorkflowDispatchRunNameV1({ prNumber: 1894, expectedHead: HEAD, expectedBase: OTHER }) }),
  ];
  for (const candidate of cases) assert.deepEqual(select([candidate]), []);
});

test('rejects a base-shaped pull_request_target workflow-run head identity even when the embedded PR binding is exact', () => {
  assert.deepEqual(select([run({ head_sha: BASE })]), []);
});

test('matches the known-good #1888 independent-review REST identity contract', () => {
  const observedHead = '5b81d353492f036aae5dcf4c1b8e359ee4cbc3ee';
  const observedBase = 'c607c49fef0d853a100d83a67ee0dcedf47342d7';
  const candidates = selectIndependentReviewRunCandidatesV1({
    runs: [{
      id: 32195930612,
      event: 'pull_request_target',
      head_sha: observedHead,
      pull_requests: [{
        number: 1888,
        head: { ref: 'fix/ignition-backend-stale-listener-recovery-v1', sha: observedHead },
        base: { ref: 'main', sha: observedBase },
      }],
    }],
    prNumber: 1888,
    headRef: 'fix/ignition-backend-stale-listener-recovery-v1',
    expectedHead: observedHead,
    expectedBase: observedBase,
  });
  assert.deepEqual(candidates.map((item) => item.id), [32195930612]);
});

test('rejects wrong PR, branch, feature head, base SHA and unsupported events', () => {
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

test('orders exact candidates newest-first across legacy and dispatched run families', () => {
  assert.deepEqual(
    select([run({ id: 3 }), dispatchedRun({ id: 9 }), run({ id: 5 })]).map((item) => item.id),
    [9, 5, 3],
  );
});

test('fails closed without complete exact identity', () => {
  assert.throws(() => buildIndependentReviewRunQueryV1({ workflowId: 0, expectedHead: HEAD }));
  assert.throws(() => buildIndependentReviewWorkflowDispatchRunQueryV1({ workflowId: 0, expectedBase: BASE }));
  assert.throws(() => independentReviewWorkflowDispatchRunNameV1({ prNumber: 0, expectedHead: HEAD, expectedBase: BASE }));
  assert.throws(() => selectIndependentReviewRunCandidatesV1({
    runs: [], prNumber: 1894, headRef: BRANCH, expectedHead: 'bad', expectedBase: BASE,
  }));
});
