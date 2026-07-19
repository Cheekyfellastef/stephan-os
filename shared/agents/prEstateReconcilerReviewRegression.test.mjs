import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
  validatePrEstateLedger,
} from './prEstateReconciler.mjs';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

function build(pullRequests, families = []) {
  const withHeads = pullRequests.map((pr) => ({ headSha: HEAD_A, ...pr }));
  const headByPr = new Map(withHeads.map((pr) => [pr.number, pr.headSha]));
  const familyByPr = new Map();
  for (const family of families) {
    for (const number of family.members || []) familyByPr.set(number, family);
  }

  const prepared = withHeads.map((pr) => {
    const comparisonPresent = ['aheadBy', 'ahead_by', 'behindBy', 'behind_by', 'headContainedInBase']
      .some((key) => Object.prototype.hasOwnProperty.call(pr, key));
    const family = familyByPr.get(pr.number);
    const target = family?.supersededBy?.[pr.number]
      ?? ((family?.canonicalPr && family.canonicalPr !== pr.number) ? family.canonicalPr : null);
    const supersessionClaimed = target && (pr.patchEquivalentTo === target || pr.uniqueDelta === false);
    return {
      ...(comparisonPresent && !Object.prototype.hasOwnProperty.call(pr, 'comparedHeadSha')
        ? { comparedHeadSha: pr.headSha }
        : {}),
      ...(supersessionClaimed && !Object.prototype.hasOwnProperty.call(pr, 'supersessionSourceHeadSha')
        ? {
          supersessionSourceHeadSha: pr.headSha,
          supersessionTargetPr: target,
          supersessionTargetHeadSha: headByPr.get(target) || '',
        }
        : {}),
      ...pr,
    };
  });

  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T10:45:00Z',
    pullRequests: prepared,
    families,
  });
}

test('rejects controlled disposition hints on noncanonical family members', () => {
  const family = [{ id: 'canonical-hint', members: [1, 2], canonicalPr: 2 }];
  for (const dispositionHint of [
    PR_DISPOSITIONS.ACTIVE_CANONICAL,
    PR_DISPOSITIONS.WAITING_ACCEPTANCE,
    PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL,
  ]) {
    const ledger = build([
      { number: 1, state: 'open', title: 'Noncanonical', dispositionHint },
      { number: 2, state: 'open', title: 'Canonical', aheadBy: 0 },
    ], family);
    const entry = ledger.entries.find((candidate) => candidate.number === 1);
    assert.equal(entry.disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
    assert.match(entry.blockers.join(' '), /noncanonical-controlled-disposition-hint/);
  }
});

test('treats negated completion language as a pending gate', () => {
  for (const body of [
    'Browser proof is not complete.',
    'Live acceptance was not completed.',
    'The acceptance has never passed.',
  ]) {
    const ledger = build([{ number: 10, state: 'open', title: 'Acceptance gate', body }]);
    assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE, body);
  }

  for (const body of [
    'Operator approval was not granted.',
    'The merge gate is not complete.',
    'Exact-head approval has never been approved.',
  ]) {
    const ledger = build([{ number: 11, state: 'open', title: 'Approval gate', body }]);
    assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL, body);
  }
});

test('ledger validation rejects supersession evidence targeting a noncanonical PR', () => {
  const ledger = build([
    { number: 20, state: 'open', title: 'Earlier', patchEquivalentTo: 21 },
    { number: 21, state: 'open', title: 'Canonical', headSha: HEAD_B },
  ], [{ id: 'supersession-validation', members: [20, 21], canonicalPr: 21, supersededBy: { 20: 21 } }]);

  const entry = ledger.entries.find((candidate) => candidate.number === 20);
  assert.equal(entry.disposition, PR_DISPOSITIONS.SUPERSEDED);
  entry.evidence.explicitSupersededBy = 999;
  entry.evidence.patchEquivalentTo = 999;
  entry.evidence.supersessionTargetPr = 999;

  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('superseded-target-not-canonical:20'));
});
