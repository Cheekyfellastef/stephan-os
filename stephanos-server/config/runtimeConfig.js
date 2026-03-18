import {
  DEFAULT_PROVIDER_KEY,
  PROVIDER_DEFINITIONS,
  buildProviderEndpoint,
} from '../../shared/ai/providerDefaults.mjs';

export const DEFAULT_SERVER_PORT = 8787;
export const DEFAULT_LOCAL_FRONTEND_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
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

export function buildHealthDiagnostics(env = process.env) {
  const allowedOrigins = resolveAllowedOrigins(env);
  const backendBaseUrl = buildServerBaseUrl(env);
  const ollamaDefaults = PROVIDER_DEFINITIONS.ollama.defaults;

  return {
    ok: true,
    service: 'stephanos-server',
    api_status: 'online',
    environment: env.NODE_ENV || 'development',
    backend_base_url: backendBaseUrl,
    backend_target_endpoint: `${backendBaseUrl}/api/ai/chat`,
    default_provider: DEFAULT_PROVIDER_KEY,
    provider_defaults: Object.fromEntries(
      Object.entries(PROVIDER_DEFINITIONS).map(([key, definition]) => [key, {
        label: definition.label,
        targetSummary: definition.targetSummary,
        baseUrl: definition.defaults.baseUrl,
        chatEndpoint: definition.defaults.chatEndpoint,
        model: definition.defaults.model,
      }]),
    ),
    provider_router_path: 'browser -> /api/ai/chat -> provider router -> ollama/openai/custom',
    ollama_endpoint: buildProviderEndpoint(ollamaDefaults.baseUrl, ollamaDefaults.chatEndpoint),
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
