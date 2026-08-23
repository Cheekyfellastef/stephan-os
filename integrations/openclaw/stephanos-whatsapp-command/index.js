import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import {
  parseStephanosCommand,
  requestStephanos,
  STEPHANOS_COMMAND_DEFAULTS,
  validateLoopbackEndpoint,
} from './lib/bridge.mjs';

const MAX_REPLY_LENGTH = 7000;

function resolvePluginConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    endpoint: validateLoopbackEndpoint(config.endpoint || STEPHANOS_COMMAND_DEFAULTS.endpoint),
    timeoutMs: Number(config.timeoutMs) || STEPHANOS_COMMAND_DEFAULTS.timeoutMs,
  };
}

function boundReply(text) {
  const normalized = String(text || '').trim();
  if (normalized.length <= MAX_REPLY_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_REPLY_LENGTH - 48)}\n\n[Response truncated by /stephanos safety limit.]`;
}

export default definePluginEntry({
  id: 'stephanos-whatsapp-command',
  name: 'Stephanos WhatsApp Command',
  description: 'Routes authorized /stephanos messages to the local Stephanos AI endpoint.',
  register(api) {
    const config = resolvePluginConfig(api.pluginConfig);
    api.registerCommand({
      name: 'stephanos',
      description: 'Ask the local Stephanos command deck.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        const parsed = parseStephanosCommand(ctx?.args || '');
        if (!parsed.ok) return { text: parsed.error };
        try {
          const result = await requestStephanos({
            message: parsed.message,
            endpoint: config.endpoint,
            timeoutMs: config.timeoutMs,
          });
          return { text: boundReply(result.text) };
        } catch (error) {
          api.logger.warn(`Stephanos command failed: ${error instanceof Error ? error.message : String(error)}`);
          return {
            text: 'Stephanos is unavailable right now. The request was not sent anywhere else. Check the local Stephanos backend and try again.',
          };
        }
      },
    });
  },
});
