import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as duplicateGuard from './protectedWorkflowDispatchMailboxV1.mjs';
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
  validateProtectedWorkflowActorHandoff,
  protectedWorkflowAuthorizationCommentSha256,
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
  updated_at: AUTHORED.toISOString(),
  user: Object.freeze({ login: PROTECTED_WORKFLOW_DISPATCH_AUTHOR, id: 267490109, type: 'User' }),
  body: `before\n\`\`\`${PROTECTED_WORKFLOW_DISPATCH_MARKER}\n${JSON.stringify(baseCommand)}\n\`\`\`\nafter`,
});

test('actor handoff authenticates the exact immutable owner packet for either carrier', () => {
  for (const transportActor of [PROTECTED_WORKFLOW_DISPATCH_AUTHOR, 'github-actions[bot]']) {
    const proof = validateProtectedWorkflowActorHandoff(authorizationComment, baseCommand, {
      transportActor, transportActorId: transportActor === PROTECTED_WORKFLOW_DISPATCH_AUTHOR ? 267490109 : 41898282,
      expectedCommentId: AUTHORIZATION_COMMENT_ID, now: NOW,
    });
    assert.equal(proof.ok, true, proof.blocker);
    assert.equal(proof.authorization.operatorAuthor, PROTECTED_WORKFLOW_DISPATCH_AUTHOR);
    assert.equal(proof.authorization.transportActor, transportActor);
    assert.match(proof.authorization.commentSha256, /^[a-f0-9]{64}$/);
  }
});

