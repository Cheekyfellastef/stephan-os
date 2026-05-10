const SETUP_INTEGRATIONS = Object.freeze([
  {
    id: 'spotify-catalog',
    name: 'Spotify Catalogue Search',
    purpose: 'Resolve artist/title into real Spotify track candidates for Music Tile.',
    requiredSecrets: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
    optionalSecrets: [],
    backendRoute: '/api/music/spotify/search',
    testEndpoint: '/api/music/spotify/search?q=Sevdaliza%20Save%20Me',
    safetyNotes: ['Never expose secret values to frontend surfaces.', 'Operator approval is required before writing secrets.'],
  },
  { id: 'google-ai-studio-gemini', name: 'Google AI Studio Gemini', purpose: 'Provider route for Gemini-powered AI missions.', requiredSecrets: ['GEMINI_API_KEY'], optionalSecrets: [], backendRoute: '/api/ai/chat', testEndpoint: '/api/ai/chat', safetyNotes: ['Backend secret store only.'] },
  { id: 'hugging-face', name: 'Hugging Face', purpose: 'Provider route for Hugging Face models.', requiredSecrets: ['HUGGING_FACE_API_KEY'], optionalSecrets: [], backendRoute: '/api/ai/chat', testEndpoint: '/api/ai/chat', safetyNotes: ['Backend secret store only.'] },
  { id: 'github-models', name: 'GitHub Models', purpose: 'Provider route for GitHub Models inference.', requiredSecrets: ['GITHUB_TOKEN'], optionalSecrets: [], backendRoute: '/api/ai/chat', testEndpoint: '/api/ai/chat', safetyNotes: ['Backend secret store only.'] },
  { id: 'openai-compatible', name: 'OpenAI-Compatible', purpose: 'Provider route for OpenAI-compatible endpoints.', requiredSecrets: ['OPENAI_API_KEY'], optionalSecrets: ['OPENAI_BASE_URL'], backendRoute: '/api/ai/chat', testEndpoint: '/api/ai/chat', safetyNotes: ['Backend secret store only.'] },
  { id: 'tailscale-bridge', name: 'Tailscale Bridge', purpose: 'Secure tailnet bridge for hosted/remote sessions.', requiredSecrets: ['TAILSCALE_AUTHKEY'], optionalSecrets: [], backendRoute: '/api/local/health', testEndpoint: '/api/local/health', safetyNotes: ['Never treat local reachability as hosted truth.'] },
  { id: 'openclaw-adapter', name: 'OpenClaw Adapter', purpose: 'Approval-gated orchestration adapter for OpenClaw actions.', requiredSecrets: ['OPENCLAW_ADAPTER_TOKEN'], optionalSecrets: ['OPENCLAW_ADAPTER_URL'], backendRoute: '/api/ai-admin/openclaw', testEndpoint: '/api/ai-admin/openclaw', safetyNotes: ['Execution remains operator-approved.'] },
]);

function presenceFromEnv(env = process.env, keys = []) {
  return keys.reduce((acc, key) => ({ ...acc, [key]: Boolean(String(env?.[key] || '').trim()) }), {});
}

export function buildIntegrationSetupModel({ env = process.env, integrationTestStatus = {} } = {}) {
  return SETUP_INTEGRATIONS.map((base) => {
    const requiredPresence = presenceFromEnv(env, base.requiredSecrets);
    const missingSecrets = base.requiredSecrets.filter((key) => !requiredPresence[key]);
    const configured = missingSecrets.length === 0;
    const test = integrationTestStatus[base.id] || {};
    const status = configured ? (test.status || 'configured') : 'not-configured';
    return {
      ...base,
      configured,
      requiredSecretPresence: requiredPresence,
      missingSecrets,
      status,
      lastTestStatus: test.status || 'unknown',
      lastTestError: test.error || null,
      nextAction: configured
        ? 'Test resolver endpoint and confirm Music Tile resolve flow.'
        : `Add ${missingSecrets.join(', ')} to backend .env, restart server, and retest.`,
    };
  });
}
