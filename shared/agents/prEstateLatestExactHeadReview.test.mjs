import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
  validatePrEstateLedger,
} from './prEstateReconciler.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const CANONICAL_SHA = 'b'.repeat(40);

function build(pullRequests, families = []) {
  return buildPrEstateLedger({
    repository: 'owner/repo',
    generatedAt: '2026-07-19T11:00:00Z',
    pullRequests,
    families,
  });
}

test('pending acceptance overrides an ACTIVE_CANONICAL disposition hint', () => {
  const ledger = build([{
    number: 1,
    state: 'open',
    title: 'Quest acceptance',
    body: 'Browser proof is not complete.',
    headSha: SOURCE_SHA,
    dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
  }]);

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
  assert.deepEqual(ledger.entries[0].blockers, ['acceptance-proof-required']);
});

test('pending approval overrides an ACTIVE_CANONICAL disposition hint', () => {
  const ledger = build([{
    number: 2,
    state: 'open',
    title: 'Approval gate',
    body: 'Operator approval was not granted.',
    headSha: SOURCE_SHA,
    dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
  }]);

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.deepEqual(ledger.entries[0].blockers, ['operator-approval-required']);
});

test('unrelated completed browser proof does not erase pending live acceptance', () => {
  const ledger = build([{
    number: 3,
    state: 'open',
    title: 'Mixed acceptance evidence',
    body: 'Live acceptance remains required on Quest. Browser proof is complete for desktop.',
    headSha: SOURCE_SHA,
    dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
  }]);

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
  assert.deepEqual(ledger.entries[0].blockers, ['acceptance-proof-required']);
});

test('completed earlier merge gate does not erase pending exact-head approval', () => {
  const ledger = build([{
    number: 4,
    state: 'open',
    title: 'Mixed approval evidence',
    body: 'Exact-head operator approval remains required. The earlier merge gate is complete.',
    headSha: SOURCE_SHA,
    dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
  }]);

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.deepEqual(ledger.entries[0].blockers, ['operator-approval-required']);
});

test('same-sentence desktop completion does not erase pending Quest acceptance', () => {
  const ledger = build([{
    number: 5,
    state: 'open',
    title: 'Clause-scoped acceptance evidence',
    body: 'Quest acceptance remains pending while desktop acceptance is completed.',
    headSha: SOURCE_SHA,
    dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
  }]);

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
  assert.deepEqual(ledger.entries[0].blockers, ['acceptance-proof-required']);
});

test('same-sentence completed merge gate does not erase pending exact-head approval', () => {
  const ledger = build([{
    number: 6,
    state: 'open',
    title: 'Clause-scoped approval evidence',
    body: 'The earlier merge gate is completed while exact-head approval remains pending.',
    headSha: SOURCE_SHA,
    dispositionHint: PR_DISPOSITIONS.ACTIVE_CANONICAL,
  }]);

  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.deepEqual(ledger.entries[0].blockers, ['operator-approval-required']);
});

function buildSupersededLedger() {
  return build(
    [
      {
        number: 10,
        state: 'open',
        title: 'Earlier implementation',
        headSha: SOURCE_SHA,
        patchEquivalentTo: 11,
        supersessionSourceHeadSha: SOURCE_SHA,
        supersessionTargetPr: 11,
        supersessionTargetHeadSha: CANONICAL_SHA,
      },
      {
        number: 11,
        state: 'open',
        title: 'Canonical implementation',
        headSha: CANONICAL_SHA,
      },
    ],
    [{
      id: 'canonical-pair',
      members: [10, 11],
      canonicalPr: 11,
      supersededBy: { 10: 11 },
    }],
  );
}

test('persisted supersession evidence must match the canonical ledger entry head', () => {
  const ledger = buildSupersededLedger();
  assert.equal(validatePrEstateLedger(ledger).valid, true);

  const canonical = ledger.entries.find((entry) => entry.number === 11);
  canonical.headSha = 'c'.repeat(40);

  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /superseded-without-current-target-head/);
  assert.match(validation.errors.join(' '), /superseded-with-stale-canonical-evidence/);
});

test('persisted supersession evidence fails closed when the canonical entry is missing', () => {
  const ledger = buildSupersededLedger();
  ledger.entries = ledger.entries.filter((entry) => entry.number !== 11);

  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /superseded-canonical-entry-missing/);
});

test('persisted ledgers reject duplicate canonical PR entries', () => {
  const ledger = buildSupersededLedger();
  const canonical = ledger.entries.find((entry) => entry.number === 11);
  canonical.headSha = 'c'.repeat(40);
  ledger.entries.push({
    ...canonical,
    headSha: CANONICAL_SHA,
  });

  const validation = validatePrEstateLedger(ledger);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /duplicate-pr-number:11/);
});
