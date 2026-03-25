import { deriveOllamaCandidates, detectOllamaHost, normalizeOllamaBaseUrl } from './ollamaDiscovery.js';

function isLoopbackHost(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname || '').trim().toLowerCase());
}

function extractHostname(value = '') {
  try {
    return new URL(String(value || '')).hostname || '';
  } catch {
    return '';
  }
}

export function createSearchingOllamaHealth({ frontendOrigin = '', attempts = [] } = {}) {
  const frontendHost = (() => {
    try {
      return new URL(frontendOrigin).hostname;
    } catch {
      return '';
    }
  })();
  const localhostAttemptWillMismatch = frontendHost && frontendHost !== 'localhost' && frontendHost !== '127.0.0.1';

  return {
    ok: false,
    provider: 'ollama',
    badge: 'Checking',
    state: 'SEARCHING',
    message: 'Looking for Ollama',
    detail: 'Stephanos is checking localhost first, then a few likely PC addresses.',
    helpText: localhostAttemptWillMismatch
      ? ['localhost only works when Stephanos and Ollama are on the same computer. Stephanos will now try likely network addresses.']
      : [],
    reason: '',
    failureType: null,
    likelyWrongDevice: localhostAttemptWillMismatch,
    attempts,
  };
}

export function shouldAutoSyncOllama({ apiStatus, ollamaHealth = {}, ollamaConfig = {} } = {}) {
  if (!apiStatus?.backendReachable) return false;
  if (ollamaHealth?.ok) return false;

  const frontendHost = extractHostname(apiStatus?.frontendOrigin || apiStatus?.runtimeContext?.frontendOrigin || '');
  if (isLoopbackHost(frontendHost)) {
    return true;
  }

  const normalizedBaseUrl = normalizeOllamaBaseUrl(ollamaConfig?.baseURL);
  if (!normalizedBaseUrl) return false;

  const hostname = (() => {
    try {
      return new URL(normalizedBaseUrl).hostname;
    } catch {
      return '';
    }
  })();

  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
  return isLoopback || ollamaHealth?.likelyWrongDevice === true;
}

export async function runOllamaDiscovery({ runtimeConfig, ollamaConnection, draftConfig, manualAddress = '' } = {}) {
  const normalizedHint = manualAddress ? normalizeOllamaBaseUrl(manualAddress) : '';
  const nextHintValue = manualAddress || ollamaConnection?.pcAddressHint || '';

  const candidates = manualAddress
    ? [{
      baseURL: normalizedHint,
      host: new URL(normalizedHint).hostname,
      source: 'manual-hint',
      badge: 'Network PC',
    }]
    : deriveOllamaCandidates({
      frontendOrigin: runtimeConfig?.frontendOrigin,
      lastSuccessfulBaseURL: ollamaConnection?.lastSuccessfulBaseURL,
      lastSuccessfulHost: ollamaConnection?.lastSuccessfulHost,
      pcAddressHint: nextHintValue,
      recentHosts: ollamaConnection?.recentHosts,
    });

  const searchingState = {
    status: 'searching',
    detail: manualAddress
      ? 'Stephanos is trying the address you entered.'
      : 'Stephanos is checking localhost first, then a few likely PC addresses.',
    helpText: createSearchingOllamaHealth({ frontendOrigin: runtimeConfig?.frontendOrigin, attempts: candidates }).helpText,
    attempts: candidates,
  };

  const result = await detectOllamaHost(candidates, { timeoutMs: Math.min(Number(draftConfig?.timeoutMs) || 1800, 2500) });
  if (result.success) {
    return {
      result,
      searchingState,
      discoveryState: { status: 'found', ...result },
      candidates,
    };
  }

  return {
    result,
    searchingState,
    discoveryState: {
      status: 'not_found',
      failureBucket: result.failureBucket,
      reason: result.reason,
      attempts: result.attempts,
    },
    candidates,
  };
}

export function applyDetectedOllamaConnection({ result, draftConfig, ollamaConnection, updateDraftProviderConfig, rememberSuccessfulOllamaConnection }) {
  const nextModel = result.models.includes(draftConfig.model)
    ? draftConfig.model
    : (result.models[0] || draftConfig.model || ollamaConnection?.lastSelectedModel || '');

  updateDraftProviderConfig('ollama', {
    baseURL: result.baseURL,
    model: nextModel,
  });

  if (result.host || result.baseURL || nextModel) {
    rememberSuccessfulOllamaConnection({ baseURL: result.baseURL, host: result.host, model: nextModel });
  }

  return nextModel;
}
