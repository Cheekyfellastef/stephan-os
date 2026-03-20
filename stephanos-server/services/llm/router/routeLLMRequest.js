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

const logger = createLogger('llm-router');

function summarizeAttemptFailure(provider, attempt) {
  if (!attempt) return null;
  if (attempt.result?.ok && attempt.result?.outputText) return null;
  if (attempt.result?.ok && !attempt.result?.outputText) return `Provider "${provider}" returned an empty response.`;
  return attempt.result?.error?.message || attempt.health?.reason || attempt.health?.detail || `Provider "${provider}" failed.`;
}

function buildFallbackReason(failedAttempts = []) {
  const reasons = failedAttempts
    .map(({ provider, failureReason }) => failureReason ? `${provider}: ${failureReason}` : null)
    .filter(Boolean);

  return reasons.length > 0 ? reasons.join(' | ') : null;
}

async function executeProvider(provider, request, routerConfig) {
  const config = sanitizeProviderConfig(provider, routerConfig.providerConfigs?.[provider] || {});
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
    const config = sanitizeProviderConfig(provider, routerConfig.providerConfigs?.[provider] || {});
    const health = await PROVIDER_HEALTH_CHECKS[provider](config);
    snapshot[provider] = {
      ...health,
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
  const routerConfig = buildRouterConfig(configInput);
  const providerHealthSnapshot = await getProviderHealthSnapshot(routerConfig);
  const routing = providerHealthSnapshot.routing;
  const attempts = [];
  const attemptOrder = routing.attemptOrder;
  const requestedProvider = configInput.provider || DEFAULT_PROVIDER_KEY;
  const requestedRouteMode = routing.requestedRouteMode;
  const selectedProvider = routing.selectedProvider;

  logger.info('Routing LLM request', {
    requestedProvider,
    requestedRouteMode,
    effectiveRouteMode: routing.effectiveRouteMode,
    selectedProvider,
    fallbackEnabled: routerConfig.fallbackEnabled,
    attemptOrder,
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
    logger.info('Executing provider attempt', {
      requestedProvider,
      requestedRouteMode,
      selectedProvider,
      provider,
    });
    console.log('[BACKEND LIVE] Provider attempt starting', {
      requested_provider: requestedProvider,
      requested_route_mode: requestedRouteMode,
      effective_route_mode: routing.effectiveRouteMode,
      selected_provider: selectedProvider,
      actual_provider_attempt: provider,
    });

    const attempt = await executeProvider(provider, request, routerConfig);
    const failureReason = summarizeAttemptFailure(provider, attempt);

    attempts.push({
      provider,
      health: attempt.health,
      failureReason,
      result: attempt.result.ok ? { ...attempt.result, raw: undefined } : attempt.result,
    });

    logger.info('Provider attempt completed', {
      requestedProvider,
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
      const failedAttempts = attempts.slice(0, -1);
      const fallbackUsed = provider !== selectedProvider;
      const fallbackReason = fallbackUsed ? buildFallbackReason(failedAttempts) : null;
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
          requestedRouteMode,
          effectiveRouteMode: routing.effectiveRouteMode,
          selectedProvider,
          resolvedProvider: provider,
          actualProviderUsed: provider,
          modelUsed: attempt.result.model || '',
          fallbackUsed,
          fallbackReason,
          attemptOrder,
          attempts,
          runtimeContext: routing.runtimeContext,
          routing,
          routerConfig: redactSecrets(routerConfig),
        },
      };

      console.log('[BACKEND LIVE] Provider router resolved', {
        requested_provider: requestedProvider,
        requested_route_mode: requestedRouteMode,
        effective_route_mode: routing.effectiveRouteMode,
        selected_provider: selectedProvider,
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
      message: 'No AI provider is currently available.',
      retryable: false,
    },
    diagnostics: {
      ...(lastAttempt?.result?.diagnostics || {}),
      requestedProvider,
      requestedRouteMode,
      effectiveRouteMode: routing.effectiveRouteMode,
      selectedProvider,
      resolvedProvider: lastAttempt?.provider || selectedProvider,
      actualProviderUsed: lastAttempt?.provider || selectedProvider,
      modelUsed: lastAttempt?.result?.model || '',
      fallbackUsed,
      fallbackReason,
      attemptOrder,
      attempts,
      runtimeContext: routing.runtimeContext,
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
