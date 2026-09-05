import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MACHINE_COORDINATOR_SENTINEL_LOGIN,
  REVIEW_COORDINATOR_CREDENTIAL_SOURCE,
  normalizeReviewCoordinatorMarkerComments,
  selectReviewCoordinatorCredential,
  selectReviewCoordinatorToken,
  validateReviewCoordinatorActor,
  validateReviewCoordinatorCredential,
} from './exactHeadReviewCoordinatorAuthority.mjs';
import {
  EXACT_HEAD_REVIEW_MARKERS,
} from './exactHeadReviewDispatchCoordinator.mjs';
import {
  INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT,
  INDEPENDENT_REVIEW_RETRY_DECISION,
  planIndependentReviewRetry,
} from './independentReviewRetryPlanner.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  PROTECTED_REVIEW_MARKER,
} from './operatorMergeApprovalGate.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const BRANCH = 'fix/recovery';
const WORKFLOW_ID = 326000001;
const COORDINATOR_WORKFLOW = readFileSync(
  new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n');
const COORDINATOR_RUNNER = readFileSync(
  new URL('../../scripts/exact-head-review-dispatch.mjs', import.meta.url),
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

function machineEnvironment(overrides = {}) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_JOB: 'coordinate',
    GITHUB_WORKFLOW: 'Exact-Head Review Dispatch',
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/exact-head-review-dispatch.yml@refs/heads/main`,
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
    input({ pr: pullRequest({ draft: null }) }),
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

test('retries a failed exact-head review while the PR is still draft', () => {
  const result = planIndependentReviewRetry(input({
    pr: pullRequest({ draft: true }),
  }));
  assert.equal(result.decision, INDEPENDENT_REVIEW_RETRY_DECISION.RERUN_FAILED_JOBS);
  assert.equal(result.mutationAllowed, true);
  assert.equal(result.operation, 'rerun-failed-jobs');
});

test('selects the first nonblank coordinator credential and does not let an empty secret mask the repository token', () => {
  assert.deepEqual(selectReviewCoordinatorCredential({
    STEPHANOS_REVIEW_DISPATCH_TOKEN: 'owner-token',
    GITHUB_TOKEN: 'repository-token',
  }), {
    token: 'owner-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET,
  });
  assert.deepEqual(selectReviewCoordinatorCredential({
    STEPHANOS_REVIEW_DISPATCH_TOKEN: '   ',
    GITHUB_TOKEN: 'repository-token',
    GH_TOKEN: 'fallback-token',
  }), {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  });
  assert.equal(selectReviewCoordinatorToken({
    STEPHANOS_REVIEW_DISPATCH_TOKEN: '',
    GITHUB_TOKEN: '',
    GH_TOKEN: 'fallback-token',
  }), 'fallback-token');
  assert.deepEqual(selectReviewCoordinatorCredential({}), {
    token: '',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.NONE,
  });
});

test('separates owner lane authority from the exact trusted GitHub Actions machine boundary', () => {
  const owner = validateReviewCoordinatorActor(
    { login: 'Cheekyfellastef', type: 'User', id: 267490109 },
    'Cheekyfellastef',
  );
  assert.equal(owner.valid, true);
  assert.equal(owner.mode, 'lane-authority-token');

  const exactBot = validateReviewCoordinatorActor(
    { login: 'github-actions[bot]', type: 'Bot', id: 41898282 },
    'Cheekyfellastef',
  );
  assert.equal(exactBot.valid, true);
  assert.equal(exactBot.mode, 'github-actions-token');

  for (const hostile of [
    { login: 'github-actions[bot]', type: 'Bot', id: 7 },
    { login: 'github-actions[bot]', type: 'User', id: 41898282 },
    { login: 'other-user', type: 'User', id: 267490109 },
  ]) {
    assert.equal(
      validateReviewCoordinatorActor(hostile, 'Cheekyfellastef').valid,
      false,
    );
  }

  const repositoryCredential = {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  };
  const trustedMachine = validateReviewCoordinatorCredential({
    credential: repositoryCredential,
    laneAuthorityLogin: 'Cheekyfellastef',
    environment: machineEnvironment(),
  });
  assert.equal(trustedMachine.valid, true);
  assert.equal(trustedMachine.actorLogin, 'github-actions[bot]');

  for (const hostileEnvironment of [
    machineEnvironment({ GITHUB_ACTIONS: 'false' }),
    machineEnvironment({ GITHUB_JOB: 'verify' }),
    machineEnvironment({ GITHUB_WORKFLOW: 'Lookalike Review Dispatch' }),
    machineEnvironment({ GITHUB_EVENT_NAME: 'pull_request' }),
    machineEnvironment({ GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/lookalike.yml@refs/heads/main` }),
    machineEnvironment({ GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/exact-head-review-dispatch.yml@refs/heads/feature` }),
  ]) {
    assert.equal(validateReviewCoordinatorCredential({
      credential: repositoryCredential,
      laneAuthorityLogin: 'Cheekyfellastef',
      environment: hostileEnvironment,
    }).valid, false);
  }

  const ownerCredential = validateReviewCoordinatorCredential({
    credential: {
      token: 'owner-token',
      source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET,
    },
    authenticatedUser: { login: 'Cheekyfellastef', type: 'User', id: 267490109 },
    laneAuthorityLogin: 'Cheekyfellastef',
    environment: {},
  });
  assert.equal(ownerCredential.valid, true);
  assert.equal(ownerCredential.credentialSource, REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET);
});

test('normalizes only trusted mechanical markers while preserving owner lane evidence and protected review identity', () => {
  const ownerDispatch = {
    id: 1,
    body: `<!-- ${EXACT_HEAD_REVIEW_MARKERS.DISPATCH} head=${HEAD} -->`,
    user: { login: 'Cheekyfellastef', type: 'User', id: 267490109 },
  };
  const botReceipt = {
    id: 2,
    body: `<!-- ${EXACT_HEAD_REVIEW_MARKERS.RECEIPT} head=${HEAD} -->`,
    user: { login: 'github-actions[bot]', type: 'Bot', id: 41898282 },
  };
  const protectedReview = {
    id: 3,
    body: `${PROTECTED_REVIEW_MARKER}\n\`\`\`json\n{}\n\`\`\``,
    user: { login: 'github-actions[bot]', type: 'Bot', id: 41898282 },
  };
  const forgedBotMarker = {
    id: 4,
    body: `<!-- ${EXACT_HEAD_REVIEW_MARKERS.ESCALATION} head=${HEAD} -->`,
    user: { login: 'github-actions[bot]', type: 'Bot', id: 7 },
  };
  const ownerLaneReceipt = {
    id: 5,
    body: '## Programme Completion Controller\n\nActive lane: PR #1638.',
    user: { login: 'Cheekyfellastef', type: 'User', id: 267490109 },
  };
  const comments = [
    ownerDispatch,
    botReceipt,
    protectedReview,
    forgedBotMarker,
    ownerLaneReceipt,
  ];
  const normalized = normalizeReviewCoordinatorMarkerComments(comments, {
    laneAuthorityLogin: 'Cheekyfellastef',
  });

  assert.equal(normalized[0].user.login, MACHINE_COORDINATOR_SENTINEL_LOGIN);
  assert.equal(normalized[1].user.login, MACHINE_COORDINATOR_SENTINEL_LOGIN);
  assert.equal(normalized[2], protectedReview);
  assert.equal(normalized[2].user.login, 'github-actions[bot]');
  assert.equal(normalized[3], forgedBotMarker);
  assert.equal(normalized[4], ownerLaneReceipt);
});

