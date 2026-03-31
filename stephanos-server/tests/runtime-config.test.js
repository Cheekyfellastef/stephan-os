import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHealthDiagnostics,
  resolvePublishedBackendBaseUrl,
  resolveAllowedOrigins,
} from '../config/runtimeConfig.js';

test('allowed origins keep local development fallbacks and hosted frontend support', () => {
  const allowedOrigins = resolveAllowedOrigins({});

  assert.deepEqual(allowedOrigins, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'https://cheekyfellastef.github.io',
  ]);
});

test('allowed origins merge FRONTEND_ORIGIN and FRONTEND_ORIGINS without duplicates', () => {
  const allowedOrigins = resolveAllowedOrigins({
    FRONTEND_ORIGIN: 'https://one.example',
    FRONTEND_ORIGINS: 'https://two.example, https://one.example ,https://three.example',
  });

  assert.deepEqual(allowedOrigins, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'https://cheekyfellastef.github.io',
    'https://one.example',
    'https://two.example',
    'https://three.example',
  ]);
});

test('health diagnostics expose backend target endpoint and visible CORS origins', () => {
  const diagnostics = buildHealthDiagnostics({
    PORT: '9090',
    FRONTEND_ORIGINS: 'https://example.test',
  });

  assert.equal(diagnostics.backend_base_url, 'http://localhost:9090');
  assert.equal(diagnostics.backend_target_endpoint, 'http://localhost:9090/api/ai/chat');
  assert.equal(diagnostics.backend_internal_base_url, 'http://localhost:9090');
  assert.equal(diagnostics.backend_internal_target_endpoint, 'http://localhost:9090/api/ai/chat');
  assert.equal(diagnostics.client_route_state, 'ready');
  assert.equal(diagnostics.client_route_source, 'internal-loopback');
  assert.equal(diagnostics.default_provider, 'ollama');
  assert.equal(diagnostics.provider_defaults.ollama.defaults.baseURL, '[server-internal-only]');
  assert.equal(diagnostics.provider_defaults.ollama.endpoint, '[server-internal-only]');
  assert.deepEqual(diagnostics.ollama_routing, {
    visibility: 'server-internal-only',
    summary: 'Stephanos server calls Ollama locally on the PC home node.',
  });
  assert.deepEqual(diagnostics.cors.allowed_origins, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'https://cheekyfellastef.github.io',
    'https://example.test',
  ]);
});

test('published backend base url uses inbound LAN host for remote-safe client routing', () => {
  const diagnostics = buildHealthDiagnostics(
    { PORT: '8787' },
    {
      headers: {
        host: '192.168.0.198:8787',
      },
      protocol: 'http',
      secure: false,
    },
  );

  assert.equal(diagnostics.backend_base_url, 'http://192.168.0.198:8787');
  assert.equal(diagnostics.backend_target_endpoint, 'http://192.168.0.198:8787/api/ai/chat');
  assert.equal(diagnostics.backend_internal_base_url, 'http://localhost:8787');
  assert.equal(diagnostics.client_route_state, 'ready');
  assert.equal(diagnostics.client_route_source, 'request-host');
  assert.equal(diagnostics.ok, true);
});

test('request-aware resolver promotes request host when configured public base url is loopback', () => {
  const resolved = resolvePublishedBackendBaseUrl({
    env: {
      PORT: '8787',
      PUBLIC_BASE_URL: 'http://localhost:8787',
    },
    request: {
      headers: {
        host: '192.168.0.198:8787',
      },
      protocol: 'http',
      secure: false,
    },
  });

  assert.equal(resolved.publishedBaseUrl, 'http://192.168.0.198:8787');
  assert.equal(resolved.internalBaseUrl, 'http://localhost:8787');
  assert.equal(resolved.clientRouteState, 'ready');
  assert.equal(resolved.clientRouteSafe, true);
  assert.equal(resolved.source, 'request-host-promoted');
});


test('request-aware resolver ignores loopback forwarded host when direct host is LAN', () => {
  const resolved = resolvePublishedBackendBaseUrl({
    env: {
      PORT: '8787',
      PUBLIC_BASE_URL: 'http://localhost:8787',
    },
    request: {
      headers: {
        host: '192.168.0.198:8787',
        'x-forwarded-host': 'localhost:8787',
      },
      protocol: 'http',
      secure: false,
    },
  });

  assert.equal(resolved.publishedBaseUrl, 'http://192.168.0.198:8787');
  assert.equal(resolved.source, 'request-host-promoted');
  assert.equal(resolved.clientRouteSafe, true);
});

test('health diagnostics mark groq configured when backend local secret store is configured', () => {
  const diagnostics = buildHealthDiagnostics(
    {},
    null,
    {
      providerSecretStatus: {
        groq: {
          configured: true,
          masked: '••••••••1234',
          updatedAt: '2026-03-31T00:00:00.000Z',
        },
      },
      secretAuthority: 'backend-local-secret-store',
    },
  );

  assert.equal(diagnostics.groq.configured, true);
  assert.equal(diagnostics.groq.configured_via_secret_store, true);
  assert.match(diagnostics.groq.configured_via.join(','), /backend-local-secret-store/);
});

test('health diagnostics keep groq unconfigured when env and backend local secret store are both absent', () => {
  const diagnostics = buildHealthDiagnostics(
    {},
    null,
    {
      providerSecretStatus: {
        groq: {
          configured: false,
          masked: '',
          updatedAt: null,
        },
      },
    },
  );

  assert.equal(diagnostics.groq.configured, false);
  assert.deepEqual(diagnostics.groq.configured_via, ['missing']);
  assert.equal(diagnostics.groq.configured_via_secret_store, false);
});
