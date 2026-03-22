import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStephanosHomeNodeCandidates,
  createStephanosHomeNodeUrls,
  discoverStephanosHomeNode,
  normalizeStephanosHomeNode,
  probeStephanosHomeNode,
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
  assert.equal(
    resolveStephanosBackendBaseUrl({ currentOrigin: 'https://cheekyfellastef.github.io', manualNode: normalizeStephanosHomeNode({ host: '192.168.1.42' }) }),
    'http://192.168.1.42:8787',
  );
});

test('probeStephanosHomeNode keeps the candidate LAN backend when health still publishes localhost', async () => {
  const probe = await probeStephanosHomeNode(
    { host: '192.168.0.198', source: 'manual' },
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
        }),
      }),
    },
  );

  assert.equal(probe.ok, true);
  assert.equal(probe.node.backendUrl, 'http://192.168.0.198:8787');
  assert.equal(probe.node.backendHealthUrl, 'http://192.168.0.198:8787/api/health');
  assert.equal(probe.health.backend_base_url, 'http://localhost:8787');
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

test('validateStephanosRuntime treats a reachable home node as reachable even when published client routes are misconfigured', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const manualNode = {
    host: '192.168.0.198',
    uiPort: 5173,
    backendPort: 8787,
    distPort: 4173,
    source: 'manual',
  };

  globalThis.window = { location: { origin: 'https://cheekyfellastef.github.io' } };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'stephanos_home_node_manual') {
        return JSON.stringify(manualNode);
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      return { ok: false, status: 404, text: async () => '' };
    }

    if (url === 'http://192.168.0.198:8787/api/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
          client_route_state: 'misconfigured',
        }),
        json: async () => ({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
          client_route_state: 'misconfigured',
        }),
      };
    }

    if (url === 'http://192.168.0.198:8787/api/ai/providers/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: {} }),
        json: async () => ({ success: true, data: {} }),
      };
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

    assert.equal(status.state, 'healthy');
    assert.equal(status.runtimeStatusModel.routeKind, 'home-node');
    assert.equal(status.runtimeStatusModel.homeNodeReachable, true);
    assert.equal(status.runtimeStatusModel.runtimeContext.homeNode.backendUrl, 'http://192.168.0.198:8787');
    assert.equal(status.runtimeStatusModel.runtimeContext.publishedClientRouteState, 'misconfigured');
    assert.match(status.message, /published client route misconfigured/i);
    assert.doesNotMatch(status.message, /no reachable stephanos route/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});


