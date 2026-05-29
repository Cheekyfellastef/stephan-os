import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseProviderDrift,
  reconcileExecutionRequestedProvider,
  reconcileFinalProviderDispatch,
  shouldPreserveLocalFirstExecution,
} from './providerRoutingTruth.js';
import { classifyPromptFreshness, resolveFreshnessRoutingDecision } from '../ai/freshnessRouting.js';

test('direct answer with low freshness preserves Ollama execution', () => {
  const classification = classifyPromptFreshness('what is 2 plus 2');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      ollama: { ok: true },
      gemini: { ok: true, providerCapability: { supportsFreshWeb: true, supportsCurrentAnswers: true, transportReachable: true } },
    },
    runtimeStatus: { localAvailable: true, cloudAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.freshnessCandidateProvider, 'gemini');
  assert.equal(decision.selectedProvider, 'ollama');
  assert.equal(decision.requestedProviderForRequest, 'ollama');
  assert.equal(decision.selectedAnswerMode, 'local-private');
});

test('ARL mission-planning prompt with low freshness preserves Ollama execution', () => {
  const classification = classifyPromptFreshness('tell me about the agent reality loop');
  const decision = resolveFreshnessRoutingDecision({
    classification,
    requestedProvider: 'ollama',
    providerHealth: {
      ollama: { ok: true },
      gemini: { ok: true, providerCapability: { supportsFreshWeb: true, supportsCurrentAnswers: true, transportReachable: true } },
    },
    runtimeStatus: { localAvailable: true, cloudAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(classification.freshnessNeed, 'low');
  assert.equal(decision.freshnessCandidateProvider, 'gemini');
  assert.equal(decision.selectedProvider, 'ollama');
  assert.equal(decision.requestedProviderForRequest, 'ollama');
  assert.equal(decision.executionProviderPolicyReason, 'execution-provider-policy-unchanged');
});

test('Project Awareness prompt injection cannot force Gemini when freshness stays low', () => {
  const classification = { freshnessNeed: 'low', staleRisk: 'low', explicitFreshness: false };
  const reconciled = reconcileExecutionRequestedProvider({
    uiSelectedProvider: 'ollama',
    uiDefaultProvider: 'ollama',
    requestedProviderIntent: 'ollama',
    freshnessCandidateProvider: 'gemini',
    proposedExecutionProvider: 'gemini',
    freshnessRequiredForTruth: false,
    freshAnswerRequired: false,
    freshnessNeed: classification.freshnessNeed,
    localRouteAvailable: true,
    fallbackPermitted: false,
  });

  assert.equal(reconciled.executionRequestedProvider, 'ollama');
  assert.equal(reconciled.reason, 'freshness-candidate-crossed-into-execution-provider-without-freshness-requirement');
});

test('freshness candidate Gemini remains separate from execution provider', () => {
  assert.equal(shouldPreserveLocalFirstExecution({
    uiSelectedProvider: 'ollama',
    uiDefaultProvider: 'ollama',
    requestedProviderIntent: 'ollama',
    freshnessRequiredForTruth: false,
    freshAnswerRequired: false,
    freshnessNeed: 'low',
  }), true);

  const reconciled = reconcileExecutionRequestedProvider({
    uiSelectedProvider: 'ollama',
    uiDefaultProvider: 'ollama',
    requestedProviderIntent: 'ollama',
    freshnessCandidateProvider: 'gemini',
    proposedExecutionProvider: 'ollama',
    freshnessNeed: 'low',
  });
  assert.equal(reconciled.executionRequestedProvider, 'ollama');
});

test('explicit Gemini selection still uses Gemini for low freshness', () => {
  const decision = resolveFreshnessRoutingDecision({
    classification: classifyPromptFreshness('summarize this plan'),
    requestedProvider: 'gemini',
    uiSelectedProvider: 'gemini',
    explicitProviderOverrideForRequest: true,
    providerHealth: { gemini: { ok: true, transportReachable: true }, ollama: { ok: true } },
    runtimeStatus: { sessionKind: 'hosted-web', cloudAvailable: true, localAvailable: false, homeNodeAvailable: false, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes', homeNodeUsableState: 'no', actualTarget: 'https://api.example.test' },
  });

  assert.equal(decision.selectedProvider, 'gemini');
  assert.equal(decision.requestedProviderForRequest, 'gemini');
});

test('fresh-required prompt can select Gemini when policy allows it', () => {
  const decision = resolveFreshnessRoutingDecision({
    classification: classifyPromptFreshness('who is the current US president today?'),
    requestedProvider: 'ollama',
    providerHealth: {
      gemini: { ok: true, providerCapability: { supportsFreshWeb: true, supportsCurrentAnswers: true, transportReachable: true } },
      ollama: { ok: true },
    },
    runtimeStatus: { cloudAvailable: true, localAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.selectedAnswerMode, 'fresh-cloud');
  assert.equal(decision.selectedProvider, 'gemini');
});

test('Ollama unavailable fallback to Gemini only happens when fallback policy permits it', () => {
  const base = {
    classification: classifyPromptFreshness('tell me about the agent reality loop'),
    requestedProvider: 'ollama',
    providerHealth: {
      ollama: { ok: false, state: 'offline' },
      gemini: { ok: true, providerCapability: { supportsFreshWeb: true, supportsCurrentAnswers: true, transportReachable: true } },
    },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes', homeNodeUsableState: 'no', actualTarget: 'https://api.example.test' },
  };
  const blocked = resolveFreshnessRoutingDecision({
    ...base,
    runtimeStatus: { sessionKind: 'hosted-web', cloudAvailable: true, localAvailable: false, homeNodeAvailable: false, backendReachable: true, fallbackEnabled: false },
  });
  const permitted = resolveFreshnessRoutingDecision({
    ...base,
    runtimeStatus: { sessionKind: 'hosted-web', cloudAvailable: true, localAvailable: false, homeNodeAvailable: false, backendReachable: true, fallbackEnabled: true },
  });

  assert.equal(blocked.selectedProvider, 'ollama');
  assert.equal(blocked.selectedAnswerMode, 'route-unavailable');
  assert.equal(permitted.selectedProvider, 'gemini');
  assert.equal(permitted.selectedAnswerMode, 'cloud-basic');
});

test('provider mismatch diagnostics identify freshness candidate drift boundary', () => {
  const drift = diagnoseProviderDrift({
    uiSelectedProvider: 'ollama',
    uiDefaultProvider: 'ollama',
    requestedProviderIntent: 'ollama',
    freshnessCandidateProvider: 'gemini',
    executionRequestedProvider: 'gemini',
    routerSelectedProvider: 'gemini',
    executableProvider: 'gemini',
    actualProviderUsed: 'gemini',
    freshnessRequiredForTruth: false,
    freshAnswerRequired: false,
    freshnessNeed: 'low',
  });

  assert.equal(drift.providerMismatch, 'yes');
  assert.equal(drift.providerDriftBoundary, 'execution-requested-provider');
  assert.equal(drift.providerDriftAllowed, 'no');
  assert.match(drift.providerDriftReason, /freshness-candidate/);
  assert.equal(drift.providerDriftPolicySource, 'local-first-freshness-guard');
});

test('stale UI default Gemini is not explicit current-request provider selection', () => {
  const decision = resolveFreshnessRoutingDecision({
    classification: classifyPromptFreshness('tell me about the agent reality loop'),
    requestedProvider: 'gemini',
    uiSelectedProvider: 'ollama',
    explicitProviderOverrideForRequest: false,
    providerHealth: {
      ollama: { ok: true },
      gemini: { ok: true, providerCapability: { supportsFreshWeb: true, supportsCurrentAnswers: true, transportReachable: true } },
    },
    runtimeStatus: { localAvailable: true, cloudAvailable: true, backendReachable: true },
    routeTruthView: { routeUsableState: 'yes', backendReachableState: 'yes' },
  });

  assert.equal(decision.explicitProviderOverrideForRequest, 'no');
  assert.equal(decision.uiSelectedProvider, 'ollama');
  assert.equal(decision.freshnessCandidateProvider, 'gemini');
  assert.equal(decision.selectedProvider, 'ollama');
  assert.equal(decision.requestedProviderForRequest, 'ollama');
});

test('final pre-dispatch guard rewrites stale Gemini execution back to Ollama', () => {
  const guarded = reconcileFinalProviderDispatch({
    uiSelectedProvider: 'ollama',
    uiDefaultProvider: 'gemini',
    requestedProviderIntent: 'ollama',
    freshnessCandidateProvider: 'gemini',
    executionRequestedProvider: 'gemini',
    freshnessRequiredForTruth: false,
    freshAnswerRequired: false,
    freshnessNeed: 'low',
    explicitProviderOverrideForRequest: false,
    fallbackPolicyTriggered: false,
    localRouteAvailable: true,
  });

  assert.equal(guarded.executionRequestedProvider, 'ollama');
  assert.equal(guarded.policySource, 'local-first-freshness-guard');
  assert.equal(guarded.reason, 'freshness-candidate-crossed-into-execution-provider-without-freshness-requirement');
});

test('diagnostics ignore stale UI default when execution remains selected Ollama', () => {
  const drift = diagnoseProviderDrift({
    uiSelectedProvider: 'ollama',
    uiDefaultProvider: 'gemini',
    requestedProviderIntent: 'ollama',
    freshnessCandidateProvider: 'gemini',
    executionRequestedProvider: 'ollama',
    routerSelectedProvider: 'ollama',
    executableProvider: 'ollama',
    actualProviderUsed: 'ollama',
    freshnessRequiredForTruth: false,
    freshAnswerRequired: false,
    freshnessNeed: 'low',
    explicitProviderOverrideForRequest: false,
  });

  assert.equal(drift.providerMismatch, 'no');
  assert.equal(drift.providerDriftBoundary, 'none');
  assert.equal(drift.providerDriftAllowed, 'n/a');
});
