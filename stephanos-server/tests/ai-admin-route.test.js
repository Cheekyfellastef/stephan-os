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

test('local admin request allows localhost origin + loopback ip', () => {
  assert.equal(isLocalAdminRequest(buildRequest()), true);
});

test('local admin request denies hosted origin', () => {
  assert.equal(isLocalAdminRequest(buildRequest({ origin: 'https://cheekyfellastef.github.io' })), false);
});

test('local admin request denies non-loopback ip', () => {
  assert.equal(isLocalAdminRequest(buildRequest({ ip: '192.168.1.88' })), false);
});

test('local admin request allows localhost host header without explicit port', () => {
  assert.equal(isLocalAdminRequest(buildRequest({ host: 'localhost' })), true);
});
