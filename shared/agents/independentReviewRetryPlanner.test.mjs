import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT,
  INDEPENDENT_REVIEW_RETRY_DECISION,
  planIndependentReviewRetry,
} from './independentReviewRetryPlanner.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from './operatorMergeApprovalGate.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const BRANCH = 'fix/recovery';
const WORKFLOW_ID = 326000001;
const COORDINATOR_WORKFLOW = readFileSync(
  new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url),
  'utf8',
);
const RETRY_EXECUTOR = readFileSync(
  new URL('../../scripts/retry-independent-review.mjs', import.meta.url),
  'utf8',
);

function workflow(overrides = {}) {
  return {
    id: WORKFLOW_ID,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    state: 'active',
    ...overrides,
  };
}

function pullRequest(overrides = {}) {
  return {
    number: 1638,
    state: 'open',
    draft: false,
    sameRepository: true,
    headRef: BRANCH,
    headSha: HEAD,
    baseRef: 'main',
    baseSha: BASE,
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    id: 9001,
    run_number: 17,
    run_attempt: 1,
    workflow_id: WORKFLOW_ID,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'pull_request_target',
    repository: { full_name: REPOSITORY },
    status: 'completed',
    conclusion: 'failure',
    created_at: '2026-08-04T10:00:00Z',
    pull_requests: [{
      number: 1638,
      head: { ref: BRANCH, sha: HEAD },
      base: { ref: 'main', sha: BASE },
    }],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    repository: REPOSITORY,
    workflow: workflow(),
    pr: pullRequest(),
    runs: [run()],
    ...overrides,
  };
}

test('selects one failed-job-only retry for the latest exact canonical run', () => {
  const plan = planIndependentReviewRetry(input());
  assert.equal(plan.decision, INDEPENDENT_REVIEW_RETRY_DECISION.RERUN_FAILED_JOBS);
  assert.equal(plan.runId, 9001);
  assert.equal(plan.runAttempt, 1);
  assert.equal(plan.operation, 'rerun-failed-jobs');
  assert.equal(plan.mutationAllowed, true);
});

test('selects the newest exact run without accepting stale exact-run history', () => {
  const plan = planIndependentReviewRetry(input({
    runs: [
      run({ id: 8999, run_number: 16, conclusion: 'success', created_at: '2026-08-04T09:00:00Z' }),
      run({ id: 9002, run_number: 18, conclusion: 'failure', created_at: '2026-08-04T11:00:00Z' }),
      run({
        id: 9003,
        run_number: 19,
        pull_requests: [{
          number: 1638,
          head: { ref: BRANCH, sha: 'c'.repeat(40) },
          base: { ref: 'main', sha: BASE },
        }],
      }),
    ],
  }));
  assert.equal(plan.decision, INDEPENDENT_REVIEW_RETRY_DECISION.RERUN_FAILED_JOBS);
  assert.equal(plan.runId, 9002);
});

test('does not rerun successful, queued or in-progress exact review runs', () => {
  const successful = planIndependentReviewRetry(input({ runs: [run({ conclusion: 'success' })] }));
  assert.equal(successful.decision, INDEPENDENT_REVIEW_RETRY_DECISION.ALREADY_SUCCESSFUL);
  assert.equal(successful.mutationAllowed, false);

  for (const status of ['queued', 'in_progress', 'waiting']) {
    const waiting = planIndependentReviewRetry(input({
      runs: [run({ status, conclusion: null })],
    }));
    assert.equal(waiting.decision, INDEPENDENT_REVIEW_RETRY_DECISION.WAIT_RUNNING);
    assert.equal(waiting.mutationAllowed, false);
  }
});

test('fails closed when the retry budget is exhausted or the conclusion is unsupported', () => {
  const exhausted = planIndependentReviewRetry(input({
    runs: [run({ run_attempt: INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT })],
  }));
  assert.equal(exhausted.decision, INDEPENDENT_REVIEW_RETRY_DECISION.RETRY_BUDGET_EXHAUSTED);

  for (const conclusion of ['cancelled', 'timed_out', 'action_required', 'neutral']) {
    const blocked = planIndependentReviewRetry(input({ runs: [run({ conclusion })] }));
    assert.equal(blocked.decision, INDEPENDENT_REVIEW_RETRY_DECISION.BLOCKED_CONCLUSION);
    assert.equal(blocked.mutationAllowed, false);
  }
});

