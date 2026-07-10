import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { renderIgniteCommand } from './lib/ignite-status.mjs';

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Read-only Stephanos/OpenClaw ignition status command surface.',
  register(api) {
    api.registerCommand({
      name: 'stephanos-ignite',
      description: 'Show read-only Stephanos/OpenClaw ignition status.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => ({
        text: renderIgniteCommand(ctx?.args || 'help'),
      }),
    });
  },
});
