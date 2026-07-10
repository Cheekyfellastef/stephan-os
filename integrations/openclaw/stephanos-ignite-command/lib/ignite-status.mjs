export const PLUGIN_ID = 'stephanos-ignite-command';

export const AUTHORIZED_SUBCOMMANDS = Object.freeze([
  'help',
  'openclaw-status',
  'status',
]);

const HELP_TEXT = `Stephanos Ignite Command (read-only)\n\nAuthorized commands:\n/stephanos-ignite help\n/stephanos-ignite openclaw-status\n/stephanos-ignite status\n\nThis plugin only reports deterministic status text. It does not mutate repositories, dispatch Codex/OpenClaw tasks, run shell commands, install plugins, push, merge, or repair configuration.`;

const OPENCLAW_STATUS_TEXT = `OPENCLAW_STATUS=operator-verification-required\nPLUGIN_ID=stephanos-ignite-command\nCOMMAND_SURFACE=/stephanos-ignite openclaw-status\nREAD_ONLY=true\nMUTATES_REPO=false\nRUNS_SHELL=false\nDISPATCHES_CODEX=false\nDISPATCHES_OPENCLAW_TASKS=false\nNOTE=Use Battle Bridge/OpenClaw gateway health proof for live runtime status; this command does not claim gateway health.`;

const STATUS_TEXT = `STEPHANOS_IGNITE_STATUS=source-plugin-restored\nPLUGIN_ID=stephanos-ignite-command\nCOMMAND_SURFACE=/stephanos-ignite status\nAUTHORIZED_COMMANDS=help,openclaw-status,status\nREAD_ONLY=true\nMUTATES_REPO=false\nRUNS_SHELL=false\nDISPATCHES_CODEX=false\nDISPATCHES_OPENCLAW_TASKS=false\nNOTE=This is source/plugin status only, not Battle Bridge gateway proof.`;

export function normalizeIgniteArgs(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function resolveIgniteCommand(value) {
  const command = normalizeIgniteArgs(value) || 'help';
  if (!AUTHORIZED_SUBCOMMANDS.includes(command)) {
    return {
      ok: false,
      text: `Unsupported /stephanos-ignite command: ${command}\n\n${HELP_TEXT}`,
    };
  }
  return { ok: true, command };
}

export function renderIgniteCommand(value) {
  const resolved = resolveIgniteCommand(value);
  if (!resolved.ok) return resolved.text;
  if (resolved.command === 'openclaw-status') return OPENCLAW_STATUS_TEXT;
  if (resolved.command === 'status') return STATUS_TEXT;
  return HELP_TEXT;
}
