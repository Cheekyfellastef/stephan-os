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

test('rejects malformed execution and material-authorization identities', () => {
  assert.equal(validate({ ...baseCommand, expectedHead: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_HEAD_INVALID');
  assert.equal(validate({ ...baseCommand, expectedHeadTree: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_INVALID');
  assert.equal(validate({ ...baseCommand, expectedBranch: 'agent/../main' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_BRANCH_INVALID');
  assert.equal(validate({ ...baseCommand, authorizationHead: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_HEAD_INVALID');
  assert.equal(validate({ ...baseCommand, authorizationHeadTree: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_HEAD_TREE_INVALID');
  assert.equal(validate({ ...baseCommand, authorizationBase: 'abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_BASE_INVALID');
  assert.equal(validate({ ...baseCommand, independentReviewArtifactDigest: 'sha256:abc' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_ARTIFACT_DIGEST_INVALID');
  assert.equal(validate({ ...baseCommand, expiresAt: '2026-08-30T07:20:00.000Z' }).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_EXPIRY_TOO_FAR_AHEAD');
});

test('legacy exact authorization defaults material identity to the original exact execution tuple', () => {
  const result = validate(baseCommand);
  assert.equal(result.ok, true);
  assert.equal(result.command.authorizationHead, baseCommand.expectedHead);
  assert.equal(result.command.authorizationHeadTree, baseCommand.expectedHeadTree);
  assert.equal(result.command.authorizationBase, baseCommand.expectedBase);
});

test('re-proves one owner-authored material authorization while allowing fresh technical evidence to rotate', () => {
  const movedExecution = {
    ...baseCommand,
    requestId: 'protected-dispatch-pr1951-refresh-002',
    expectedHead: 'a'.repeat(40),
    expectedHeadTree: 'b'.repeat(40),
    expectedBase: 'c'.repeat(40),
    authorizationHead: baseCommand.expectedHead,
    authorizationHeadTree: baseCommand.expectedHeadTree,
    authorizationBase: baseCommand.expectedBase,
    independentReviewRunId: baseCommand.independentReviewRunId + 100,
    independentReviewRunAttempt: 2,
    independentReviewArtifactId: baseCommand.independentReviewArtifactId + 100,
    independentReviewArtifactDigest: `sha256:${'d'.repeat(64)}`,
    independentReviewPayloadSha256: 'e'.repeat(64),
  };
  const accepted = validateProtectedWorkflowAuthorizationComment(authorizationComment, movedExecution, {
    now: NOW,
    expectedCommentId: AUTHORIZATION_COMMENT_ID,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.materialAuthorization.authorizationHead, baseCommand.expectedHead);
  assert.equal(accepted.materialAuthorization.authorizationHeadTree, baseCommand.expectedHeadTree);
  assert.equal(accepted.materialAuthorization.authorizationBase, baseCommand.expectedBase);

  for (const [field, value] of [
    ['prNumber', 1952],
    ['expectedBranch', 'agent/other-v1'],
    ['authorizationHead', 'f'.repeat(40)],
    ['authorizationHeadTree', '0'.repeat(40)],
    ['authorizationBase', '1'.repeat(40)],
  ]) {
    assert.equal(validateProtectedWorkflowAuthorizationComment(
      authorizationComment,
      { ...movedExecution, [field]: value },
      { now: NOW, expectedCommentId: AUTHORIZATION_COMMENT_ID },
    ).blocker, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_IDENTITY_MISMATCH');
  }
});

test('authorization comment provenance and expiry remain exact', () => {
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
});

test('merge maps only to fixed canonical workflow filename, ref and separate authorization/execution inputs', () => {
  const request = buildProtectedWorkflowDispatchRequest(baseCommand, {
    authorizationCommentId: AUTHORIZATION_COMMENT_ID,
  });
  assert.equal(request.ok, true);
  assert.equal(PROTECTED_WORKFLOW_DISPATCH_PATH, '.github/workflows/operator-merge-approval-gate.yml');
  assert.equal(PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID, 'operator-merge-approval-gate.yml');
  assert.equal(request.path,
    `/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/actions/workflows/${PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID}/dispatches`);
  assert.equal(request.method, 'POST');
  assert.equal(request.body.ref, 'main');
  assert.equal(request.body.inputs.mode, PROTECTED_WORKFLOW_DISPATCH_MODE);
  assert.equal(request.body.inputs.authorization_comment_id, String(AUTHORIZATION_COMMENT_ID));
  assert.equal(request.body.inputs.authorization_head, baseCommand.expectedHead);
  assert.equal(request.body.inputs.authorization_head_tree, baseCommand.expectedHeadTree);
  assert.equal(request.body.inputs.authorization_base, baseCommand.expectedBase);
  assert.deepEqual(Object.keys(request.body.inputs).sort(), [
    'authorization_base', 'authorization_comment_id', 'authorization_head', 'authorization_head_tree',
    'expected_base', 'expected_branch', 'expected_head', 'expected_head_tree',
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

test('ready transitions remain exact and cannot inherit main-movement tolerance', () => {
  assert.equal(validate(readyOnlyCommand).ok, true);
  assert.equal(validate({ ...readyOnlyCommand, authorizationBase: 'd'.repeat(40) }).blocker,
    'PROTECTED_WORKFLOW_READY_AUTHORIZATION_MUST_BE_EXACT_EXECUTION_IDENTITY');
  assert.equal(validate({ ...readyOnlyCommand, authorizationHead: 'd'.repeat(40) }).blocker,
    'PROTECTED_WORKFLOW_READY_AUTHORIZATION_MUST_BE_EXACT_EXECUTION_IDENTITY');
  assert.equal(validate({ ...readyOnlyCommand, authorizationHeadTree: 'd'.repeat(40) }).blocker,
    'PROTECTED_WORKFLOW_READY_AUTHORIZATION_MUST_BE_EXACT_EXECUTION_IDENTITY');
});

test('receipts preserve both material authorization and execution identity without granting new authority', () => {
  const movementCommand = {
    ...baseCommand,
    expectedHead: 'a'.repeat(40),
    expectedHeadTree: 'b'.repeat(40),
    expectedBase: 'c'.repeat(40),
    authorizationHead: baseCommand.expectedHead,
    authorizationHeadTree: baseCommand.expectedHeadTree,
    authorizationBase: baseCommand.expectedBase,
  };
  const receipt = buildProtectedWorkflowDispatchReceipt(movementCommand, NOW, 'PROTECTED_EXECUTION_PENDING');
  assert.equal(receipt.expectedHead, movementCommand.expectedHead);
  assert.equal(receipt.expectedBase, movementCommand.expectedBase);
  assert.equal(receipt.authorizationHead, baseCommand.expectedHead);
  assert.equal(receipt.authorizationBase, baseCommand.expectedBase);
  assert.equal(receipt.arbitraryWorkflowAllowed, false);
  assert.equal(receipt.arbitraryRefAllowed, false);
  assert.equal(receipt.arbitraryInputAllowed, false);
  assert.equal(receipt.arbitraryGraphqlAllowed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.credentialExportAllowed, false);
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

test('merge schema still requires fresh independent review identity', () => {
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
