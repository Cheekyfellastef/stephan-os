import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import {
  buildAgentRequest,
  boundAgentReply,
  COMMAND_LIST,
  DEFAULTS,
  invokeAgent,
  parseAgentCommand,
  unavailableReply,
} from './lib/agent-command-contract.mjs';

function resolvePluginConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    timeoutMs: Number(config.timeoutMs) || DEFAULTS.timeoutMs,
  };
}

function registerAgentCommand(api, commandSpec, config) {
  api.registerCommand({
    name: commandSpec.command,
    description: `Route an authorized ${commandSpec.slashCommand} WhatsApp prompt to ${commandSpec.targetAgentId}.`,
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const parsed = parseAgentCommand(commandSpec, ctx?.args || '');
      if (!parsed.ok) return { text: parsed.error };
      try {
        const request = buildAgentRequest(commandSpec, parsed.message, config.timeoutMs);
        const text = await invokeAgent(api, request);
        return { text: boundAgentReply(commandSpec, text) };
      } catch (error) {
        api.logger.warn(`${commandSpec.slashCommand} failed: ${error instanceof Error ? error.message : String(error)}`);
        return { text: unavailableReply(commandSpec) };
      }
    },
  });
}

export default definePluginEntry({
  id: 'stephanos-whatsapp-agent-commands',
  name: 'Stephanos WhatsApp Agent Commands',
  description: 'Routes authorized /standalone, /scout-coder, and /scout_coder messages to explicit local OpenClaw agent lanes.',
  register(api) {
    const config = resolvePluginConfig(api.pluginConfig);
    for (const commandSpec of COMMAND_LIST) {
      registerAgentCommand(api, commandSpec, config);
    }
  },
});
