import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { requestStephanosBackend, resolveStephanosBackendClientBaseUrl } from './backendClient.mjs';

test('caller cancellation aborts actual fetch without relabelling it as a backend timeout', async () => {
  const controller = new AbortController();
  let began, observed;
  const started = new Promise(resolve => { began = resolve; });
  const request = requestStephanosBackend({
    runtimeContext: { frontendOrigin: 'http://127.0.0.1:4173' }, signal: controller.signal,
    fetchImpl: (_url, { signal }) => { observed = signal; began(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
  });
  await started; controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(observed.aborted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('completed polls remove external abort listeners and pre-aborted requests never fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  const options = {
    runtimeContext: { frontendOrigin: 'http://127.0.0.1:4173' }, signal: controller.signal,
    fetchImpl: async () => { calls++; return { ok: true, status: 200, text: async () => '{}' }; },
  };
  for (let i = 0; i < 25; i++) {
    await requestStephanosBackend(options);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
  controller.abort();
  await assert.rejects(requestStephanosBackend(options), { name: 'AbortError' });
  assert.equal(calls, 25);
});

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


test('loopback Battle Bridge surface prefers same-machine backend over stale remembered bridge', () => {
  const baseUrl = resolveStephanosBackendClientBaseUrl({
    frontendOrigin: 'http://127.0.0.1:4173',
    bridgeUrl: 'http://192.168.0.198:8787',
    homeNodeBridge: { backendUrl: 'http://192.168.0.198:8787' },
  });

  assert.equal(baseUrl, 'http://127.0.0.1:8787');
});

test('localhost Battle Bridge surface prefers localhost backend over stale remote bridge', () => {
  const baseUrl = resolveStephanosBackendClientBaseUrl({
    frontendOrigin: 'http://localhost:4173',
    bridgeUrl: 'http://100.88.0.2:8787',
  });

  assert.equal(baseUrl, 'http://localhost:8787');
});

test('explicit backend override remains authoritative on a loopback surface', () => {
  const baseUrl = resolveStephanosBackendClientBaseUrl({
    frontendOrigin: 'http://127.0.0.1:4173',
    baseUrl: 'http://192.168.0.50:8787',
    bridgeUrl: 'http://192.168.0.198:8787',
  });

  assert.equal(baseUrl, 'http://192.168.0.50:8787');
});
