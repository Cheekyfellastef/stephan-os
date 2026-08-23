import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  loadWorkflowDispatchRuns,
  parseWorkflowDispatchRunAcknowledgementV1,
  reconcileExistingLaunchReceiptV1,
  renderWorkflowDispatchRunAcknowledgementV1,
  selectExactHandoffCommentV1,
  selectExactLaunchReceiptCommentV1,
  validateWorkflowDispatchCreationResponseV1,
} from './launch-missing-independent-review-v1.mjs';
import {
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
  renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const HANDOFF = 'a'.repeat(64);
const RECEIPT = 'b'.repeat(64);
const BOT = { login: 'github-actions[bot]', id: 41898282 };

function launchReceipt() {
  return buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: {
      schemaVersion: 'stephanos.independent-review-missing-run-launch.v1',
      decision: 'LAUNCH_MISSING_RUN',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1910,
      sourceHead: HEAD,
      baseSha: BASE,
      workflowId: 123,
      handoffBindingSha256: HANDOFF,
      operation: 'workflow-dispatch',
      mutationAllowed: true,
      workflowDispatchInputs: {
        pr_number: '1910',
        source_head: HEAD,
        base_sha: BASE,
        head_branch: 'agent/openclaw-oc1',
        handoff_binding_sha256: HANDOFF,
        handoff_run_receipt_sha256: RECEIPT,
      },
      requiredRevalidation: {
        currentMain: true,
        pullRequestIdentity: true,
        workflowIdentity: true,
        coordinatorWorkflowRun: true,
        handoffComment: true,
        coordinatorHandoffRunReceipt: true,
        exactRunAbsenceImmediatelyBeforeDispatch: true,
      },
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
    },
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
  });
}

function dispatchRun(receipt, overrides = {}) {
  return {
    id: 500,
    workflow_id: 123,
    name: 'Independent Merge Security Review',
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: 'Cheekyfellastef/stephan-os' },
    head_branch: 'main',
    head_sha: BASE,
    display_title: receipt.runName,
    created_at: '2026-08-20T10:00:01.000Z',
    run_attempt: 1,
    status: 'completed',
    conclusion: 'failure',
    ...overrides,
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(payload); },
  };
}

test('selects exactly one trusted exact-head handoff and at most one content-addressed launch receipt', () => {
  const handoff = {
    id: 10,
    user: BOT,
    body: `<!-- stephanos:exact-head-review-dispatch:v1 head=${HEAD} -->\n## Provider-neutral exact-head review handoff`,
  };
  assert.equal(selectExactHandoffCommentV1([handoff], HEAD), handoff);
  assert.throws(() => selectExactHandoffCommentV1([], HEAD), /count must be one/);
  assert.throws(() => selectExactHandoffCommentV1([handoff, { ...handoff, id: 11 }], HEAD), /count must be one/);

  const receipt = launchReceipt();
  const launch = { id: 20, user: BOT, body: renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt) };
  assert.equal(selectExactLaunchReceiptCommentV1([launch], receipt.launchKeySha256), launch);
  assert.equal(selectExactLaunchReceiptCommentV1([], receipt.launchKeySha256), null);
  assert.throws(
    () => selectExactLaunchReceiptCommentV1([launch, { ...launch, id: 21 }], receipt.launchKeySha256),
    /count exceeds one/,
  );
});

test('workflow dispatch creation response binds one exact returned Actions run id and canonical URLs', () => {
  const response = {
    workflow_run_id: 500,
    run_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/actions/runs/500',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/500',
  };
  assert.deepEqual(validateWorkflowDispatchCreationResponseV1(response, {
    owner: 'Cheekyfellastef', repo: 'stephan-os',
  }), {
    workflowRunId: 500,
    runUrl: response.run_url,
    htmlUrl: response.html_url,
  });
  assert.throws(
    () => validateWorkflowDispatchCreationResponseV1({ ...response, workflow_run_id: 0 }, {
      owner: 'Cheekyfellastef', repo: 'stephan-os',
    }),
    /positive run id/,
  );
  assert.throws(
    () => validateWorkflowDispatchCreationResponseV1({ ...response, run_url: response.run_url.replace('/500', '/501') }, {
      owner: 'Cheekyfellastef', repo: 'stephan-os',
    }),
    /run URLs do not match/,
  );
});

test('dispatch acknowledgement is content-addressed to the launch receipt and exact returned run id', () => {
  const receipt = launchReceipt();
  const response = {
    workflow_run_id: 500,
    run_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/actions/runs/500',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/500',
  };
  const rendered = renderWorkflowDispatchRunAcknowledgementV1(receipt, response);
  const parsed = parseWorkflowDispatchRunAcknowledgementV1(rendered, receipt);
  assert.equal(parsed.workflowRunId, 500);
  assert.equal(parsed.launchKeySha256, receipt.launchKeySha256);
  assert.equal(parsed.runUrl, response.run_url);
  assert.equal(parsed.htmlUrl, response.html_url);
  assert.equal(parseWorkflowDispatchRunAcknowledgementV1('no acknowledgement', receipt), null);
  assert.throws(
    () => parseWorkflowDispatchRunAcknowledgementV1(`${rendered}\n${rendered}`, receipt),
    /count must be at most one/,
  );
});

