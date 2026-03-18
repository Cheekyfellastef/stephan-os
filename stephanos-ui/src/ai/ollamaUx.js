function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname = '') {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

export function isLocalhostLikeUrl(value = '') {
  const parsed = parseUrl(value);
  return parsed ? isLoopbackHostname(parsed.hostname) : false;
}

function getOriginHostname(origin = '') {
  const parsed = parseUrl(origin);
  return parsed?.hostname || '';
}

export function isRemoteFrontendOrigin(origin = '') {
  const hostname = getOriginHostname(origin);
  return Boolean(hostname) && !isLoopbackHostname(hostname);
}

export function getAutoDetectOllamaBaseUrl(origin = '') {
  const parsed = parseUrl(origin);
  if (!parsed || !parsed.hostname || isLoopbackHostname(parsed.hostname)) {
    return '';
  }

  const protocol = parsed.protocol === 'https:' ? 'http:' : parsed.protocol;
  return `${protocol}//${parsed.hostname}:11434`;
}

export function getOllamaUiState({ health = null, config = {}, frontendOrigin = '' } = {}) {
  const isLocalhost = isLocalhostLikeUrl(config?.baseURL);
  const remoteOrigin = isRemoteFrontendOrigin(frontendOrigin);
  const baseState = health?.state || (health?.ok ? 'CONNECTED' : 'UNKNOWN_ERROR');
  const shouldWarnAboutRemoteLocalhost = isLocalhost && remoteOrigin && !health?.ok && health?.likelyWrongDevice !== false;
  const state = shouldWarnAboutRemoteLocalhost ? 'LOCALHOST_MISMATCH' : baseState;
  const autoDetectBaseUrl = getAutoDetectOllamaBaseUrl(frontendOrigin);

  if (state === 'CONNECTED') {
    return {
      state,
      title: 'Connected to Ollama (Local Machine)',
      detail: health?.detail || 'Stephanos reached your Ollama server successfully.',
      helpText: [],
      reason: '',
      autoDetectBaseUrl,
      showAutoDetect: Boolean(autoDetectBaseUrl && isLocalhost),
    };
  }

  if (state === 'LOCALHOST_MISMATCH') {
    return {
      state,
      title: 'Ollama is running on another device',
      detail: 'You are using Stephanos on a different device, so “localhost” will not reach your PC.',
      helpText: [
        'You are using Stephanos on a different device (e.g. iPad).',
        "'localhost' only works on the same machine.",
        `👉 Use your PC’s IP address instead: Example: ${health?.suggestedUrl || 'http://192.168.1.42:11434'}`,
      ],
      reason: health?.failureType === 'connection_refused' ? 'Nothing answered at the localhost Ollama address.' : health?.reason || '',
      autoDetectBaseUrl,
      showAutoDetect: Boolean(autoDetectBaseUrl),
    };
  }

  if (state === 'OFFLINE') {
    return {
      state,
      title: 'Cannot connect to Ollama',
      detail: 'Stephanos could not reach your Ollama server.',
      helpText: [
        'Make sure Ollama is running on your PC.',
        'Or switch to Mock Mode (free dev mode).',
      ],
      reason: health?.reason || '',
      autoDetectBaseUrl,
      showAutoDetect: Boolean(autoDetectBaseUrl && isLocalhost),
    };
  }

  return {
    state: 'UNKNOWN_ERROR',
    title: 'Ollama connection failed',
    detail: health?.detail || 'Stephanos could not finish the Ollama connection check.',
    helpText: health?.helpText || [],
    reason: health?.reason || '',
    autoDetectBaseUrl,
    showAutoDetect: Boolean(autoDetectBaseUrl && isLocalhost),
  };
}
