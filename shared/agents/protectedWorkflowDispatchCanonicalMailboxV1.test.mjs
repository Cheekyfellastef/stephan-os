import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
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
const RETIRED_MAILBOX_ISSUE = 1507;

function command(issueNumber = PROTECTED_WORKFLOW_DISPATCH_ISSUE) {
  return {
    schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
    requestId: 'protected-mailbox-canonical-regression-v1',
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

test('protected workflow relay derives the canonical mailbox authority and rejects retired 1507', () => {
  assert.equal(PROTECTED_WORKFLOW_DISPATCH_ISSUE, CANONICAL_MAILBOX_ISSUE);

  const accepted = validateProtectedWorkflowDispatch(command(CANONICAL_MAILBOX_ISSUE), {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    now: NOW,
    authoredAt: new Date('2026-09-12T06:19:00.000Z'),
  });
  assert.equal(accepted.ok, true);

  const retired = validateProtectedWorkflowDispatch(command(RETIRED_MAILBOX_ISSUE), {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: RETIRED_MAILBOX_ISSUE,
    now: NOW,
    authoredAt: new Date('2026-09-12T06:19:00.000Z'),
  });
  assert.equal(retired.ok, false);
  assert.equal(retired.blocker, 'PROTECTED_WORKFLOW_DISPATCH_ISSUE_MISMATCH');

  const workflow = readFileSync('.github/workflows/protected-workflow-dispatch-mailbox.yml', 'utf8');
  assert.match(workflow, new RegExp(`github\\.event\\.issue\\.number == ${CANONICAL_MAILBOX_ISSUE}`));
  assert.doesNotMatch(workflow, new RegExp(`github\\.event\\.issue\\.number == ${RETIRED_MAILBOX_ISSUE}`));
  assert.match(workflow, /stephanos-protected-workflow-dispatch/);
});
