const HOSTED_COGNITION_PROVIDERS = new Set(['groq', 'gemini']);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeProvider(value = '') {
  return normalizeText(value).toLowerCase();
}

function hasHostedProxyForProvider(providerKey, hostedCloudConfig = {}) {
  const provider = normalizeProvider(providerKey);
  if (!HOSTED_COGNITION_PROVIDERS.has(provider)) return false;
  const providerProxy = normalizeText(hostedCloudConfig?.providerProxyUrls?.[provider]);
  const sharedProxy = normalizeText(hostedCloudConfig?.proxyUrl);
  return Boolean(providerProxy || sharedProxy);
}

function hasHostedProviderCredentials(providerKey, providerConfigs = {}) {
  const provider = normalizeProvider(providerKey);
  if (!HOSTED_COGNITION_PROVIDERS.has(provider)) return false;
  const apiKey = normalizeText(providerConfigs?.[provider]?.apiKey);
  return Boolean(apiKey);
}

export function resolveHostedCloudPathCapability({
  providerKey = '',
  hostedCloudConfig = {},
  providerConfigs = {},
} = {}) {
  const provider = normalizeProvider(providerKey);
  const providerSupported = HOSTED_COGNITION_PROVIDERS.has(provider);
  const hasProxyPath = hasHostedProxyForProvider(provider, hostedCloudConfig);
  const hasHostedCredentials = hasHostedProviderCredentials(provider, providerConfigs);
  const backendOnlySecrets = hostedCloudConfig?.backendOnlySecrets === true;

  const secretPathKind = hasProxyPath
    ? 'hosted-proxy'
    : hasHostedCredentials
      ? 'hosted-provider-credentials'
      : backendOnlySecrets
        ? 'backend-only'
        : 'none';
  const available = providerSupported && (hasProxyPath || hasHostedCredentials);

  return {
    provider,
    providerSupported,
    available,
    secretPathKind,
    authorityLevel: available ? 'cloud-cognition-only' : 'none',
    providerExecutionPath: available ? `${provider}-hosted-cloud` : 'none',
    executionDeferred: true,
  };
}
