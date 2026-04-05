import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProviderDraft, resolveProviderEndpointForDisplay } from './providerConfig.js';

test('resolveProviderEndpointForDisplay hides saved localhost Ollama endpoints on remote devices', () => {
  const display = resolveProviderEndpointForDisplay({
    providerKey: 'ollama',
    config: {
      baseURL: 'http://localhost:11434',
      model: 'gpt-oss:20b',
    },
    runtimeContext: {
      sessionKind: 'hosted-web',
      frontendLocal: false,
    },
    sessionRestoreDiagnostics: {
      ignoredFields: ['providerConfigs.ollama.baseURL'],
    },
  });

  assert.equal(display, 'Handled by Stephanos backend (saved localhost endpoint ignored on this device)');
});

test('resolveProviderEndpointForDisplay keeps localhost Ollama endpoints visible on PC-local sessions', () => {
  const display = resolveProviderEndpointForDisplay({
    providerKey: 'ollama',
    config: {
      baseURL: 'http://localhost:11434',
      model: 'gpt-oss:20b',
    },
    runtimeContext: {
      sessionKind: 'local-desktop',
      frontendLocal: true,
    },
    sessionRestoreDiagnostics: {
      ignoredFields: [],
    },
  });

  assert.equal(display, 'http://localhost:11434');
});

test('normalizeProviderDraft migrates legacy ollama timeoutMs to defaultOllamaTimeoutMs', () => {
  const normalized = normalizeProviderDraft('ollama', {
    baseURL: 'http://localhost:11434',
    model: 'gpt-oss:20b',
    timeoutMs: 14000,
  });

  assert.equal(normalized.defaultOllamaTimeoutMs, 14000);
  assert.equal(normalized.timeoutMs, 14000);
  assert.deepEqual(normalized.perModelTimeoutOverrides, {});
});
