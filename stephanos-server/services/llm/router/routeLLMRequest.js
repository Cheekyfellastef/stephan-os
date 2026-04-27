import { DEFAULT_PROVIDER_KEY, PROVIDER_DEFINITIONS } from '../../../../shared/ai/providerDefaults.mjs';
import { ERROR_CODES } from '../../errors.js';
import { createLogger } from '../../../utils/logger.js';
import { PROVIDER_HEALTH_CHECKS, PROVIDER_RUNNERS } from '../providers/index.js';
import {
  buildAIRequest,
  buildRouterConfig,
  redactSecrets,
  resolveRoutingPlan,
  sanitizeProviderConfig,
} from '../utils/providerUtils.js';
import { determineFastLaneEligibility } from './fastResponseLane.js';

const logger = createLogger('llm-router');

function normalizeProviderCapabilityTruth(provider, health = {}) {
  const explicit = health?.providerCapability && typeof health.providerCapability === 'object'
    ? health.providerCapability
    : null;
  if (explicit) {
    return {
      provider,
      available: explicit.available === true,
      transportReachable: explicit.transportReachable === true,
      supportsFreshWeb: explicit.supportsFreshWeb === true,
      supportsBrowserSearch: explicit.supportsBrowserSearch === true,
      supportsCurrentAnswers: explicit.supportsCurrentAnswers === true,
      requiresGrounding: explicit.requiresGrounding === true,
      groundingMode: String(explicit.groundingMode || 'none'),
      groundingEnabled: explicit.groundingEnabled === true,
      configuredModel: String(explicit.configuredModel || ''),
      configuredModelSupportsFreshWeb: explicit.configuredModelSupportsFreshWeb === true,
      configuredModelSupportsCurrentAnswers: explicit.configuredModelSupportsCurrentAnswers === true,
      candidateFreshRouteAvailable: explicit.candidateFreshRouteAvailable === true,
      candidateFreshWebModel: String(explicit.candidateFreshWebModel || ''),
      freshWebPath: String(explicit.freshWebPath || ''),
      capabilityReason: String(explicit.capabilityReason || health.detail || 'Capability truth unavailable.'),
    };
  }

  return {
    provider,
    available: health?.ok === true,
    transportReachable: health?.transportReachable === true || health?.ok === true,
    supportsFreshWeb: false,
    supportsBrowserSearch: false,
    supportsCurrentAnswers: false,
    requiresGrounding: false,
    groundingMode: 'none',
    groundingEnabled: false,
    configuredModel: '',
    configuredModelSupportsFreshWeb: false,
    configuredModelSupportsCurrentAnswers: false,
    candidateFreshRouteAvailable: false,
    candidateFreshWebModel: '',
    freshWebPath: '',
    capabilityReason: provider === 'groq'
      ? 'Groq capability truth unavailable from provider health diagnostics.'
      : `${provider} does not expose fresh-web capability in this backend route.`,
  };
}

function summarizeAttemptFailure(provider, attempt) {
  if (!attempt) return null;
  if (attempt.result?.ok && attempt.result?.outputText) return null;
  if (attempt.result?.ok && !attempt.result?.outputText) return `Provider "${provider}" returned an empty response.`;
  const timeoutLabel = attempt.result?.error?.details?.failureLabel || attempt.result?.diagnostics?.ollama?.executionFailureLabel || '';
  const timeoutLayer = attempt.result?.error?.details?.failureLayer || attempt.result?.diagnostics?.ollama?.executionFailureLayer || '';
  const timeoutCategory = attempt.result?.error?.details?.timeoutCategory || attempt.result?.diagnostics?.ollama?.timeoutCategory || '';
  const timeoutMs = attempt.result?.error?.details?.timeoutMs || attempt.result?.diagnostics?.ollama?.timeoutMs || null;
  const warmupLikely = attempt.result?.error?.details?.modelWarmupLikely === true || attempt.result?.diagnostics?.ollama?.modelWarmupLikely === true;
  const warmupHint = warmupLikely ? 'model-warmup-likely' : '';
  const timeoutDetail = [timeoutLabel, timeoutLayer, timeoutCategory, warmupHint].filter(Boolean).join(',');
  const failureMessage = attempt.result?.error?.message || attempt.health?.reason || attempt.health?.detail || `Provider "${provider}" failed.`;
  if (!timeoutDetail && !timeoutMs) return failureMessage;
  return `${failureMessage} [${timeoutDetail}${timeoutMs ? `; timeoutMs=${timeoutMs}` : ''}]`;
}

