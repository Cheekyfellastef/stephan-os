import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStephanosHomeNodeCandidates,
  createStephanosHomeNodeUrls,
  discoverStephanosHomeNode,
  normalizeStephanosHomeNode,
  resolveStephanosBackendBaseUrl,
} from '../shared/runtime/stephanosHomeNode.mjs';
import { validateStephanosRuntime } from '../system/apps/app_validator.js';

test('createStephanosHomeNodeUrls builds LAN-friendly UI and backend URLs', () => {
  const urls = createStephanosHomeNodeUrls({ host: '192.168.1.42' });

  assert.equal(urls.uiUrl, 'http://192.168.1.42:5173/');
  assert.equal(urls.backendUrl, 'http://192.168.1.42:8787');
  assert.equal(urls.backendHealthUrl, 'http://192.168.1.42:8787/api/health');
});

test('normalizeStephanosHomeNode(null) returns a safe empty structure', () => {
  const normalized = normalizeStephanosHomeNode(null, { source: 'manual' });

  assert.deepEqual(normalized, {
    host: '',
    ip: '',
    uiPort: 5173,
    backendPort: 8787,
    distPort: 4173,
    uiUrl: '',
    backendUrl: '',
    backendHealthUrl: '',
    distUrl: '',
    lastSeenAt: '',
    source: 'manual',
    reachable: false,
    configured: false,
  });
});

test('normalizeStephanosHomeNode(undefined) returns a safe empty structure', () => {
  const normalized = normalizeStephanosHomeNode(undefined, { source: 'lastKnown', backendPort: 9000 });

  assert.equal(normalized.host, '');
  assert.equal(normalized.backendPort, 9000);
  assert.equal(normalized.source, 'lastKnown');
  assert.equal(normalized.configured, false);
});

test('buildStephanosHomeNodeCandidates skips empty candidates and missing hosts', () => {
  const candidates = buildStephanosHomeNodeCandidates({
    manualNode: null,
    lastKnownNode: '',
    recentHosts: ['', '   '],
  });

  assert.deepEqual(candidates, []);
});

test('buildStephanosHomeNodeCandidates prefers manual, last-known, and current-origin hints without subnet scanning', () => {
  const candidates = buildStephanosHomeNodeCandidates({
    currentOrigin: 'http://192.168.1.42:5173',
    manualNode: { host: 'stephanos-pc.local', uiPort: 5173, backendPort: 8787 },
    lastKnownNode: { host: '192.168.1.10', uiPort: 5173, backendPort: 8787 },
    recentHosts: ['192.168.1.11', '192.168.1.12'],
  });

  assert.deepEqual(
    [...new Set(candidates.map((candidate) => candidate.host))],
    ['stephanos-pc.local', '192.168.1.10', '192.168.1.42', '192.168.1.11', '192.168.1.12'],
  );
  assert.ok(candidates.length <= 8);
});

test('buildStephanosHomeNodeCandidates drops partial objects without a host', () => {
  const candidates = buildStephanosHomeNodeCandidates({
    manualNode: { backendPort: 8787 },
    lastKnownNode: { uiPort: 5173 },
    recentHosts: ['192.168.1.42'],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.host), ['192.168.1.42']);
});

test('discoverStephanosHomeNode reports not-configured when no valid candidates exist', async () => {
  const discovery = await discoverStephanosHomeNode({
    manualNode: null,
    lastKnownNode: undefined,
    recentHosts: ['', null],
    fetchImpl: async () => {
      throw new Error('fetch should not run without candidates');
    },
  });

  assert.equal(discovery.reachable, false);
  assert.equal(discovery.preferredNode, null);
  assert.equal(discovery.node, null);
  assert.equal(discovery.status, 'not-configured');
  assert.equal(discovery.attempts.length, 0);
});

test('resolveStephanosBackendBaseUrl uses the current LAN host before falling back to localhost', () => {
  assert.equal(
    resolveStephanosBackendBaseUrl({ currentOrigin: 'http://192.168.1.42:5173' }),
    'http://192.168.1.42:8787',
  );
  assert.equal(
    resolveStephanosBackendBaseUrl({ currentOrigin: 'http://localhost:5173', manualNode: normalizeStephanosHomeNode({ host: '192.168.1.42' }) }),
    'http://192.168.1.42:8787',
  );
});

test('validateStephanosRuntime boot path does not throw when no home node is configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  globalThis.window = { location: { origin: 'http://localhost:5173' } };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      return { ok: false, status: 404, text: async () => '' };
    }

    return {
      ok: false,
      status: 404,
      text: async () => '',
      json: async () => ({}),
    };
  };

  try {
    const status = await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });

    assert.equal(status.state, 'error');
    assert.equal(status.runtimeStatusModel.runtimeContext.homeNode.configured, false);
    assert.equal(status.runtimeStatusModel.runtimeContext.homeNode.host, '');
    assert.equal(status.runtimeTargets.some((target) => target.kind === 'home-node'), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});
