import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { renderIgniteCommand, resolveIgniteCommand } from './lib/ignite-status.mjs';
import { wakeBattleBridgeRecoveryMesh } from './lib/recovery-wake.mjs';

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Stephanos/OpenClaw ignition status plus one authenticated fixed recovery wake route.',
  register(api) {
    api.registerCommand({
      name: 'stephanos-ignite',
      description: 'Show ignition status or wake the canonical Battle Bridge recovery coordinator.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        const resolved = resolveIgniteCommand(ctx?.args || 'help');
        if (!resolved.ok || resolved.command !== 'wake') return { text: renderIgniteCommand(ctx?.args || 'help') };
        const result = wakeBattleBridgeRecoveryMesh({
          authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' },
        });
        if (!result.ok) return { text: `BATTLE_BRIDGE_RECOVERY_WAKE=BLOCKED\nREASON=${result.blocker}` };
        return { text: `BATTLE_BRIDGE_RECOVERY_WAKE=QUEUED\nREQUEST_ID=${result.requestId}\nROUTE=${result.route}\nONE_CANONICAL_COORDINATOR=true` };
      },
    });
  },
});
