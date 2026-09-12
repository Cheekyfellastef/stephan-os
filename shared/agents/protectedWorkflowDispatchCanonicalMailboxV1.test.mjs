import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_MODE,
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
  validateProtectedWorkflowDispatch,
} from './protectedWorkflowDispatchMailboxV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const DIGEST = `sha256:${'d'.repeat(64)}`;
const PAYLOAD = 'e'.repeat(64);
const NOW = new Date('2026-09-12T06:20:00.000Z');

function command(issueNumber = PROTECTED_WORKFLOW_DISPATCH_ISSUE) {
  return {
    schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
    requestId: 'protected-mailbox-2158-regression-v1',
    operation: PROTECTED_WORKFLOW_DISPATCH_OPERATION,
    repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
    issueNumber,
    operatorApproval: 'operator-approved',
    expiresAt: '2026-09-12T06:25:00.000Z',
    mode: PROTECTED_WORKFLOW_DISPATCH_MODE,
    prNumber: 2181,
    expectedBranch: 'fix/example',
    expectedHead: HEAD,
    expectedHeadTree: TREE,
    expectedBase: BASE,
    independentReviewRunId: 1,
    independentReviewRunAttempt: 1,
    independentReviewArtifactId: 1,
    independentReviewArtifactDigest: DIGEST,
    independentReviewPayloadSha256: PAYLOAD,
  };
}

test('protected workflow relay is bound to canonical mailbox 2158 and rejects retired 1507', () => {
  assert.equal(PROTECTED_WORKFLOW_DISPATCH_ISSUE, 2158);

  const accepted = validateProtectedWorkflowDispatch(command(2158), {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: 2158,
    now: NOW,
    authoredAt: new Date('2026-09-12T06:19:00.000Z'),
  });
  assert.equal(accepted.ok, true);

  const retired = validateProtectedWorkflowDispatch(command(1507), {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: 1507,
    now: NOW,
    authoredAt: new Date('2026-09-12T06:19:00.000Z'),
  });
  assert.equal(retired.ok, false);
  assert.equal(retired.blocker, 'PROTECTED_WORKFLOW_DISPATCH_ISSUE_MISMATCH');

  const workflow = readFileSync('.github/workflows/protected-workflow-dispatch-mailbox.yml', 'utf8');
  assert.match(workflow, /github\.event\.issue\.number == 2158/);
  assert.doesNotMatch(workflow, /github\.event\.issue\.number == 1507/);
  assert.match(workflow, /stephanos-protected-workflow-dispatch/);
});
