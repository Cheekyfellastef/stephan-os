import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReadonlyValidationEndpoint } from './openClawEndpointConfig.js';

test('resolves blank config to safe loopback default', () => {
  const resolved = resolveReadonlyValidationEndpoint({ endpointHost: '', endpointPort: '' });
  assert.equal(resolved.host, '127.0.0.1');
  assert.equal(resolved.port, '8790');
  assert.equal(resolved.valid, true);
});

test('keeps valid prior operator endpoint', () => {
  const resolved = resolveReadonlyValidationEndpoint({ endpointHost: '127.0.0.1', endpointPort: '8790' });
  assert.equal(resolved.usedSafeDefault, false);
});