test('handoff fails closed for altered comment, stale transport and every detached source/review hash', () => {
  const options = { transportActor: 'github-actions[bot]', transportActorId: 41898282, expectedCommentId: AUTHORIZATION_COMMENT_ID, now: NOW };
  for (const field of ['expectedHead', 'expectedHeadTree', 'expectedBase', 'independentReviewArtifactDigest', 'independentReviewPayloadSha256']) {
    assert.equal(validateProtectedWorkflowActorHandoff(authorizationComment, {
      ...baseCommand, [field]: field === 'independentReviewArtifactDigest' ? `sha256:${'a'.repeat(64)}` : 'a'.repeat(field.includes('Sha256') ? 64 : 40),
    }, options).ok, false, field);
  }
  for (const field of ['independentReviewRunId', 'independentReviewRunAttempt', 'independentReviewArtifactId']) {
    assert.equal(validateProtectedWorkflowActorHandoff(authorizationComment, { ...baseCommand, [field]: baseCommand[field] + 1 }, options).ok, false, field);
  }
  for (const comment of [
    { ...authorizationComment, user: { login: 'github-actions[bot]' } },
    { ...authorizationComment, user: { ...authorizationComment.user, id: 41898282 } },
    { ...authorizationComment, updated_at: NOW.toISOString() },
    { ...authorizationComment, updated_at: undefined },
    { ...authorizationComment, created_at: 'invalid' },
    { ...authorizationComment, id: AUTHORIZATION_COMMENT_ID + 1 },
    { ...authorizationComment, issue_url: authorizationComment.issue_url.replace('/' + PROTECTED_WORKFLOW_DISPATCH_ISSUE, '/2808') },
  ]) assert.equal(validateProtectedWorkflowActorHandoff(comment, baseCommand, options).ok, false);
  assert.equal(validateProtectedWorkflowActorHandoff(authorizationComment, baseCommand, { ...options, transportActor: 'lookalike' }).ok, false);
  assert.equal(validateProtectedWorkflowActorHandoff(authorizationComment, baseCommand, { ...options, transportActorId: 267490109 }).ok, false);
  assert.equal(validateProtectedWorkflowActorHandoff(authorizationComment, baseCommand, { ...options, now: new Date('2026-08-30T07:10:00Z') }).ok, false);
  assert.equal(validateProtectedWorkflowActorHandoff(authorizationComment, baseCommand, { ...options, now: new Date('2026-08-30T06:48:00Z') }).ok, false);
  assert.equal(validateProtectedWorkflowActorHandoff({ ...authorizationComment, body: authorizationComment.body + 'changed' }, baseCommand, {
    ...options, expectedCommentSha256: protectedWorkflowAuthorizationCommentSha256(authorizationComment),
  }).blocker, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_DIGEST_MISMATCH');
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

function movedExecution() {
  return {
    ...baseCommand,
    requestId: 'protected-dispatch-pr1951-refresh-002',
    expectedHead: 'a'.repeat(40),
    expectedHeadTree: 'b'.repeat(40),
    expectedBase: 'c'.repeat(40),
    independentReviewRunId: baseCommand.independentReviewRunId + 100,
    independentReviewRunAttempt: 2,
    independentReviewArtifactId: baseCommand.independentReviewArtifactId + 100,
    independentReviewArtifactDigest: `sha256:${'d'.repeat(64)}`,
    independentReviewPayloadSha256: 'e'.repeat(64),
  };
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

test('final execution reproof derives historical material identity from the owner comment without caller authority inputs', () => {
  const moved = movedExecution();
  const accepted = validateProtectedWorkflowAuthorizationComment(authorizationComment, moved, {
    now: new Date('2026-08-30T07:10:00.000Z'),
    expectedCommentId: AUTHORIZATION_COMMENT_ID,
  });
  assert.equal(accepted.ok, true, accepted.blocker);
  assert.equal(accepted.historicalExecutionIdentity, true);
  assert.equal(accepted.materialAuthorization.authorizationHead, baseCommand.expectedHead);
  assert.equal(accepted.materialAuthorization.authorizationHeadTree, baseCommand.expectedHeadTree);
  assert.equal(accepted.materialAuthorization.authorizationBase, baseCommand.expectedBase);
});

test('explicit material expectation remains exact and partial caller material identity fails closed', () => {
  const moved = movedExecution();
  const explicit = {
    ...moved,
    authorizationHead: baseCommand.expectedHead,
    authorizationHeadTree: baseCommand.expectedHeadTree,
    authorizationBase: baseCommand.expectedBase,
  };
  const accepted = validateProtectedWorkflowAuthorizationComment(authorizationComment, explicit, {
    now: NOW,
    expectedCommentId: AUTHORIZATION_COMMENT_ID,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.historicalExecutionIdentity, false);

  assert.equal(validateProtectedWorkflowAuthorizationComment(
    authorizationComment,
    { ...moved, authorizationHead: baseCommand.expectedHead },
    { now: NOW, expectedCommentId: AUTHORIZATION_COMMENT_ID },
  ).blocker, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_MATERIAL_EXPECTATION_INCOMPLETE');

  assert.equal(validateProtectedWorkflowAuthorizationComment(
    authorizationComment,
    { ...explicit, authorizationBase: '1'.repeat(40) },
    { now: NOW, expectedCommentId: AUTHORIZATION_COMMENT_ID },
  ).blocker, 'PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_IDENTITY_MISMATCH');
});

test('authorization comment provenance and exact-mode expiry remain strict', () => {
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
  const explicit = {
    ...baseCommand,
    authorizationHead: baseCommand.expectedHead,
    authorizationHeadTree: baseCommand.expectedHeadTree,
    authorizationBase: baseCommand.expectedBase,
  };
  assert.equal(validateProtectedWorkflowAuthorizationComment(authorizationComment, explicit, {
    now: new Date('2026-08-30T06:56:00.000Z'),
    expectedCommentId: AUTHORIZATION_COMMENT_ID,
  }).blocker, 'PROTECTED_WORKFLOW_DISPATCH_EXPIRED');
});

test('merge maps only to fixed canonical workflow filename, ref and fresh execution inputs', () => {
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
  assert.equal(Object.hasOwn(request.body.inputs, 'authorization_head'), false);
  assert.equal(Object.hasOwn(request.body.inputs, 'authorization_head_tree'), false);
  assert.equal(Object.hasOwn(request.body.inputs, 'authorization_base'), false);
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


test('protected mailbox refuses a second identical run before any workflow dispatch', () => {
  const { inspectProtectedWorkflowDuplicateDispatchRuns: inspect } = duplicateGuard;
  const HEAD = baseCommand.expectedHead;
  const BASE = baseCommand.expectedBase;
  const expected = { expectedHead: HEAD, expectedBase: BASE };
  const run = (status, overrides = {}) => ({
    id: 38967178500, name: 'Protected operator merge ' + HEAD,
    display_title: 'Protected operator merge ' + HEAD,
    event: 'workflow_dispatch', head_sha: BASE, head_branch: 'main',
    status, conclusion: status === 'completed' ? 'failure' : null, ...overrides,
  });
  assert.equal(inspect([], expected).ok, true);
  assert.equal(inspect([run('waiting')], expected).blocker,
    'PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
  assert.equal(inspect([run('completed')], expected).blocker,
    'PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
  assert.equal(inspect([run('in_progress')], expected).blocker,
    'PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
  assert.equal(inspect([run('queued')], expected).blocker,
    'PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
  assert.equal(inspect([run('waiting', { name: 'altered' })], expected).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_RUN_IDENTITY_UNVERIFIABLE');
  assert.equal(inspect([run('waiting', { head_sha: HEAD })], expected).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_RUN_IDENTITY_UNVERIFIABLE');
  assert.equal(inspect([run('waiting', { name: 'Protected operator merge ' + BASE,
    display_title: 'Protected operator merge ' + BASE })], expected).ok, true);
  assert.equal(inspect([run('waiting', { id: 0 })], expected).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_RUN_IDENTITY_UNVERIFIABLE');
  assert.equal(inspect(null, expected).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
  assert.equal(inspect(new Array(601).fill(run('waiting')), expected).blocker,
    'PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
});

test('dispatch entrypoint checks the complete bounded run estate before POST', () => {
  const script = readFileSync('scripts/dispatch-protected-merge-from-mailbox.mjs', 'utf8');
  assert.match(script, /async function rejectPriorProtectedDispatch\(command\)/);
  assert.match(script, /actions\/workflows\/operator-merge-approval-gate\.yml\/runs/);
  assert.match(script, /head_sha=\$\{command.expectedBase\}/);
  assert.match(script, /result\.total_count !== expectedTotal/);
  assert.ok(script.indexOf('await rejectPriorProtectedDispatch(command);')
    < script.indexOf('const dispatch = buildProtectedWorkflowDispatchRequest'));
  const workflow = readFileSync('.github/workflows/protected-workflow-dispatch-mailbox.yml', 'utf8');
  assert.match(workflow, /group: protected-workflow-dispatch-mailbox-\$\{\{ github\.event\.comment\.user\.login/);
  assert.doesNotMatch(workflow, /group: protected-workflow-dispatch-mailbox-\$\{\{ github\.event\.comment\.id/);
});


function readOnlyRetryFixture(attempts = 1) {
  const repository = 'Cheekyfellastef/stephan-os';
  const id = 38967178500;
  const title = 'Protected operator merge ' + baseCommand.expectedHead;
  const run = { id, run_attempt: attempts, workflow_id: 12345, name: title, display_title: title,
    event: 'workflow_dispatch', head_sha: baseCommand.expectedBase, head_branch: 'main',
    repository: { full_name: repository }, path: '.github/workflows/operator-merge-approval-gate.yml',
    triggering_actor: { login: 'github-actions[bot]', id: 41898282 },
    status: 'completed', conclusion: 'failure' };
  const jobs = Array.from({ length: attempts }, (_, index) => {
    const attempt = index + 1;
    return [
      ['personal-repository-evidence', 'failure'],
      ['operator-personal-repository-approval', 'skipped'],
      ['operator-personal-repository-squash-merge', 'skipped'],
    ].map(([name, conclusion], offset) => {
      const jobId = attempt * 100 + offset + 1;
      return { id: jobId, run_id: id, run_attempt: attempt, workflow_name: title,
        head_branch: 'main', head_sha: baseCommand.expectedBase, name, status: 'completed', conclusion,
        url: 'https://api.github.com/repos/' + repository + '/actions/jobs/' + jobId,
        run_url: 'https://api.github.com/repos/' + repository + '/actions/runs/' + id,
        check_run_url: 'https://api.github.com/repos/' + repository + '/check-runs/' + jobId,
        html_url: 'https://github.com/' + repository + '/actions/runs/' + id + '/job/' + jobId };
    });
  }).flat();
  return { run, jobs, priorRunJobSets: [{ runId: id, jobs }] };
}

test('mailbox shares the executor read-only failure proof and admits no other replay', () => {
  const inspect = duplicateGuard.inspectProtectedWorkflowDuplicateDispatchRuns;
  const fixture = readOnlyRetryFixture(2);
  assert.equal(inspect([fixture.run], baseCommand).ok, false);
  const accepted = inspect([fixture.run], baseCommand, { priorRunJobSets: fixture.priorRunJobSets });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.retryablePriorFailures[0].runAttempt, 2);
  for (const mutate of [
    f => { f.jobs = f.jobs.filter(j => j.run_attempt === 2); },
    f => { f.jobs[2].conclusion = 'success'; },
    f => { f.jobs[1].status = 'in_progress'; },
    f => { f.jobs[0].run_id += 1; },
    f => { f.jobs[0].head_sha = 'f'.repeat(40); },
    f => { f.jobs[0].url += '/forged'; },
    f => { f.jobs.push({ ...f.jobs[0] }); },
    f => { f.run.conclusion = 'success'; },
    f => { f.run.status = 'waiting'; },
    f => { f.run.path = '.github/workflows/other.yml'; },
    f => { f.run.repository.full_name = 'other/repository'; },
    f => { f.run.triggering_actor.id = 999; },
    f => { f.run.run_attempt = 9; },
  ]) {
    const hostile = readOnlyRetryFixture(2);
    mutate(hostile);
    assert.equal(inspect([hostile.run], baseCommand,
      { priorRunJobSets: [{ runId: hostile.run.id, jobs: hostile.jobs }] }).ok, false);
  }
  assert.equal(inspect([fixture.run], baseCommand,
    { priorRunJobSets: [...fixture.priorRunJobSets, ...fixture.priorRunJobSets] }).ok, false);
  assert.equal(inspect(Array.from({length: 9}, (_, n) => ({ ...fixture.run, id: fixture.run.id + n })),
    baseCommand, { priorRunJobSets: fixture.priorRunJobSets }).ok, false);
});
