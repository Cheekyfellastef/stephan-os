import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { renderIgniteCommand, resolveIgniteCommand } from './lib/ignite-status.mjs';
import { queueBattleBridgeExactHeadFromOpenClaw } from './lib/recovery-update.mjs';
import { wakeBattleBridgeRecoveryMesh } from './lib/recovery-wake.mjs';

function bool(value) {
  return value === true ? 'true' : 'false';
}

function renderExactHeadUpdateResult(result) {
  const lines = [
    `BATTLE_BRIDGE_EXACT_HEAD_UPDATE=${result.ok ? 'ACCEPTED' : 'BLOCKED'}`,
    `EXPECTED_HEAD=${result.expectedHead || ''}`,
    `SOURCE_HEAD=${result.sourceHead || ''}`,
    `EXPECTED_HEAD_MATCH=${bool(result.expectedHeadMatch)}`,
    `SOURCE_INSTALLED=${bool(result.sourceInstalled)}`,
    `RUNTIME_PROOF_PASSED=${bool(result.runtimeProofPassed)}`,
    `RUNTIME_PROOF_PENDING=${bool(result.runtimeProofPending)}`,
    `PLUGIN_RELOAD_PROOF_PENDING=${bool(result.pluginReloadProofPending)}`,
    `SERVED_UI_EXACT_HEAD=${bool(result.servedUiExactHead)}`,
    `VERDICT=${result.finalVerdict || 'UPDATE_FAILED'}`,
  ];
  if (result.blocker) lines.push(`REASON=${result.blocker}`);
  lines.push('DESTRUCTIVE_GIT_ALLOWED=false');
  lines.push('ARBITRARY_SHELL_ALLOWED=false');
  lines.push('PC_RESTART_ALLOWED=false');
  return lines.join('\n');
}

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Stephanos/OpenClaw ignition status plus authenticated fixed Battle Bridge recovery routes.',
  register(api) {
    api.registerCommand({
      name: 'stephanos-ignite',
      description: 'Show ignition status, wake recovery, or perform an owner-approved exact-head Battle Bridge update.',
      acceptsArgs: true,
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: async (ctx) => {
        const resolved = resolveIgniteCommand(ctx?.args || 'help');
        if (!resolved.ok) return { text: resolved.text };
        if (resolved.command === 'wake') {
          const result = await wakeBattleBridgeRecoveryMesh({
            authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' },
          });
          if (!result.ok) return { text: `BATTLE_BRIDGE_RECOVERY_WAKE=BLOCKED\nREASON=${result.blocker}` };
          return { text: `BATTLE_BRIDGE_RECOVERY_WAKE=QUEUED\nREQUEST_ID=${result.requestId}\nROUTE=${result.route}\nONE_CANONICAL_COORDINATOR=true` };
        }
        if (resolved.command === 'update') {
          const result = await queueBattleBridgeExactHeadFromOpenClaw({
            expectedHead: resolved.expectedHead,
            authenticatedContext: {
              authenticatedByHost: true,
              commandName: 'stephanos-ignite',
              command: 'update',
              senderIsOwner: ctx?.senderIsOwner === true,
            },
          });
          if (result.receiptId) return { text: `${renderExactHeadUpdateResult(result)}\nRECEIPT_ID=${result.receiptId}` };
          return { text: renderExactHeadUpdateResult(result) };
        }
        return { text: renderIgniteCommand(ctx?.args || 'help') };
      },
    });
  },
});
