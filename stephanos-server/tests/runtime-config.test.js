import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHealthDiagnostics,
  resolveAllowedOrigins,
} from '../config/runtimeConfig.js';

test('allowed origins keep local development fallbacks and hosted frontend support', () => {
  const allowedOrigins = resolveAllowedOrigins({});

  assert.deepEqual(allowedOrigins, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
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
  assert.equal(diagnostics.default_provider, 'ollama');
  assert.equal(diagnostics.ollama_endpoint, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(diagnostics.cors.allowed_origins, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://cheekyfellastef.github.io',
    'https://example.test',
  ]);
});
