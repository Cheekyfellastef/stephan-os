import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  reconcileExistingLaunchReceiptV1,
  selectExactHandoffCommentV1,
  selectExactLaunchReceiptCommentV1,
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

test('an existing launch receipt with no observable dispatch run fails closed instead of silently succeeding', () => {
  const result = reconcileExistingLaunchReceiptV1({ launchReceipt: launchReceipt(), runs: [] });
  assert.equal(result.verdict, 'DISPATCH_RUN_NOT_YET_OBSERVED');
  assert.equal(result.reconciliation, 'BLOCKED_DISPATCH_REQUEST_UNOBSERVED');
  assert.deepEqual(result.blockers, [
    'launch receipt exists but no matching workflow-dispatch run is observable; blind redispatch is forbidden',
  ]);
});

test('launcher has one fixed workflow dispatch mutation, accepts draft review, and has no shell/source/merge authority surface', () => {
  const source = fs.readFileSync(new URL('./launch-missing-independent-review-v1.mjs', import.meta.url), 'utf8');
  assert.match(source, /\/actions\/workflows\/\$\{context\.workflow\.id\}\/dispatches/);
  assert.equal((source.match(/method:\s*'POST'/g) || []).length, 2, 'only launch-receipt comment plus workflow dispatch may POST');
  assert.doesNotMatch(source, /execFile|spawn|child_process|shell:\s*true|git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|\/merges|\/contents\//i);
  assert.match(source, /retryPlan\.decision !== INDEPENDENT_REVIEW_RETRY_DECISION\.NO_MATCHING_RUN/);
  assert.match(source, /Reconstruct the complete trusted context immediately before/);
  assert.match(source, /selectExactLaunchReceiptCommentV1/);
  assert.match(source, /reconcileExistingLaunchReceiptV1/);
  assert.match(source, /BLOCKED_DISPATCH_REQUEST_UNOBSERVED/);
  assert.match(source, /pr\.state\.toLowerCase\(\) !== 'open' \|\| !pr\.sameRepository/);
  assert.doesNotMatch(source, /pr\.state\.toLowerCase\(\) !== 'open' \|\| pr\.draft/);
});
