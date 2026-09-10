import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_JOB,
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  buildProtectedSecurityReviewReceipt,
} from './operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  EXACT_HEAD_REVIEW_DECISION,
  REQUIRED_EXACT_HEAD_WORKFLOWS,
  REQUIRED_EXACT_HEAD_WORKFLOW_PATHS,
  evaluateExactHeadReviewDispatch,
} from './exactHeadReviewDispatchCoordinator.mjs';

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
const TRUSTED_COORDINATOR = 'Cheekyfellastef';
const GITHUB_ACTIONS = Object.freeze({ login: 'github-actions[bot]', type: 'Bot', id: 41898282 });

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function launchReceipt() {
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
  };
  return {
    schemaVersion: 'stephanos.independent-review-workflow-dispatch-launch-receipt.v1',
    ...binding,
    launchKeySha256: digest(binding),
    runName: `stephanos-independent-review-pr-${PR_NUMBER}-head-${HEAD}-binding-${HANDOFF_BINDING}`,
    requestedAtUtc: '2026-08-25T17:35:00.000Z',
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

function launchComment(receipt = launchReceipt()) {
  return {
    id: 7001,
    user: GITHUB_ACTIONS,
    createdAt: '2026-08-25T17:35:01Z',
    body: [
      `<!-- ${INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER} key=${receipt.launchKeySha256} -->`,
      '## Provider-neutral independent-review missing-run launch receipt',
      '',
      '```json',
      JSON.stringify(receipt, null, 2),
      '```',
    ].join('\n'),
  };
}

function reviewReceiptComment() {
  const receipt = buildProtectedSecurityReviewReceipt({
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    branch: BRANCH,
    sourceHead: HEAD,
    workflowRunId: RUN_ID,
    workflowRunAttempt: RUN_ATTEMPT,
    timestampUtc: '2026-08-25T17:36:30Z',
    analysis: {
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: [],
      counts: { P0: 0, P1: 0, P2: 0 },
      verdict: 'clean',
      proofRefs: ['proofs/changed-file/shared/agents/goalBuildingAgentV1.evaluator.mjs'],
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
    },
  });
  return {
    id: 7002,
    user: GITHUB_ACTIONS,
    createdAt: '2026-08-25T17:36:30Z',
    body: `<!-- stephanos-protected-security-review -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
  };
}

function dispatchRun(receipt = launchReceipt()) {
  return {
    id: RUN_ID,
    run_attempt: RUN_ATTEMPT,
    workflow_id: WORKFLOW_ID,
    name: receipt.runName,
    display_title: receipt.runName,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'workflow_dispatch',
    repository: { full_name: REPOSITORY },
    head_branch: 'main',
    head_sha: BASE,
    created_at: '2026-08-25T17:35:02Z',
    status: 'completed',
    conclusion: 'success',
    pull_requests: [],
  };
}

function reviewJobs() {
  return [{
    id: 9001,
    name: INDEPENDENT_REVIEW_JOB,
    run_attempt: RUN_ATTEMPT,
    run_url: `https://api.github.com/repos/${REPOSITORY}/actions/runs/${RUN_ID}`,
    status: 'completed',
    conclusion: 'success',
  }];
}

function successfulRuns() {
  return REQUIRED_EXACT_HEAD_WORKFLOWS.map((name, index) => ({
    id: index + 1,
    name,
    workflowPath: REQUIRED_EXACT_HEAD_WORKFLOW_PATHS[name],
    headSha: HEAD,
    status: 'completed',
    conclusion: 'success',
    updatedAt: `2026-08-25T17:3${index}:00Z`,
  }));
}

function input(overrides = {}) {
  const launch = launchReceipt();
  const run = dispatchRun(launch);
  return {
    repository: REPOSITORY,
    now: '2026-08-25T17:37:00Z',
    trustedCoordinatorLogin: TRUSTED_COORDINATOR,
    canonicalLaneConfirmed: true,
    pr: {
      number: PR_NUMBER,
      state: 'open',
      baseRef: 'main',
      baseSha: BASE,
      headRef: BRANCH,
      headSha: HEAD,
      sameRepository: true,
    },
    workflowRuns: successfulRuns(),
    independentReviewWorkflowId: WORKFLOW_ID,
    independentReviewRuns: [run],
    independentReviewJobsByRunId: { [String(RUN_ID)]: reviewJobs() },
    unresolvedThreadCount: 0,
    comments: [launchComment(launch), reviewReceiptComment()],
    reviews: [],
    ...overrides,
  };
}

test('exact-head coordinator records a clean exact workflow-dispatch review receipt', () => {
  const result = evaluateExactHeadReviewDispatch(input());
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(result.externalReceiptId, 7002);
  assert.equal(result.providerNeutralReceipt?.verdict, 'clean');
});

test('same clean review artifact is not admitted without its exact trusted launch receipt', () => {
  const result = evaluateExactHeadReviewDispatch(input({ comments: [reviewReceiptComment()] }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
  assert.equal(result.providerNeutralReceipt, undefined);
});
