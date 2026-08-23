import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyPromptFreshness, resolveFreshnessRoutingDecision } from './freshnessRouting.js';

const freshProviderHealth = {
  gemini: {
    ok: true,
    providerCapability: {
      supportsCurrentAnswers: true,
      supportsFreshWeb: true,
      transportReachable: true,
    },
  },
  ollama: { ok: true },
};

for (const prompt of [
  'Has Keir Starmer resigned?',
  'Did the prime minister resign?',
  'Has the CEO stepped down?',
  'Was the governor removed from office?',
]) {
  test(`routes current state-change question through fresh web truth: ${prompt}`, () => {
    const classification = classifyPromptFreshness(prompt);
    const decision = resolveFreshnessRoutingDecision({
      classification,
      requestedProvider: 'ollama',
      providerHealth: freshProviderHealth,
      runtimeStatus: {
        cloudAvailable: true,
        localAvailable: true,
        backendReachable: true,
      },
      routeTruthView: {
        routeUsableState: 'yes',
        backendReachableState: 'yes',
      },
    });

    assert.equal(classification.freshnessNeed, 'high');
    assert.equal(classification.currentAffairsLikely, true);
    assert.equal(classification.webLookupRecommended, true);
    assert.equal(classification.staleRisk, 'high');
    assert.equal(decision.selectedProvider, 'gemini');
    assert.equal(decision.requestedProviderForRequest, 'gemini');
    assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
  });
}

test('timeless resignation-process question remains non-fresh', () => {
  const classification = classifyPromptFreshness('How does a prime minister resign?');
  assert.equal(classification.freshnessNeed, 'low');
  assert.equal(classification.webLookupRecommended, false);
});
