import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { buildIgniteReply } from './lib/ignite-command.mjs';

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Provides source-controlled /stephanos-ignite Battle Bridge guidance.',
  register(api) {
    api.registerCommand({
      name: 'stephanos-ignite',
      description: 'Show Stephanos Ignite command help and bridge proof guidance.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => buildIgniteReply(ctx?.args || ''),
    });
  },
});
