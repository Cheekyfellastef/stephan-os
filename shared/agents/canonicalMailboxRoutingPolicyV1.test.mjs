import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  auditCanonicalMailboxReferences,
  canonicalActiveMailboxReference,
  evaluateCanonicalMailboxReference,
} from './canonicalMailboxRoutingPolicyV1.mjs';

test('active routing is admitted only through a canonically derived branded reference', () => {
  const derived = canonicalActiveMailboxReference('runtime-routing');
  const admitted = evaluateCanonicalMailboxReference(derived);
  assert.equal(admitted.ok, true);
  assert.equal(admitted.activeAuthority, true);
  assert.equal(admitted.authoritySource, CANONICAL_MAILBOX_AUTHORITY_SOURCE);
  assert.equal(admitted.hardCodedActiveIssueAllowed, false);

  const forged = evaluateCanonicalMailboxReference({
    issueNumber: 2158,
    usage: 'runtime-routing',
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.blocker, 'CANONICAL_MAILBOX_ACTIVE_REFERENCE_NOT_DERIVED_FROM_AUTHORITY');
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

test('foreign active mailbox identity fails closed even when the caller copies the authority label', () => {
  const result = evaluateCanonicalMailboxReference({
    issueNumber: 3000,
    usage: 'polling',
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CANONICAL_MAILBOX_ACTIVE_REFERENCE_MISMATCH');
  assert.equal(result.expectedIssueNumber, 2158);
});

test('canonical active reference helper refuses non-active usage', () => {
  assert.equal(canonicalActiveMailboxReference('historical'), null);
  assert.equal(canonicalActiveMailboxReference(''), null);
});

test('batch audit preserves historical references while surfacing forged active literal debt', () => {
  const audit = auditCanonicalMailboxReferences([
    { issueNumber: 1507, usage: 'provenance' },
    canonicalActiveMailboxReference('operator-runbook-active'),
    { issueNumber: 2158, usage: 'workflow-guard', authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE },
  ]);
  assert.equal(audit.ok, false);
  assert.equal(audit.blockerCount, 1);
  assert.deepEqual(audit.blockers, ['CANONICAL_MAILBOX_ACTIVE_REFERENCE_NOT_DERIVED_FROM_AUTHORITY']);
});

test('malformed routing audit collection fails closed instead of becoming an empty clean audit', () => {
  for (const references of [null, {}, 'not-an-array']) {
    const audit = auditCanonicalMailboxReferences(references);
    assert.equal(audit.ok, false);
    assert.equal(audit.blockerCount, 1);
    assert.deepEqual(audit.blockers, ['CANONICAL_MAILBOX_REFERENCE_COLLECTION_INVALID']);
  }
});
