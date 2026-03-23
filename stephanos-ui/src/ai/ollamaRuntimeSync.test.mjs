import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAutoSyncOllama } from './ollamaRuntimeSync.js';

test('shouldAutoSyncOllama stays backend-authoritative for pc local browser sessions', () => {
  assert.equal(shouldAutoSyncOllama({
    apiStatus: {
      backendReachable: true,
      frontendOrigin: 'http://localhost:4173',
    },
    ollamaHealth: {
      ok: false,
    },
    ollamaConfig: {
      baseURL: 'http://localhost:11434',
    },
  }), false);
});

test('shouldAutoSyncOllama still allows remote sessions to discover loopback Ollama replacements', () => {
  assert.equal(shouldAutoSyncOllama({
    apiStatus: {
      backendReachable: true,
      frontendOrigin: 'https://cheekyfellastef.github.io',
    },
    ollamaHealth: {
      ok: false,
      likelyWrongDevice: true,
    },
    ollamaConfig: {
      baseURL: 'http://localhost:11434',
    },
  }), true);
});
