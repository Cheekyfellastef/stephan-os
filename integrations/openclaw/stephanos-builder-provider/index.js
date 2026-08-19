import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import {
  OPENCLAW_OC1_COMMAND,
  renderOpenClawBuilderHelp,
  resolveOpenClawBuilderCommand,
  runOpenClawOc1RepositoryScout,
} from './lib/oc1-repository-scout.mjs';

export default definePluginEntry({
  id: 'stephanos-builder-provider',
  name: 'Stephanos Builder Provider',
  description: 'Bounded OpenClaw provider tasks for Stephanos qualification, beginning with read-only OC1 repository scouting.',
  register(api) {
    api.registerCommand({
      name: 'stephanos-builder',
      description: 'Run bounded Stephanos/OpenClaw diagnostics. Qualification is reserved for canonical Mission Worker claims.',
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