test('acknowledged dispatch run is loaded directly by exact id without relying on workflow-run list visibility', async () => {
  const receipt = launchReceipt();
  const response = {
    workflow_run_id: 500,
    run_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/actions/runs/500',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/500',
  };
  const launchBody = [
    renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt),
    '',
    renderWorkflowDispatchRunAcknowledgementV1(receipt, response),
  ].join('\n');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes('/issues/1910/comments?')) {
      return jsonResponse([{ id: 20, user: BOT, body: launchBody }]);
    }
    if (value.endsWith('/actions/runs/500')) return jsonResponse(dispatchRun(receipt));
    throw new Error(`unexpected request ${value}`);
  };
  try {
    const runs = await loadWorkflowDispatchRuns('Cheekyfellastef', 'stephan-os', 123, 'test-token', receipt);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, 500);
    assert.equal(runs[0].display_title, receipt.runName);
    assert.equal(calls.length, 2);
    assert.equal(calls.some((value) => value.includes('/actions/workflows/123/runs?')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an existing launch receipt with no observable dispatch run fails closed instead of silently succeeding', () => {
  const result = reconcileExistingLaunchReceiptV1({ launchReceipt: launchReceipt(), runs: [] });
  assert.equal(result.verdict, 'DISPATCH_RUN_NOT_YET_OBSERVED');
  assert.equal(result.reconciliation, 'BLOCKED_DISPATCH_REQUEST_UNOBSERVED');
  assert.equal(result.mutationAllowed, false);
  assert.deepEqual(result.blockers, [
    'launch receipt exists but no matching workflow-dispatch run is observable; blind redispatch is forbidden',
  ]);
});

test('one exact failed workflow-dispatch review may use the existing failed-job-only retry budget', () => {
  const receipt = launchReceipt();
  const result = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt)],
  });
  assert.equal(result.verdict, 'DISPATCH_RUN_TERMINAL');
  assert.equal(result.reconciliation, 'RERUN_FAILED_JOBS');
  assert.equal(result.runId, 500);
  assert.equal(result.runAttempt, 1);
  assert.equal(result.mutationAllowed, true);
  assert.equal(result.operation, 'rerun-failed-jobs');
});

test('workflow-dispatch retry remains bounded and non-failure conclusions fail closed', () => {
  const receipt = launchReceipt();
  const exhausted = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, { run_attempt: 2 })],
  });
  assert.equal(exhausted.reconciliation, 'RETRY_BUDGET_EXHAUSTED');
  assert.equal(exhausted.mutationAllowed, false);

  const cancelled = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, { conclusion: 'cancelled' })],
  });
  assert.equal(cancelled.reconciliation, 'BLOCKED_CONCLUSION');
  assert.equal(cancelled.mutationAllowed, false);

  const running = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, { status: 'in_progress', conclusion: null })],
  });
  assert.equal(running.reconciliation, 'WAIT_RUNNING');
  assert.equal(running.mutationAllowed, false);

  const successful = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, { conclusion: 'success' })],
  });
  assert.equal(successful.reconciliation, 'ALREADY_SUCCESSFUL');
  assert.equal(successful.mutationAllowed, false);
});

test('launcher has one fixed workflow dispatch with returned run identity, one exact failed-job retry, accepts draft review, and has no shell/source/merge authority surface', () => {
  const source = fs.readFileSync(new URL('./launch-missing-independent-review-v1.mjs', import.meta.url), 'utf8');
  assert.match(source, /const API_VERSION = '2026-03-10'/);
  assert.match(source, /\/actions\/workflows\/\$\{context\.workflow\.id\}\/dispatches/);
  assert.match(source, /return_run_details:\s*true/);
  assert.match(source, /INDEPENDENT_REVIEW_MISSING_RUN_RUN_ID/);
  assert.match(source, /method:\s*'PATCH'/);
  assert.match(source, /\/issues\/comments\/\$\{positiveInteger\(created\?\.id\)\}/);
  assert.match(source, /\/actions\/runs\/\$\{reconciliation\.runId\}\/rerun-failed-jobs/);
  assert.equal((source.match(/method:\s*'POST'/g) || []).length, 3, 'only launch-receipt comment, workflow dispatch, and exact failed-job retry may POST');
  assert.equal((source.match(/method:\s*'PATCH'/g) || []).length, 1, 'only the exact launch comment may be patched with returned run identity');
  assert.doesNotMatch(source, /execFile|spawn|child_process|shell:\s*true|git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|\/merges|\/contents\//i);
  assert.match(source, /retryPlan\.decision !== INDEPENDENT_REVIEW_RETRY_DECISION\.NO_MATCHING_RUN/);
  assert.match(source, /INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT/);
  assert.match(source, /reconciliation\.reconciliation === 'RERUN_FAILED_JOBS'/);
  assert.match(source, /Reconstruct the complete trusted context immediately before/);
  assert.match(source, /selectExactLaunchReceiptCommentV1/);
  assert.match(source, /parseWorkflowDispatchRunAcknowledgementV1/);
  assert.match(source, /reconcileExistingLaunchReceiptV1/);
  assert.match(source, /BLOCKED_DISPATCH_REQUEST_UNOBSERVED/);
  assert.match(source, /pr\.state\.toLowerCase\(\) !== 'open' \|\| !pr\.sameRepository/);
  assert.doesNotMatch(source, /pr\.state\.toLowerCase\(\) !== 'open' \|\| pr\.draft/);
});
