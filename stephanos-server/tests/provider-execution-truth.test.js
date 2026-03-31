import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderExecutionTruth } from '../services/providerExecutionTruth.js';

test('execution truth narration prioritizes actual provider used over defaults', () => {
  const truth = resolveProviderExecutionTruth({
    actualProviderUsed: 'groq',
    executionStatus: 'ok:groq',
    executableProvider: 'groq',
    selectedProvider: 'groq',
    backendDefaultProvider: 'ollama',
  });

  assert.equal(truth.providerUsed, 'groq');
  assert.equal(truth.status, 'ok:groq');
  assert.equal(truth.answered, 'groq answered');
  assert.match(truth.narration, /groq answered/i);
  assert.doesNotMatch(truth.narration, /ollama answered/i);
});

test('execution truth uses executable/selected provider when actual provider is missing', () => {
  const truth = resolveProviderExecutionTruth({
    actualProviderUsed: '',
    executionStatus: '',
    executableProvider: 'gemini',
    selectedProvider: 'groq',
    backendDefaultProvider: 'ollama',
  });

  assert.equal(truth.providerUsed, 'gemini');
  assert.equal(truth.status, 'ok:gemini');
});
