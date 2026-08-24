import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildSuccessfulReviewArtifactRecoveryV1,
  selectSuccessfulReviewRecoveryLaunchReceiptV1,
} from './recover-successful-independent-review-v1.mjs';
import {
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
  renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const OTHER_HEAD = '3'.repeat(40);
const BOT = { login: 'github-actions[bot]', id: 41898282 };

function launchReceipt({ sourceHead = HEAD, baseSha = BASE } = {}) {
  return buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: {
      schemaVersion: 'stephanos.independent-review-missing-run-launch.v1',
      decision: 'LAUNCH_MISSING_RUN',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1944,
      sourceHead,
      baseSha,
      workflowId: 318073448,
      handoffBindingSha256: 'a'.repeat(64),
      operation: 'workflow-dispatch',
      mutationAllowed: true,
      workflowDispatchInputs: {
        pr_number: '1944',
        source_head: sourceHead,
        base_sha: baseSha,
        head_branch: 'fix/execution-receipt-heartbeat-proof-flake-v1',
        handoff_binding_sha256: 'a'.repeat(64),
        handoff_run_receipt_sha256: 'b'.repeat(64),
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
    requestedAtUtc: '2026-08-22T10:10:05.632Z',
  });
}

function comment(receipt, overrides = {}) {
  return {
    id: 1,
    user: BOT,
    body: renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt),
    ...overrides,
  };
}

function terminalResultComment(receipt, overrides = {}) {
  return comment(receipt, {
    body: renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt)
      .replace(
        '## Provider-neutral independent-review missing-run launch receipt',
        '## Provider-neutral independent-review launch — terminal clean result',
      ),
    ...overrides,
  });
}

test('selects only the trusted exact PR/head/base launch receipt and ignores historical heads', () => {
  const current = launchReceipt();
  const historical = launchReceipt({ sourceHead: OTHER_HEAD });
  const selected = selectSuccessfulReviewRecoveryLaunchReceiptV1([
    comment(historical, { id: 2 }),
    comment(current),
    comment(current, { id: 3, user: { login: 'Cheekyfellastef', id: 267490109 } }),
  ], {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1944,
    expectedHead: HEAD,
    expectedBase: BASE,
  });
  assert.equal(selected.launchKeySha256, current.launchKeySha256);
});

test('ignores trusted historical terminal-result comments that reuse the launch marker prefix', () => {
  const current = launchReceipt();
  const selected = selectSuccessfulReviewRecoveryLaunchReceiptV1([
    terminalResultComment(current, { id: 2 }),
    comment(current),
  ], {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1944,
    expectedHead: HEAD,
    expectedBase: BASE,
  });
  assert.equal(selected.launchKeySha256, current.launchKeySha256);
});

test('fails closed when exact launch receipt evidence is missing or duplicated', () => {
  const current = launchReceipt();
  const options = {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1944,
    expectedHead: HEAD,
    expectedBase: BASE,
  };
  assert.throws(() => selectSuccessfulReviewRecoveryLaunchReceiptV1([], options), /count must be one/);
  assert.throws(
    () => selectSuccessfulReviewRecoveryLaunchReceiptV1([comment(current), comment(current, { id: 4 })], options),
    /count must be one/,
  );
});

test('only an exact successful terminal reconciliation requests immutable artifact recovery', () => {
  const recovery = buildSuccessfulReviewArtifactRecoveryV1({
    reconciliation: 'ALREADY_SUCCESSFUL',
    conclusion: 'success',
    runId: 32570000001,
    runAttempt: 2,
  });
  assert.deepEqual(recovery, {
    decision: 'RECOVER_SUCCESSFUL_REVIEW_ARTIFACT',
    recoveryRequired: true,
    runId: 32570000001,
    runAttempt: 2,
    artifactName: 'stephanos-independent-review-32570000001-attempt-2',
  });

  const waiting = buildSuccessfulReviewArtifactRecoveryV1({
    reconciliation: 'WAIT_RUNNING',
    conclusion: null,
    runId: 32570000001,
    runAttempt: 1,
  });
  assert.equal(waiting.recoveryRequired, false);
  assert.equal(waiting.artifactName, null);

  assert.throws(
    () => buildSuccessfulReviewArtifactRecoveryV1({
      reconciliation: 'ALREADY_SUCCESSFUL',
      conclusion: 'failure',
      runId: 32570000001,
      runAttempt: 1,
    }),
    /requires one exact successful run id and attempt/,
  );
});

test('recovery helper is read-only and delegates run discovery/reconciliation to canonical Stage-2 machinery', () => {
  const source = fs.readFileSync(new URL('./recover-successful-independent-review-v1.mjs', import.meta.url), 'utf8');
  assert.match(source, /loadWorkflowDispatchRuns/);
  assert.match(source, /reconcileExistingLaunchReceiptV1/);
  assert.match(source, /ALREADY_SUCCESSFUL/);
  assert.match(source, /stephanos-independent-review-\$\{runId\}-attempt-\$\{runAttempt\}/);
  assert.doesNotMatch(source, /method:\s*'POST'|\/dispatches|rerun-failed-jobs|execFile|spawn|child_process|shell:\s*true|git\s+(?:push|reset|clean|rebase)|\/merges|\/contents\//i);
});
