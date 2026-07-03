import { OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY, OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX } from './openClawWorkspaceHygiene.mjs';

export const OPENCLAW_GATEWAY_STARTUP_SOURCE = 'shared:openclaw-control-panel-start-gateway';
export const OPENCLAW_GATEWAY_APPROVED_PORT = 18789;
export const OPENCLAW_GATEWAY_APPROVED_ENDPOINT = `http://127.0.0.1:${OPENCLAW_GATEWAY_APPROVED_PORT}`;
export const OPENCLAW_GATEWAY_STARTUP_GUARDRAILS = Object.freeze({
  openClawTaskExecutionAllowed: false,
  mutationAllowed: false,
  codexDispatchAllowed: false,
  mergeReadinessChangeAllowed: false,
  paidApiUsageAllowed: false,
});

export function getOpenClawGatewayStartupCommand() {
  return `${OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX} openclaw gateway --host 127.0.0.1 --port ${OPENCLAW_GATEWAY_APPROVED_PORT}`;
}

export function splitOpenClawGatewayStartupCommand(value = getOpenClawGatewayStartupCommand()) {
  const parts = String(value || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"|"$/g, ''));
}

export function hasForbiddenOpenClawGatewayStartupToken(value = '') {
  return /\b(codex|dispatch|task|execute|mutation|mutate|merge-ready|merge\s+readiness|git\s+(?:push|merge|commit)|openai|anthropic|paid)\b/i.test(String(value || ''));
}

export function buildOpenClawGatewayStartupTarget({ commandText = getOpenClawGatewayStartupCommand(), source = OPENCLAW_GATEWAY_STARTUP_SOURCE } = {}) {
  const text = String(commandText || '').trim();
  const argv = splitOpenClawGatewayStartupCommand(text);
  const portMatch = text.match(/(?:^|\s)--port(?:=|\s+)(\d{2,5})(?:\s|$)/i);
  const port = Number(portMatch?.[1] || 0);
  const blockedReason = !text
    ? 'startup-command-missing'
    : argv.length === 0
      ? 'startup-command-empty'
      : hasForbiddenOpenClawGatewayStartupToken(text)
        ? 'startup-command-violates-guardrails'
        : port !== OPENCLAW_GATEWAY_APPROVED_PORT
          ? 'startup-command-port-not-approved'
          : '';
  return {
    id: 'gateway',
    source,
    commandText: text,
    command: text.startsWith('$') ? 'powershell.exe' : (argv[0] || ''),
    commandArgs: text.startsWith('$') ? ['-NoProfile', '-Command', text] : argv.slice(1),
    port,
    endpoint: OPENCLAW_GATEWAY_APPROVED_ENDPOINT,
    workspacePath: OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY,
    available: !blockedReason,
    blocked: Boolean(blockedReason),
    reason: blockedReason,
    guardrails: OPENCLAW_GATEWAY_STARTUP_GUARDRAILS,
  };
}
