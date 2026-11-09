import assert from 'node:assert/strict';
import test from 'node:test';

import { SAFE_FAMILY_ID } from './prEstateContracts.mjs';
import { buildPrEstateLedger, validatePrEstateLedger } from './prEstateReconciler.mjs';

const HEAD_SHA = 'a'.repeat(40);
function pr(number, title) {
  return { number, state: 'open', title, headSha: HEAD_SHA, baseRefName: 'main' };
}
function ledger(pullRequests, families = []) {
  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-11-09T00:00:00Z',
    pullRequests,
    families,
  });
}

test('different long duplicate titles cannot collapse into one PR estate family', () => {
  const sharedPrefix = 'same normalized PR title '.repeat(9);
  const records = [
    pr(301, sharedPrefix + 'alpha'),
    pr(302, sharedPrefix + 'alpha'),
    pr(401, sharedPrefix + 'beta'),
    pr(402, sharedPrefix + 'beta'),
  ];
  const result = ledger(records);
  const byNumber = new Map(result.entries.map((entry) => [entry.number, entry]));
  const alpha = byNumber.get(301).familyId;
  const beta = byNumber.get(401).familyId;
  assert.equal(alpha, byNumber.get(302).familyId);
  assert.equal(beta, byNumber.get(402).familyId);
  assert.notEqual(alpha, beta);
  assert.match(alpha, SAFE_FAMILY_ID);
  assert.match(beta, SAFE_FAMILY_ID);
  assert.deepEqual(result.families.map((family) => family.members), [[301, 302], [401, 402]]);
  assert.equal(result.finalVerdict, 'PR_ESTATE_RECONCILIATION_REQUIRED');
  assert.equal(validatePrEstateLedger(result).valid, true);

  const reversed = ledger([...records].reverse());
  assert.deepEqual(reversed.families.map((family) => family.id), result.families.map((family) => family.id));
});

test('short exact-title groups retain their own distinct membership', () => {
  const result = ledger([
    pr(21, 'Fix original bug'), pr(22, 'Fix original bug'),
    pr(23, 'Fix another bug'), pr(24, 'Fix another bug'),
  ]);
  assert.equal(result.families.length, 2);
  assert.deepEqual(result.families.map((family) => family.members), [[21, 22], [23, 24]]);
  assert.ok(result.entries.every((entry) => entry.familyId?.startsWith('title-pr-')));
});

test('explicit owner family ID cannot silently shadow a generated family', () => {
  assert.throws(() => ledger([
    pr(301, 'Exact title'), pr(302, 'Exact title'), pr(900, 'Owner family'),
  ], [{ id: 'title-pr-301', members: [900] }]), /duplicate PR estate family id: title-pr-301/);
});
