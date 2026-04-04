import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyPromptFreshness, resolveFreshnessRoutingDecision } from './freshnessRouting.js';

test('classifies current-affairs office-holder question as high freshness', () => {
  const result = classifyPromptFreshness('Who is the UK prime minister today?');
  assert.equal(result.freshnessNeed, 'high');
  assert.equal(result.currentAffairsLikely, true);
  assert.equal(result.webLookupRecommended, true);
  assert.equal(result.staleRisk, 'high');
});

test('classifies Stephanos continuity and local debugging prompts as low freshness', () => {
  const continuity = classifyPromptFreshness('Summarize my recent Stephanos continuity activity.');
  const localDebug = classifyPromptFreshness('Help me debug local route truth.');
  assert.equal(continuity.freshnessNeed, 'low');
  assert.equal(localDebug.freshnessNeed, 'low');
});

test('latest phrasing prefers fresh-web routing when available', () => {
  const classification = classifyPromptFreshness('What is the latest Bethesda update?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: { groq: { ok: true }, ollama: { ok: true } },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fresh-web');
  assert.equal(decision.selectedProvider, 'groq');
});

test('no fresh route available falls back with stale-risk mode', () => {
  const classification = classifyPromptFreshness('Who is the UK prime minister?');
  const decision = resolveFreshnessRoutingDecision({
    classification: { ...classification, freshnessNeed: 'high' },
    requestedProvider: 'ollama',
    providerHealth: { groq: { ok: false }, ollama: { ok: true } },
    runtimeStatus: { cloudAvailable: false, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fallback-stale-risk');
  assert.match(decision.freshnessWarning || '', /stale/i);
});
