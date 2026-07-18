import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PR_DISPOSITIONS,
  buildPrEstateLedger,
  renderPrEstateReport,
  requireCapturedHeadSha,
  validatePrEstateLedger,
} from './prEstateReconciler.mjs';

const DEFAULT_HEAD_SHA = 'a'.repeat(40);

function build(pullRequests, families = []) {
  const normalizedPullRequests = pullRequests.map((pr) => ({ headSha: DEFAULT_HEAD_SHA, ...pr }));
  return buildPrEstateLedger({ repository: 'owner/repo', generatedAt: '2026-07-18T16:00:00Z', pullRequests: normalizedPullRequests, families });
}

const placeholderBody = 'Codex generated this pull request, but encountered an unexpected error after generation.';

test('fails closed for a placeholder PR without compare evidence', () => {
  const ledger = build([{ number: 81, state: 'open', title: 'Codex-generated pull request', body: placeholderBody }]);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.match(ledger.entries[0].reason, /no branch-to-main compare evidence/i);
});

test('marks a placeholder as failed only when compare proves no unique commits', () => {
  const ledger = build([{ number: 81, state: 'open', title: 'Codex-generated pull request', body: placeholderBody, aheadBy: 0, behindBy: 12 }]);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.PLACEHOLDER_FAILED);
});

test('recovers placeholder work when the branch still has unique commits', () => {
  const ledger = build([{ number: 81, state: 'open', title: 'Codex-generated pull request', body: placeholderBody, aheadBy: 1, behindBy: 12 }]);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.RECOVER_UNIQUE_WORK);
});

test('fails closed when inferred placeholder containment conflicts with unique work', () => {
  const ledger = build([{ number: 82, state: 'open', title: 'Codex-generated pull request', body: placeholderBody, aheadBy: 0, uniqueDelta: true }]);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.match(ledger.entries[0].blockers.join(' '), /conflicting-placeholder-delta-evidence/);
});

test('requires canonical selection for duplicate families', () => {
  const ledger = build(
    [{ number: 10, state: 'open', title: 'Repair thing' }, { number: 11, state: 'open', title: 'Repair thing better' }],
    [{ id: 'repair-thing', label: 'Repair thing', members: [10, 11] }],
  );
  assert.ok(ledger.entries.every((entry) => entry.disposition === PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED));
  assert.match(ledger.families[0].blockers.join(' '), /canonical-selection-required/);
});

test('selects one canonical survivor and supersedes only with equivalence evidence', () => {
  const ledger = build(
    [
      { number: 1545, state: 'open', title: 'Canonical', body: 'Do not merge without Stephan explicit approval.' },
      { number: 1544, state: 'open', title: 'Earlier', patchEquivalentTo: 1545 },
    ],
    [{ id: 'capacity', label: 'Capacity', members: [1544, 1545], canonicalPr: 1545, supersededBy: { 1544: 1545 } }],
  );
  assert.equal(ledger.entries.find((entry) => entry.number === 1545).disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
  assert.equal(ledger.entries.find((entry) => entry.number === 1544).disposition, PR_DISPOSITIONS.SUPERSEDED);
});

test('classifies a non-placeholder PR as already in main only with containment evidence', () => {
  const ledger = build([{ number: 20, state: 'open', title: 'Old fix', aheadBy: 0, behindBy: 8 }]);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.ALREADY_IN_MAIN);
  assert.equal(validatePrEstateLedger(ledger).valid, true);
});

test('preserves explicit live acceptance gates', () => {
  const ledger = build([{ number: 30, state: 'open', title: 'Quest scaffold', body: 'Live acceptance required on the Quest headset.' }]);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);
});

