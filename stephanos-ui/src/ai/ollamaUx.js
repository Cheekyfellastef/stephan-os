import {
  isLoopbackHostname,
  isPrivateOrLocalHostname,
  normalizeOllamaBaseUrl,
} from './ollamaDiscovery';

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
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
  const hostname = getOriginHostname(origin);
  if (!hostname || isLoopbackHostname(hostname) || !isPrivateOrLocalHostname(hostname)) {
    return '';
  }

  return normalizeOllamaBaseUrl(`http://${hostname}:11434`);
}

function buildDefaultHelpText(discovery, remoteOrigin) {
  if (discovery?.status === 'not_found') {
    return [
      'Make sure Ollama is running on your PC.',
      'If you are on another device, your PC may need to expose Ollama to the network.',
      'You can also enter your PC address manually.',
      'Or switch to Mock Mode for free testing.',
    ];
  }

  if (remoteOrigin) {
    return [
      'localhost only works when Stephanos and Ollama are on the same computer.',
      'Stephanos can also try your PC address on the local network.',
    ];
  }

  return [
    'Same computer: localhost usually works.',
    'Different device: Stephanos needs your PC’s address.',
  ];
}

export function getOllamaUiState({ health = null, config = {}, frontendOrigin = '', discovery = null } = {}) {
  const isLocalhost = isLocalhostLikeUrl(config?.baseURL);
  const remoteOrigin = isRemoteFrontendOrigin(frontendOrigin);
  const autoDetectBaseUrl = getAutoDetectOllamaBaseUrl(frontendOrigin);

  if (discovery?.status === 'searching') {
    return {
      state: 'SEARCHING',
      title: 'Looking for Ollama',
      detail: discovery.detail || 'Stephanos is trying a few likely addresses now.',
      helpText: discovery.helpText || [],
      reason: '',
      autoDetectBaseUrl,
      showAutoDetect: false,
      resultTitle: '',
      resultBody: '',
      resultBadge: '',
      detectedAddress: '',
      models: [],
      showUseConnection: false,
      emptyModels: false,
      failureBucket: '',
      attempts: discovery.attempts || [],
    };
  }

  if (discovery?.status === 'found') {
    return {
      state: 'FOUND',
      title: 'Found Ollama',
      detail: 'Stephanos found an Ollama server and connected to it.',
      helpText: discovery.warning ? [discovery.warning] : [],
      reason: '',
      autoDetectBaseUrl,
      showAutoDetect: false,
      resultTitle: 'Found Ollama',
      resultBody: 'Stephanos found an Ollama server and connected to it.',
      resultBadge: discovery.badge || (isLocalhostLikeUrl(discovery.baseURL) ? 'Local Machine' : 'Network PC'),
      detectedAddress: discovery.baseURL || '',
      models: discovery.models || [],
      showUseConnection: true,
      emptyModels: Boolean(discovery.noModels),
      failureBucket: '',
      attempts: discovery.attempts || [],
    };
  }

  if (discovery?.status === 'not_found') {
    return {
      state: 'NOT_FOUND',
      title: 'Stephanos could not find Ollama automatically.',
      detail: 'Stephanos could not find Ollama automatically.',
      helpText: buildDefaultHelpText(discovery, remoteOrigin),
      reason: discovery.reason || '',
      autoDetectBaseUrl,
      showAutoDetect: Boolean(autoDetectBaseUrl && isLocalhost),
      resultTitle: 'Stephanos could not find Ollama automatically.',
      resultBody: 'Stephanos could not find Ollama automatically.',
      resultBadge: '',
      detectedAddress: '',
      models: [],
      showUseConnection: false,
      emptyModels: false,
      failureBucket: discovery.failureBucket || '',
      attempts: discovery.attempts || [],
    };
  }

  const baseState = health?.state || (health?.ok ? 'CONNECTED' : 'UNKNOWN_ERROR');
  const shouldWarnAboutRemoteLocalhost = isLocalhost && remoteOrigin && !health?.ok && health?.likelyWrongDevice !== false;
  const state = shouldWarnAboutRemoteLocalhost ? 'LOCALHOST_MISMATCH' : baseState;

  if (state === 'CONNECTED') {
    return {
      state,
      title: 'Connected to Ollama (Local Machine)',
      detail: health?.detail || 'Stephanos reached your Ollama server successfully.',
      helpText: [],
      reason: '',
      autoDetectBaseUrl,
      showAutoDetect: false,
      resultTitle: '',
      resultBody: '',
      resultBadge: '',
      detectedAddress: '',
      models: [],
      showUseConnection: false,
      emptyModels: false,
      failureBucket: '',
      attempts: [],
    };
  }

  if (state === 'LOCALHOST_MISMATCH') {
    return {
      state,
      title: 'Stephanos is not running on the same machine as Ollama.',
      detail: 'localhost only works when Stephanos and Ollama are on the same computer. Stephanos will now try likely network addresses.',
      helpText: [
        'If Stephanos is open on another device, use your PC’s address instead of localhost.',
      ],
      reason: health?.failureType === 'connection_refused' ? 'Nothing answered at the localhost Ollama address.' : health?.reason || '',
      autoDetectBaseUrl,
      showAutoDetect: Boolean(autoDetectBaseUrl),
      resultTitle: '',
      resultBody: '',
      resultBadge: '',
      detectedAddress: '',
      models: [],
      showUseConnection: false,
      emptyModels: false,
      failureBucket: '',
      attempts: [],
    };
  }

  if (state === 'OFFLINE') {
    return {
      state,
      title: 'Cannot connect to Ollama',
      detail: 'Stephanos could not reach your Ollama server.',
      helpText: buildDefaultHelpText({}, remoteOrigin),
      reason: health?.reason || '',
      autoDetectBaseUrl,
      showAutoDetect: Boolean(autoDetectBaseUrl && isLocalhost),
      resultTitle: '',
      resultBody: '',
      resultBadge: '',
      detectedAddress: '',
      models: [],
      showUseConnection: false,
      emptyModels: false,
      failureBucket: '',
      attempts: [],
    };
  }

  return {
    state: 'UNKNOWN_ERROR',
    title: 'Ollama connection failed',
    detail: health?.detail || 'Stephanos could not finish the Ollama connection check.',
    helpText: health?.helpText || buildDefaultHelpText({}, remoteOrigin),
    reason: health?.reason || '',
    autoDetectBaseUrl,
    showAutoDetect: Boolean(autoDetectBaseUrl && isLocalhost),
    resultTitle: '',
    resultBody: '',
    resultBadge: '',
    detectedAddress: '',
    models: [],
    showUseConnection: false,
    emptyModels: false,
    failureBucket: '',
    attempts: [],
  };
}
