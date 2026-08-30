import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_MARKER,
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_READY_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_PATH,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  PROTECTED_WORKFLOW_DISPATCH_MODE,
  PROTECTED_WORKFLOW_READY_MODE,
  buildProtectedWorkflowDispatchReceipt,
  buildProtectedWorkflowDispatchRequest,
  extractProtectedWorkflowDispatch,
  validateProtectedWorkflowDispatch,
} from './protectedWorkflowDispatchMailboxV1.mjs';

const NOW = new Date('2026-08-30T06:50:00.000Z');
const AUTHORED = new Date('2026-08-30T06:49:00.000Z');
const baseCommand = Object.freeze({
  schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  requestId: 'protected-dispatch-pr1951-001',
  operation: PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  operatorApproval: 'operator-approved',
  expiresAt: '2026-08-30T06:55:00.000Z',
  mode: PROTECTED_WORKFLOW_DISPATCH_MODE,
  prNumber: 1951,
  expectedBranch: 'agent/elastic-independent-review-pool-v1',
  expectedHead: '3'.repeat(40),
  expectedHeadTree: '4'.repeat(40),
  expectedBase: '5'.repeat(40),
  independentReviewRunId: 33261050983,
  independentReviewRunAttempt: 1,
  independentReviewArtifactId: 9717259828,
  independentReviewArtifactDigest: `sha256:${'8'.repeat(64)}`,
  independentReviewPayloadSha256: '9'.repeat(64),
});
const readyCommand = Object.freeze({
  ...baseCommand,
  requestId: 'protected-ready-pr1951-001',
  operation: PROTECTED_WORKFLOW_READY_OPERATION,
  mode: PROTECTED_WORKFLOW_READY_MODE,
});

function validate(candidate = baseCommand, overrides = {}) {
  return validateProtectedWorkflowDispatch(candidate, {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    now: NOW,
    authoredAt: AUTHORED,
    ...overrides,
  });
}

test('extracts only the dedicated protected workflow fence', () => {
  const body = `before\n\`\`\`${PROTECTED_WORKFLOW_DISPATCH_MARKER}\n${JSON.stringify(readyCommand)}\n\`\`\`\nafter`;
  assert.deepEqual(extractProtectedWorkflowDispatch(body), { ok: true, command: { ...readyCommand } });
  assert.equal(extractProtectedWorkflowDispatch('```stephanos-battle-bridge-command\n{}\n```').blocker,
    'PROTECTED_WORKFLOW_DISPATCH_MARKER_MISSING');
});

test('accepts exactly merge and draft-to-ready operation/mode pairs', () => {
  assert.equal(validate(baseCommand).ok, true);
  assert.equal(validate(readyCommand).ok, true);
  assert.equal(validate({ ...baseCommand, mode: PROTECTED_WORKFLOW_READY_MODE }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_MODE_INVALID');
  assert.equal(validate({ ...readyCommand, mode: PROTECTED_WORKFLOW_DISPATCH_MODE }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_MODE_INVALID');
});

test('rejects wrong author, issue, arbitrary operation and arbitrary capability fields', () => {
  assert.equal(validate(baseCommand, { authorLogin: 'github-actions[bot]' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_AUTHOR_NOT_ALLOWED');
  assert.equal(validate(baseCommand, { issueNumber: 1508 }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_ISSUE_MISMATCH');
  assert.equal(validate({ ...baseCommand, operation: 'DISPATCH_ANY_WORKFLOW' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_OPERATION_NOT_ALLOWED');
  for (const [field, value] of [
    ['workflow', 'evil.yml'], ['ref', 'feature'], ['command', 'rm -rf .'], ['query', 'mutation Evil'],
  ]) {
    assert.equal(validate({ ...baseCommand, [field]: value }).blocker,
      'PROTECTED_WORKFLOW_DISPATCH_FIELD_NOT_ALLOWED');
  }
});

test('rejects malformed immutable identities, branch traversal and overlong windows', () => {
  assert.equal(validate({ ...baseCommand, expectedHead: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_HEAD_INVALID');
  assert.equal(validate({ ...baseCommand, expectedHeadTree: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_INVALID');
  assert.equal(validate({ ...baseCommand, expectedBranch: 'agent/../main' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_BRANCH_INVALID');
  assert.equal(validate({ ...baseCommand, independentReviewArtifactDigest: 'sha256:abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_ARTIFACT_DIGEST_INVALID');
  assert.equal(validate({ ...baseCommand, expiresAt: '2026-08-30T07:20:00.000Z' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_EXPIRY_TOO_FAR_AHEAD');
});

test('merge maps only to fixed canonical workflow/ref and exact 11 inputs', () => {
  const request = buildProtectedWorkflowDispatchRequest(baseCommand);
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
  assert.equal(buildProtectedWorkflowDispatchRequest(readyCommand).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_REQUEST_NOT_MERGE_OPERATION');
});

test('receipts keep ready operation separate from merge/runtime/deployment authority', () => {
  const receipt = buildProtectedWorkflowDispatchReceipt(readyCommand, NOW, 'READY_FOR_REVIEW_PROVEN');
  assert.equal(receipt.operation, PROTECTED_WORKFLOW_READY_OPERATION);
  assert.equal(receipt.mode, PROTECTED_WORKFLOW_READY_MODE);
  assert.equal(receipt.lifecycleResult, 'READY_FOR_REVIEW_PROVEN');
  assert.equal(receipt.arbitraryWorkflowAllowed, false);
  assert.equal(receipt.arbitraryGraphqlAllowed, false);
  assert.equal(receipt.mergeAuthorityByReadyOperation, false);
  assert.equal(receipt.directMainWriteAllowed, false);
  assert.equal(receipt.deploymentAuthority, false);
  assert.equal(receipt.runtimeMutationAuthority, false);
});
