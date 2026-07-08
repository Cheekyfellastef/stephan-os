import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { handleIgniteCommand } from './lib/ignite-command.mjs';

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Provides the authorized /stephanos-ignite WhatsApp command surface.',
  register(api) {
    api.registerCommand({
      name: 'stephanos-ignite',
      description: 'Show Stephanos ignition help and source-controlled OpenClaw plugin status.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => handleIgniteCommand(ctx?.args || ''),
    });
  },
});
