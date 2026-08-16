import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROTECTED_OPENCLAW_MERGE_MODE,
  PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
  PROTECTED_OPERATOR_MERGE_WORKFLOW,
  PROTECTED_OPERATOR_MERGE_WORKFLOW_MODE,
  buildProtectedOpenClawMergePlan,
  buildProtectedOperatorWorkflowDispatchArgs,
  validateProtectedOpenClawMergeCommand,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const DIGEST = `sha256:${'d'.repeat(64)}`;
const PAYLOAD = 'e'.repeat(64);
const NOW = new Date('2026-08-16T03:30:00.000Z');

function common(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'protected-workflow-test-0001',
    operation: 'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    prNumber: 1805,
    expectedBase: BASE,
    reviewRunId: 31921493326,
    reviewRunAttempt: 1,
    reviewJobId: 95101935992,
    reviewArtifactId: 9256477379,
    reviewArtifactDigest: DIGEST,
    reviewPayloadSha256: PAYLOAD,
    mergeMethod: 'squash',
    expiresAt: '2026-08-16T04:00:00.000Z',
    ...overrides,
  };
}

test('qualified bootstrap mode retains its original approval token and finding contract', () => {
  const command = common({
    reviewMode: PROTECTED_OPENCLAW_MERGE_MODE,
    reviewFindingCode: 'approval-boundary-v2-self-change-requires-qualified-review',
    mergeApprovalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1805:${HEAD}`,
  });
  const result = validateProtectedOpenClawMergeCommand(command, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.command.reviewMode, PROTECTED_OPENCLAW_MERGE_MODE);
});

test('clean independent review selects only the canonical protected workflow dispatch contract', () => {
  const command = common({
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: '',
    mergeApprovalToken: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:1805:${HEAD}`,
  });
  const validation = validateProtectedOpenClawMergeCommand(command, { now: NOW });
  assert.equal(validation.ok, true);

  const plan = buildProtectedOpenClawMergePlan(command, {
    now: NOW,
    userProfile: 'C:/Users/Stephan',
  });
  assert.equal(plan.ok, true);
  const args = buildProtectedOperatorWorkflowDispatchArgs(plan, {
    head: { ref: 'agent/forge-m2-podman-prerequisite-bootstrap-v1' },
  }, TREE);
  assert.ok(args);
  assert.deepEqual(args.slice(0, 5), [
    'workflow', 'run', PROTECTED_OPERATOR_MERGE_WORKFLOW,
    '--repo', 'Cheekyfellastef/stephan-os',
  ]);
  assert.ok(args.includes('--ref'));
  assert.ok(args.includes('main'));
  assert.ok(args.includes(`mode=${PROTECTED_OPERATOR_MERGE_WORKFLOW_MODE}`));
  assert.ok(args.includes('pr_number=1805'));
  assert.ok(args.includes('expected_branch=agent/forge-m2-podman-prerequisite-bootstrap-v1'));
  assert.ok(args.includes(`expected_head=${HEAD}`));
  assert.ok(args.includes(`expected_head_tree=${TREE}`));
  assert.ok(args.includes(`expected_base=${BASE}`));
  assert.ok(args.includes('independent_review_run_id=31921493326'));
  assert.ok(args.includes('independent_review_run_attempt=1'));
  assert.ok(args.includes('independent_review_artifact_id=9256477379'));
  assert.ok(args.includes(`independent_review_artifact_digest=${DIGEST}`));
  assert.ok(args.includes(`independent_review_payload_sha256=${PAYLOAD}`));
  assert.equal(args.includes('pr'), false);
  assert.equal(args.includes('merge'), false);
});

test('clean workflow mode rejects bootstrap findings and bootstrap approval tokens', () => {
  const withFinding = validateProtectedOpenClawMergeCommand(common({
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: 'approval-boundary-v2-self-change-requires-qualified-review',
    mergeApprovalToken: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:1805:${HEAD}`,
  }), { now: NOW });
  assert.equal(withFinding.ok, false);
  assert.equal(withFinding.blocker, 'PROTECTED_MERGE_FINDING_NOT_ALLOWED');

  const withBootstrapToken = validateProtectedOpenClawMergeCommand(common({
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: '',
    mergeApprovalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1805:${HEAD}`,
  }), { now: NOW });
  assert.equal(withBootstrapToken.ok, false);
  assert.equal(withBootstrapToken.blocker, 'PROTECTED_MERGE_APPROVAL_TOKEN_INVALID');
});

test('workflow dispatch builder fails closed on an invalid head tree or missing branch', () => {
  const command = common({
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: '',
    mergeApprovalToken: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:1805:${HEAD}`,
  });
  const plan = buildProtectedOpenClawMergePlan(command, { now: NOW, userProfile: 'C:/Users/Stephan' });
  assert.equal(buildProtectedOperatorWorkflowDispatchArgs(plan, { head: { ref: 'branch' } }, 'not-a-tree'), null);
  assert.equal(buildProtectedOperatorWorkflowDispatchArgs(plan, { head: {} }, TREE), null);
});
