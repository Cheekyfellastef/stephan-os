import test from 'node:test';
import assert from 'node:assert/strict';
import { observeForgeReadOnlyCapacity } from './forge-independent-capacity-observer-v1.mjs';

const HEAD = 'a'.repeat(40);
const models = (names) => ({ ok: true, status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify({ models: names.map((name) => ({ name })) }),
});
const base = (overrides = {}) => ({
  readHead: () => HEAD,
  fetchImpl: async () => models(['qwen3-coder:30b']),
  ...overrides,
});

test('stale canonical worker does not prevent independent read-only inventory', async () => {
  let call;
  const value = await observeForgeReadOnlyCapacity(base({
    canonicalWorkerAllowed: false,
    fetchImpl: async (url, options) => {
      call = { url, options };
      return models(['qwen3-coder:30b']);
    },
  }));
  assert.equal(value.ok, true);
  assert.equal(value.modelListed, true);
  assert.equal(value.readiness, 'OBSERVATION_ONLY');
  assert.equal(value.reason, 'FORGE_MODEL_LISTED_CONSUMER_UNPROVEN');
  assert.equal(value.buildCapacityPublished, false);
  assert.equal(value.canClaim, false);
  assert.equal(value.canDispatch, false);
  assert.equal(value.physicalPickupProven, false);
  assert.equal(value.mergeAuthority, false);
  assert.equal(call.url, 'http://127.0.0.1:11434/api/tags');
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.redirect, 'error');
  assert.equal(Object.hasOwn(call.options, 'body'), false);
});

test('missing model is not reported as build-ready', async () => {
  const value = await observeForgeReadOnlyCapacity(base({fetchImpl: async () => models(['llama3.2:3b'])}));
  assert.equal(value.ok, true);
  assert.equal(value.modelListed, false);
  assert.equal(value.reason, 'FORGE_CONFIGURED_MODEL_NOT_LISTED');
  assert.equal(value.canDispatch, false);
});

test('invalid git head stops before any model request', async () => {
  let touched = false;
  const value = await observeForgeReadOnlyCapacity(base({
    readHead: () => 'bad',
    fetchImpl: async () => { touched = true; throw new Error('unreachable'); },
  }));
  assert.equal(value.reason, 'FORGE_SOURCE_HEAD_UNPROVEN');
  assert.equal(touched, false);
});

test('remote or malicious model endpoints are refused', async () => {
  let touched = false;
  const value = await observeForgeReadOnlyCapacity(base({
    endpoint: 'http://192.168.1.5:11434',
    fetchImpl: async () => { touched = true; throw new Error('unreachable'); },
  }));
  assert.equal(value.reason, 'FORGE_LOCAL_IDENTITY_INVALID');
  assert.equal(touched, false);
});

test('host errors and malformed responses fail closed', async () => {
  for (const response of [
    { ok: false, status: 503, text: async () => '' },
    { ok: true, status: 200, text: async () => '{bad' },
    { ok: true, status: 200, text: async () => JSON.stringify({ models: {} }) },
    { ok: true, status: 200, headers: {get: () => '2000000'}, text: async () => '' },
  ]) {
    const value = await observeForgeReadOnlyCapacity(base({ fetchImpl: async () => response }));
    assert.equal(value.ok, false);
    assert.equal(value.canDispatch, false);
  }
});

test('unsupported timeout and failed model inventory never claim execution', async () => {
  const invalid = await observeForgeReadOnlyCapacity(base({timeoutMs: 60000}));
  assert.equal(invalid.reason, 'FORGE_OBSERVATION_TIMEOUT_INVALID');
  const failed = await observeForgeReadOnlyCapacity(base({
    fetchImpl: async () => { throw new Error('denied'); },
  }));
  assert.equal(failed.reason, 'FORGE_LOCAL_INVENTORY_REQUEST_FAILED');
  assert.equal(failed.canClaim, false);
});

test('changes to the source head during the read-only inventory refuse even observation', async () => {
  let checks = 0;
  const value = await observeForgeReadOnlyCapacity(base({
    readHead: () => ++checks === 1 ? HEAD : 'b'.repeat(40),
  }));
  assert.equal(checks, 2);
  assert.equal(value.reason, 'FORGE_SOURCE_HEAD_CHANGED_DURING_OBSERVATION');
  assert.equal(value.buildCapacityPublished, false);
  assert.equal(value.canDispatch, false);
});

test('source head lookup failure is a typed hold instead of a rejected cycle', async () => {
  const value = await observeForgeReadOnlyCapacity(base({
    readHead: () => { throw new Error('git-unavailable'); },
  }));
  assert.equal(value.reason, 'FORGE_SOURCE_HEAD_UNPROVEN');
  assert.equal(value.canClaim, false);
});
