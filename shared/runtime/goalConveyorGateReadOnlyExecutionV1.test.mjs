import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreGateReadOnlyActionV1 as execute } from './goalConveyorGateReadOnlyExecutionV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-10-14T16:30:00.000Z';
const action = Object.freeze({
  gateId: 13, action: 'RECHECK_SIGNED_NATIVE_PUBLISHER',
  authority: 'native-capacity-publisher', mode: 'READ_ONLY',
  proofRef: 'workspace:status/stephanos-native-capacity-current.json',
});
const steward = Object.freeze({
  mode: 'SHADOW_READ_ONLY', decision: 'PROPOSE_EXISTING_AUTHORITY_ACTION',
  observedHead: HEAD, nextAction: action,
});
const options = () => ({
  sourceHead: HEAD, observedAtUtc: NOW, nowUtc: NOW,
  probeNativeRouting: async () => ({
    ok: true, candidate: { sourceHead: HEAD },
  }),
});

test('original Core may execute precisely one registered read-only Gate 13 verifier', async () => {
  let probes = 0;
  const result = await execute(steward, { ...options(),
    probeNativeRouting: async () => {
      probes += 1;
      return { ok: true, candidate: { sourceHead: HEAD } };
    },
  });
  assert.equal(probes, 1);
  assert.equal(result.attempted, true);
  assert.equal(result.passed, true);
  assert.equal(result.mode, 'BOUNDED_READ_ONLY_EXECUTED');
  assert.equal(result.gateId, 13);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  for (const field of ['sourceMutationAllowed', 'windowsTaskMutationAllowed',
    'mergeAuthority', 'admissionAuthority', 'approvalAuthority',
    'gateClearedByThisAction']) assert.equal(result[field], false);
  assert.equal(result.originalSourceLeaseUntouched, true);
});

test('original custody, quarantine and unknown gate actions never execute', async () => {
  for (const candidate of [
    { ...steward, nextAction: { ...action, gateId: 8, action: 'REQUEST_ORIGINAL_WRITER_CUSTODY_WITNESS' } },
    { ...steward, nextAction: { ...action, gateId: 11, mode: 'OPERATOR_REQUIRED' } },
    { ...steward, nextAction: { ...action, action: 'RESTART_NATIVE_PUBLISHER' } },
    { ...steward, nextAction: { ...action, proofRef: 'https://untrusted.invalid/a' } },
    { ...steward, nextAction: { ...action, mode: 'MUTATION' } },
    { ...steward, decision: 'SAME_EVIDENCE_COOLDOWN' },
  ]) {
    let called = false;
    const result = await execute(candidate, { ...options(),
      probeNativeRouting: async () => { called = true; throw Error('should not call'); },
    });
    assert.equal(result.attempted, false);
    assert.equal(called, false);
    assert.equal(result.sourceMutationAllowed, false);
  }
});

test('gaming, stale source, wrong head, unavailable verifier and read failure hold', async () => {
  const cases = [
    { ...options(), gamingProtected: true },
    { ...options(), observedAtUtc: '2026-10-14T16:20:00.000Z' },
    { ...options(), sourceHead: 'b'.repeat(40) },
    { ...options(), probeNativeRouting: null },
  ];
  for (const entry of cases) {
    const result = await execute(steward, entry);
    assert.equal(result.attempted, false);
    assert.equal(result.passed, false);
  }
  const failure = await execute(steward, {
    ...options(), probeNativeRouting: async () => { throw Error('private path or token'); },
  });
  assert.equal(failure.attempted, true);
  assert.equal(failure.passed, false);
  assert.equal(failure.reason, 'GATE_READ_ONLY_PROBE_FAILED');
  assert.equal(JSON.stringify(failure).includes('token'), false);
});

test('unsigned, stale or mismatched native capacity never passes signed gate', async () => {
  for (const result of [
    { ok: false, reason: 'SOURCE-HEAD-INVALID' },
    { ok: true, candidate: { sourceHead: 'b'.repeat(40) } },
    { ok: true, candidate: null },
    { ok: false, reason: '/private/path\nsecret' },
  ]) {
    const outcome = await execute(steward, { ...options(), probeNativeRouting: async () => result });
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.passed, false);
    assert.equal(outcome.gateClearedByThisAction, false);
    assert.equal(outcome.originalSourceLeaseUntouched, true);
  }
});
