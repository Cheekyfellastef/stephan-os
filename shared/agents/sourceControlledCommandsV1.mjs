export const SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION = 'source-controlled-commands.v1';

export const COMMAND_SURFACE = Object.freeze({
  WHATSAPP: 'WHATSAPP',
  COMMAND_DECK: 'COMMAND_DECK',
  BATTLE_BRIDGE: 'BATTLE_BRIDGE',
});

export const COMMAND_STATE = Object.freeze({
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item).toLowerCase()).filter(Boolean) : [];
}

export const DEFAULT_OPERATOR_COMMANDS = Object.freeze([
  {
    id: 'ignition',
    aliases: ['ignite', 'start', 'wake'],
    scope: 'runtime',
    surface: COMMAND_SURFACE.WHATSAPP,
    handlerIntent: 'START_OR_REFRESH_STEPHANOS_RUNTIME',
    guardrails: ['approval-required-for-mutation', 'local-first', 'exact-status-return'],
    proofCommand: 'node --test shared/agents/sourceControlledCommandsV1.test.mjs',
    enabled: true,
    state: COMMAND_STATE.ENABLED,
    mutation: true,
  },
  {
    id: 'status',
    aliases: ['where-are-we', 'dashboard', 'progress'],
    scope: 'mission',
    surface: COMMAND_SURFACE.COMMAND_DECK,
    handlerIntent: 'READ_MISSION_OPERATIONS_STATUS',
    guardrails: ['read-only', 'facts-before-hypotheses'],
    proofCommand: 'node --test shared/agents/sourceControlledCommandsV1.test.mjs',
    enabled: true,
    state: COMMAND_STATE.ENABLED,
    mutation: false,
  },
  {
    id: 'recovery',
    aliases: ['recover', 'repair', 'unstick'],
    scope: 'runtime',
    surface: COMMAND_SURFACE.BATTLE_BRIDGE,
    handlerIntent: 'RUN_APPROVED_RECOVERY_PLAN',
    guardrails: ['approval-required-for-mutation', 'dirty-tree-blocker', 'exact-unblock-action'],
    proofCommand: 'node --test shared/agents/sourceControlledCommandsV1.test.mjs',
    enabled: true,
    state: COMMAND_STATE.ENABLED,
    mutation: true,
  },
  {
    id: 'help',
    aliases: ['commands', 'what-can-you-do'],
    scope: 'operator',
    surface: COMMAND_SURFACE.WHATSAPP,
    handlerIntent: 'LIST_AVAILABLE_OPERATOR_COMMANDS',
    guardrails: ['read-only', 'copy-safe-output'],
    proofCommand: 'node --test shared/agents/sourceControlledCommandsV1.test.mjs',
    enabled: true,
    state: COMMAND_STATE.ENABLED,
    mutation: false,
  },
  {
    id: 'legacy-relay',
    aliases: ['old-relay'],
    scope: 'relay',
    surface: COMMAND_SURFACE.WHATSAPP,
    handlerIntent: 'BLOCK_LEGACY_AD_HOC_RELAY',
    guardrails: ['blocked', 'source-controlled-replacement-required'],
    proofCommand: 'node --test shared/agents/sourceControlledCommandsV1.test.mjs',
    enabled: false,
    state: COMMAND_STATE.DISABLED,
    mutation: false,
    exactUnblockAction: 'Use source-controlled ignition, status, recovery, or help commands instead.',
  },
]);

export function buildSourceControlledCommandsContract() {
  return {
    schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
    contractKind: 'stephanos.source_controlled_commands.contract',
    surfaces: Object.values(COMMAND_SURFACE),
    states: Object.values(COMMAND_STATE),
    requiredCommandIds: ['ignition', 'status', 'recovery', 'help'],
    finalVerdict: 'SOURCE_CONTROLLED_COMMANDS_CONTRACT_READY',
  };
}

export function normalizeCommandRecord(command = {}) {
  return {
    schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
    id: text(command.id).toLowerCase(),
    aliases: list(command.aliases),
    scope: text(command.scope, 'operator'),
    surface: text(command.surface, COMMAND_SURFACE.COMMAND_DECK),
    handlerIntent: text(command.handlerIntent),
    guardrails: list(command.guardrails),
    proofCommand: text(command.proofCommand),
    enabled: command.enabled !== false,
    state: text(command.state, command.enabled === false ? COMMAND_STATE.DISABLED : COMMAND_STATE.ENABLED),
    mutation: command.mutation === true,
    exactUnblockAction: text(command.exactUnblockAction),
  };
}

