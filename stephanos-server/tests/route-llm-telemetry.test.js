import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFallbackTelemetry } from '../services/llm/router/routeLLMRequest.js';

test('resolveFallbackTelemetry marks direct provider redirect as fallback even when no attempt failed', () => {
  const telemetry = resolveFallbackTelemetry({
    requestedProvider: 'ollama',
    selectedProvider: 'mock',
    actualProvider: 'mock',
    failedAttempts: [],
  });

  assert.equal(telemetry.fallbackUsed, true);
  assert.match(telemetry.fallbackReason || '', /selected \"mock\" instead of requested \"ollama\"/i);
});

test('resolveFallbackTelemetry includes prior failed attempt reasons when fallback executes', () => {
  const telemetry = resolveFallbackTelemetry({
    requestedProvider: 'ollama',
    selectedProvider: 'ollama',
    actualProvider: 'mock',
    failedAttempts: [
      {
        provider: 'ollama',
        failureReason: 'Nothing answered at that Ollama address.',
      },
    ],
  });

  assert.equal(telemetry.fallbackUsed, true);
  assert.match(telemetry.fallbackReason || '', /Nothing answered at that Ollama address/i);
});