test('rejects lookalike workflow, repository, event and PR identities', () => {
  const hostileRuns = [
    run({ workflow_id: WORKFLOW_ID + 1 }),
    run({ name: 'Independent Merge Security Review Copy' }),
    run({ path: '.github/workflows/lookalike-review.yml' }),
    run({ event: 'workflow_dispatch' }),
    run({ repository: { full_name: 'other/repo' } }),
    run({ pull_requests: [{ number: 1639, head: { ref: BRANCH, sha: HEAD }, base: { ref: 'main', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1638, head: { ref: 'other', sha: HEAD }, base: { ref: 'main', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1638, head: { ref: BRANCH, sha: 'd'.repeat(40) }, base: { ref: 'main', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1638, head: { ref: BRANCH, sha: HEAD }, base: { ref: 'other', sha: BASE } }] }),
    run({ pull_requests: [{ number: 1638, head: { ref: BRANCH, sha: HEAD }, base: { ref: 'main', sha: 'e'.repeat(40) } }] }),
  ];
  for (const hostile of hostileRuns) {
    const plan = planIndependentReviewRetry(input({ runs: [hostile] }));
    assert.equal(plan.decision, INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN);
  }
});

test('rejects invalid workflow or pull-request authority before considering runs', () => {
  const inputs = [
    input({ workflow: workflow({ state: 'disabled_manually' }) }),
    input({ workflow: workflow({ path: '.github/workflows/lookalike-review.yml' }) }),
    input({ pr: pullRequest({ state: 'closed' }) }),
    input({ pr: pullRequest({ draft: true }) }),
    input({ pr: pullRequest({ sameRepository: false }) }),
    input({ pr: pullRequest({ baseRef: 'other' }) }),
    input({ pr: pullRequest({ headSha: 'short' }) }),
  ];
  for (const candidate of inputs) {
    const plan = planIndependentReviewRetry(candidate);
    assert.equal(plan.decision, INDEPENDENT_REVIEW_RETRY_DECISION.INVALID_INPUT);
    assert.equal(plan.mutationAllowed, false);
  }
});

test('trusted workflow re-evaluates a bounded retry after dispatch, wait and one escalation', () => {
  assert.match(COORDINATOR_WORKFLOW, /permissions:\s*\n\s+actions: write\b/);
  const retryStepStart = COORDINATOR_WORKFLOW.indexOf(
    '- name: Retry only the exact failed canonical independent review',
  );
  assert.ok(retryStepStart >= 0, 'bounded retry step must exist');
  const retryStep = COORDINATOR_WORKFLOW.slice(retryStepStart);

  assert.match(retryStep, /if:\s*>-\s*\n\s+always\(\) &&/);
  for (const decision of [
    'DISPATCH_REVIEW',
    'WAIT_REVIEW_RECEIPT',
    'ESCALATE_MISSING_RECEIPT',
  ]) {
    assert.match(retryStep, new RegExp(`steps\\.coordinate\\.outputs\\.decision == '${decision}'`));
  }
  assert.match(
    retryStep,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_PR:\s*\$\{\{ steps\.coordinate\.outputs\.pr_number \}\}/,
  );
  assert.match(
    retryStep,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ steps\.coordinate\.outputs\.exact_head \}\}/,
  );
  assert.match(retryStep, /run: node scripts\/retry-independent-review\.mjs/);
  assert.doesNotMatch(retryStep, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_(?:RUN|WORKFLOW)_ID/);
});

test('retry executor has one fixed mutation and no shell, dispatch, ref or merge path', () => {
  assert.match(RETRY_EXECUTOR, /process\.env\.GITHUB_ACTIONS !== 'true'/);
  assert.match(
    RETRY_EXECUTOR,
    /\['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch'\]\.includes\(eventName\)/,
  );
  assert.match(
    RETRY_EXECUTOR,
    /\/actions\/workflows\/\$\{workflowId\}\/runs\?event=pull_request_target/,
  );
  assert.match(RETRY_EXECUTOR, /\/git\/ref\/heads\/main/);
  assert.match(
    RETRY_EXECUTOR,
    /text\(mainRef\?\.object\?\.sha\)\.toLowerCase\(\) !== pr\.baseSha/,
  );
  assert.match(
    RETRY_EXECUTOR,
    /\/actions\/runs\/\$\{plan\.runId\}\/rerun-failed-jobs/,
  );
  assert.equal((RETRY_EXECUTOR.match(/method:\s*'POST'/g) || []).length, 1);
  assert.doesNotMatch(RETRY_EXECUTOR, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_(?:RUN|WORKFLOW)_ID/);
  for (const forbidden of [
    /\/dispatches\b/,
    /\/git\/refs\b/,
    /\/pulls\/[^`'"\s]+\/merge\b/,
    /child_process|execFile|execSync|spawn\s*\(/,
    /force[-_ ]?push|reset --hard|git clean/i,
  ]) {
    assert.equal(forbidden.test(RETRY_EXECUTOR), false, `forbidden retry authority: ${forbidden}`);
  }
});
