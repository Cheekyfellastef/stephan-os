const HELP_TEXT = `Stephanos Ignite command help

Usage:
/stephanos-ignite help — show this help.

Purpose:
Use this command to verify the OpenClaw WhatsApp command bridge is loading the source-controlled Stephanos Ignite plugin. Desktop ignition remains the canonical operator-approved path in the Stephanos repository.`;

export function parseIgniteCommand(value) {
  const action = String(value || '').trim().toLowerCase();
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    return { ok: true, action: 'help' };
  }
  return {
    ok: false,
    text: 'Usage: /stephanos-ignite help',
  };
}

export function buildIgniteReply(value) {
  const parsed = parseIgniteCommand(value);
  if (!parsed.ok) return { text: parsed.text };
  return { text: HELP_TEXT };
}

export const STEPHANOS_IGNITE_COMMAND_DEFAULTS = Object.freeze({
  command: 'stephanos-ignite',
  helpText: HELP_TEXT,
});
