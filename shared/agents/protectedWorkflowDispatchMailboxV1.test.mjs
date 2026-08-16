import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_MARKER,
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_PATH,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  buildProtectedWorkflowDispatchReceipt,
  buildProtectedWorkflowDispatchRequest,
  extractProtectedWorkflowDispatch,
  validateProtectedWorkflowDispatch,
} from './protectedWorkflowDispatchMailboxV1.mjs';

const NOW = new Date('2026-08-16T03:00:00.000Z');
const AUTHORED = new Date('2026-08-16T02:59:00.000Z');
const command = Object.freeze({
  schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  requestId: 'protected-dispatch-pr1805-001',
  operation: PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  operatorApproval: 'operator-approved',
  expiresAt: '2026-08-16T03:05:00.000Z',
  mode: 'user-owned-protected-squash',
  prNumber: 1805,
  expectedBranch: 'agent/forge-m2-podman-prerequisite-bootstrap-v1',
  expectedHead: '72c4de7438b1fddc7272f0f1c3b3267b028bfbea',
  expectedHeadTree: '0b180dc7ba462a5490093c8e633bbc57a1d3aa08',
  expectedBase: '27d897d05836d48204df5e9e5dc1102970b9ecfe',
  independentReviewRunId: 31921493326,
  independentReviewRunAttempt: 1,
  independentReviewArtifactId: 9256477379,
  independentReviewArtifactDigest: 'sha256:3466bb6765b621514e1e1078e2dfcd31035514c479e8f661e6d7430b478ba8f3',
  independentReviewPayloadSha256: '1543c6ebfb4b2942417e2c3c977ee52985fa86a67e12109363ce07d00fac92c7',
});

function validate(candidate = command, overrides = {}) {
  return validateProtectedWorkflowDispatch(candidate, {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    now: NOW,
    authoredAt: AUTHORED,
    ...overrides,
  });
}

test('extracts the dedicated protected workflow fence only', () => {
  const body = `before\n\`\`\`${PROTECTED_WORKFLOW_DISPATCH_MARKER}\n${JSON.stringify(command)}\n\`\`\`\nafter`;
  assert.deepEqual(extractProtectedWorkflowDispatch(body), { ok: true, command: { ...command } });
  assert.equal(extractProtectedWorkflowDispatch('```stephanos-battle-bridge-command\n{}\n```').blocker,
    'PROTECTED_WORKFLOW_DISPATCH_MARKER_MISSING');
});

test('accepts only the closed-world protected merge dispatch shape', () => {
  const result = validate();
  assert.equal(result.ok, true);
  assert.equal(result.command.prNumber, 1805);
  assert.equal(result.command.mode, 'user-owned-protected-squash');
});

test('rejects wrong author, issue, operation and arbitrary fields', () => {
  assert.equal(validate(command, { authorLogin: 'github-actions[bot]' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_AUTHOR_NOT_ALLOWED');
  assert.equal(validate(command, { issueNumber: 1508 }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_ISSUE_MISMATCH');
  assert.equal(validate({ ...command, operation: 'DISPATCH_ANY_WORKFLOW' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_OPERATION_NOT_ALLOWED');
  assert.equal(validate({ ...command, workflow: 'evil.yml' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_FIELD_NOT_ALLOWED');
  assert.equal(validate({ ...command, ref: 'feature' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_FIELD_NOT_ALLOWED');
  assert.equal(validate({ ...command, command: 'rm -rf .' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_FIELD_NOT_ALLOWED');
});

test('rejects malformed immutable identities and overlong authorization windows', () => {
  assert.equal(validate({ ...command, expectedHead: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_HEAD_INVALID');
  assert.equal(validate({ ...command, expectedHeadTree: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_INVALID');
  assert.equal(validate({ ...command, independentReviewArtifactDigest: 'sha256:abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_ARTIFACT_DIGEST_INVALID');
  assert.equal(validate({ ...command, expiresAt: '2026-08-16T03:20:00.000Z' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_EXPIRY_TOO_FAR_AHEAD');
});

test('maps only to the fixed canonical workflow and fixed main ref', () => {
  const request = buildProtectedWorkflowDispatchRequest(command);
  assert.equal(request.ok, true);
  assert.equal(request.path,
    `/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/actions/workflows/${PROTECTED_WORKFLOW_DISPATCH_PATH}/dispatches`);
  assert.equal(request.method, 'POST');
  assert.equal(request.body.ref, 'main');
  assert.deepEqual(Object.keys(request.body.inputs).sort(), [
    'expected_base', 'expected_branch', 'expected_head', 'expected_head_tree',
    'independent_review_artifact_digest', 'independent_review_artifact_id',
    'independent_review_payload_sha256', 'independent_review_run_attempt',
    'independent_review_run_id', 'mode', 'pr_number',
  ].sort());
});

test('dispatch receipt records zero arbitrary execution authority', () => {
  const receipt = buildProtectedWorkflowDispatchReceipt(command, NOW);
  assert.equal(receipt.workflow, PROTECTED_WORKFLOW_DISPATCH_PATH);
  assert.equal(receipt.workflowRef, 'main');
  assert.equal(receipt.prNumber, 1805);
  assert.equal(receipt.arbitraryWorkflowAllowed, false);
  assert.equal(receipt.arbitraryRefAllowed, false);
  assert.equal(receipt.arbitraryInputAllowed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.credentialExportAllowed, false);
});
