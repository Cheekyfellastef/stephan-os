import assert from 'node:assert/strict';
import test from 'node:test';

import { projectElasticFiveLaneProofCacheShadowV1 } from './elasticFiveLaneProofCacheShadowV1.mjs';

const H = (value) => value.repeat(40);
const D = (value) => value.repeat(64);

function identity(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: H('a'),
    sourceTree: H('b'),
    proofClass: 'DETERMINISTIC_TEST',
    testDefinitionVersion: 'five-lane-v1',
    testDefinitionDigest: D('c'),
    environmentIdentity: 'ubuntu-24.04-x64',
    environmentDigest: D('d'),
    toolchainVersion: 'node-24.6.0',
    toolchainDigest: D('e'),
    policyVersion: 'provider-parity-v1',
    policyDigest: D('f'),
    resultDigest: D('1'),
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    ...identity(),
    cacheKey: 'proof-cache-entry-1',
    receiptId: 'receipt-1',
    terminalState: 'SUCCESS',
    completedAtUtc: '2026-08-27T04:00:00Z',
    expiresAtUtc: '2026-08-28T04:00:00Z',
    signatureVerified: true,
    ...overrides,
  };
}

function fixture() {
  return {
    candidate: identity(),
    entries: [entry()],
    observedAtUtc: '2026-08-27T05:00:00Z',
  };
}

test('permits only exact immutable proof reuse in shadow with zero authority', () => {
  const result = projectElasticFiveLaneProofCacheShadowV1(fixture());
  assert.equal(result.state, 'CACHE_HIT_SHADOW');
  assert.equal(result.reuseDecision, 'REUSE_EXACT_PROOF_SHADOW');
  assert.equal(result.matchedReceiptId, 'receipt-1');
  assert.equal(result.exactIdentityMatch, true);
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('every source, definition, environment, toolchain, policy and result field invalidates reuse', () => {
  const changes = {
    sourceHead: H('2'),
    sourceTree: H('3'),
    proofClass: 'STATIC_ANALYSIS',
    testDefinitionVersion: 'five-lane-v2',
    testDefinitionDigest: D('4'),
    environmentIdentity: 'windows-10-x64',
    environmentDigest: D('5'),
    toolchainVersion: 'node-24.7.0',
    toolchainDigest: D('6'),
    policyVersion: 'provider-parity-v2',
    policyDigest: D('7'),
    resultDigest: D('8'),
  };
  for (const [key, value] of Object.entries(changes)) {
    const input = fixture();
    input.candidate[key] = value;
    const result = projectElasticFiveLaneProofCacheShadowV1(input);
    assert.equal(result.state, 'CACHE_MISS_SHADOW', key);
    assert.equal(result.reuseDecision, 'RUN_FRESH_PROOF_SHADOW', key);
  }
});

test('expired exact proof is rejected as stale', () => {
  const input = fixture();
  input.observedAtUtc = '2026-08-28T04:00:00Z';
  const result = projectElasticFiveLaneProofCacheShadowV1(input);
  assert.equal(result.state, 'CACHE_MISS_SHADOW');
  assert.equal(result.staleProofRejected, true);
  assert.deepEqual(result.reasonCodes, ['MATCHED_PROOF_EXPIRED']);
});

test('approval, runtime, deployment and review verdicts cannot enter the reusable cache', () => {
  for (const proofClass of ['OPERATOR_APPROVAL', 'LIVE_RUNTIME_ACCEPTANCE', 'DEPLOYMENT_RECEIPT', 'INDEPENDENT_REVIEW']) {
    const input = fixture();
    input.candidate.proofClass = proofClass;
    const result = projectElasticFiveLaneProofCacheShadowV1(input);
    assert.equal(result.state, 'SAFE_HOLD');
    assert.deepEqual(result.reasonCodes, ['PROOF_CLASS_NOT_REUSABLE']);
  }
});

test('unsigned, nonterminal and malformed-time entries fail closed', () => {
  const unsigned = fixture();
  unsigned.entries[0].signatureVerified = false;
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(unsigned).reasonCodes,
    ['PROOF_CACHE_ENTRY_SIGNATURE_UNPROVEN']);

  const failed = fixture();
  failed.entries[0].terminalState = 'FAILED';
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(failed).reasonCodes,
    ['PROOF_CACHE_ENTRY_NOT_SUCCESSFUL']);

  const reversed = fixture();
  reversed.entries[0].completedAtUtc = reversed.entries[0].expiresAtUtc;
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(reversed).reasonCodes,
    ['PROOF_CACHE_ENTRY_TIME_ORDER_INVALID']);
});

test('duplicate cache keys, receipt ids and exact matches fail closed', () => {
  const key = fixture();
  key.entries.push(entry({ receiptId: 'receipt-2' }));
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(key).reasonCodes,
    ['DUPLICATE_PROOF_CACHE_KEY']);

  const receipt = fixture();
  receipt.entries.push(entry({ cacheKey: 'proof-cache-entry-2' }));
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(receipt).reasonCodes,
    ['DUPLICATE_PROOF_RECEIPT_ID']);

  const exact = fixture();
  exact.entries.push(entry({ cacheKey: 'proof-cache-entry-2', receiptId: 'receipt-2' }));
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(exact).reasonCodes,
    ['MULTIPLE_EXACT_PROOF_CACHE_MATCHES']);
});

test('authority smuggling, hidden keys, symbols and accessors fail closed', () => {
  const extra = fixture();
  extra.candidate.mergeAllowed = true;
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(extra).reasonCodes,
    ['PROOF_IDENTITY_NOT_CANONICAL_PLAIN_DATA']);

  for (const mutate of [
    (value) => Object.defineProperty(value, 'deployNow', { value: true, enumerable: false }),
    (value) => { value[Symbol('approve')] = true; },
    (value) => Object.defineProperty(value, 'approve', { get() { return true; }, enumerable: true }),
  ]) {
    const input = fixture();
    mutate(input.entries[0]);
    assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(input).reasonCodes,
      ['PROOF_IDENTITY_NOT_CANONICAL_PLAIN_DATA']);
  }
});

test('sparse, decorated and custom-prototype arrays fail closed', () => {
  const sparse = fixture();
  sparse.entries = new Array(1);
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(sparse).reasonCodes,
    ['PROOF_CACHE_ENTRIES_INVALID']);

  const decorated = fixture();
  decorated.entries.extra = true;
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(decorated).reasonCodes,
    ['PROOF_CACHE_ENTRIES_INVALID']);

  const custom = fixture();
  Object.setPrototypeOf(custom.entries, null);
  assert.deepEqual(projectElasticFiveLaneProofCacheShadowV1(custom).reasonCodes,
    ['PROOF_CACHE_ENTRIES_INVALID']);
});

test('hostile reflection returns deterministic safe hold', () => {
  const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  const result = projectElasticFiveLaneProofCacheShadowV1(hostile);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['PROOF_CACHE_INPUT_INSPECTION_FAILED']);
});
