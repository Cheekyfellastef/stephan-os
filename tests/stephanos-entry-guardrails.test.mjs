import test from 'node:test';
import assert from 'node:assert/strict';

import { validateApps, validateStephanosRuntime } from '../system/apps/app_validator.js';

function createStephanosFetchMock({ runtimeUrl = 'http://localhost:5173/', runtimeReachable = true } = {}) {
  return async (url, options = {}) => {
    const requestUrl = String(url);

    if (options.method === 'HEAD') {
      if (
        requestUrl === 'http://localhost:5173/'
        || requestUrl === 'http://127.0.0.1:5173/'
        || requestUrl === 'http://127.0.0.1:4173/apps/stephanos/dist/'
        || requestUrl.includes('/apps/stephanos/dist/')
      ) {
        return { ok: true, status: 200, text: async () => '' };
      }

      return { ok: false, status: 404, text: async () => '' };
    }

    if (requestUrl === 'apps/stephanos/app.json') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ name: 'Stephanos OS', entry: 'dist/index.html', packaging: 'vite' }),
        json: async () => ({ name: 'Stephanos OS', entry: 'dist/index.html', packaging: 'vite' }),
      };
    }

    if (requestUrl === './apps/stephanos/runtime-status.json' || requestUrl === 'http://127.0.0.1:4173/__stephanos/health') {
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    }

    if (requestUrl === './apps/stephanos/dist/stephanos-build.json') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ runtimeMarker: 'marker-live', buildTimestamp: '2026-03-27T00:00:00.000Z', gitCommit: 'abc123' }),
        json: async () => ({ runtimeMarker: 'marker-live', buildTimestamp: '2026-03-27T00:00:00.000Z', gitCommit: 'abc123' }),
      };
    }

    if (requestUrl.endsWith('/api/health')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, service: 'stephanos-server', backend_base_url: 'http://localhost:8787', published_backend_base_url: 'http://localhost:8787', client_route_state: 'ready' }),
        json: async () => ({ ok: true, service: 'stephanos-server', backend_base_url: 'http://localhost:8787', published_backend_base_url: 'http://localhost:8787', client_route_state: 'ready' }),
      };
    }

    if (requestUrl.endsWith('/api/ai/providers/health')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { groq: { ok: true }, ollama: { ok: true } } }),
        json: async () => ({ success: true, data: { groq: { ok: true }, ollama: { ok: true } } }),
      };
    }

    if ((requestUrl === runtimeUrl || requestUrl === 'http://127.0.0.1:5173/') && runtimeReachable) {
      return {
        ok: true,
        status: 200,
        text: async () => '<html><head><title>Stephanos UI</title></head><body>Stephanos</body></html>',
        json: async () => ({}),
      };
    }

    return {
      ok: false,
      status: 404,
      text: async () => '',
      json: async () => ({}),
    };
  };
}

test('validateStephanosRuntime preserves launcherEntry/runtimeEntry/launchEntry separation on root launcher context', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;

  globalThis.window = { location: { origin: 'http://127.0.0.1:4173' } };
  globalThis.location = { pathname: '/' };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = createStephanosFetchMock();

  try {
    const status = await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });

    assert.equal(status.state, 'healthy');
    assert.equal(status.launcherEntry, 'http://127.0.0.1:4173/');
    assert.equal(status.runtimeEntry, 'http://localhost:5173/');
    assert.equal(status.launchEntry, 'http://localhost:5173/');
    assert.notEqual(status.launcherEntry, status.runtimeEntry);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.location = originalLocation;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('validateStephanosRuntime probes launcher runtime-status on /apps/stephanos/runtime-status.json', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

  const fetchCalls = [];

  globalThis.window = { location: { origin: 'http://127.0.0.1:4173' } };
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    fetchCalls.push(requestUrl);
    if (
      requestUrl === './apps/stephanos/runtime-status.json'
      || requestUrl === 'http://127.0.0.1:4173/__stephanos/health'
    ) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          state: 'ready',
          runtimeMarker: 'marker',
          launcherStatus: {
            state: 'ready',
            launchInProgress: false,
            subsystems: { build: { state: 'ready' }, ui: { state: 'ready' }, backend: { state: 'ready' } },
          },
        }),
        json: async () => ({
          state: 'ready',
          runtimeMarker: 'marker',
          launcherStatus: {
            state: 'ready',
            launchInProgress: false,
            subsystems: { build: { state: 'ready' }, ui: { state: 'ready' }, backend: { state: 'ready' } },
          },
        }),
      };
    }

    if (requestUrl === './apps/stephanos/dist/stephanos-build.json') {
      return {
        ok: true,
        text: async () => JSON.stringify({ runtimeMarker: 'marker' }),
      };
    }

    if (
      requestUrl === 'http://localhost:5173/'
      || requestUrl === 'http://127.0.0.1:5173/'
      || requestUrl === 'http://127.0.0.1:4173/apps/stephanos/dist/'
    ) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
      };
    }

    return {
      ok: true,
      text: async () => '<!doctype html><html></html>',
      json: async () => ({ service: 'stephanos-server', client_route_state: 'ready', published_backend_base_url: 'http://127.0.0.1:8787' }),
    };
  };

  try {
    await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });
    assert.equal(
      fetchCalls.includes('/apps/stephanos/runtime-status.json')
      || fetchCalls.includes('./apps/stephanos/runtime-status.json'),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('validateApps keeps separated Stephanos entries authoritative while app.entry remains compatibility mirror', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;

  globalThis.window = { location: { origin: 'http://127.0.0.1:4173' } };
  globalThis.location = { pathname: '/' };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = createStephanosFetchMock();

  const app = {
    name: 'Stephanos OS',
    folder: 'stephanos',
    entry: '/legacy-entry',
    launchEntry: '/legacy-launch-entry',
    runtimeEntry: '/legacy-runtime-entry',
    launcherEntry: '/legacy-launcher-entry',
    launchStrategy: 'workspace',
  };

  try {
    await validateApps([app], {
      eventBus: { emit() {}, on() { return () => {}; } },
      systemState: { set() {} },
    });

    assert.equal(app.launcherEntry, 'http://127.0.0.1:4173/');
    assert.equal(app.runtimeEntry, 'http://localhost:5173/');
    assert.equal(app.launchEntry, 'http://localhost:5173/');
    assert.equal(app.entry, app.launchEntry);
    assert.notEqual(app.launcherEntry, app.runtimeEntry);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.location = originalLocation;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('validateStephanosRuntime keeps launcher tile interaction semantics aligned between localhost and hosted roots', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;

  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  try {
    const runScenario = async ({ origin, pathname }) => {
      globalThis.window = { location: { origin, pathname } };
      globalThis.location = { pathname };
      globalThis.fetch = createStephanosFetchMock({ runtimeReachable: false });
      return validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });
    };

    const localhostStatus = await runScenario({ origin: 'http://127.0.0.1:4173', pathname: '/' });
    const hostedStatus = await runScenario({ origin: 'https://launcher.stephanos.example', pathname: '/' });

    assert.equal(localhostStatus.state, 'healthy');
    assert.equal(hostedStatus.state, 'healthy');
    assert.equal(localhostStatus.launchStrategy, hostedStatus.launchStrategy);
    assert.equal(localhostStatus.launchStrategy, 'workspace');
    assert.equal(Boolean(localhostStatus.launchEntry), true);
    assert.equal(Boolean(hostedStatus.launchEntry), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.location = originalLocation;
    globalThis.localStorage = originalLocalStorage;
  }
});
