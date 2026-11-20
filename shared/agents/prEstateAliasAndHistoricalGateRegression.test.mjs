import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
} from './prEstateReconciler.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const CANONICAL_SHA = 'c'.repeat(40);

function single(record) {
  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T12:50:00Z',
    pullRequests: [{
      number: 40,
      state: 'open',
      title: 'Alias and gate regression',
      headSha: SOURCE_SHA,
      dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
      ...record,
    }],
  });
}

test('conflicting PR-head aliases fail closed', () => {
  const ledger = single({
    headRefOid: OTHER_SHA,
    aheadBy: 0,
    comparedHeadSha: SOURCE_SHA,
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(ledger.entries[0].blockers, ['conflicting-evidence-alias']);
  assert.equal(ledger.entries[0].evidence.identityAliasConflict, true);
});

test('conflicting supersession source-head aliases fail closed', () => {
  const ledger = buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T12:50:00Z',
    pullRequests: [
      {
        number: 41,
        state: 'open',
        title: 'Earlier implementation',
        headSha: SOURCE_SHA,
        patchEquivalentTo: 42,
        supersessionSourceHeadSha: SOURCE_SHA,
        comparedSourceHeadSha: OTHER_SHA,
        supersessionTargetPr: 42,
        supersessionTargetHeadSha: CANONICAL_SHA,
      },
      {
        number: 42,
        state: 'open',
        title: 'Canonical implementation',
        headSha: CANONICAL_SHA,
      },
    ],
    families: [{
      id: 'supersession-alias-pair',
      members: [41, 42],
      canonicalPr: 42,
      supersededBy: { 41: 42 },
    }],
  });

  const source = ledger.entries.find((entry) => entry.number === 41);
  assert.equal(source.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(source.blockers, ['conflicting-evidence-alias']);
  assert.equal(source.evidence.supersessionAliasConflict, true);
});

test('conflicting supersession target aliases fail closed', () => {
  const ledger = buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T12:50:00Z',
    pullRequests: [
      {
        number: 43,
        state: 'open',
        title: 'Earlier target implementation',
        headSha: SOURCE_SHA,
        patchEquivalentTo: 44,
        supersessionSourceHeadSha: SOURCE_SHA,
        supersessionTargetPr: 44,
        comparedCanonicalPr: 45,
        supersessionTargetHeadSha: CANONICAL_SHA,
        comparedCanonicalHeadSha: OTHER_SHA,
      },
      {
        number: 44,
        state: 'open',
        title: 'Canonical target implementation',
        headSha: CANONICAL_SHA,
      },
    ],
    families: [{
      id: 'supersession-target-alias-pair',
      members: [43, 44],
      canonicalPr: 44,
      supersededBy: { 43: 44 },
    }],
  });

  const source = ledger.entries.find((entry) => entry.number === 43);
  assert.equal(source.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(source.blockers, ['conflicting-evidence-alias']);
  assert.equal(source.evidence.supersessionAliasConflict, true);
});

test('prior-head approval completion does not clear current exact-head approval', () => {
  const ledger = single({
    body: 'Exact-head approval remains pending. This approval was granted for the prior head.',
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.deepEqual(ledger.entries[0].blockers, ['operator-approval-required']);
});

test('another-branch acceptance completion does not clear current acceptance', () => {
  const ledger = single({
    body: 'Quest acceptance remains pending. This acceptance was completed for another branch.',
  });

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
  assert.deepEqual(ledger.entries[0].blockers, ['acceptance-proof-required']);
});
