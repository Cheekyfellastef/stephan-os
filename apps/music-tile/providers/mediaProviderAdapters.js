import { createYouTubeMediaProviderAdapter } from './youtubeMediaProviderAdapter.js';

function createStubProvider(provider) {
  return {
    provider,
    discoverCandidates: async () => [],
    enrichCandidates: async () => ({}),
    validateCandidate(candidate) {
      return {
        ...candidate,
        provider,
        playbackMode: 'suppress',
        availabilityStatus: 'unsupported_provider',
        validationStatus: 'blocked',
        validationReasons: [`${provider}.not_configured`],
        capabilities: {
          canPlayInline: false,
          canOpenExternally: false,
          canFlowInline: false,
          canFlowExternal: false,
          provider,
          providerType: 'video',
          playbackMode: 'suppress',
        },
        lastValidationAt: new Date().toISOString(),
      };
    },
    buildExternalUrl: () => '',
    buildInlineEmbedDescriptor: () => null,
    getPlaybackCapabilities: (item) => item.capabilities || null,
  };
}

export function createMediaProviderAdapters({ youtubeApiKey = '', fetchImpl = fetch } = {}) {
  const adapters = {
    youtube: createYouTubeMediaProviderAdapter({ apiKey: youtubeApiKey, fetchImpl }),
    vimeo: createStubProvider('vimeo'),
    dailymotion: createStubProvider('dailymotion'),
    twitch: createStubProvider('twitch'),
  };

  return {
    adapters,
    get(provider) {
      return adapters[String(provider || '').trim().toLowerCase()] || null;
    },
    listProviders() {
      return Object.keys(adapters);
    },
  };
}
