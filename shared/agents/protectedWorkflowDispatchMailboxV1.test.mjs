import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_MARKER,
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_READY_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_PATH,
  PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  PROTECTED_WORKFLOW_DISPATCH_MODE,
  PROTECTED_WORKFLOW_READY_MODE,
  buildProtectedWorkflowDispatchReceipt,
  buildProtectedWorkflowDispatchRequest,
  extractProtectedWorkflowDispatch,
  validateProtectedWorkflowAuthorizationComment,
  validateProtectedWorkflowDispatch,
} from './protectedWorkflowDispatchMailboxV1.mjs';

const NOW = new Date('2026-08-30T06:50:00.000Z');
const AUTHORED = new Date('2026-08-30T06:49:00.000Z');
const AUTHORIZATION_COMMENT_ID = 5470670379;
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

const readyOnlyCommand = Object.freeze({
  schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  requestId: 'protected-ready-pr1868-001',
  operation: PROTECTED_WORKFLOW_READY_OPERATION,
  repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  operatorApproval: 'operator-approved',
  expiresAt: '2026-08-30T06:55:00.000Z',
  mode: PROTECTED_WORKFLOW_READY_MODE,
  prNumber: 1868,
  expectedBranch: 'agent/personal-repository-bootstrap-policy-v1',
  expectedHead: 'a'.repeat(40),
  expectedHeadTree: 'b'.repeat(40),
  expectedBase: 'c'.repeat(40),
});

