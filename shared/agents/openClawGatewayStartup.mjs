import { OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY, OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX } from './openClawWorkspaceHygiene.mjs';

export const OPENCLAW_GATEWAY_STARTUP_SOURCE = 'shared:openclaw-control-panel-start-gateway';
export const OPENCLAW_GATEWAY_APPROVED_PORT = 18789;
export const OPENCLAW_GATEWAY_APPROVED_ENDPOINT = `http://127.0.0.1:${OPENCLAW_GATEWAY_APPROVED_PORT}`;
export const OPENCLAW_GATEWAY_STARTUP_GUARDRAILS = Object.freeze({
  openClawTaskExecutionAllowed: false,
  mutationAllowed: true,
  codexDispatchAllowed: false,
  mergeReadinessChangeAllowed: false,
  paidApiUsageAllowed: false,
});

export const OPENCLAW_GATEWAY_STARTGATEWAY_APPROVAL = Object.freeze({
  required: true,
  actionId: 'approve-openclaw-control-panel-startgateway',
  reason: 'Control Panel StartGateway writes OpenClaw gateway config/token settings and runs openclaw gateway run --force, which may replace an existing listener.',
  envFlag: 'STEPHANOS_APPROVE_OPENCLAW_CONTROL_PANEL_STARTGATEWAY',
});

export function resolveOpenClawGatewayStartToken({ env = process.env, token = '' } = {}) {
  return String(token || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN || env.OPENCLAW_GATEWAY_TOKEN || '').trim();
}

export function openClawGatewayStartApprovalGranted({ env = process.env, approved = false } = {}) {
  return approved === true || /^(1|true|yes|approved)$/i.test(String(env[OPENCLAW_GATEWAY_STARTGATEWAY_APPROVAL.envFlag] || ''));
}

export function getOpenClawGatewayStartupCommand({ token = '<operator-token>' } = {}) {
  const safeToken = String(token || '<operator-token>').replace(/'/g, "''");
  return [
    `${OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX} openclaw config set gateway.mode local`,
    `openclaw config set gateway.auth.mode token`,
    `openclaw config set gateway.auth.token '${safeToken}'`,
    `openclaw config set gateway.remote.token '${safeToken}'`,
    `openclaw gateway run --force`,
  ].join('; ');
}

export function redactOpenClawGatewayStartupCommand(value = '') {
  return String(value || '').replace(/(gateway\.(?:auth|remote)\.token\s+)(?:'[^']*'|\S+)/gi, '$1<redacted-token>');
}

export function splitOpenClawGatewayStartupCommand(value = getOpenClawGatewayStartupCommand()) {
  const parts = String(value || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"|"$/g, ''));
}

export function hasForbiddenOpenClawGatewayStartupToken(value = '') {
  return /\b(codex|dispatch|task|execute|mutation|mutate|merge-ready|merge\s+readiness|git\s+(?:push|merge|commit)|openai|anthropic|paid)\b/i.test(String(value || ''));
}

export function buildOpenClawGatewayStartupTarget({ commandText = '', source = OPENCLAW_GATEWAY_STARTUP_SOURCE, env = process.env, token = '', approved = false } = {}) {
  const resolvedToken = resolveOpenClawGatewayStartToken({ env, token });
  const approvalGranted = openClawGatewayStartApprovalGranted({ env, approved });
  const text = String(commandText || getOpenClawGatewayStartupCommand({ token: resolvedToken || '<operator-token>' }) || '').trim();
  const argv = splitOpenClawGatewayStartupCommand(text);
  const forceStartGateway = /openclaw\s+gateway\s+run\s+--force/i.test(text);
  const portMatch = text.match(/(?:^|\s)--port(?:=|\s+)(\d{2,5})(?:\s|$)/i);
  const port = forceStartGateway ? OPENCLAW_GATEWAY_APPROVED_PORT : Number(portMatch?.[1] || 0);
  const blockedReason = !text
    ? 'startup-command-missing'
    : argv.length === 0
      ? 'startup-command-empty'
      : hasForbiddenOpenClawGatewayStartupToken(text)
        ? 'startup-command-violates-guardrails'
        : !resolvedToken
          ? 'startup-token-missing'
          : !approvalGranted
            ? 'startup-approval-required'
            : port !== OPENCLAW_GATEWAY_APPROVED_PORT
              ? 'startup-command-port-not-approved'
              : '';
  return {
    id: 'gateway',
    source,
    commandText: redactOpenClawGatewayStartupCommand(text),
    command: text.startsWith('$') ? 'powershell.exe' : (argv[0] || ''),
    commandArgs: text.startsWith('$') ? ['-NoProfile', '-Command', text] : argv.slice(1),
    port,
    endpoint: OPENCLAW_GATEWAY_APPROVED_ENDPOINT,
    workspacePath: OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY,
    available: !blockedReason,
    blocked: Boolean(blockedReason),
    reason: blockedReason,
    guardrails: OPENCLAW_GATEWAY_STARTUP_GUARDRAILS,
    approval: { ...OPENCLAW_GATEWAY_STARTGATEWAY_APPROVAL, granted: approvalGranted },
    mutatesOpenClaw: true,
    killsProcesses: forceStartGateway,
  };
}