function buildFallbackReason(failedAttempts = []) {
  const reasons = failedAttempts
    .map(({ provider, failureReason }) => failureReason ? `${provider}: ${failureReason}` : null)
    .filter(Boolean);

  return reasons.length > 0 ? reasons.join(' | ') : null;
}

function isFreshCapableProvider(providerHealthSnapshot = {}, provider = '') {
  const capability = providerHealthSnapshot?.[provider]?.providerCapability || {};
  return capability.supportsFreshWeb === true
    || capability.supportsCurrentAnswers === true;
}

export function resolveFallbackTelemetry({
  requestedProvider = DEFAULT_PROVIDER_KEY,
  selectedProvider = DEFAULT_PROVIDER_KEY,
  actualProvider = DEFAULT_PROVIDER_KEY,
  failedAttempts = [],
} = {}) {
  const attemptFailureReason = buildFallbackReason(failedAttempts);
  const providerRedirected = actualProvider !== requestedProvider;
  const fallbackUsed = failedAttempts.length > 0 || providerRedirected;

  if (!fallbackUsed) {
    return { fallbackUsed: false, fallbackReason: null };
  }

  if (attemptFailureReason) {
    return { fallbackUsed: true, fallbackReason: attemptFailureReason };
  }

  if (selectedProvider !== requestedProvider) {
    return {
      fallbackUsed: true,
      fallbackReason: `Routing selected "${selectedProvider}" instead of requested "${requestedProvider}" because the requested provider was not healthy for this route.`,
    };
  }

  return {
    fallbackUsed: true,
    fallbackReason: `Routing executed "${actualProvider}" instead of requested "${requestedProvider}".`,
  };
}

async function executeProvider(provider, request, routerConfig, providerConfigOverrides = {}) {
  const routeSelectionHealth = routerConfig?.providerHealthSnapshot?.[provider] || {};
  const config = sanitizeProviderConfig(provider, {
    ...(routerConfig.providerConfigs?.[provider] || {}),
    ...(providerConfigOverrides || {}),
    runtimeContext: routerConfig.runtimeContext,
    selectedProviderHealthOkAtSelection: routeSelectionHealth.ok === true,
  });
  const health = await PROVIDER_HEALTH_CHECKS[provider](config);
  const result = await PROVIDER_RUNNERS[provider](request, config);

  return {
    provider,
    config,
    health,
    result,
  };
}

export async function getProviderHealthSnapshot(routerConfigInput = {}) {
  const routerConfig = buildRouterConfig(routerConfigInput);
  const snapshot = {};

  for (const provider of Object.keys(PROVIDER_DEFINITIONS)) {
    const config = sanitizeProviderConfig(provider, {
      ...(routerConfig.providerConfigs?.[provider] || {}),
      runtimeContext: routerConfig.runtimeContext,
    });
    const health = await PROVIDER_HEALTH_CHECKS[provider](config);
    const providerCapability = normalizeProviderCapabilityTruth(provider, health);
    snapshot[provider] = {
      ...health,
      transportReachable: health?.transportReachable === true || providerCapability.transportReachable,
      providerCapability,
      active: routerConfig.provider === provider,
      fallback: routerConfig.fallbackOrder.includes(provider) && provider !== routerConfig.provider,
      config: redactSecrets(config),
    };
  }

  const routing = resolveRoutingPlan(routerConfig, snapshot);

  return {
    ...snapshot,
    routing: {
      requestedProvider: routing.requestedProvider,
      requestedRouteMode: routing.requestedRouteMode,
      effectiveRouteMode: routing.effectiveRouteMode,
      selectedProvider: routing.selectedProvider,
      requestedProviderForRequest: routing.requestedProviderForRequest,
      providerSelectionSource: routing.providerSelectionSource,
      freshnessNeed: routing.freshnessNeed,
      freshnessWarning: routing.freshnessWarning,
      attemptOrder: routing.attemptOrder,
      readyLocalProviders: routing.readyLocalProviders,
      readyCloudProviders: routing.readyCloudProviders,
      localAvailable: routing.localAvailable,
      cloudAvailable: routing.cloudAvailable,
      runtimeContext: routing.runtimeContext,
    },
  };
}

