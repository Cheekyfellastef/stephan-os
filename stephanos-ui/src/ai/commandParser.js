import { COMMAND_TYPE } from './aiTypes';

const knownCommands = new Set([
  'help',
  'status',
  'memory',
  'agents',
  'clear',
  'simulate',
  'kg',
  'vrlab',
]);

export function parseCommand(input = '') {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: COMMAND_TYPE.NATURAL, name: null, args: [] };
  }

  if (trimmed.startsWith('/')) {
    const [nameRaw, ...args] = trimmed.slice(1).split(' ');
    const name = nameRaw?.toLowerCase();
    return {
      type: COMMAND_TYPE.SLASH,
      name,
      args,
      recognized: knownCommands.has(name),
    };
  }

  if (trimmed.startsWith('::') || trimmed.startsWith('sys:')) {
    return {
      type: COMMAND_TYPE.SYSTEM,
      name: 'system',
      args: [trimmed],
      recognized: true,
    };
  }

  return { type: COMMAND_TYPE.NATURAL, name: null, args: [], recognized: true };
}

export function getLocalCommandResponse(parsed) {
  if (parsed.type !== COMMAND_TYPE.SLASH) return null;

  switch (parsed.name) {
    case 'help':
      return 'Commands: /help /status /memory /agents /clear /simulate /kg /vrlab';
    case 'memory':
      return 'Memory subsystem is currently in stub mode (in-memory store).';
    case 'simulate':
      return 'Simulation subsystem is planned. Current mode: placeholder route.';
    case 'kg':
      return 'Knowledge graph tools are planned and currently mocked.';
    case 'vrlab':
      return 'VR Lab integration is planned and currently mocked.';
    default:
      return null;
  }
}
