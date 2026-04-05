import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalAdminRequest } from '../routes/ai-admin.js';

function buildRequest({ ip = '127.0.0.1', origin = 'http://localhost:4173', host = 'localhost:8787' } = {}) {
  return {
    headers: { origin, host },
    socket: { remoteAddress: ip },
    ip,
  };
}

test('local-shell route guard denies hosted runtime requests', () => {
  const allowed = isLocalAdminRequest(buildRequest({ origin: 'https://cheekyfellastef.github.io' }));
  assert.equal(allowed, false);
});

test('local-shell route guard allows loopback desktop runtime requests', () => {
  const allowed = isLocalAdminRequest(buildRequest());
  assert.equal(allowed, true);
});
