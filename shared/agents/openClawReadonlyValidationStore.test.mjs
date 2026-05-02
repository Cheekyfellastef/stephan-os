import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_READONLY_VALIDATION_STORAGE_KEY,
  READONLY_VALIDATION_EXPIRED_MS,
  READONLY_VALIDATION_FRESH_MS,
  buildOpenClawValidationEndpointFingerprint,
  classifyReadonlyValidationFreshness,
  loadOpenClawReadonlyValidationEvidence,
  saveOpenClawReadonlyValidationEvidence,
} from './openClawReadonlyValidationStore.mjs';

function createStorage() {
  const db = new Map();
  return {
    getItem(key) { return db.has(key) ? db.get(key) : null; },
    setItem(key, value) { db.set(key, String(value)); },
  };
}

test('save/load readonly validation evidence excludes secrets and preserves safe fields', () => {
  const storage = createStorage();
  saveOpenClawReadonlyValidationEvidence({
    storage,
    evidence: {
      endpointHost: '127.0.0.1', endpointPort: '8790', endpointScope: 'local_only',
      validationStatus: 'succeeded', validationEvidence: ['safe-probe-path:available'],
      token: 'secret-token', rawResponse: { huge: true },
    },
  });
  const loaded = loadOpenClawReadonlyValidationEvidence({ storage });
  assert.equal(loaded.validationStatus, 'succeeded');
  assert.equal(Object.hasOwn(loaded, 'token'), false);
  assert.equal(Object.hasOwn(loaded, 'rawResponse'), false);
});

test('malformed storage safely returns null', () => {
  const storage = { getItem: () => '{bad-json' };
  assert.equal(loadOpenClawReadonlyValidationEvidence({ storage }), null);
});

test('storage unavailable fallback is null/no-throw', () => {
  assert.equal(loadOpenClawReadonlyValidationEvidence({ storage: null }), null);
  assert.equal(saveOpenClawReadonlyValidationEvidence({ storage: null, evidence: { validationStatus: 'succeeded' } }), null);
});

test('fresh/stale/expired freshness policy works', () => {
  const now = Date.now();
  assert.equal(classifyReadonlyValidationFreshness({ savedAt: new Date(now - 5 * 60 * 1000).toISOString(), now }), 'fresh');
  assert.equal(classifyReadonlyValidationFreshness({ savedAt: new Date(now - READONLY_VALIDATION_FRESH_MS - 1000).toISOString(), now }), 'stale');
  assert.equal(classifyReadonlyValidationFreshness({ savedAt: new Date(now - READONLY_VALIDATION_EXPIRED_MS - 1000).toISOString(), now }), 'expired');
});

test('fingerprint is stable by host/port/scope/protocol', () => {
  const a = buildOpenClawValidationEndpointFingerprint({ endpointHost: 'LOCALHOST', endpointPort: '8790', endpointScope: 'local_only', expectedProtocolVersion: 'V1' });
  const b = buildOpenClawValidationEndpointFingerprint({ endpointHost: 'localhost', endpointPort: '8790', endpointScope: 'local_only', expectedProtocolVersion: 'v1' });
  assert.equal(a, b);
});
