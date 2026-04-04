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

test('latest phrasing prefers fresh-cloud routing when available', () => {
  const classification = classifyPromptFreshness('What is the latest Bethesda update?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: { groq: { ok: true }, ollama: { ok: true } },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
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
  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
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
  assert.equal(decision.fallbackReasonCode, 'groq-cloud-route-unusable');
  assert.equal(decision.overrideDeniedReason, 'groq-cloud-route-unusable');
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
  assert.equal(decision.fallbackReasonCode, 'groq-transport-unreachable');
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
  assert.equal(decision.fallbackReasonCode, 'groq-current-answers-unsupported');
  assert.equal(decision.freshRouteValidation.providerSupportsCurrentAnswers, false);
});

test('low-freshness prompt keeps default local provider without override', () => {
  const classification = classifyPromptFreshness('What is the capital of England?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: { groq: { ok: true }, ollama: { ok: true } },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.requestedProviderForRequest, 'ollama');
  assert.equal(decision.overrideDeniedReason, null);
  assert.equal(decision.selectedAnswerMode, 'local-private');
});

test('high freshness override denial reason is explicit about groq capability truth', () => {
  const classification = classifyPromptFreshness('Who is the current UK prime minister?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: {
        ok: true,
        providerCapability: {
          supportsCurrentAnswers: false,
          supportsFreshWeb: false,
        },
      },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.requestedProviderForRequest, 'ollama');
  assert.equal(decision.selectedAnswerMode, 'fallback-stale-risk');
  assert.equal(decision.overrideDeniedReason, 'groq-current-answers-unsupported');
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

  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
  assert.equal(decision.freshRouteValidation.providerCapability.supportsFreshWeb, true);
});

test('high-freshness PM question requests Groq when cloud fresh route is available', () => {
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
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.requestedProviderForRequest, 'groq');
  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
});

test('hosted high-freshness request pins to groq fresh route when fresh candidate exists', () => {
  const classification = classifyPromptFreshness('Who is the current US president today?');
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
          candidateFreshRouteAvailable: true,
          candidateFreshWebModel: 'compound-beta-mini',
          freshWebPath: '/responses:web_search',
        },
      },
      ollama: { ok: true },
    },
    runtimeStatus: { sessionKind: 'hosted-web', cloudAvailable: true, localAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.requestedProviderForRequest, 'groq');
  assert.equal(decision.selectedProvider, 'groq');
  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
  assert.equal(decision.candidateFreshModel, 'compound-beta-mini');
});

test('hosted high-freshness request degrades truthfully to route-unavailable when groq fresh candidate is unavailable', () => {
  const classification = classifyPromptFreshness('Who is the current UK prime minister?');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: {
        ok: true,
        providerCapability: {
          supportsCurrentAnswers: false,
          supportsFreshWeb: false,
          transportReachable: true,
        },
      },
      ollama: { ok: true },
    },
    runtimeStatus: { sessionKind: 'hosted-web', cloudAvailable: true, localAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.requestedProviderForRequest, 'groq');
  assert.equal(decision.selectedProvider, 'groq');
  assert.equal(decision.selectedAnswerMode, 'route-unavailable');
  assert.equal(decision.staleFallbackAttempted, false);
  assert.equal(decision.overrideDeniedReason, null);
  assert.equal(decision.fallbackReasonCode, 'groq-current-answers-unsupported');
});

test('office-holder U.S. president question is treated as high freshness and requests Groq', () => {
  const classification = classifyPromptFreshness('Who is the U.S. president?');
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
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(classification.freshnessNeed, 'high');
  assert.equal(decision.requestedProviderForRequest, 'groq');
  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
});

test('Champions League holders question requests Groq when explicit currentness is high freshness', () => {
  const classification = classifyPromptFreshness('Who are the current UEFA Champions League holders?');
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
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(classification.freshnessNeed, 'high');
  assert.equal(decision.requestedProviderForRequest, 'groq');
  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
});

test('low-freshness local system prompt remains local-first on Ollama', () => {
  const classification = classifyPromptFreshness('Help me debug local route truth for this repo.');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: { ok: true },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(classification.freshnessNeed, 'low');
  assert.equal(decision.requestedProviderForRequest, 'ollama');
  assert.equal(decision.selectedAnswerMode, 'local-private');
});

test('hosted low-freshness request uses cloud-basic when local/home bridge is unavailable', () => {
  const classification = classifyPromptFreshness('Summarize this architecture section.');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'groq',
    providerHealth: {
      groq: { ok: true, transportReachable: true },
      ollama: { ok: true },
    },
    runtimeStatus: {
      sessionKind: 'hosted-web',
      cloudAvailable: true,
      localAvailable: true,
      homeNodeAvailable: false,
      backendReachable: true,
    },
    routeTruthView: {
      backendReachableState: 'yes',
      homeNodeUsableState: 'no',
    },
  });

  assert.equal(decision.selectedProvider, 'groq');
  assert.equal(decision.selectedAnswerMode, 'cloud-basic');
  assert.match(decision.policyReason, /zero-cost cloud reasoning path/i);
});

test('hosted low-freshness request returns route-unavailable when neither cloud nor local path is reachable', () => {
  const classification = classifyPromptFreshness('Summarize this architecture section.');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'groq',
    providerHealth: {
      groq: { ok: false, transportReachable: false },
      ollama: { ok: false },
    },
    runtimeStatus: {
      sessionKind: 'hosted-web',
      cloudAvailable: false,
      localAvailable: false,
      homeNodeAvailable: false,
      backendReachable: true,
    },
    routeTruthView: {
      backendReachableState: 'yes',
      homeNodeUsableState: 'no',
    },
  });

  assert.equal(decision.selectedAnswerMode, 'route-unavailable');
  assert.equal(decision.fallbackReasonCode, 'no-viable-execution-path');
});

test('hosted low-freshness request keeps local-private only when home-node bridge is reachable', () => {
  const classification = classifyPromptFreshness('Summarize this architecture section.');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      groq: { ok: true, transportReachable: true },
      ollama: { ok: true },
    },
    runtimeStatus: {
      sessionKind: 'hosted-web',
      cloudAvailable: true,
      localAvailable: true,
      homeNodeAvailable: true,
      backendReachable: true,
    },
    routeTruthView: {
      backendReachableState: 'yes',
      homeNodeUsableState: 'yes',
    },
  });

  assert.equal(decision.selectedProvider, 'ollama');
  assert.equal(decision.selectedAnswerMode, 'local-private');
});

test('hosted session-kind alias still resolves low-freshness Groq requests to cloud-basic', () => {
  const classification = classifyPromptFreshness('Summarize this architecture section.');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'groq',
    providerHealth: {
      groq: { ok: true, transportReachable: true },
      ollama: { ok: true },
    },
    runtimeStatus: {
      sessionKind: 'hosted_web',
      cloudAvailable: true,
      localAvailable: true,
      homeNodeAvailable: false,
      backendReachable: true,
    },
    routeTruthView: {
      backendReachableState: 'yes',
      homeNodeUsableState: 'no',
    },
  });

  assert.equal(decision.selectedProvider, 'groq');
  assert.equal(decision.selectedAnswerMode, 'cloud-basic');
});
