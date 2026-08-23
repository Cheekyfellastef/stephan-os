import {
  COMMAND_STATE,
  createCommandRegistry,
  listSourceControlledCommands,
  routeOperatorCommand,
} from './sourceControlledCommandsV1.mjs';

export const OPERATOR_COMMAND_ACTION_SCHEMA_VERSION = 'operator-command-action-lane.v1';

export const ACTION_PACKET_KIND = Object.freeze({
  START_RUNTIME: 'START_RUNTIME',
  READ_STATUS: 'READ_STATUS',
  PLAN_REPAIR: 'PLAN_REPAIR',
  SHOW_HELP: 'SHOW_HELP',
  BLOCKED: 'BLOCKED',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function approved(input = {}) {
  return input.operatorApproved === true || input.approved === true;
}

function basePacket(input, route) {
  return {
    schemaVersion: OPERATOR_COMMAND_ACTION_SCHEMA_VERSION,
    kind: 'stephanos.operator_command_action_lane.packet',
    commandRoute: route,
    currentGoal: text(input.currentGoal, '#1285'),
    runtimeState: text(input.runtimeState, 'UNKNOWN'),
    proofCommand: text(input.proofCommand, 'node --test shared/agents/operatorCommandActionLaneV1.test.mjs'),
  };
}

export function buildOperatorCommandActionContract() {
  return {
    schemaVersion: OPERATOR_COMMAND_ACTION_SCHEMA_VERSION,
    contractKind: 'stephanos.operator_command_action_lane.contract',
    sourceOfTruth: 'sourceControlledCommandsV1',
    supportedCommandIds: ['ignition', 'status', 'recovery', 'help'],
    packetKinds: Object.values(ACTION_PACKET_KIND),
    finalVerdict: 'OPERATOR_COMMAND_ACTION_CONTRACT_READY',
  };
}

export function createOperatorCommandActionPacket(input = {}) {
  const registry = input.registry?.kind === 'stephanos.source_controlled_commands.registry'
    ? input.registry
    : createCommandRegistry(input.commands);
  const route = routeOperatorCommand({
    registry,
    commandText: input.commandText,
    operatorApproved: approved(input),
  });
  const base = basePacket(input, route);

  if (route.state !== COMMAND_STATE.ENABLED) {
    return {
      ...base,
      packetKind: ACTION_PACKET_KIND.BLOCKED,
      readOnly: true,
      guardedAction: false,
      blocker: route.exactUnblockAction,
      nextAction: route.exactUnblockAction,
      finalVerdict: 'OPERATOR_COMMAND_ACTION_BLOCKED',
    };
  }

  if (route.command.id === 'ignition') {
    return {
      ...base,
      packetKind: ACTION_PACKET_KIND.START_RUNTIME,
      readOnly: false,
      guardedAction: true,
      blocker: '',
      nextAction: 'Create approved runtime start or refresh intent.',
      handlerIntent: route.handlerIntent,
      finalVerdict: 'OPERATOR_COMMAND_ACTION_START_READY',
    };
  }

  if (route.command.id === 'recovery') {
    return {
      ...base,
      packetKind: ACTION_PACKET_KIND.PLAN_REPAIR,
      readOnly: false,
      guardedAction: true,
      blocker: text(input.blocker, 'Inspect Mission Operations before repair planning.'),
      nextAction: 'Create bounded repair plan with proof before action.',
      handlerIntent: route.handlerIntent,
      finalVerdict: 'OPERATOR_COMMAND_ACTION_REPAIR_READY',
    };
  }

  if (route.command.id === 'help') {
    return {
      ...base,
      packetKind: ACTION_PACKET_KIND.SHOW_HELP,
      readOnly: true,
      guardedAction: false,
      blocker: '',
      nextAction: 'Show copy-safe source-controlled command list.',
      commands: listSourceControlledCommands(registry),
      handlerIntent: route.handlerIntent,
      finalVerdict: 'OPERATOR_COMMAND_ACTION_HELP_READY',
    };
  }

  return {
    ...base,
    packetKind: ACTION_PACKET_KIND.READ_STATUS,
    readOnly: true,
    guardedAction: false,
    blocker: text(input.blocker),
    nextAction: 'Return read-only mission status.',
    handlerIntent: route.handlerIntent,
    finalVerdict: 'OPERATOR_COMMAND_ACTION_STATUS_READY',
  };
}

export function validateOperatorCommandActionPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== OPERATOR_COMMAND_ACTION_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.operator_command_action_lane.packet') errors.push('invalid-kind');
  if (!Object.values(ACTION_PACKET_KIND).includes(packet.packetKind)) errors.push('invalid-packet-kind');
  if (!packet.commandRoute) errors.push('missing-command-route');
  if (!text(packet.currentGoal)) errors.push('missing-current-goal');
  if (!text(packet.proofCommand)) errors.push('missing-proof-command');
  if (!text(packet.nextAction)) errors.push('missing-next-action');
  if (packet.packetKind === ACTION_PACKET_KIND.BLOCKED && !text(packet.blocker)) errors.push('blocked-without-exact-action');
  if (packet.guardedAction === true && packet.readOnly === true) errors.push('guarded-action-marked-readonly');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'OPERATOR_COMMAND_ACTION_PACKET_PASS' : 'OPERATOR_COMMAND_ACTION_PACKET_BLOCKED',
  };
}
