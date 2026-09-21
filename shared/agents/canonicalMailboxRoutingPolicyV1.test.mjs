import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  auditCanonicalMailboxReferences,
  evaluateCanonicalMailboxReference,
} from './canonicalMailboxRoutingPolicyV1.mjs';

test('active routing is admitted only through the canonical authority source', () => {
  const admitted = evaluateCanonicalMailboxReference({
    issueNumber: 2158,
    usage: 'runtime-routing',
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.activeAuthority, true);
  assert.equal(admitted.hardCodedActiveIssueAllowed, false);

  const literal = evaluateCanonicalMailboxReference({
    issueNumber: 2158,
    usage: 'runtime-routing',
    authoritySource: 'local-literal',
  });
  assert.equal(literal.ok, false);
  assert.equal(literal.blocker, 'CANONICAL_MAILBOX_ACTIVE_REFERENCE_NOT_DERIVED_FROM_AUTHORITY');
});

test('retired mailbox identity can remain history but cannot become active routing', () => {
  const history = evaluateCanonicalMailboxReference({
    issueNumber: 1507,
    usage: 'historical',
  });
  assert.equal(history.ok, true);
  assert.equal(history.historicalReferenceAllowed, true);

  const active = evaluateCanonicalMailboxReference({
    issueNumber: 1507,
    usage: 'workflow-guard',
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  });
  assert.equal(active.ok, false);
  assert.equal(active.blocker, 'RETIRED_MAILBOX_ACTIVE_REFERENCE_FORBIDDEN');
});

test('foreign active mailbox identity fails closed even when the caller claims canonical provenance', () => {
  const result = evaluateCanonicalMailboxReference({
    issueNumber: 3000,
    usage: 'polling',
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CANONICAL_MAILBOX_ACTIVE_REFERENCE_MISMATCH');
  assert.equal(result.expectedIssueNumber, 2158);
});

test('batch audit preserves historical references while surfacing active literal debt', () => {
  const audit = auditCanonicalMailboxReferences([
    { issueNumber: 1507, usage: 'provenance' },
    { issueNumber: 2158, usage: 'operator-runbook-active', authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE },
    { issueNumber: 2158, usage: 'workflow-guard', authoritySource: 'hard-coded-yaml-literal' },
  ]);
  assert.equal(audit.ok, false);
  assert.equal(audit.blockerCount, 1);
  assert.deepEqual(audit.blockers, ['CANONICAL_MAILBOX_ACTIVE_REFERENCE_NOT_DERIVED_FROM_AUTHORITY']);
});
