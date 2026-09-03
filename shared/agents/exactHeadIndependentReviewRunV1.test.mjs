import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_JOB,
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from './operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  mapGitHubIndependentReviewJobV1,
  mapGitHubIndependentReviewRunV1,
  validateExactHeadIndependentReviewRunV1,
} from './exactHeadIndependentReviewRunV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR_NUMBER = 2003;
const HEAD = '1284a8ecac24645dbdc64b426012826c51b79213';
const BASE = 'd4a3702dd3dbd27ffe26433c48602d1e372d09e5';
const BRANCH = 'agent/goal-building-agent-v1';
const WORKFLOW_ID = 318073448;
const RUN_ID = 32878833071;
const RUN_ATTEMPT = 1;
const HANDOFF_BINDING = 'a'.repeat(64);
const HANDOFF_RUN_RECEIPT = 'b'.repeat(64);
const REQUESTED_AT = '2026-08-25T17:35:00.000Z';
const GITHUB_ACTIONS = Object.freeze({ login: 'github-actions[bot]', type: 'Bot', id: 41898282 });

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function launchReceipt(overrides = {}) {
  const binding = {
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    sourceHead: HEAD,
    baseSha: BASE,
    branch: BRANCH,
    workflowId: WORKFLOW_ID,
    workflowName: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    workflowPath: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    handoffBindingSha256: HANDOFF_BINDING,
    handoffRunReceiptSha256: HANDOFF_RUN_RECEIPT,
    ...overrides,
  };
  return {
    schemaVersion: 'stephanos.independent-review-workflow-dispatch-launch-receipt.v1',
    ...binding,
    launchKeySha256: digest(binding),
    runName: `stephanos-independent-review-pr-${binding.prNumber}-head-${binding.sourceHead}-binding-${binding.handoffBindingSha256}`,
    requestedAtUtc: REQUESTED_AT,
    authority: {
      reviewWorkflowDispatchAllowed: true,
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
      arbitraryCommandAllowed: false,
    },
  };
}

function launchComment(receipt = launchReceipt(), overrides = {}) {
  return {
    id: 100,
    user: GITHUB_ACTIONS,
    created_at: '2026-08-25T17:35:01Z',
    body: [
      `<!-- ${INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER} key=${receipt.launchKeySha256} -->`,
      '## Provider-neutral independent-review missing-run launch receipt',
      '',
      '```json',
      JSON.stringify(receipt, null, 2),
      '```',
    ].join('\n'),
    ...overrides,
  };
}

function dispatchRun(receipt = launchReceipt(), overrides = {}) {
  return {
    id: RUN_ID,
    run_attempt: RUN_ATTEMPT,
    workflow_id: WORKFLOW_ID,
    name: receipt.runName,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'workflow_dispatch',
    repository: { full_name: REPOSITORY },
    head_branch: 'main',
    head_sha: BASE,
    display_title: receipt.runName,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-25T17:35:02Z',
    pull_requests: [],
    ...overrides,
  };
}

function jobs(overrides = {}) {
  return [{
    id: 9001,
    name: INDEPENDENT_REVIEW_JOB,
    run_attempt: RUN_ATTEMPT,
    run_url: `https://api.github.com/repos/${REPOSITORY}/actions/runs/${RUN_ID}`,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }];
}

function input(overrides = {}) {
  const receipt = launchReceipt();
  const run = dispatchRun(receipt);
  return {
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    expectedHead: HEAD,
    expectedBranch: BRANCH,
    expectedBaseBranch: 'main',
    expectedBaseSha: BASE,
    expectedWorkflowId: WORKFLOW_ID,
    workflowRunId: RUN_ID,
    workflowRunAttempt: RUN_ATTEMPT,
    run,
    allRuns: [run],
    jobs: jobs(),
    comments: [launchComment(receipt)],
    ...overrides,
  };
}

test('admits the exact acknowledged workflow-dispatch review shape through existing strict primitives', () => {
  const result = validateExactHeadIndependentReviewRunV1(input());
  assert.equal(result.valid, true);
  assert.equal(result.mode, 'workflow_dispatch');
  assert.deepEqual(result.blockers, []);
});

