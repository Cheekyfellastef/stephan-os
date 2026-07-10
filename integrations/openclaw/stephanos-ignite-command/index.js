import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { buildIgniteReply, STEPHANOS_IGNITE_COMMAND_DEFAULTS } from './lib/command.mjs';

function resolvePluginConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    command: config.command || STEPHANOS_IGNITE_COMMAND_DEFAULTS.command,
  };
}

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Shows the approved local Stephanos ignition command without executing it.',
  register(api) {
    const config = resolvePluginConfig(api.pluginConfig);
    api.registerCommand({
      name: 'ignite',
      description: 'Show the approved Stephanos ignition command.',
      acceptsArgs: false,
      requireAuth: true,
      handler: async () => ({
        text: buildIgniteReply(config.command),
      }),
    });
  },
});
