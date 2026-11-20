import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
  validatePrEstateLedger,
} from './prEstateReconciler.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function single(record) {
  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T13:05:00Z',
    pullRequests: [{
      number: 50,
      state: 'open',
      title: 'Qualified completion regression',
      headSha: SOURCE_SHA,
      dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
      ...record,
    }],
  });
}

test('desktop-qualified acceptance completion does not clear pending Quest acceptance', () => {
  const ledger = single({
    body: 'Quest acceptance remains pending. This acceptance was completed for the desktop build.',
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
  assert.deepEqual(ledger.entries[0].blockers, ['acceptance-proof-required']);
});

test('another-branch approval completion does not clear pending exact-head approval', () => {
  const ledger = single({
    body: 'Exact-head approval remains pending. This approval was granted for another branch.',
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.deepEqual(ledger.entries[0].blockers, ['operator-approval-required']);
});

test('bare exact same-gate completion can close the earlier pending acceptance statement', () => {
  const ledger = single({
    body: 'Live acceptance required on Quest; this acceptance is now complete.',
  });

  assert.notEqual(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
});

test('persisted alias conflicts cannot be forged into an already-in-main disposition', () => {
  const ledger = single({
    body: '',
    headRefOid: OTHER_SHA,
    aheadBy: 0,
    comparedHeadSha: SOURCE_SHA,
  });

  const entry = ledger.entries[0];
  assert.equal(entry.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.equal(entry.evidence.identityAliasConflict, true);

  entry.disposition = PR_DISPOSITIONS.ALREADY_IN_MAIN;
  entry.reason = 'forged terminal disposition';
  entry.blockers = [];
  entry.evidence.compareKnown = true;
  entry.evidence.comparisonHeadMatches = true;
  entry.evidence.headContainedInBase = true;

  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /non-ambiguous-with-conflicting-evidence-alias:50/);
});