export function resolveProviderRequest(provider, providerConfig = {}, options = {}) {
  const routerConfig = buildRouterConfig({
    provider,
    routeMode: options.routeMode,
    providerConfigs: { [provider]: providerConfig },
    fallbackEnabled: options.fallbackEnabled,
    fallbackOrder: options.fallbackOrder,
    devMode: options.devMode,
    runtimeContext: options.runtimeContext,
  });

  return {
    requestedProvider: provider || DEFAULT_PROVIDER_KEY,
    requestedRouteMode: routerConfig.routeMode,
    resolvedProvider: routerConfig.provider,
    fallbackApplied: routerConfig.provider !== (provider || DEFAULT_PROVIDER_KEY),
    overrideKeys: Object.keys(providerConfig || {}).filter((key) => {
      const value = providerConfig?.[key];
      return typeof value === 'string' ? value.trim() !== '' : value != null;
    }),
  };
}

export async function routeLLMRequest(requestInput = {}, configInput = {}) {
  const request = buildAIRequest(requestInput);
  const routerConfig = buildRouterConfig({
    ...configInput,
    freshnessContext: configInput?.freshnessContext || request?.freshnessContext || null,
  });
  const providerHealthSnapshot = await getProviderHealthSnapshot(routerConfig);
  const routing = providerHealthSnapshot.routing;
  const attempts = [];
  const attemptOrder = routing.attemptOrder;
  const savedPreferredProvider = configInput.provider || DEFAULT_PROVIDER_KEY;
  const requestedProvider = routing.requestedProviderForRequest || routing.selectedProvider || savedPreferredProvider;
  const requestedRouteMode = routing.requestedRouteMode;
  const selectedProvider = routing.selectedProvider;
  const initialFastLaneEligibility = determineFastLaneEligibility(
    '',
    {
      ...request,
      freshnessContext: configInput?.freshnessContext || request?.freshnessContext || null,
      routeDecision: request?.routeDecision || requestInput?.routeDecision || null,
    },
    routing,
  );
  const fastLaneModel = selectedProvider === 'ollama' && initialFastLaneEligibility.eligible
    ? 'llama3.2:3b'
    : '';
  const resolveFastLaneTruth = ({ provider = '', modelUsed = '' } = {}) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedModel = String(modelUsed || '').trim().toLowerCase();
    const eligible = initialFastLaneEligibility.eligible === true
      || (normalizedProvider === 'ollama' && normalizedModel === 'llama3.2:3b');
    const active = eligible && normalizedProvider === 'ollama' && normalizedModel === 'llama3.2:3b';
    return {
      eligible,
      active,
      model: active ? 'llama3.2:3b' : '',
    };
  };
  const initialEscalationModel = selectedProvider === 'ollama' && fastLaneModel
    ? (
      String(configInput?.providerConfigs?.ollama?.model || '').trim().toLowerCase() === 'llama3.2:3b'
        ? 'qwen:14b'
        : String(configInput?.providerConfigs?.ollama?.model || '').trim() || 'qwen:14b'
    )
    : '';
  const freshnessNeed = String(routing.freshnessNeed || request?.freshnessContext?.freshnessNeed || '').trim().toLowerCase();
  const freshnessRequiredForTruth = freshnessNeed === 'high';
  const staleFallbackPermitted = Boolean(
    configInput?.staleFallbackPermitted
    ?? requestInput?.staleFallbackPermitted
    ?? requestInput?.routeDecision?.staleFallbackPermitted
    ?? requestInput?.freshnessContext?.staleFallbackPermitted
    ?? false,
  );
  const freshProvidersInOrder = attemptOrder.filter((provider) => isFreshCapableProvider(providerHealthSnapshot, provider));
  const freshProviderAvailableForRequest = freshProvidersInOrder.length > 0;
  let freshProviderAttempted = null;
  let freshProviderSucceeded = false;
  let staleFallbackAttempted = false;
  let staleFallbackUsed = false;
  let staleFallbackBlocked = false;
  let staleAnswerWarning = null;

  logger.info('Routing LLM request', {
    requestedProvider,
    savedPreferredProvider,
    requestedRouteMode,
    effectiveRouteMode: routing.effectiveRouteMode,
    selectedProvider,
    providerSelectionSource: routing.providerSelectionSource,
    fallbackEnabled: routerConfig.fallbackEnabled,
    attemptOrder,
    freshnessRequiredForTruth,
    staleFallbackPermitted,
  });
  console.log('[BACKEND LIVE] Provider router request', {
    requested_provider: requestedProvider,
    requested_route_mode: requestedRouteMode,
    effective_route_mode: routing.effectiveRouteMode,
    selected_provider: selectedProvider,
    fallback_enabled: routerConfig.fallbackEnabled,
    attempt_order: attemptOrder,
    runtime_context: routing.runtimeContext,
  });

  for (const provider of attemptOrder) {
    const providerFreshCapable = isFreshCapableProvider(providerHealthSnapshot, provider);
    if (freshnessRequiredForTruth && providerFreshCapable && !freshProviderAttempted) {
      freshProviderAttempted = provider;
    }
    logger.info('Executing provider attempt', {
      requestedProvider,
      savedPreferredProvider,
      requestedRouteMode,
      selectedProvider,
      providerSelectionSource: routing.providerSelectionSource,
      provider,
    });
    console.log('[BACKEND LIVE] Provider attempt starting', {
      requested_provider: requestedProvider,
      requested_route_mode: requestedRouteMode,
      effective_route_mode: routing.effectiveRouteMode,
      selected_provider: selectedProvider,
      provider_selection_source: routing.providerSelectionSource,
      actual_provider_attempt: provider,
    });

    const attempt = await executeProvider(provider, request, {
      ...routerConfig,
      providerHealthSnapshot,
    }, {
      ...(provider === 'ollama' && fastLaneModel ? { model: fastLaneModel } : {}),
      ...(typeof configInput?.streamObserver === 'function' ? { streamObserver: configInput.streamObserver } : {}),
    });
    const failureReason = summarizeAttemptFailure(provider, attempt);

    if (
      provider === 'ollama'
      && fastLaneModel
      && (!attempt.result?.ok || !attempt.result?.outputText)
      && initialEscalationModel
    ) {
      const escalationAttempt = await executeProvider(provider, request, {
        ...routerConfig,
        providerHealthSnapshot,
      }, {
        model: initialEscalationModel,
        ...(typeof configInput?.streamObserver === 'function' ? { streamObserver: configInput.streamObserver } : {}),
      });
      const escalationFailureReason = summarizeAttemptFailure(provider, escalationAttempt);
      attempts.push({
        provider,
        health: escalationAttempt.health,
        failureReason: escalationFailureReason,
        result: escalationAttempt.result.ok ? { ...escalationAttempt.result, raw: undefined } : escalationAttempt.result,
      });
      if (escalationAttempt.result?.ok && escalationAttempt.result?.outputText) {
        const failedAttempts = attempts.slice(0, -1);
        const { fallbackUsed, fallbackReason } = resolveFallbackTelemetry({
          requestedProvider,
          selectedProvider,
          actualProvider: provider,
          failedAttempts,
        });
        const fastLaneTruth = resolveFastLaneTruth({
          provider,
          modelUsed: escalationAttempt.result.model || '',
        });
        return {
          ...escalationAttempt.result,
          requestedProvider,
          actualProviderUsed: provider,
          modelUsed: escalationAttempt.result.model || '',
          fallbackUsed: true,
          fallbackReason: fallbackReason || 'fast-lane-escalation',
          diagnostics: {
            ...(escalationAttempt.result.diagnostics || {}),
            requestedProvider,
            selectedProvider,
            resolvedProvider: provider,
            actualProviderUsed: provider,
            modelUsed: escalationAttempt.result.model || '',
            fallbackUsed: true,
            fallbackReason: fallbackReason || 'fast-lane-escalation',
            attemptOrder,
            attempts,
            runtimeContext: routing.runtimeContext,
            fastResponseLane: {
              eligible: fastLaneTruth.eligible,
              active: fastLaneTruth.active,
              reason: initialFastLaneEligibility.reason,
              model: fastLaneTruth.model,
              escalationModel: initialEscalationModel,
              escalationReason: 'fast-lane-initial-attempt-failed',
            },
            routing,
            routerConfig: redactSecrets(routerConfig),
          },
        };
      }
    }

    attempts.push({
      provider,
      health: attempt.health,
      failureReason,
      result: attempt.result.ok ? { ...attempt.result, raw: undefined } : attempt.result,
    });

    logger.info('Provider attempt completed', {
      requestedProvider,
      savedPreferredProvider,
      requestedRouteMode,
      selectedProvider,
      provider,
      ok: attempt.result.ok,
      outputTextPresent: Boolean(attempt.result.outputText),
      fallbackTriggerReason: failureReason,
    });
    console.log('[BACKEND LIVE] Provider attempt completed', {
      requested_provider: requestedProvider,
      requested_route_mode: requestedRouteMode,
      effective_route_mode: routing.effectiveRouteMode,
      selected_provider: selectedProvider,
      actual_provider_attempt: provider,
      ok: attempt.result.ok,
      output_text_present: Boolean(attempt.result.outputText),
      fallback_trigger_reason: failureReason,
    });

    if (attempt.result.ok && attempt.result.outputText) {
      if (freshnessRequiredForTruth && !providerFreshCapable) {
        staleFallbackAttempted = true;
        staleFallbackUsed = true;
        staleAnswerWarning = `Freshness-critical request answered by non-fresh provider "${provider}". Current-truth verification is unavailable.`;
        if (!staleFallbackPermitted) {
          staleFallbackBlocked = true;
          staleFallbackUsed = false;
          continue;
        }
      }
      if (freshnessRequiredForTruth && providerFreshCapable) {
        freshProviderSucceeded = true;
      }
      const failedAttempts = attempts.slice(0, -1);
      const { fallbackUsed, fallbackReason } = resolveFallbackTelemetry({
        requestedProvider,
        selectedProvider,
        actualProvider: provider,
        failedAttempts,
      });
      const answerTruthMode = freshnessRequiredForTruth
        ? (providerFreshCapable ? 'fresh-verified' : 'degraded-stale-allowed')
        : 'standard-nonfresh';
      const freshnessIntegrityPreserved = !freshnessRequiredForTruth
        || providerFreshCapable
        || (staleFallbackPermitted && staleFallbackUsed && Boolean(staleAnswerWarning));
      const finalResult = {
        ...attempt.result,
        requestedProvider,
        actualProviderUsed: provider,
        modelUsed: attempt.result.model || '',
        fallbackUsed,
        fallbackReason,
        diagnostics: {
          ...(attempt.result.diagnostics || {}),
          requestedProvider,
          savedPreferredProvider,
          requestedRouteMode,
          effectiveRouteMode: routing.effectiveRouteMode,
          selectedProvider,
          providerSelectionSource: routing.providerSelectionSource,
          resolvedProvider: provider,
          actualProviderUsed: provider,
          modelUsed: attempt.result.model || '',
          fallbackUsed,
          fallbackReason,
          attemptOrder,
          attempts,
          runtimeContext: routing.runtimeContext,
          freshnessTruth: {
            freshnessRequiredForTruth,
            freshAnswerRequired: freshnessRequiredForTruth,
            freshProviderAvailableForRequest,
            freshProviderAttempted,
            freshProviderSucceeded,
            staleFallbackPermitted,
            staleFallbackAttempted,
            staleFallbackUsed,
            staleFallbackBlocked,
            staleAnswerWarning,
            answerTruthMode,
            freshnessIntegrityPreserved,
            freshnessIntegrityFailureReason: freshnessIntegrityPreserved
              ? null
              : 'stale-fallback-presented-without-explicit-warning',
            truthReason: providerFreshCapable
              ? 'Fresh-capable provider satisfied freshness-critical request.'
              : 'Operator explicitly allowed degraded stale fallback after fresh path failure.',
            nextActions: providerFreshCapable
              ? []
              : ['retry-fresh-provider', 'switch-provider'],
          },
          fastResponseLane: {
            ...resolveFastLaneTruth({
              provider,
              modelUsed: attempt.result.model || '',
            }),
            reason: initialFastLaneEligibility.reason,
            escalationModel: provider === 'ollama' && fastLaneModel ? initialEscalationModel : '',
            escalationReason: provider === 'ollama' && fastLaneModel ? '' : 'fast-lane-not-selected',
          },
          routing,
          routerConfig: redactSecrets(routerConfig),
        },
      };

      console.log('[BACKEND LIVE] Provider router resolved', {
        requested_provider: requestedProvider,
        requested_route_mode: requestedRouteMode,
        effective_route_mode: routing.effectiveRouteMode,
      selected_provider: selectedProvider,
      provider_selection_source: routing.providerSelectionSource,
      actual_provider_used: finalResult.actualProviderUsed,
        model_used: finalResult.modelUsed,
        fallback_used: finalResult.fallbackUsed,
        fallback_reason: finalResult.fallbackReason,
      });

      return finalResult;
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  const fallbackUsed = attempts.length > 1;
  const fallbackReason = buildFallbackReason(attempts.slice(0, -1)) || lastAttempt?.failureReason || 'No provider returned a usable response.';

  const freshProviderFailureReason = freshProviderAttempted
    ? buildFallbackReason(attempts.filter((attempt) => attempt.provider === freshProviderAttempted && attempt.result?.ok !== true))
    : null;
  const freshnessUnavailable = freshnessRequiredForTruth && !freshProviderSucceeded;
  const degradedFreshnessUnavailable = freshnessUnavailable && !staleFallbackPermitted;
  const answerTruthMode = degradedFreshnessUnavailable
    ? 'degraded-freshness-unavailable'
    : 'standard-nonfresh';
  const failedResult = {
    ok: false,
    provider: lastAttempt?.provider || selectedProvider,
    requestedProvider,
    actualProviderUsed: lastAttempt?.provider || selectedProvider,
    model: lastAttempt?.result?.model || '',
    modelUsed: lastAttempt?.result?.model || '',
    outputText: '',
    fallbackUsed,
    fallbackReason,
    error: lastAttempt?.result?.error || {
      code: ERROR_CODES.LLM_ROUTER_NO_PROVIDER_AVAILABLE,
      message: degradedFreshnessUnavailable
        ? 'Freshness-critical route unavailable. No verified fresh answer is available right now.'
        : 'No AI provider is currently available.',
      retryable: degradedFreshnessUnavailable,
    },
    diagnostics: {
      ...(lastAttempt?.result?.diagnostics || {}),
      requestedProvider,
      savedPreferredProvider,
      requestedRouteMode,
      effectiveRouteMode: routing.effectiveRouteMode,
      selectedProvider,
      providerSelectionSource: routing.providerSelectionSource,
      resolvedProvider: lastAttempt?.provider || selectedProvider,
      actualProviderUsed: lastAttempt?.provider || selectedProvider,
      modelUsed: lastAttempt?.result?.model || '',
      fallbackUsed,
      fallbackReason,
      attemptOrder,
      attempts,
      runtimeContext: routing.runtimeContext,
      freshnessTruth: {
        freshnessRequiredForTruth,
        freshAnswerRequired: freshnessRequiredForTruth,
        freshProviderAvailableForRequest,
        freshProviderAttempted,
        freshProviderSucceeded,
        staleFallbackPermitted,
        staleFallbackAttempted,
        staleFallbackUsed,
        staleFallbackBlocked,
        staleAnswerWarning,
        answerTruthMode,
        freshnessIntegrityPreserved: freshnessRequiredForTruth,
        freshnessIntegrityFailureReason: null,
        truthReason: degradedFreshnessUnavailable
          ? `Fresh-capable provider failed${freshProviderFailureReason ? `: ${freshProviderFailureReason}` : ''}.`
          : 'No provider returned a usable response.',
        nextActions: degradedFreshnessUnavailable
          ? ['retry-fresh-provider', 'allow-degraded-stale-fallback', 'switch-provider']
          : ['retry-request', 'switch-provider'],
      },
      fastResponseLane: {
        ...resolveFastLaneTruth({
          provider: lastAttempt?.provider || selectedProvider,
          modelUsed: lastAttempt?.result?.model || '',
        }),
        reason: initialFastLaneEligibility.reason,
        model: '',
        escalationModel: initialEscalationModel,
        escalationReason: fastLaneModel ? 'fast-lane-exhausted-or-failed' : 'fast-lane-not-selected',
      },
      routing,
      routerConfig: redactSecrets(routerConfig),
    },
  };

  console.log('[BACKEND LIVE] Provider router exhausted attempts', {
    requested_provider: requestedProvider,
    requested_route_mode: requestedRouteMode,
    effective_route_mode: routing.effectiveRouteMode,
    selected_provider: selectedProvider,
    actual_provider_used: failedResult.actualProviderUsed,
    model_used: failedResult.modelUsed,
    fallback_used: failedResult.fallbackUsed,
    fallback_reason: failedResult.fallbackReason,
  });

  return failedResult;
}
