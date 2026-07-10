const DEFAULT_IGNITE_COMMAND = 'npm run stephanos:ignite';

export function normalizeIgniteCommand(value = DEFAULT_IGNITE_COMMAND) {
  const normalized = String(value || DEFAULT_IGNITE_COMMAND).trim();
  if (!normalized) return DEFAULT_IGNITE_COMMAND;
  return normalized.replace(/[\r\n]+/g, ' ');
}

export function buildIgniteReply(command = DEFAULT_IGNITE_COMMAND) {
  const safeCommand = normalizeIgniteCommand(command);
  return [
    'Stephanos ignition remains operator-run and approval-gated.',
    `From the Stephanos repository root, run: ${safeCommand}`,
    'This OpenClaw command does not execute ignition or mutate repository/runtime state.',
  ].join('\n');
}

export const STEPHANOS_IGNITE_COMMAND_DEFAULTS = Object.freeze({
  command: DEFAULT_IGNITE_COMMAND,
});
