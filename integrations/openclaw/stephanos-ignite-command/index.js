import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import {
  routeStephanosIgniteCommand,
  STEPHANOS_IGNITE_COMMAND_DEFAULTS,
  validateLoopbackHealthEndpoint,
} from './lib/router.mjs';

function resolvePluginConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    openclawHealthEndpoint: validateLoopbackHealthEndpoint(config.openclawHealthEndpoint || STEPHANOS_IGNITE_COMMAND_DEFAULTS.openclawHealthEndpoint, '/health'),
    stephanosHealthEndpoint: validateLoopbackHealthEndpoint(config.stephanosHealthEndpoint || STEPHANOS_IGNITE_COMMAND_DEFAULTS.stephanosHealthEndpoint, '/api/health'),
    timeoutMs: Number(config.timeoutMs) || STEPHANOS_IGNITE_COMMAND_DEFAULTS.timeoutMs,
  };
}

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Routes safe read-only /stephanos-ignite V1A WhatsApp status commands.',
  register(api) {
    const config = resolvePluginConfig(api.pluginConfig);
    api.registerCommand({
      name: 'stephanos-ignite',
      description: 'Show read-only Stephanos/OpenClaw status proof.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => routeStephanosIgniteCommand(ctx?.args || '', {
        openclaw: {
          endpoint: config.openclawHealthEndpoint,
          timeoutMs: config.timeoutMs,
        },
        stephanos: {
          endpoint: config.stephanosHealthEndpoint,
          timeoutMs: config.timeoutMs,
        },
      }),
    });
  },
});
