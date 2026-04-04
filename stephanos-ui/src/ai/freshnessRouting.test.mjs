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
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fresh-web');
  assert.equal(decision.selectedProvider, 'groq');
  assert.equal(decision.aiPolicy.aiPolicyMode, 'local-first-cloud-when-needed');
});

test('high-freshness request can use cloud route even when canonical selected route is currently unusable', () => {
  const classification = classifyPromptFreshness('Who is the current UK prime minister?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: {
        ok: true,
        providerCapability: {
          supportsCurrentAnswers: true,
          supportsFreshWeb: true,
          transportReachable: true,
        },
      },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'no', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedProvider, 'groq');
  assert.equal(decision.requestedProviderForRequest, 'groq');
  assert.equal(decision.selectedAnswerMode, 'fresh-web');
  assert.equal(decision.overrideDeniedReason, null);
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
  assert.equal(decision.fallbackReasonCode, 'cloud-route-unusable');
  assert.equal(decision.overrideDeniedReason, 'cloud-route-unusable');
});

test('fresh route requires provider transport reachability', () => {
  const classification = classifyPromptFreshness('Who is the US president today?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: { ok: true, transportReachable: false },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fallback-stale-risk');
  assert.equal(decision.fallbackReasonCode, 'transport-unreachable');
  assert.equal(decision.freshRouteValidation.providerTransportReachable, false);
});

test('fresh route blocks unsupported explicit web capability signal', () => {
  const classification = classifyPromptFreshness('What is the latest NVIDIA stock price?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: { ok: true, capabilities: { webEnabled: false } },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fallback-stale-risk');
  assert.equal(decision.fallbackReasonCode, 'web-capability-unsupported');
  assert.equal(decision.freshRouteValidation.webCapabilityState, 'unsupported');
});

test('fresh route uses explicit provider capability truth contract when present', () => {
  const classification = classifyPromptFreshness('Who is the current UK prime minister?');
  const decision = resolveFreshnessRoutingDecision({
    classification: { ...classification, freshnessNeed: 'high', explicitFreshness: true },
    requestedProvider: 'ollama',
    providerHealth: {
      groq: {
        ok: true,
        providerCapability: {
          provider: 'groq',
          available: true,
          transportReachable: true,
          supportsFreshWeb: true,
          supportsBrowserSearch: true,
          supportsCurrentAnswers: true,
          capabilityReason: 'compound model configured',
        },
      },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fresh-web');
  assert.equal(decision.freshRouteValidation.providerCapability.supportsFreshWeb, true);
});
