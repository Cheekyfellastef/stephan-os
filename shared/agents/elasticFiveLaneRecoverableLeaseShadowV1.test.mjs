import assert from 'node:assert/strict';
import test from 'node:test';

import { projectElasticFiveLaneRecoverableLeaseShadowV1 } from './elasticFiveLaneRecoverableLeaseShadowV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-08-27T03:00:00.000Z';

function activeLease(index, overrides = {}) {
  return {
    leaseId: `lease-${index}`,
    ownerId: `owner-${index}`,
    resourceId: `resource:${index}`,
    sourceHead: HEAD,
    processIdentity: `process-${index}`,
    nonce: `nonce-${index}`,
    state: 'ACTIVE',
    createdAtUtc: '2026-08-27T02:50:00.000Z',
    heartbeatAtUtc: '2026-08-27T02:59:00.000Z',
    expiresAtUtc: '2026-08-27T03:05:00.000Z',
    signatureVerified: true,
    issuerAuthorized: true,
    ...overrides,
  };
}

function fixture() {
  return { sourceHead: HEAD, observedAtUtc: NOW, leases: Array.from({ length: 5 }, (_, index) => activeLease(index + 1)) };
}

test('proves five active distinct resource leases in shadow without mutation authority', () => {
  const result = projectElasticFiveLaneRecoverableLeaseShadowV1(fixture());
  assert.equal(result.state, 'RUNNING_SHADOW');
  assert.equal(result.laneCount, 5);
  assert.equal(result.oneWriterPerResourceProven, true);
  assert.ok(result.leases.every((lease) => lease.action === 'RETAIN_ACTIVE_SHADOW'));
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('proves one expired lease is shadow-reclaimable only with complete recovery evidence', () => {
  const input = fixture();
  input.leases[2] = activeLease(3, {
    state: 'EXPIRED',
    expiresAtUtc: '2026-08-27T02:59:30.000Z',
    recoveryPolicy: 'EXPIRE_OR_PROVEN_DEAD',
    resourceStateRevalidated: true,
    competingOwnerAbsent: true,
    recoveryReceiptId: 'recovery-receipt-3',
  });
  const result = projectElasticFiveLaneRecoverableLeaseShadowV1(input);
  assert.equal(result.state, 'RECOVERY_SHADOW_READY');
  assert.equal(result.crashRecoveryShadowProven, true);
  assert.equal(result.reclaimableLeaseCount, 1);
  assert.equal(result.leases[2].action, 'SHADOW_RECLAIMABLE');
  assert.equal(result.authority.leaseReclamationAllowed, false);
  assert.equal(result.authority.leaseSeizureAllowed, false);
});

test('expired lease without resource revalidation or receipt fails closed', () => {
  const input = fixture();
  input.leases[0] = activeLease(1, {
    state: 'EXPIRED', expiresAtUtc: '2026-08-27T02:59:30.000Z',
    recoveryPolicy: 'EXPIRE_OR_PROVEN_DEAD', competingOwnerAbsent: true,
  });
  const result = projectElasticFiveLaneRecoverableLeaseShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['LEASE_RESOURCE_STATE_NOT_REVALIDATED']);
});

test('multiple active writers for one resource force safe hold', () => {
  const input = fixture();
  input.leases[0].resourceId = 'repo:main';
  input.leases[1].resourceId = 'repo:main';
  const result = projectElasticFiveLaneRecoverableLeaseShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['MULTIPLE_ACTIVE_WRITERS_FOR_RESOURCE']);
});

test('two active leases for one resource fail even when they claim the same owner', () => {
  const input = fixture();
  input.leases[0].resourceId = 'repo:main';
  input.leases[1] = activeLease(2, {
    ownerId: input.leases[0].ownerId,
    resourceId: 'repo:main',
    processIdentity: 'second-process-for-same-owner',
  });
  const result = projectElasticFiveLaneRecoverableLeaseShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['MULTIPLE_ACTIVE_WRITERS_FOR_RESOURCE']);
});

test('forged lease and replayed nonce each fail closed', () => {
  const forged = fixture();
  forged.leases[0].signatureVerified = false;
  assert.deepEqual(projectElasticFiveLaneRecoverableLeaseShadowV1(forged).reasonCodes, ['LEASE_SIGNATURE_UNVERIFIED']);

  const replayed = fixture();
  replayed.leases[1].nonce = replayed.leases[0].nonce;
  assert.deepEqual(projectElasticFiveLaneRecoverableLeaseShadowV1(replayed).reasonCodes, ['LEASE_NONCE_REPLAY']);
});

test('stale source identity and fewer than five lanes cannot pass', () => {
  const stale = fixture();
  stale.leases[0].sourceHead = 'b'.repeat(40);
  assert.deepEqual(projectElasticFiveLaneRecoverableLeaseShadowV1(stale).reasonCodes, ['LEASE_SOURCE_HEAD_MISMATCH']);

  const narrow = fixture();
  narrow.leases = narrow.leases.slice(0, 4);
  assert.deepEqual(projectElasticFiveLaneRecoverableLeaseShadowV1(narrow).reasonCodes, ['FIVE_LANE_MINIMUM_NOT_PROVEN']);
});

test('non-enumerable, symbol-keyed and accessor authority fields fail closed', () => {
  for (const mutate of [
    (lease) => Object.defineProperty(lease, 'executeNow', { value: true, enumerable: false }),
    (lease) => { lease[Symbol('executeNow')] = true; },
    (lease) => Object.defineProperty(lease, 'executeNow', { get() { return true; }, enumerable: true }),
  ]) {
    const input = fixture();
    mutate(input.leases[0]);
    const result = projectElasticFiveLaneRecoverableLeaseShadowV1(input);
    assert.equal(result.state, 'SAFE_HOLD');
    assert.deepEqual(result.reasonCodes, ['LEASE_RECORD_NOT_CANONICAL_PLAIN_DATA']);
  }
});

test('hostile reflection failures return deterministic safe hold', () => {
  const hostile = new Proxy({}, { ownKeys() { throw null; } });
  const result = projectElasticFiveLaneRecoverableLeaseShadowV1(hostile);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['LEASE_SHADOW_INPUT_INSPECTION_FAILED']);
  assert.equal(result.authority.fiveLaneCutoverAllowed, false);
});
