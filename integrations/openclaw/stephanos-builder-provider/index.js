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
import {
  OPENCLAW_OC2_GATEWAY_METHOD,
  executeOpenClawOc2GatewayRequest,
} from './lib/oc2-gateway-provider.mjs';


const SHARED_CONVERSATION_METHOD = 'stephanos-builder-provider.sharedConversation';
const SHARED_CONVERSATION_SCHEMA = 'stephanos.openclaw-shared-conversation-gateway.v1';
const SHARED_CONVERSATION_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'messageId', 'threadId', 'turnId',
  'relatedIssue', 'text', 'issuedAtUtc', 'expiresAtUtc',
]);
const SHARED_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SHARED_ISSUE = /^#[1-9][0-9]{0,6}$/;
const SHARED_SECRET = /(?:BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|gh[pousr]_[a-z0-9_]+|sk-[a-z0-9_-]{20,})/i;

// A real, authenticated Gateway receive/reply proof, not a model completion
// and never a source-write, lease, approval, or permission grant.
export function receiveOpenClawSharedConversationTurn(params = {}, context = {}, now = Date.now()) {
  const deny = (reason) => Object.freeze({
    schemaVersion: SHARED_CONVERSATION_SCHEMA,
    success: false, blocker: reason,
    arbitraryShellAllowed: false, sourceMutationAllowed: false, mergeAuthority: false,
  });
  if (!params || typeof params !== 'object' || Array.isArray(params)
      || Object.keys(params).sort().join(',') !== [...SHARED_CONVERSATION_KEYS].sort().join(',')) {
    return deny('OPENCLAW_CONVERSATION_ENVELOPE_INVALID');
  }
  const fields = ['requestId', 'messageId', 'threadId', 'turnId'];
  if (params.schemaVersion !== SHARED_CONVERSATION_SCHEMA
      || fields.some((key) => typeof params[key] !== 'string' || !SHARED_ID.test(params[key]))
      || typeof params.relatedIssue !== 'string' || !SHARED_ISSUE.test(params.relatedIssue)
      || typeof params.text !== 'string' || !params.text.trim() || params.text.length > 1200
      || SHARED_SECRET.test(params.text)) return deny('OPENCLAW_CONVERSATION_SCOPE_INVALID');
  const issued = Date.parse(params.issuedAtUtc), expiry = Date.parse(params.expiresAtUtc);
  if (!Number.isFinite(issued) || !Number.isFinite(expiry)
      || issued > now + 60_000 || expiry <= now || expiry <= issued
      || expiry - issued > 30 * 60_000) return deny('OPENCLAW_CONVERSATION_EXPIRED');
  if (context.executingInsideOpenClawGateway !== true
      || context.pluginId !== 'stephanos-builder-provider'
      || context.method !== SHARED_CONVERSATION_METHOD
      || !/^openclaw-gateway:[1-9][0-9]*$/.test(context.providerInstance || '')) {
    return deny('OPENCLAW_CONVERSATION_NATIVE_CONTEXT_REQUIRED');
  }
  return Object.freeze({
    schemaVersion: SHARED_CONVERSATION_SCHEMA,
    success: true, executionSurface: 'openclaw-gateway-plugin',
    providerInstance: context.providerInstance,
    requestId: params.requestId, messageId: params.messageId,
    threadId: params.threadId, turnId: params.turnId, relatedIssue: params.relatedIssue,
    replyText: 'OpenClaw Gateway received the shared conversation turn. Native assistant reasoning is not yet qualified by this handshake.',
    sourceHeadProven: false, modelResponseProven: false,
    arbitraryShellAllowed: false, sourceMutationAllowed: false, mergeAuthority: false,
  });
}

function gatewayContext(method) {
  return {
    executingInsideOpenClawGateway: true,
    pluginId: 'stephanos-builder-provider',
    method,
    providerInstance: `openclaw-gateway:${process.pid}`,
  };
}

export default definePluginEntry({
  id: 'stephanos-builder-provider',
  name: 'Stephanos Builder Provider',
  description: 'Bounded OpenClaw provider tasks for Stephanos OC1 repository scouting and fixed OC2 deterministic test/build qualification.',
  register(api) {
    api.registerGatewayMethod(
      OPENCLAW_OC1_GATEWAY_METHOD,
      async (params) => executeOpenClawOc1GatewayRequest(params, {
        gatewayRuntimeContext: gatewayContext(OPENCLAW_OC1_GATEWAY_METHOD),
      }),
      { scope: 'operator.write' },
    );
    api.registerGatewayMethod(
      OPENCLAW_OC2_GATEWAY_METHOD,
      async (params) => executeOpenClawOc2GatewayRequest(params, {
        gatewayRuntimeContext: gatewayContext(OPENCLAW_OC2_GATEWAY_METHOD),
      }),
      { scope: 'operator.write' },
    );

    api.registerGatewayMethod(
      SHARED_CONVERSATION_METHOD,
      async (params) => receiveOpenClawSharedConversationTurn(params, gatewayContext(SHARED_CONVERSATION_METHOD)),
      { scope: 'operator.read' },
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
