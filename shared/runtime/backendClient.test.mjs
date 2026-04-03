import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStephanosBackend, resolveStephanosBackendClientBaseUrl } from './backendClient.mjs';

test('resolveStephanosBackendClientBaseUrl reuses shared resolver defaults', () => {
  const baseUrl = resolveStephanosBackendClientBaseUrl({
    frontendOrigin: 'http://192.168.0.55:5173',
  });

  assert.equal(baseUrl, 'http://192.168.0.55:8787');
});

test('requestStephanosBackend performs JSON transport through resolved base URL', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, service: 'stephanos-server' });
      },
    };
  };

  const response = await requestStephanosBackend({
    path: '/api/health',
    runtimeContext: {
      baseUrl: 'http://127.0.0.1:8787',
    },
    fetchImpl,
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/health');
  assert.equal(response.baseUrl, 'http://127.0.0.1:8787');
  assert.equal(response.path, '/api/health');
  assert.equal(response.json.service, 'stephanos-server');
});

test('requestStephanosBackend throws structured HTTP errors', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    async text() {
      return JSON.stringify({ error: 'offline' });
    },
  });

  await assert.rejects(
    () => requestStephanosBackend({
      path: '/api/health',
      runtimeContext: { baseUrl: 'http://127.0.0.1:8787' },
      fetchImpl,
    }),
    /offline/,
  );
});

test('requestStephanosBackend rejects unresolved hosted-web backend targets before fetch', async () => {
  await assert.rejects(
    () => requestStephanosBackend({
      path: '/api/health',
      runtimeContext: { frontendOrigin: 'https://cheekyfellastef.github.io' },
      fetchImpl: async () => {
        throw new Error('fetch should not be called for unresolved backend targets');
      },
    }),
    /same-origin \/api is invalid on static host/i,
  );
});
