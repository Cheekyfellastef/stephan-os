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

test('execution truth narrates fallback provider and reason without conflating selected provider', () => {
  const truth = resolveProviderExecutionTruth({
    requestedProviderForRequest: 'gemini',
    actualProviderUsed: 'groq',
    executionStatus: 'ok:groq',
    executableProvider: 'gemini',
    selectedProvider: 'gemini',
    backendDefaultProvider: 'ollama',
    fallbackUsed: true,
    fallbackProviderUsed: 'groq',
    fallbackReason: 'gemini: Invalid JSON payload received. Unknown name "config": Cannot find field.',
  });

  assert.equal(truth.providerUsed, 'groq');
  assert.match(truth.narration, /Fallback via groq after gemini failure/i);
  assert.match(truth.narration, /Unknown name "config"/i);
});
