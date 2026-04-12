import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalModelTruth, buildCanonicalProviderResolution } from '../services/assistantRequestTruth.js';

test('canonical provider resolution keeps intent/request/selected/executed layers distinct', () => {
  const truth = buildCanonicalProviderResolution({
    uiRequestedProvider: 'gemini',
    initialResolution: {
      requestedProvider: 'gemini',
      resolvedProvider: 'gemini',
      fallbackApplied: false,
    },
    requestedProviderForRequest: 'ollama',
    selectedProvider: 'ollama',
    actualProviderUsed: 'ollama',
  });

  assert.equal(truth.intentProvider, 'gemini');
  assert.equal(truth.requestProvider, 'ollama');
  assert.equal(truth.selectedProvider, 'ollama');
  assert.equal(truth.executedProvider, 'ollama');
  assert.equal(truth.requestProviderRewritten, true);
  assert.equal(truth.resolvedProvider, 'ollama');
  assert.equal(truth.initialResolution.resolvedProvider, 'gemini');
});

test('canonical model truth reports policy override when selected model differs from requested model', () => {
  const truth = buildCanonicalModelTruth({
    configuredModel: 'gpt-oss:20b',
    requestedModel: 'gpt-oss:20b',
    selectedModel: 'qwen:14b',
    executedModel: 'qwen:14b',
    selectionReason: 'Policy selected qwen:14b for normal local reasoning.',
    overrideReason: 'Policy selected qwen:14b for normal local reasoning.',
  });

  assert.equal(truth.configuredModel, 'gpt-oss:20b');
  assert.equal(truth.requestedModel, 'gpt-oss:20b');
  assert.equal(truth.selectedModel, 'qwen:14b');
  assert.equal(truth.executedModel, 'qwen:14b');
  assert.equal(truth.modelPolicyOverrideApplied, true);
  assert.match(truth.modelPolicyOverrideReason || '', /Policy selected qwen:14b/i);
});
