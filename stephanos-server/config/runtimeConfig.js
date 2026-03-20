import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  PROVIDER_DEFINITIONS,
  buildProviderEndpoint,
} from '../../shared/ai/providerDefaults.mjs';

export const DEFAULT_SERVER_PORT = 8787;
export const DEFAULT_LOCAL_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
export const DEFAULT_HOSTED_FRONTEND_ORIGINS = ['https://cheekyfellastef.github.io'];

function parseOriginList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveAllowedOrigins(env = process.env) {
  const configuredOrigins = [
    ...parseOriginList(env.FRONTEND_ORIGIN),
    ...parseOriginList(env.FRONTEND_ORIGINS),
  ];

  return [...new Set([
    ...DEFAULT_LOCAL_FRONTEND_ORIGINS,
    ...DEFAULT_HOSTED_FRONTEND_ORIGINS,
    ...configuredOrigins,
  ])];
}

export function getServerPort(env = process.env) {
  const port = Number(env.PORT || DEFAULT_SERVER_PORT);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_SERVER_PORT;
}

export function buildServerBaseUrl(env = process.env) {
  return `http://localhost:${getServerPort(env)}`;
}

function buildGroqEnvStatus(env = process.env) {
  return {
    configured: Boolean(env.GROQ_API_KEY),
    model: env.GROQ_MODEL || PROVIDER_DEFINITIONS.groq.defaults.model,
    baseURL: env.GROQ_BASE_URL || PROVIDER_DEFINITIONS.groq.defaults.baseURL,
    configured_via: ['GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_BASE_URL'],
  };
}

export function buildHealthDiagnostics(env = process.env) {
  const allowedOrigins = resolveAllowedOrigins(env);
  const backendBaseUrl = buildServerBaseUrl(env);

  return {
    ok: true,
    service: 'stephanos-server',
    api_status: 'online',
    environment: env.NODE_ENV || 'development',
    backend_base_url: backendBaseUrl,
    backend_target_endpoint: `${backendBaseUrl}/api/ai/chat`,
    default_provider: DEFAULT_PROVIDER_KEY,
    default_route_mode: DEFAULT_ROUTE_MODE,
    provider_defaults: Object.fromEntries(
      Object.entries(PROVIDER_DEFINITIONS).map(([key, definition]) => [key, {
        label: definition.label,
        kind: definition.kind,
        targetSummary: definition.targetSummary,
        defaults: {
          ...definition.defaults,
          apiKey: definition.defaults.apiKey ? '[server-env-only]' : undefined,
        },
        endpoint: definition.defaults.baseURL ? buildProviderEndpoint(definition.defaults.baseURL, '') : null,
      }]),
    ),
    provider_router_path: 'browser -> /api/ai/chat -> routeLLMRequest -> provider router -> groq/gemini/ollama/mock/openrouter',
    groq: buildGroqEnvStatus(env),
    ollama_endpoint: buildProviderEndpoint(PROVIDER_DEFINITIONS.ollama.defaults.baseURL, '/api/chat'),
    ts: new Date().toISOString(),
    cors: {
      configured_via: ['FRONTEND_ORIGIN', 'FRONTEND_ORIGINS'],
      fallback_local_origins: DEFAULT_LOCAL_FRONTEND_ORIGINS,
      fallback_hosted_origins: DEFAULT_HOSTED_FRONTEND_ORIGINS,
      allowed_origin_count: allowedOrigins.length,
      allowed_origins: allowedOrigins,
    },
  };
}