test('preserves every authority field needed when mapping GitHub workflow-dispatch API evidence', () => {
  const original = input();
  const rawRun = {
    ...original.run,
    display_title: original.run.name,
    head_branch: 'main',
    created_at: '2026-08-25T17:35:02Z',
    updated_at: '2026-08-25T17:35:20Z',
    run_started_at: '2026-08-25T17:35:03Z',
  };
  const mappedRun = mapGitHubIndependentReviewRunV1(rawRun);
  const mappedJobs = original.jobs.map(mapGitHubIndependentReviewJobV1);
  const result = validateExactHeadIndependentReviewRunV1({
    ...original,
    run: mappedRun,
    allRuns: [mappedRun],
    jobs: mappedJobs,
  });

  assert.equal(mappedRun.display_title, original.run.name);
  assert.equal(mappedRun.created_at, rawRun.created_at);
  assert.equal(mappedRun.head_branch, 'main');
  assert.equal(result.valid, true);
  assert.equal(result.mode, 'workflow_dispatch');
});

test('accepts the historical static workflow-name representation for the same exact dispatch', () => {
  const original = input();
  const run = { ...original.run, name: INDEPENDENT_REVIEW_WORKFLOW_NAME };
  const result = validateExactHeadIndependentReviewRunV1({ ...original, run, allRuns: [run] });
  assert.equal(result.valid, true);
  assert.equal(result.mode, 'workflow_dispatch');
});

test('workflow-dispatch review fails closed without the trusted exact launch receipt', () => {
  const result = validateExactHeadIndependentReviewRunV1(input({ comments: [] }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('dispatch-review-launch-receipt-missing'));
});

test('forged launch receipt actor cannot authenticate a dispatch review', () => {
  const original = input();
  const forged = { ...original.comments[0], user: { login: 'attacker', type: 'User', id: 7 } };
  const result = validateExactHeadIndependentReviewRunV1({ ...original, comments: [forged] });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('dispatch-review-launch-receipt-missing'));
});

test('wrong exact base in launch receipt cannot authenticate the current review tuple', () => {
  const original = input();
  const receipt = launchReceipt({ baseSha: 'c'.repeat(40) });
  const result = validateExactHeadIndependentReviewRunV1({ ...original, comments: [launchComment(receipt)] });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('dispatch-review-launch-receipt-missing'));
});

test('a pre-launch or ambiguous matching dispatch run is rejected', () => {
  const original = input();
  const oldRun = { ...original.run, id: RUN_ID - 1, created_at: '2026-08-25T17:34:59Z' };
  const preLaunch = validateExactHeadIndependentReviewRunV1({ ...original, run: oldRun, allRuns: [oldRun], workflowRunId: RUN_ID - 1 });
  assert.equal(preLaunch.valid, false);
  assert.ok(preLaunch.blockers.some((value) => value.includes('DISPATCH_RUN_NOT_YET_OBSERVED')));

  const duplicate = { ...original.run, id: RUN_ID + 1 };
  const ambiguous = validateExactHeadIndependentReviewRunV1({ ...original, allRuns: [original.run, duplicate] });
  assert.equal(ambiguous.valid, false);
  assert.ok(ambiguous.blockers.some((value) => value.includes('AMBIGUOUS_DISPATCH_RUNS')));
});

test('wrong handoff binding in the successful run name is rejected', () => {
  const original = input();
  const wrongName = `stephanos-independent-review-pr-${PR_NUMBER}-head-${HEAD}-binding-${'f'.repeat(64)}`;
  const run = { ...original.run, name: wrongName, display_title: wrongName };
  const result = validateExactHeadIndependentReviewRunV1({ ...original, run, allRuns: [run] });
  assert.equal(result.valid, false);
});

test('legacy pull_request_target review admission remains unchanged', () => {
  const legacyRun = {
    id: RUN_ID,
    run_attempt: RUN_ATTEMPT,
    workflow_id: WORKFLOW_ID,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'pull_request_target',
    repository: { full_name: REPOSITORY },
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{
      number: PR_NUMBER,
      head: { sha: HEAD, ref: BRANCH },
      base: { sha: BASE, ref: 'main' },
    }],
  };
  const result = validateExactHeadIndependentReviewRunV1({
    ...input(),
    run: legacyRun,
    allRuns: [legacyRun],
    comments: [],
  });
  assert.equal(result.valid, true);
  assert.equal(result.mode, 'pull_request_target');
});
