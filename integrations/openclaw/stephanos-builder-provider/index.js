import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import {
  OPENCLAW_OC1_COMMAND,
  renderOpenClawBuilderHelp,
  resolveOpenClawBuilderCommand,
  runOpenClawOc1RepositoryScout,
} from './lib/oc1-repository-scout.mjs';
import {
  OPENCLAW_OC1_GATEWAY_METHOD,
  executeOpenClawOc1GatewayRequest,
} from './lib/oc1-gateway-provider.mjs';

export default definePluginEntry({
  id: 'stephanos-builder-provider',
  name: 'Stephanos Builder Provider',
  description: 'Bounded OpenClaw provider tasks for Stephanos qualification, beginning with read-only OC1 repository scouting.',
  register(api) {
    api.registerGatewayMethod(
      OPENCLAW_OC1_GATEWAY_METHOD,
      async (params) => executeOpenClawOc1GatewayRequest(params, {
        gatewayRuntimeContext: {
          executingInsideOpenClawGateway: true,
          pluginId: 'stephanos-builder-provider',
          method: OPENCLAW_OC1_GATEWAY_METHOD,
          providerInstance: `openclaw-gateway:${process.pid}`,
        },
      }),
      { scope: 'operator.write' },
    );

    api.registerCommand({
      name: 'stephanos-builder',
      description: 'Run bounded Stephanos/OpenClaw diagnostics. Qualification is reserved for canonical Mission Worker claims executed by the OpenClaw Gateway plugin.',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        const resolved = resolveOpenClawBuilderCommand(ctx?.args || 'help');
        if (!resolved.ok) return { text: `OPENCLAW_BUILDER_TASK=BLOCKED\nREASON=${resolved.blocker}` };
        if (resolved.command !== OPENCLAW_OC1_COMMAND) return { text: renderOpenClawBuilderHelp() };

        const result = await runOpenClawOc1RepositoryScout({
          authenticatedContext: {
            authenticatedByHost: true,
            commandName: 'stephanos-builder',
            command: OPENCLAW_OC1_COMMAND,
          },
        });
        if (!result.ok) {
          return {
            text: [
              'OPENCLAW_OC1_REPOSITORY_SCOUT=BLOCKED',
              `REASON=${result.blocker}`,
              `SOURCE_HEAD=${result.sourceHead || ''}`,
              `PROOF_REF=${result.proofRef || ''}`,
              'QUALIFICATION_ELIGIBLE=false',
              'SOURCE_MUTATION=false',
            ].join('\n'),
          };
        }
        return {
          text: [
            'OPENCLAW_OC1_REPOSITORY_SCOUT=DIAGNOSTIC_COMPLETED',
            `EXECUTION_ID=${result.executionId}`,
            `SOURCE_HEAD=${result.sourceHead}`,
            `PROOF_REF=${result.proofRef}`,
            `PROVIDER_VERSION=${result.providerVersion}`,
            `RELEVANT_FILE_COUNT=${result.relevantFileCount}`,
            `PACKAGE_SCRIPT_COUNT=${result.packageScriptCount}`,
            'QUALIFICATION_ELIGIBLE=false',
            'SOURCE_MUTATION=false',
            'PRODUCTION_ELIGIBLE=false',
          ].join('\n'),
        };
      },
    });
  },
});
