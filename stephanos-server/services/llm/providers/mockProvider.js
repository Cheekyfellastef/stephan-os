import { ERROR_CODES, createError } from '../../errors.js';
import { sanitizeProviderConfig, extractLatestUserIntent } from '../utils/providerUtils.js';

const THINKING_SURFACES = [
  'Stephanos mock relay online. Synthesizing a safe development response.',
  'Command deck telemetry stable. Returning a zero-cost simulation output.',
  'Mission console in free-tier mode. No external credits consumed.',
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkMockHealth(config = {}) {
  const resolved = sanitizeProviderConfig('mock', config);
  return {
    ok: resolved.enabled !== false,
    provider: 'mock',
    badge: 'Ready',
    detail: 'Mock provider is always available for development and tests.',
  };
}

export async function runMockProvider(request, config = {}) {
  const resolved = sanitizeProviderConfig('mock', config);
  const latestIntent = extractLatestUserIntent(request.messages);

  if (resolved.latencyMs > 0) {
    await delay(resolved.latencyMs);
  }

  if (resolved.failRate > 0 && Math.random() < resolved.failRate) {
    return {
      ok: false,
      provider: 'mock',
      model: resolved.model,
      outputText: '',
      error: {
        code: ERROR_CODES.LLM_MOCK_SIMULATED_FAILURE,
        message: 'Mock provider simulated a failure for resilience testing.',
        retryable: true,
      },
      raw: { simulated: true },
    };
  }

  const outputs = {
    echo: `Mock echo acknowledged: ${latestIntent}`,
    canned: `${THINKING_SURFACES[latestIntent.length % THINKING_SURFACES.length]}\n\nIntent heard: ${latestIntent}`,
    scenario: `Stephanos scenario surface\n- Intent: ${latestIntent}\n- Mode: zero-cost development\n- Next action: inspect subsystems or try a cloud/local provider when ready.`,
  };

  return {
    ok: true,
    provider: 'mock',
    model: resolved.model,
    outputText: outputs[resolved.mode] || outputs.echo,
    usage: { total_tokens: 0 },
    raw: { mode: resolved.mode, latencyMs: resolved.latencyMs, echoedIntent: latestIntent },
  };
}
