import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
  buildProtectedOpenClawMergePlan,
  buildProtectedOperatorWorkflowDispatchArgs,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

const head = '1'.repeat(40);
const base = '2'.repeat(40);
const tree = '3'.repeat(40);

const command = {
  expectedHead: head,
  expectedBase: base,
  prNumber: 1805,
  reviewRunId: 31921493326,
  reviewRunAttempt: 1,
  reviewJobId: 95101935992,
  reviewArtifactId: 9256477379,
  reviewArtifactDigest: `sha256:${'4'.repeat(64)}`,
  reviewPayloadSha256: '5'.repeat(64),
  reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
  reviewFindingCode: '',
  mergeMethod: 'squash',
  mergeApprovalToken: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:1805:${head}`,
  expiresAt: '2026-08-16T04:30:00.000Z',
};

test('derived workflow dispatch is complete and exact-head bound', () => {
  const plan = buildProtectedOpenClawMergePlan(command, {
    now: new Date('2026-08-16T04:00:00.000Z'),
    userProfile: 'C:/Users/Stephan',
  });
  assert.equal(plan.ok, true);
  const args = buildProtectedOperatorWorkflowDispatchArgs(plan, {
    head: { ref: 'agent/example' },
  }, tree);
  const fields = args.filter((value) => typeof value === 'string' && value.includes('='));
  assert.deepEqual(fields, [
    'mode=user-owned-protected-squash',
    'pr_number=1805',
    'expected_branch=agent/example',
    `expected_head=${head}`,
    `expected_head_tree=${tree}`,
    `expected_base=${base}`,
    'independent_review_run_id=31921493326',
    'independent_review_run_attempt=1',
    'independent_review_artifact_id=9256477379',
    `independent_review_artifact_digest=sha256:${'4'.repeat(64)}`,
    `independent_review_payload_sha256=${'5'.repeat(64)}`,
  ]);
});
