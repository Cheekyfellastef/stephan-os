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
  assert.match(alpha, /^title-key-[a-f0-9]{64}$/);
  assert.match(beta, SAFE_FAMILY_ID);
  assert.deepEqual(result.families.map((family) => family.members).sort((a, b) => a[0] - b[0]), [[301, 302], [401, 402]]);
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
  assert.deepEqual(result.families.map((family) => family.members).sort((a, b) => a[0] - b[0]), [[21, 22], [23, 24]]);
  assert.ok(result.entries.every((entry) => entry.familyId?.startsWith('title-key-')));
});

test('rolling inventory retains the same duplicate-title family ID after oldest member closes', () => {
  const title = 'Maintain stable review custody of this duplicate PR family';
  const before = ledger([pr(201, title), pr(202, title), pr(203, title)]);
  const after = ledger([pr(203, title), pr(202, title)]);
  const beforeIds = new Map(before.entries.map((entry) => [entry.number, entry.familyId]));
  const afterIds = new Map(after.entries.map((entry) => [entry.number, entry.familyId]));
  assert.equal(beforeIds.get(201), beforeIds.get(202));
  assert.equal(beforeIds.get(202), beforeIds.get(203));
  assert.equal(afterIds.get(202), beforeIds.get(202));
  assert.equal(afterIds.get(203), beforeIds.get(203));
  assert.equal(validatePrEstateLedger(before).valid, true);
  assert.equal(validatePrEstateLedger(after).valid, true);
});

test('explicit owner family ID cannot silently shadow a generated family', () => {
  const generatedId = ledger([pr(301, 'Exact title'), pr(302, 'Exact title')]).entries[0].familyId;
  assert.throws(() => ledger([
    pr(301, 'Exact title'), pr(302, 'Exact title'), pr(900, 'Owner family'),
  ], [{ id: generatedId, members: [900] }]), /duplicate PR estate family id:/);
});


test('punctuation-distinct runtime titles stay in two separate exact-title families', () => {
  const records = [
    pr(91001, 'Fix C++ runtime regression'),
    pr(91002, 'Fix C++ runtime regression'),
    pr(92001, 'Fix C# runtime regression'),
    pr(92002, 'Fix C# runtime regression'),
  ];
  const result = ledger(records);
  const byNumber = new Map(result.entries.map((entry) => [entry.number, entry]));
  assert.equal(result.families.length, 2);
  assert.equal(byNumber.get(91001).familyId, byNumber.get(91002).familyId);
  assert.equal(byNumber.get(92001).familyId, byNumber.get(92002).familyId);
  assert.notEqual(byNumber.get(91001).familyId, byNumber.get(92001).familyId);
  assert.deepEqual(
    result.families.map((family) => family.members).sort((left, right) => left[0] - right[0]),
    [[91001, 91002], [92001, 92002]],
  );
  assert.equal(result.finalVerdict, 'PR_ESTATE_RECONCILIATION_REQUIRED');
  assert.equal(validatePrEstateLedger(result).valid, true);
  const reversed = ledger([...records].reverse());
  for (const entry of reversed.entries) {
    assert.equal(entry.familyId, byNumber.get(entry.number).familyId);
  }
});

test('case and whitespace normalize but punctuation-sensitive family identity survives member retirement', () => {
  const before = ledger([
    pr(101, '  FIX  C++   runtime regression '),
    pr(102, 'fix c++ runtime regression'),
    pr(103, 'Fix C++ runtime regression'),
  ]);
  const after = ledger([pr(102, 'fix c++ runtime regression'), pr(103, 'Fix C++ runtime regression')]);
  assert.equal(before.families.length, 1);
  assert.equal(after.families.length, 1);
  assert.equal(before.entries[0].familyId, before.entries[1].familyId);
  assert.equal(before.entries[1].familyId, before.entries[2].familyId);
  assert.equal(after.entries[0].familyId, before.entries[0].familyId);
  assert.equal(after.entries[1].familyId, before.entries[0].familyId);
  assert.equal(validatePrEstateLedger(before).valid, true);
  assert.equal(validatePrEstateLedger(after).valid, true);
});

test('generic Codex placeholder punctuation variants remain excluded from implicit grouping', () => {
  const result = ledger([
    pr(81, 'Codex-generated pull request'),
    pr(181, 'Codex generated pull request'),
    pr(281, 'Codex_generated_pull_request'),
  ]);
  assert.equal(result.families.length, 3);
  assert.ok(result.entries.every((entry) => entry.familyId === null));
  assert.equal(validatePrEstateLedger(result).valid, true);
});
