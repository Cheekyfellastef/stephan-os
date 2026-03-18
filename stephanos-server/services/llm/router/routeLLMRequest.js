import { DEFAULT_PROVIDER_KEY, PROVIDER_DEFINITIONS } from '../../../../shared/ai/providerDefaults.mjs';
import { ERROR_CODES } from '../../errors.js';
import { PROVIDER_HEALTH_CHECKS, PROVIDER_RUNNERS } from '../providers/index.js';
import { buildAIRequest, buildRouterConfig, redactSecrets, sanitizeProviderConfig } from '../utils/providerUtils.js';

function resolveAttemptOrder(config) {
  const selected = config.provider || DEFAULT_PROVIDER_KEY;
  const order = [selected];

  if (!config.fallbackEnabled) return order;

  if (config.devMode && selected !== 'mock') {
    order.push('mock');
  }

  for (const provider of config.fallbackOrder) {
    if (provider !== 'openrouter' && provider !== selected && !order.includes(provider)) {
      order.push(provider);
    }
  }

  return order.filter((provider) => PROVIDER_DEFINITIONS[provider]);
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

  return snapshot;
}

export function resolveProviderRequest(provider, providerConfig = {}, options = {}) {
  const routerConfig = buildRouterConfig({
    provider,
    providerConfigs: { [provider]: providerConfig },
    fallbackEnabled: options.fallbackEnabled,
    fallbackOrder: options.fallbackOrder,
    devMode: options.devMode,
  });

  return {
    requestedProvider: provider || DEFAULT_PROVIDER_KEY,
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
  const attempts = [];
  const attemptOrder = resolveAttemptOrder(routerConfig);

  for (const provider of attemptOrder) {
    if (provider === 'openrouter' && (!routerConfig.providerConfigs?.openrouter?.enabled || routerConfig.provider !== 'openrouter')) {
      continue;
    }

    const attempt = await executeProvider(provider, request, routerConfig);
    attempts.push({
      provider,
      health: attempt.health,
      result: attempt.result.ok ? { ...attempt.result, raw: undefined } : attempt.result,
    });

    if (attempt.result.ok && attempt.result.outputText) {
      return {
        ...attempt.result,
        diagnostics: {
          requestedProvider: configInput.provider || DEFAULT_PROVIDER_KEY,
          resolvedProvider: provider,
          fallbackUsed: provider !== routerConfig.provider,
          attemptOrder,
          attempts,
          routerConfig: redactSecrets(routerConfig),
        },
      };
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    ok: false,
    provider: lastAttempt?.provider || routerConfig.provider,
    model: lastAttempt?.result?.model || '',
    outputText: '',
    error: lastAttempt?.result?.error || {
      code: ERROR_CODES.LLM_ROUTER_NO_PROVIDER_AVAILABLE,
      message: 'No AI provider is currently available. Use Mock instead.',
      retryable: false,
    },
    diagnostics: {
      requestedProvider: configInput.provider || DEFAULT_PROVIDER_KEY,
      resolvedProvider: lastAttempt?.provider || routerConfig.provider,
      fallbackUsed: attempts.length > 1,
      attemptOrder,
      attempts,
      routerConfig: redactSecrets(routerConfig),
    },
  };
}