test('trusted workflow serializes every bounded retry under the same PR authority lock', () => {
  assert.match(COORDINATOR_WORKFLOW, /permissions:\s*\n\s+actions: write\b/);
  const retryStepStart = COORDINATOR_WORKFLOW.indexOf(
    '- name: Retry one exact failed canonical independent review',
  );
  assert.ok(retryStepStart >= 0, 'bounded retry step must exist');
  const retryStep = COORDINATOR_WORKFLOW.slice(retryStepStart);

  assert.match(COORDINATOR_WORKFLOW, /targets:\s*\$\{\{ steps\.admit\.outputs\.targets \}\}/);
  assert.match(COORDINATOR_WORKFLOW, /target:\s*\$\{\{ fromJSON\(needs\.plan\.outputs\.targets\) \}\}/);
  assert.match(
    COORDINATOR_WORKFLOW,
    /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}-pr-\$\{\{ matrix\.target\.prNumber \}\}/,
  );
  assert.match(COORDINATOR_WORKFLOW, /steps\.coordinate\.outputs\.retry_targets != '\[\]'/);
  assert.match(COORDINATOR_WORKFLOW, /max-parallel:\s*4/);
  assert.doesNotMatch(COORDINATOR_WORKFLOW, /steps\.coordinate\.outputs\.decision ==/);
  assert.match(
    retryStep,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/,
  );
  assert.match(
    retryStep,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/,
  );
  assert.match(retryStep, /run: node scripts\/retry-independent-review\.mjs/);
  assert.doesNotMatch(retryStep, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_(?:RUN|WORKFLOW)_ID/);
});
test('pull-request planning remains a successful read-only neutral gate', () => {
  const planJob = COORDINATOR_WORKFLOW.match(/^  plan:\n[\s\S]*?^  coordinate:/m)?.[0] || '';
  const neutralStep = planJob.match(
    /^      - name: Publish pull-request neutral planning truth\n[\s\S]*?^      - name: Check out trusted default-branch planner/m,
  )?.[0] || '';
  assert.match(planJob, /^  plan:\n    runs-on: ubuntu-latest/m);
  assert.match(neutralStep, /if: github\.event_name == 'pull_request'/);
  assert.doesNotMatch(neutralStep, /GITHUB_TOKEN|STEPHANOS_|actions: write|issues: write|pull-requests: write/);
  assert.match(
    planJob,
    /Discover canonical PR targets without mutation\n        id: plan\n        if: >-\n          github\.event_name != 'pull_request'/,
  );
});
test('workflow and runner wire repository fallback, owner lane authority and sentinel marker continuity', () => {
  assert.ok(COORDINATOR_WORKFLOW.includes('GITHUB_TOKEN: ${{ github.token }}'));
  assert.ok(COORDINATOR_WORKFLOW.includes('STEPHANOS_REVIEW_LANE_AUTHORITY_LOGIN: ${{ github.repository_owner }}'));
  assert.ok(COORDINATOR_WORKFLOW.includes('node --check shared/agents/exactHeadReviewCoordinatorAuthority.mjs'));
  assert.ok(COORDINATOR_RUNNER.includes('selectReviewCoordinatorCredential(process.env)'));
  assert.ok(COORDINATOR_RUNNER.includes('validateReviewCoordinatorCredential({'));
  assert.ok(COORDINATOR_RUNNER.includes('credential.source === REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS'));
  assert.ok(COORDINATOR_RUNNER.includes('trustedCoordinatorLogin: laneAuthorityLogin'));
  assert.ok(COORDINATOR_RUNNER.includes('normalizeReviewCoordinatorMarkerComments('));
  assert.ok(COORDINATOR_RUNNER.includes('trustedCoordinatorLogin: MACHINE_COORDINATOR_SENTINEL_LOGIN'));
  assert.doesNotMatch(
    COORDINATOR_RUNNER,
    /process\.env\.STEPHANOS_REVIEW_DISPATCH_TOKEN\s*\?\?\s*process\.env\.GITHUB_TOKEN/,
  );
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
