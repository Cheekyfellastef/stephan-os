import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGateSkillIntakeV1 } from './gateRepairSkillIntakeV1.mjs';

const nowMs = Date.parse('2026-10-14T15:20:00Z');
const sourceHead = 'a'.repeat(40);
function ledger() {
  return {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    observationStatus: 'EVIDENCE_AVAILABLE',
    sourceHead, observedAtUtc: new Date(nowMs).toISOString(),
    gates: Array.from({ length: 23 }, (_, n) => ({
      id: n + 1, title: 'Gate ' + (n + 1),
      owner: 'canonical-owner', status: 'UNVERIFIED', typedBlocker: '', proofRef: '',
    })),
  };
}
function failed(view, id, reason) {
  const gate = view.gates[id - 1];
  gate.status = 'FAIL';
  gate.typedBlocker = reason;
  gate.proofRef = 'workspace:proof/goal-gate-' + id;
}
test('verified gate 8 custody and gate 13 signed capacity become distinct owner handoffs, not auto installs', () => {
  const input = ledger();
  failed(input, 8, 'ELASTIC_LEASE_EXPIRED_OR_NOT_ACTIVE');
  failed(input, 13, 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID');
  const result = deriveGateSkillIntakeV1(input, { feedState: 'ready', nowMs });
  assert.equal(result.summary.failedGateCount, 2);
  assert.equal(result.summary.skillReviewDraftCount, 0);
  assert.equal(result.requests[0].route, 'EXISTING_AUTHORITY_EVIDENCE_REQUIRED');
  assert.equal(result.requests[1].route, 'REUSE_OR_DIAGNOSE_EXISTING_CAPABILITY');
  assert.equal(result.autoInstallAllowed, false);
  assert.equal(result.executeAllowed, false);
  assert.equal(result.leaseOverrideAllowed, false);
});
test('a typed missing capability reaches Skill Forge as a review draft only', () => {
  const input = ledger();
  failed(input, 15, 'CAPABILITY_UNAVAILABLE');
  const result = deriveGateSkillIntakeV1(input, { feedState: 'ready', nowMs });
  assert.equal(result.summary.skillReviewDraftCount, 1);
  assert.equal(result.skillCandidates[0].status, 'DRAFT');
  assert.equal(result.skillCandidates[0].permissionLevel, 'PROPOSE_ONLY');
  assert.equal(result.skillCandidates[0].sourceHead, sourceHead);
  assert.equal(result.skillCandidates[0].provenance, 'GATE_FAILURE_REVIEW_DRAFT_NOT_INSTALLED');
});
test('custody and protected operator approval cannot be turned into skills by a forged missing-capability reason', () => {
  const input = ledger();
  failed(input, 8, 'CAPABILITY_UNAVAILABLE');
  failed(input, 11, 'SKILL_MISSING');
  const result = deriveGateSkillIntakeV1(input, { feedState: 'ready', nowMs });
  assert.equal(result.skillCandidates.length, 0);
  assert.deepEqual(result.requests.map(x => x.route), [
    'EXISTING_AUTHORITY_EVIDENCE_REQUIRED', 'EXISTING_AUTHORITY_EVIDENCE_REQUIRED',
  ]);
});
test('stale, unsigned, inconsistent or unavailable ledger cannot fabricate review drafts', () => {
  const good = ledger();
  failed(good, 15, 'CAPABILITY_UNAVAILABLE');
  const cases = [
    [good, { feedState: 'stale', nowMs }],
    [{ ...good, observationStatus: 'UNVERIFIED' }, { feedState: 'ready', nowMs }],
    [{ ...good, approvalAuthority: true }, { feedState: 'ready', nowMs }],
    [{ ...good, gates: good.gates.slice(1) }, { feedState: 'ready', nowMs }],
    [{ ...good, gates: [good.gates[0], ...good.gates.slice(0, 22)] }, { feedState: 'ready', nowMs }],
    [{ ...good, sourceHead: 'bad' }, { feedState: 'ready', nowMs }],
    [good, { feedState: 'ready', nowMs: nowMs + 11 * 60_000 }],
    [{ ...good, gates: good.gates.map((g, i) => i === 14 ? { ...g, proofRef: 'https://evil.invalid/proof' } : g) }, { feedState: 'ready', nowMs }],
  ];
  for (const [candidate, args] of cases) {
    const result = deriveGateSkillIntakeV1(candidate, args);
    assert.equal(result.sourceTruth, 'UNVERIFIED', JSON.stringify(args));
    assert.equal(result.skillCandidates.length, 0);
    assert.equal(result.executeAllowed, false);
  }
});

test('missing-first blocker spellings are admitted to capability review on non-authority gates', () => {
  const input = ledger();
  failed(input, 14, 'MISSING_CAPABILITY');
  failed(input, 15, 'MISSING_SKILL');
  const result = deriveGateSkillIntakeV1(input, { feedState: 'ready', nowMs });
  assert.deepEqual(result.requests.map(item => item.route), ['SKILL_REVIEW_DRAFT', 'SKILL_REVIEW_DRAFT']);
  assert.equal(result.skillCandidates.length, 2);
  assert.ok(result.skillCandidates.every(item => item.status === 'DRAFT' && item.permissionLevel === 'PROPOSE_ONLY'));
});