export function createCommandRegistry(commands = DEFAULT_OPERATOR_COMMANDS) {
  return {
    schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
    kind: 'stephanos.source_controlled_commands.registry',
    commands: commands.map(normalizeCommandRecord),
    finalVerdict: 'SOURCE_CONTROLLED_COMMANDS_REGISTRY_READY',
  };
}

export function validateCommandRegistry(registry = createCommandRegistry()) {
  const errors = [];
  const ids = new Set();
  const aliases = new Map();
  const commands = Array.isArray(registry.commands) ? registry.commands : [];

  for (const command of commands) {
    if (!command.id) errors.push('missing-command-id');
    if (ids.has(command.id)) errors.push(`duplicate-command-id:${command.id}`);
    ids.add(command.id);
    if (!Object.values(COMMAND_SURFACE).includes(command.surface)) errors.push(`invalid-surface:${command.id}`);
    if (!Object.values(COMMAND_STATE).includes(command.state)) errors.push(`invalid-state:${command.id}`);
    if (!command.handlerIntent) errors.push(`missing-handler-intent:${command.id}`);
    for (const alias of command.aliases || []) {
      if (aliases.has(alias)) errors.push(`duplicate-alias:${alias}`);
      aliases.set(alias, command.id);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'SOURCE_CONTROLLED_COMMANDS_REGISTRY_PASS' : 'SOURCE_CONTROLLED_COMMANDS_REGISTRY_BLOCKED',
  };
}

export function findCommand(registry = createCommandRegistry(), input = '') {
  const lookup = text(input).toLowerCase().replace(/^\//, '');
  return (registry.commands || []).find((command) => command.id === lookup || (command.aliases || []).includes(lookup)) || null;
}

export function routeOperatorCommand(input = {}) {
  const registry = input.registry?.kind === 'stephanos.source_controlled_commands.registry' ? input.registry : createCommandRegistry(input.commands);
  const validation = validateCommandRegistry(registry);
  if (!validation.valid) {
    return {
      schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
      kind: 'stephanos.source_controlled_commands.route',
      state: COMMAND_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      command: null,
      exactUnblockAction: `Fix command registry validation errors: ${validation.errors.join(', ')}`,
      finalVerdict: 'SOURCE_CONTROLLED_COMMANDS_REGISTRY_INVALID',
    };
  }

  const command = findCommand(registry, input.commandText);
  if (!command) {
    return {
      schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
      kind: 'stephanos.source_controlled_commands.route',
      state: COMMAND_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      command: null,
      exactUnblockAction: 'Unknown command. Use /help to list source-controlled commands.',
      finalVerdict: 'SOURCE_CONTROLLED_COMMAND_UNKNOWN',
    };
  }

  if (command.state !== COMMAND_STATE.ENABLED || command.enabled === false) {
    return {
      schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
      kind: 'stephanos.source_controlled_commands.route',
      state: command.state === COMMAND_STATE.DISABLED ? COMMAND_STATE.DISABLED : COMMAND_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      command,
      exactUnblockAction: command.exactUnblockAction || `Command ${command.id} is disabled in source control.`,
      finalVerdict: 'SOURCE_CONTROLLED_COMMAND_DISABLED',
    };
  }

  if (command.mutation && input.operatorApproved !== true) {
    return {
      schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
      kind: 'stephanos.source_controlled_commands.route',
      state: COMMAND_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      command,
      exactUnblockAction: `Approve mutation command ${command.id} before execution.`,
      finalVerdict: 'SOURCE_CONTROLLED_COMMAND_APPROVAL_REQUIRED',
    };
  }

  return {
    schemaVersion: SOURCE_CONTROLLED_COMMANDS_SCHEMA_VERSION,
    kind: 'stephanos.source_controlled_commands.route',
    state: COMMAND_STATE.ENABLED,
    command,
    handlerIntent: command.handlerIntent,
    exactUnblockAction: '',
    finalVerdict: 'SOURCE_CONTROLLED_COMMAND_ROUTE_READY',
  };
}

export function listSourceControlledCommands(registry = createCommandRegistry()) {
  return registry.commands
    .filter((command) => command.enabled !== false && command.state === COMMAND_STATE.ENABLED)
    .map((command) => ({ id: command.id, aliases: command.aliases, surface: command.surface, scope: command.scope, handlerIntent: command.handlerIntent }));
}
