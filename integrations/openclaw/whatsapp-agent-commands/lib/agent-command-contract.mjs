const MAX_MESSAGE_LENGTH = 4000;
const DEFAULT_TIMEOUT_MS = 90000;
const MAX_REPLY_LENGTH = 7000;

export const COMMANDS = Object.freeze({
  standalone: Object.freeze({
    command: 'standalone',
    slashCommand: '/standalone',
    canonicalCommand: '/standalone',
    targetAgentId: 'standalone',
    routeLabel: 'standalone',
    usage: 'Usage: /standalone <message>',
  }),
  scoutCoder: Object.freeze({
    command: 'scout-coder',
    slashCommand: '/scout-coder',
    canonicalCommand: '/scout-coder',
    targetAgentId: 'stephanos-scout-coder',
    routeLabel: 'scout-coder',
    usage: 'Usage: /scout-coder <message>',
  }),
  scoutCoderAlias: Object.freeze({
    command: 'scout_coder',
    slashCommand: '/scout_coder',
    canonicalCommand: '/scout-coder',
    targetAgentId: 'stephanos-scout-coder',
    routeLabel: 'scout-coder',
    usage: 'Usage: /scout_coder <message>',
  }),
});

export const COMMAND_LIST = Object.freeze([
  COMMANDS.standalone,
  COMMANDS.scoutCoder,
  COMMANDS.scoutCoderAlias,
]);

export const DEFAULTS = Object.freeze({
  maxMessageLength: MAX_MESSAGE_LENGTH,
  maxReplyLength: MAX_REPLY_LENGTH,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  source: 'openclaw-whatsapp-agent-command',
  channel: 'whatsapp',
});

export function normalizeCommandInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseAgentCommand(commandSpec, value) {
  const message = normalizeCommandInput(value);
  if (!message) {
    return {
      ok: false,
      error: commandSpec.usage,
    };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `${commandSpec.slashCommand} messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, message };
}

export function buildAgentRequest(commandSpec, message, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const parsed = parseAgentCommand(commandSpec, message);
  if (!parsed.ok) throw new Error(parsed.error);
  const boundedTimeoutMs = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 120000);
  return {
    targetAgentId: commandSpec.targetAgentId,
    message: parsed.message,
    source: DEFAULTS.source,
    channel: DEFAULTS.channel,
    operatorInitiated: true,
    command: commandSpec.slashCommand,
    canonicalCommand: commandSpec.canonicalCommand,
    timeoutMs: boundedTimeoutMs,
  };
}

export function boundAgentReply(commandSpec, value) {
  const text = String(value || '').trim();
  if (!text) {
    return `[${commandSpec.routeLabel} via OpenClaw]\nAgent returned no text.`;
  }
  const prefixed = `[${commandSpec.routeLabel} via OpenClaw]\n${text}`;
  if (prefixed.length <= MAX_REPLY_LENGTH) return prefixed;
  return `${prefixed.slice(0, MAX_REPLY_LENGTH - 64)}\n\n[Response truncated by WhatsApp agent-command safety limit.]`;
}

export function unavailableReply(commandSpec) {
  return `OpenClaw ${commandSpec.slashCommand} is unavailable right now. The request was not sent anywhere else. Check the local OpenClaw Gateway and try again.`;
}

export async function invokeAgent(api, request) {
  const agentApi = api?.agents;
  const invoke = agentApi?.invoke || agentApi?.run || agentApi?.send;
  if (typeof invoke !== 'function') {
    throw new Error('OpenClaw agent invocation API is unavailable.');
  }
  const result = await invoke.call(agentApi, request);
  const text = typeof result === 'string'
    ? result
    : typeof result?.text === 'string'
      ? result.text
      : typeof result?.output_text === 'string'
        ? result.output_text
        : typeof result?.data?.output_text === 'string'
          ? result.data.output_text
          : '';
  if (!text.trim()) throw new Error('OpenClaw agent returned no answer text.');
  return text;
}
