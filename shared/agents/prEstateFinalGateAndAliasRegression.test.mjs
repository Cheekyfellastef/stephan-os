import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
} from './prEstateReconciler.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function build(record) {
  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T12:40:00Z',
    pullRequests: [{
      number: 30,
      state: 'open',
      title: 'Final gate regression',
      headSha: SOURCE_SHA,
      dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
      ...record,
    }],
  });
}

test('future same-gate approval condition remains pending', () => {
  const ledger = build({
    body: 'Exact-head approval remains pending until this approval is granted.',
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.deepEqual(ledger.entries[0].blockers, ['operator-approval-required']);
});

test('future same-gate acceptance condition remains pending', () => {
  const ledger = build({
    body: 'Quest acceptance remains pending until this acceptance is completed.',
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
  assert.deepEqual(ledger.entries[0].blockers, ['acceptance-proof-required']);
});

test('conflicting numeric aliases fail closed', () => {
  const ledger = build({
    body: '',
    aheadBy: 0,
    ahead_by: 3,
    comparedHeadSha: SOURCE_SHA,
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(ledger.entries[0].blockers, ['invalid-comparison-evidence']);
  assert.equal(ledger.entries[0].evidence.comparisonAliasConflict, true);
});

test('conflicting compared-head aliases fail closed', () => {
  const ledger = build({
    body: '',
    aheadBy: 0,
    comparedHeadSha: SOURCE_SHA,
    compared_head_sha: OTHER_SHA,
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(ledger.entries[0].blockers, ['invalid-comparison-evidence']);
  assert.equal(ledger.entries[0].evidence.comparisonAliasConflict, true);
});
