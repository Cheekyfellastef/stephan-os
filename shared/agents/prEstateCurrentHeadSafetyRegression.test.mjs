import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
  validatePrEstateLedger,
} from './prEstateReconciler.mjs';

const HEAD_SHA = 'a'.repeat(40);

function build(pullRequests, families = []) {
  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T16:00:00Z',
    pullRequests,
    families,
  });
}

test('rejects self-targeted supersession in classification and persisted validation', () => {
  const ledger = build(
    [{
      number: 301,
      state: 'open',
      title: 'Singleton canonical survivor',
      headSha: HEAD_SHA,
      dispositionHint: PR_DISPOSITIONS.SUPERSEDED,
      patchEquivalentTo: 301,
      supersessionSourceHeadSha: HEAD_SHA,
      supersessionTargetPr: 301,
      supersessionTargetHeadSha: HEAD_SHA,
    }],
    [{ id: 'singleton-canonical', members: [301], canonicalPr: 301 }],
  );

  const [entry] = ledger.entries;
  assert.equal(entry.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(entry.blockers, ['self-supersession-target']);

  entry.disposition = PR_DISPOSITIONS.SUPERSEDED;
  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /superseded-targets-self:301/);
});

test('persisted ledgers reject malformed unique-delta evidence after disposition tampering', () => {
  const ledger = build([{
    number: 302,
    state: 'open',
    title: 'Malformed unique delta',
    headSha: HEAD_SHA,
    aheadBy: 0,
    comparedHeadSha: HEAD_SHA,
    uniqueDelta: 'false',
  }]);

  const [entry] = ledger.entries;
  assert.equal(entry.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.equal(entry.evidence.invalidUniqueDelta, true);

  entry.disposition = PR_DISPOSITIONS.ALREADY_IN_MAIN;
  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /non-ambiguous-with-invalid-unique-delta:302/);
});