test('validateStephanosRuntime prefers local-desktop on PC when backend is online and home-node is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const manualNode = {
    host: '192.168.0.198',
    uiPort: 5173,
    backendPort: 8787,
    distPort: 4173,
    source: 'manual',
  };

  globalThis.window = { location: { origin: 'http://localhost:4173' } };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'stephanos_home_node_manual') {
        return JSON.stringify(manualNode);
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      if (url === 'http://localhost:5173/' || url === 'http://127.0.0.1:5173/' || url === 'http://127.0.0.1:4173/apps/stephanos/dist/') {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }

    if (url === './apps/stephanos/runtime-status.json' || url === 'http://127.0.0.1:4173/__stephanos/health') {
      return {
        ok: false,
        status: 404,
        text: async () => '',
        json: async () => ({}),
      };
    }

    if (url === 'http://192.168.0.198:8787/api/health') {
      return {
        ok: false,
        status: 503,
        text: async () => '',
        json: async () => ({}),
      };
    }

    if (url === 'http://localhost:8787/api/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
        json: async () => ({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
      };
    }

    if (url === 'http://localhost:8787/api/ai/providers/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { groq: { ok: true }, ollama: { ok: false } } }),
        json: async () => ({ success: true, data: { groq: { ok: true }, ollama: { ok: false } } }),
      };
    }

    if (url === 'http://localhost:5173/' || url === 'http://127.0.0.1:5173/') {
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body>Stephanos UI</body></html>',
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

  try {
    const status = await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });

    assert.equal(status.state, 'healthy');
    assert.equal(status.runtimeStatusModel.routeKind, 'local-desktop');
    assert.equal(status.runtimeStatusModel.preferredRoute, 'local-desktop');
    assert.equal(status.runtimeStatusModel.routeEvaluations['local-desktop'].available, true);
    assert.equal(status.runtimeStatusModel.routeEvaluations['home-node'].available, false);
    assert.match(status.message, /optional home-node is unavailable/i);
    assert.doesNotMatch(status.message, /source unknown/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('validateStephanosRuntime promotes localhost backend to local-desktop even from the hosted launcher', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  globalThis.window = { location: { origin: 'https://cheekyfellastef.github.io' } };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      if (url === './apps/stephanos/dist/index.html') {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }

    if (url === './apps/stephanos/runtime-status.json' || url === 'http://127.0.0.1:4173/__stephanos/health') {
      return {
        ok: false,
        status: 404,
        text: async () => '',
        json: async () => ({}),
      };
    }

    if (url === 'http://localhost:8787/api/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
        json: async () => ({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
      };
    }

    if (url === 'http://localhost:8787/api/ai/providers/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { groq: { ok: true } } }),
        json: async () => ({ success: true, data: { groq: { ok: true } } }),
      };
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

    assert.equal(status.state, 'healthy');
    assert.equal(status.runtimeStatusModel.routeKind, 'local-desktop');
    assert.equal(status.runtimeStatusModel.preferredRoute, 'local-desktop');
    assert.equal(status.runtimeStatusModel.runtimeContext.deviceContext, 'pc-local-browser');
    assert.equal(status.runtimeStatusModel.routeEvaluations['local-desktop'].source, 'local-backend-session');
    assert.match(status.runtimeStatusModel.routeEvaluations['local-desktop'].reason, /backend online locally/i);
    assert.equal(status.runtimeStatusModel.routeEvaluations.dist.available, true);
    assert.match(status.runtimeStatusModel.routeEvaluations.dist.blockedReason, /local-desktop is a valid live route and outranks dist/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});


test('validateStephanosRuntime prefers reachable home-node over dist fallback on LAN devices', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const manualNode = {
    host: '192.168.0.198',
    uiPort: 5173,
    backendPort: 8787,
    distPort: 4173,
    source: 'manual',
  };

  globalThis.window = { location: { origin: 'http://192.168.0.55:4173' } };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'stephanos_home_node_manual') {
        return JSON.stringify(manualNode);
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      if (url === './apps/stephanos/dist/index.html' || url === 'http://127.0.0.1:4173/apps/stephanos/dist/') {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }

    if (url === 'http://192.168.0.198:8787/api/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
        json: async () => ({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
      };
    }

    if (url === 'http://192.168.0.198:8787/api/ai/providers/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { groq: { ok: true } } }),
        json: async () => ({ success: true, data: { groq: { ok: true } } }),
      };
    }

    if (url === './apps/stephanos/runtime-status.json' || url === 'http://127.0.0.1:4173/__stephanos/health') {
      return {
        ok: false,
        status: 404,
        text: async () => '',
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

  try {
    const status = await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });

    assert.equal(status.state, 'healthy');
    assert.equal(status.runtimeStatusModel.routeKind, 'home-node');
    assert.equal(status.runtimeStatusModel.preferredRoute, 'home-node');
    assert.equal(status.launchUrl, 'http://192.168.0.198:5173/');
    assert.equal(status.launchStrategy, 'navigate');
    assert.equal(status.runtimeStatusModel.routeEvaluations['home-node'].available, true);
    assert.equal(status.runtimeStatusModel.routeEvaluations.dist.available, true);
    assert.match(status.message, /home pc node is reachable on the lan/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('validateStephanosRuntime prefers reachable home-node over dist from the hosted launcher on LAN devices', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const manualNode = {
    host: '192.168.0.198',
    uiPort: 5173,
    backendPort: 8787,
    distPort: 4173,
    source: 'manual',
  };

  globalThis.window = { location: { origin: 'https://cheekyfellastef.github.io' } };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'stephanos_home_node_manual') {
        return JSON.stringify(manualNode);
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      if (url === './apps/stephanos/dist/index.html') {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }

    if (url === 'http://192.168.0.198:8787/api/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
        json: async () => ({
          ok: true,
          service: 'stephanos-server',
          backend_base_url: 'http://localhost:8787',
          published_backend_base_url: 'http://localhost:8787',
          client_route_state: 'ready',
        }),
      };
    }

    if (url === 'http://192.168.0.198:8787/api/ai/providers/health') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { groq: { ok: true } } }),
        json: async () => ({ success: true, data: { groq: { ok: true } } }),
      };
    }

    if (url === './apps/stephanos/runtime-status.json' || url === 'http://127.0.0.1:4173/__stephanos/health') {
      return {
        ok: false,
        status: 404,
        text: async () => '',
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

  try {
    const status = await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });

    assert.equal(status.state, 'healthy');
    assert.equal(status.runtimeStatusModel.routeKind, 'home-node');
    assert.equal(status.runtimeStatusModel.preferredRoute, 'home-node');
    assert.equal(status.runtimeStatusModel.runtimeContext.deviceContext, 'lan-companion');
    assert.equal(status.launchUrl, 'http://192.168.0.198:5173/');
    assert.match(status.runtimeStatusModel.routeEvaluations['home-node'].reason, /published client route is misconfigured|reachable on the lan/i);
    assert.match(status.runtimeStatusModel.routeEvaluations.dist.blockedReason, /home-node is a valid live route and outranks dist/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('validateStephanosRuntime keeps dist as fallback only when no live route is valid and preserves explicit reasons', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const manualNode = {
    host: '192.168.0.198',
    uiPort: 5173,
    backendPort: 8787,
    distPort: 4173,
    source: 'manual',
  };

  globalThis.window = { location: { origin: 'http://192.168.0.55:4173' } };
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'stephanos_home_node_manual') {
        return JSON.stringify(manualNode);
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') {
      if (url === './apps/stephanos/dist/index.html') {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }

    if (url === 'http://192.168.0.198:8787/api/health') {
      return {
        ok: false,
        status: 503,
        text: async () => '',
        json: async () => ({}),
      };
    }

    if (url === './apps/stephanos/runtime-status.json' || url === 'http://127.0.0.1:4173/__stephanos/health') {
      return {
        ok: false,
        status: 404,
        text: async () => '',
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

  try {
    const status = await validateStephanosRuntime('apps/stephanos/dist/index.html', {}, { previousValidationState: 'unknown' });

    assert.equal(status.state, 'healthy');
    assert.equal(status.runtimeStatusModel.routeKind, 'dist');
    assert.equal(status.runtimeStatusModel.preferredRoute, 'dist');
    assert.equal(status.launchUrl, './apps/stephanos/dist/index.html');
    assert.equal(status.runtimeStatusModel.routeEvaluations['home-node'].available, false);
    assert.match(status.runtimeStatusModel.routeEvaluations['home-node'].blockedReason, /configured but currently unreachable|health probe could not confirm/i);
    assert.match(status.runtimeStatusModel.routeEvaluations.dist.reason, /fallback route/i);
    assert.match(status.message, /bundled dist entry exists and can be used as a fallback route/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});
