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

test('non-main containment cannot certify mainline terminal dispositions', () => {
  const ledger = build([{
    number: 303,
    state: 'open',
    title: 'Release-contained change',
    headSha: HEAD_SHA,
    baseRefName: 'release',
    aheadBy: 0,
    comparedHeadSha: HEAD_SHA,
  }, {
    number: 304,
    state: 'open',
    title: 'Codex-generated pull request',
    body: 'Codex generated this pull request, but encountered an unexpected error after generation.',
    headSha: HEAD_SHA,
    baseRefName: 'release',
    aheadBy: 0,
    comparedHeadSha: HEAD_SHA,
  }]);

  const contained = ledger.entries.find((entry) => entry.number === 303);
  const placeholder = ledger.entries.find((entry) => entry.number === 304);
  assert.equal(contained.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(contained.blockers, ['branch-to-main-compare-required']);
  assert.equal(placeholder.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(placeholder.blockers, ['branch-to-main-compare-required']);

  contained.disposition = PR_DISPOSITIONS.ALREADY_IN_MAIN;
  placeholder.disposition = PR_DISPOSITIONS.PLACEHOLDER_FAILED;
  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /already-in-main-without-main-base:303/);
  assert.match(validation.errors.join(' '), /placeholder-failed-without-main-base:304/);
});

test('missing base and state evidence remain unknown instead of being synthesized', () => {
  const ledger = build([{
    number: 305,
    state: 'open',
    title: 'Unknown comparison base',
    headSha: HEAD_SHA,
    aheadBy: 0,
    comparedHeadSha: HEAD_SHA,
  }, {
    number: 306,
    title: 'Unknown PR state',
    headSha: HEAD_SHA,
    baseRefName: 'main',
    aheadBy: 0,
    comparedHeadSha: HEAD_SHA,
  }]);

  const unknownBase = ledger.entries.find((entry) => entry.number === 305);
  const unknownState = ledger.entries.find((entry) => entry.number === 306);
  assert.equal(unknownBase.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(unknownBase.blockers, ['branch-to-main-compare-required']);
  assert.equal(unknownBase.evidence.baseRefKnown, false);
  assert.equal(unknownState.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(unknownState.blockers, ['invalid-or-non-open-pr-record']);
  assert.equal(unknownState.state, '');
});

test('conflicting base-reference aliases fail closed', () => {
  const ledger = build([{
    number: 307,
    state: 'open',
    title: 'Conflicting comparison base',
    headSha: HEAD_SHA,
    baseRefName: 'main',
    base: 'release',
    aheadBy: 0,
    comparedHeadSha: HEAD_SHA,
  }]);

  const [entry] = ledger.entries;
  assert.equal(entry.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.deepEqual(entry.blockers, ['conflicting-evidence-alias']);
  assert.equal(entry.evidence.comparisonAliasConflict, true);

  entry.disposition = PR_DISPOSITIONS.ALREADY_IN_MAIN;
  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /non-ambiguous-with-conflicting-evidence-alias:307/);
});