test('detects multiple active canonical candidates in one family', () => {
  const ledger = build(
    [{ number: 40, state: 'open', title: 'A', activeHint: true }, { number: 41, state: 'open', title: 'B', activeHint: true }],
    [{ id: 'broken-family', label: 'Broken', members: [40, 41], canonicalPr: 40 }],
  );
  assert.equal(ledger.entries.find((entry) => entry.number === 40).disposition, PR_DISPOSITIONS.ACTIVE_CANONICAL);
  assert.equal(ledger.entries.find((entry) => entry.number === 41).disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.equal(ledger.finalVerdict, 'PR_ESTATE_RECONCILIATION_REQUIRED');
});

test('creates implicit families for exact duplicate titles', () => {
  const ledger = build([{ number: 50, state: 'open', title: 'Same title' }, { number: 51, state: 'open', title: 'Same title' }]);
  assert.equal(ledger.entries[0].familyId, ledger.entries[1].familyId);
  assert.ok(ledger.entries.every((entry) => entry.disposition === PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED));
});

test('does not group normalized variants of the generic Codex placeholder title', () => {
  const ledger = build([
    { number: 81, state: 'open', title: 'Codex-generated pull request', body: placeholderBody },
    { number: 181, state: 'open', title: 'Codex generated pull request', body: placeholderBody },
    { number: 281, state: 'open', title: 'Codex_generated_pull_request', body: placeholderBody },
  ]);
  assert.ok(ledger.entries.every((entry) => entry.familyId === null));
});

test('fails closed on contradictory containment evidence in either direction', () => {
  const negativeContradiction = build([{ number: 70, state: 'open', title: 'Contradictory', aheadBy: 0, headContainedInBase: false }]);
  assert.equal(negativeContradiction.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  const positiveContradiction = build([{ number: 71, state: 'open', title: 'Contradictory', aheadBy: 3, headContainedInBase: true }]);
  assert.equal(positiveContradiction.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.match(positiveContradiction.entries[0].blockers.join(' '), /contradictory-containment-evidence/);
});

test('rejects malformed numeric comparison evidence without coercion', () => {
  for (const malformed of ['', false, '1.5', {}, -1]) {
    const ledger = build([{ number: 72, state: 'open', title: 'Malformed compare', aheadBy: malformed }]);
    assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
    assert.equal(ledger.entries[0].evidence.comparisonEvidenceInvalid, true);
  }
});

test('placeholder-failed hints require the failure marker and no unique delta', () => {
  const missingMarker = build([{ number: 73, state: 'open', title: 'Normal PR', aheadBy: 0, dispositionHint: PR_DISPOSITIONS.PLACEHOLDER_FAILED }]);
  assert.equal(missingMarker.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  const unique = build([{ number: 74, state: 'open', title: 'Codex-generated pull request', body: placeholderBody, aheadBy: 0, uniqueDelta: true, dispositionHint: PR_DISPOSITIONS.PLACEHOLDER_FAILED }]);
  assert.equal(unique.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
});

test('superseded hints require a canonical target plus equivalence evidence', () => {
  const ledger = build(
    [{ number: 75, state: 'open', title: 'Earlier', dispositionHint: PR_DISPOSITIONS.SUPERSEDED }],
    [{ id: 'hint-family', members: [75, 76], canonicalPr: 76, supersededBy: { 75: 76 } }],
  );
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
});

test('rejects a missing pullRequests collection', () => {
  assert.throws(() => buildPrEstateLedger({ repository: 'owner/repo' }), /pullRequests array is required/);
});

test('does not silently drop non-open records', () => {
  const ledger = build([{ number: 77, state: 'closed', title: 'Unexpected closed record', aheadBy: 0 }]);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.openPrCount, 0);
  assert.equal(ledger.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.equal(ledger.finalVerdict, 'PR_ESTATE_RECONCILIATION_REQUIRED');
  assert.equal(validatePrEstateLedger(ledger).valid, false);
});

test('requires a captured exact head SHA before compare collection', () => {
  const sha = 'a'.repeat(40);
  assert.equal(requireCapturedHeadSha(sha, 80), sha);
  assert.throws(() => requireCapturedHeadSha('', 80), /PR #80 captured headRefOid is missing or invalid/);
  assert.throws(() => requireCapturedHeadSha('branch-name', 80), /missing or invalid/);
});

test('requires terminal prepared evidence to identify the exact PR head', () => {
  const missing = build([{ number: 79, state: 'open', title: 'Contained without SHA', aheadBy: 0, headSha: '' }]);
  assert.equal(missing.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.match(missing.entries[0].blockers.join(' '), /exact-head-evidence-required/);

  const malformed = build([{ number: 80, state: 'open', title: 'Contained with branch name', aheadBy: 0, headSha: 'branch-name' }]);
  assert.equal(malformed.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.match(malformed.entries[0].blockers.join(' '), /exact-head-evidence-required/);
});

test('rejects a configured canonical PR outside its family members', () => {
  assert.throws(
    () => build([{ number: 81, state: 'open', title: 'Family member' }], [{ id: 'bad-family', members: [81], canonicalPr: 82 }]),
    /canonical PR #82 is not a member of family bad-family/,
  );
});

test('distinguishes completed gates from pending gates', () => {
  const completedAcceptance = build([{ number: 83, state: 'open', title: 'Browser proof', body: 'Browser acceptance passed on the exact head.' }]);
  assert.notEqual(completedAcceptance.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);

  const completedApproval = build([{ number: 84, state: 'open', title: 'Approved change', body: 'Exact-head approval was granted by the operator.' }]);
  assert.notEqual(completedApproval.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);

  const pendingAcceptance = build([{ number: 85, state: 'open', title: 'Quest proof', body: 'Live acceptance remains pending on the Quest headset.' }]);
  assert.equal(pendingAcceptance.entries[0].disposition, PR_DISPOSITIONS.WAITING_ACCEPTANCE);

  const pendingApproval = build([{ number: 86, state: 'open', title: 'Approval gate', body: 'Exact-head operator approval is still required.' }]);
  assert.equal(pendingApproval.entries[0].disposition, PR_DISPOSITIONS.WAITING_OPERATOR_APPROVAL);
});

test('rejects contradictory supersession evidence', () => {
  const explicit = build(
    [{ number: 87, state: 'open', title: 'Contradictory supersession', patchEquivalentTo: 88, uniqueDelta: true }],
    [{ id: 'contradictory-supersession', members: [87, 88], canonicalPr: 88, supersededBy: { 87: 88 } }],
  );
  assert.equal(explicit.entries[0].disposition, PR_DISPOSITIONS.AMBIGUOUS_REVIEW_REQUIRED);
  assert.match(explicit.entries[0].blockers.join(' '), /contradictory-supersession-evidence/);
});

test('rejects malformed families collections in the pure model', () => {
  assert.throws(
    () => buildPrEstateLedger({ repository: 'owner/repo', pullRequests: [], families: {} }),
    /families array is required/,
  );
});

test('ledger validation rejects forged terminal evidence', () => {
  const ledger = build([{ number: 78, state: 'open', title: 'Unknown work' }]);
  ledger.entries[0].disposition = PR_DISPOSITIONS.SUPERSEDED;
  ledger.entries[0].canonicalPr = 79;
  assert.equal(validatePrEstateLedger(ledger).valid, false);
});

test('renders a bounded human recovery report', () => {
  const ledger = build([{ number: 60, state: 'open', title: 'Unknown work' }]);
  const report = renderPrEstateReport(ledger);
  assert.match(report, /Stephanos PR Estate Report/);
  assert.match(report, /#60 \| AMBIGUOUS_REVIEW_REQUIRED/);
  assert.match(report, /read-only classifier/);
});
