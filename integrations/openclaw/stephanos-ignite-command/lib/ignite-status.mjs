export const PLUGIN_ID = 'stephanos-ignite-command';

export const AUTHORIZED_SUBCOMMANDS = Object.freeze([
  'help',
  'openclaw-status',
  'status',
  'wake',
  'update',
  'update-status',
]);

const EXACT_HEAD = /^[0-9a-f]{40}$/;
const HELP_TEXT = `Stephanos Ignite Command\n\nAuthorized commands:\n/stephanos-ignite help\n/stephanos-ignite openclaw-status\n/stephanos-ignite status\n/stephanos-ignite wake\n/stephanos-ignite update <exact-40-character-main-sha>\n/stephanos-ignite update-status <32-character-receipt-id>\n\nStatus commands are read-only. Wake submits one authenticated fixed-route request to the canonical Battle Bridge recovery coordinator. Update is owner-only and may call only the canonical preservation-safe exact-head updater for main. Update-status is an owner-only bounded point read of one receipt. Neither command accepts arbitrary shell, executable, path, task, branch, URL, Git operation, PC restart, merge or deployment authority.`;

const OPENCLAW_STATUS_TEXT = `OPENCLAW_STATUS=operator-verification-required\nPLUGIN_ID=stephanos-ignite-command\nCOMMAND_SURFACE=/stephanos-ignite openclaw-status\nCURRENT_INVOCATION_READ_ONLY=true\nPLUGIN_CAPABILITY_MUTATES_REPO=OWNER_GATED_EXACT_HEAD_ONLY\nPLUGIN_CAPABILITY_EXECUTES_IN_MEMORY=OWNER_GATED_ONLY\nARBITRARY_SHELL_ALLOWED=false\nDISPATCHES_CODEX=false\nDISPATCHES_OPENCLAW_TASKS=false\nNOTE=Use Battle Bridge/OpenClaw gateway health proof for live runtime status; this command does not claim gateway health.`;

const STATUS_TEXT = `STEPHANOS_IGNITE_STATUS=source-plugin-restored\nPLUGIN_ID=stephanos-ignite-command\nCOMMAND_SURFACE=/stephanos-ignite status\nAUTHORIZED_COMMANDS=help,openclaw-status,status,wake,update,update-status\nCURRENT_INVOCATION_READ_ONLY=true\nPLUGIN_CAPABILITY_MUTATES_REPO=OWNER_GATED_EXACT_HEAD_ONLY\nPLUGIN_CAPABILITY_EXECUTES_IN_MEMORY=OWNER_GATED_ONLY\nARBITRARY_SHELL_ALLOWED=false\nDISPATCHES_CODEX=false\nDISPATCHES_OPENCLAW_TASKS=false\nNOTE=This is source/plugin status only, not Battle Bridge gateway proof.`;

export function normalizeIgniteArgs(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function resolveIgniteCommand(value) {
  const normalized = normalizeIgniteArgs(value) || 'help';
  const updateStatusMatch = normalized.match(/^update-status ([0-9a-f]{32})$/);
  if (updateStatusMatch) return { ok: true, command: 'update-status', receiptId: updateStatusMatch[1] };
  if (normalized === 'update-status' || normalized.startsWith('update-status ')) {
    return {
      ok: false,
      text: `Unsupported /stephanos-ignite update-status request. An exact 32-character receipt ID is required.\n\n${HELP_TEXT}`,
    };
  }
  const updateMatch = normalized.match(/^update ([0-9a-f]{40})$/);
  if (updateMatch) return { ok: true, command: 'update', expectedHead: updateMatch[1] };
  if (normalized === 'update' || normalized.startsWith('update ')) {
    return {
      ok: false,
      text: `Unsupported /stephanos-ignite update request. An exact 40-character main SHA is required.\n\n${HELP_TEXT}`,
    };
  }
  if (!AUTHORIZED_SUBCOMMANDS.includes(normalized)) {
    return {
      ok: false,
      text: `Unsupported /stephanos-ignite command: ${normalized}\n\n${HELP_TEXT}`,
    };
  }
  return { ok: true, command: normalized };
}

export function renderIgniteCommand(value) {
  const resolved = resolveIgniteCommand(value);
  if (!resolved.ok) return resolved.text;
  if (resolved.command === 'openclaw-status') return OPENCLAW_STATUS_TEXT;
  if (resolved.command === 'status') return STATUS_TEXT;
  if (resolved.command === 'wake') return 'RECOVERY_WAKE_REQUIRES_AUTHENTICATED_FIXED_ADAPTER';
  if (resolved.command === 'update') return `BATTLE_BRIDGE_EXACT_HEAD_UPDATE_REQUIRES_AUTHENTICATED_OWNER\nEXPECTED_HEAD=${resolved.expectedHead}`;
  if (resolved.command === 'update-status') return `BATTLE_BRIDGE_EXACT_HEAD_UPDATE_STATUS_REQUIRES_AUTHENTICATED_OWNER\nRECEIPT_ID=${resolved.receiptId}`;
  return HELP_TEXT;
}
