const COMMAND_NAME = 'stephanos-ignite';
const SUPPORTED_SUBCOMMANDS = new Set(['help', 'openclaw-status', 'status']);

export function normalizeIgniteArgs(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function parseIgniteCommand(value) {
  const normalized = normalizeIgniteArgs(value);
  const subcommand = normalized || 'help';
  if (!SUPPORTED_SUBCOMMANDS.has(subcommand)) {
    return {
      ok: false,
      subcommand,
      text: [
        `Unknown /${COMMAND_NAME} command: ${subcommand}`,
        '',
        renderHelp(),
      ].join('\n'),
    };
  }
  return { ok: true, subcommand };
}

export function renderHelp() {
  return [
    'Stephanos Ignite command surface (OpenClaw plugin).',
    '',
    `/${COMMAND_NAME} help — show this help.`,
    `/${COMMAND_NAME} openclaw-status — confirm this source-controlled OpenClaw plugin is loaded.`,
    `/${COMMAND_NAME} status — show ignition command posture without bypassing approval gates.`,
  ].join('\n');
}

export function renderOpenClawStatus() {
  return [
    'OPENCLAW_PLUGIN_LOADED',
    'pluginId=stephanos-ignite-command',
    'command=/stephanos-ignite',
    'installation=source-controlled linked OpenClaw plugin',
  ].join('\n');
}

export function renderIgnitionStatus() {
  return [
    'STEPHANOS_IGNITION_STATUS',
    'canonicalCommand=npm run stephanos:ignite',
    'approvalGates=preserved',
    'executionPolicy=operator-approved local ignition only; WhatsApp status command does not bypass the plugin system or approval gates',
  ].join('\n');
}

export function handleIgniteCommand(value) {
  const parsed = parseIgniteCommand(value);
  if (!parsed.ok) return { text: parsed.text };
  if (parsed.subcommand === 'openclaw-status') return { text: renderOpenClawStatus() };
  if (parsed.subcommand === 'status') return { text: renderIgnitionStatus() };
  return { text: renderHelp() };
}