const authorizationComment = Object.freeze({
  id: AUTHORIZATION_COMMENT_ID,
  issue_url: `https://api.github.com/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/issues/${PROTECTED_WORKFLOW_DISPATCH_ISSUE}`,
  created_at: AUTHORED.toISOString(),
  user: Object.freeze({ login: PROTECTED_WORKFLOW_DISPATCH_AUTHOR }),
  body: `before\n\`\`\`${PROTECTED_WORKFLOW_DISPATCH_MARKER}\n${JSON.stringify(baseCommand)}\n\`\`\`\nafter`,
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
    ['workflow', 'evil.yml'],
    ['workflowId', 'evil.yml'],
    ['workflowPath', '.github/workflows/evil.yml'],
    ['ref', 'feature'],
    ['url', 'https://example.invalid/evil'],
    ['query', 'mutation Evil'],
    ['graphql', 'mutation Evil'],
    ['command', 'rm -rf .'],
    ['shell', 'bash'],
    ['powershell', 'Write-Host evil'],
    ['token', 'secret'],
    ['credential', 'secret'],
    ['operator', PROTECTED_WORKFLOW_DISPATCH_AUTHOR],
    ['authorizationCommentId', AUTHORIZATION_COMMENT_ID],
    ['authorization_comment_id', AUTHORIZATION_COMMENT_ID],
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

test('re-proves one exact owner-authored authorization comment and rejects provenance drift', () => {
  const accepted = validateProtectedWorkflowAuthorizationComment(authorizationComment, baseCommand, {
    now: NOW,
    expectedCommentId: AUTHORIZATION_COMMENT_ID,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.commentId, AUTHORIZATION_COMMENT_ID);
  assert.equal(accepted.command.requestId, baseCommand.requestId);

  assert.equal(validateProtectedWorkflowAuthorizationComment({
    ...authorizationComment,
    user: { login: 'github-actions[bot]' },
  }, baseCommand, { now: NOW, expectedCommentId: AUTHORIZATION_COMMENT_ID }).blocker,
  'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_AUTHOR_MISMATCH');
  assert.equal(validateProtectedWorkflowAuthorizationComment({
    ...authorizationComment,
    issue_url: `https://api.github.com/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/issues/1508`,
  }, baseCommand, { now: NOW, expectedCommentId: AUTHORIZATION_COMMENT_ID }).blocker,
  'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_ISSUE_MISMATCH');
  assert.equal(validateProtectedWorkflowAuthorizationComment(authorizationComment, baseCommand, {
    now: NOW,
    expectedCommentId: AUTHORIZATION_COMMENT_ID + 1,
  }).blocker, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_ID_MISMATCH');
  assert.equal(validateProtectedWorkflowAuthorizationComment(authorizationComment, baseCommand, {
    now: new Date('2026-08-30T06:56:00.000Z'),
    expectedCommentId: AUTHORIZATION_COMMENT_ID,
  }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_EXPIRED');

  for (const [field, value] of [
    ['prNumber', 1952],
    ['expectedBranch', 'agent/other-v1'],
    ['expectedHead', 'a'.repeat(40)],
    ['expectedHeadTree', 'b'.repeat(40)],
    ['expectedBase', 'c'.repeat(40)],
    ['independentReviewRunId', baseCommand.independentReviewRunId + 1],
    ['independentReviewRunAttempt', 2],
    ['independentReviewArtifactId', baseCommand.independentReviewArtifactId + 1],
    ['independentReviewArtifactDigest', `sha256:${'d'.repeat(64)}`],
    ['independentReviewPayloadSha256', 'e'.repeat(64)],
  ]) {
    assert.equal(validateProtectedWorkflowAuthorizationComment(
      authorizationComment,
      { ...baseCommand, [field]: value },
      { now: NOW, expectedCommentId: AUTHORIZATION_COMMENT_ID },
    ).blocker, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_IDENTITY_MISMATCH');
  }
});

test('merge maps only to fixed canonical workflow filename, ref and exact provenance-bound inputs', () => {
  const request = buildProtectedWorkflowDispatchRequest(baseCommand, {
    authorizationCommentId: AUTHORIZATION_COMMENT_ID,
  });
  assert.equal(request.ok, true);
  assert.equal(PROTECTED_WORKFLOW_DISPATCH_PATH, '.github/workflows/operator-merge-approval-gate.yml');
  assert.equal(PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID, 'operator-merge-approval-gate.yml');
  assert.equal(request.path,
    `/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/actions/workflows/${PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID}/dispatches`);
  assert.equal(request.path.includes('/.github/workflows/'), false);
  assert.equal(request.method, 'POST');
  assert.equal(request.body.ref, 'main');
  assert.equal(request.body.inputs.mode, PROTECTED_WORKFLOW_DISPATCH_MODE);
  assert.equal(request.body.inputs.authorization_comment_id, String(AUTHORIZATION_COMMENT_ID));
  assert.deepEqual(Object.keys(request.body.inputs).sort(), [
    'authorization_comment_id', 'expected_base', 'expected_branch', 'expected_head', 'expected_head_tree',
    'independent_review_artifact_digest', 'independent_review_artifact_id',
    'independent_review_payload_sha256', 'independent_review_run_attempt',
    'independent_review_run_id', 'mode', 'pr_number',
  ].sort());
  assert.equal(buildProtectedWorkflowDispatchRequest(baseCommand).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_COMMENT_ID_INVALID');
  assert.equal(buildProtectedWorkflowDispatchRequest(readyCommand, {
    authorizationCommentId: AUTHORIZATION_COMMENT_ID,
  }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_REQUEST_NOT_MERGE_OPERATION');
});

test('receipts preserve canonical workflow identity and keep ready separate from merge/runtime authority', () => {
  const receipt = buildProtectedWorkflowDispatchReceipt(readyCommand, NOW, 'READY_FOR_REVIEW_PROVEN');
  assert.equal(receipt.operation, PROTECTED_WORKFLOW_READY_OPERATION);
  assert.equal(receipt.mode, PROTECTED_WORKFLOW_READY_MODE);
  assert.equal(receipt.workflow, PROTECTED_WORKFLOW_DISPATCH_PATH);
  assert.equal(receipt.workflowRef, 'main');
  assert.equal(receipt.lifecycleResult, 'READY_FOR_REVIEW_PROVEN');
  assert.equal(receipt.arbitraryWorkflowAllowed, false);
  assert.equal(receipt.arbitraryRefAllowed, false);
  assert.equal(receipt.arbitraryInputAllowed, false);
  assert.equal(receipt.arbitraryGraphqlAllowed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.credentialExportAllowed, false);
  assert.equal(receipt.mergeAuthorityByReadyOperation, false);
  assert.equal(receipt.directMainWriteAllowed, false);
  assert.equal(receipt.deploymentAuthority, false);
  assert.equal(receipt.runtimeMutationAuthority, false);
  assert.equal(receipt.providerQualificationAuthority, false);
});

test('ready-only schema omits independent review identity', () => {
  const result = validate(readyOnlyCommand);
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.command.independentReviewRunId, 0);
  assert.equal(result.command.independentReviewRunAttempt, 0);
  assert.equal(result.command.independentReviewArtifactId, 0);
  assert.equal(result.command.independentReviewArtifactDigest, '');
  assert.equal(result.command.independentReviewPayloadSha256, '');
});

test('ready-only schema preserves immutable identity checks', () => {
  assert.equal(validate({ ...readyOnlyCommand, expectedHead: 'bad' }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_HEAD_INVALID');
  assert.equal(validate({ ...readyOnlyCommand, expectedHeadTree: 'bad' }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_INVALID');
  assert.equal(validate({ ...readyOnlyCommand, expectedBase: 'bad' }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_BASE_INVALID');
  assert.equal(validate({ ...readyOnlyCommand, expiresAt: '2026-08-30T06:49:30.000Z' }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_EXPIRED');
});

test('merge schema still requires independent review identity', () => {
  const missingRun = { ...baseCommand };
  delete missingRun.independentReviewRunId;
  assert.equal(validate(missingRun).blocker, 'PROTECTED_WORKFLOW_DISPATCH_REVIEW_IDENTITY_INVALID');
  const missingDigest = { ...baseCommand };
  delete missingDigest.independentReviewArtifactDigest;
  assert.equal(validate(missingDigest).blocker, 'PROTECTED_WORKFLOW_DISPATCH_ARTIFACT_DIGEST_INVALID');
  const missingPayload = { ...baseCommand };
  delete missingPayload.independentReviewPayloadSha256;
  assert.equal(validate(missingPayload).blocker, 'PROTECTED_WORKFLOW_DISPATCH_PAYLOAD_DIGEST_INVALID');
});
