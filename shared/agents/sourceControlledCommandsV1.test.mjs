import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMAND_STATE,
  COMMAND_SURFACE,
  buildSourceControlledCommandsContract,
  createCommandRegistry,
  findCommand,
  listSourceControlledCommands,
  routeOperatorCommand,
  validateCommandRegistry,
} from './sourceControlledCommandsV1.mjs';

test('contract exposes required surfaces, states, and commands', () => {
  const contract = buildSourceControlledCommandsContract();
  assert.equal(contract.surfaces.includes(COMMAND_SURFACE.WHATSAPP), true);
  assert.equal(contract.surfaces.includes(COMMAND_SURFACE.COMMAND_DECK), true);
  assert.equal(contract.surfaces.includes(COMMAND_SURFACE.BATTLE_BRIDGE), true);
  assert.equal(contract.states.includes(COMMAND_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION), true);
  assert.deepEqual(contract.requiredCommandIds, ['ignition', 'status', 'recovery', 'help']);
});

test('default registry validates', () => {
  assert.equal(validateCommandRegistry(createCommandRegistry()).valid, true);
});

test('command lookup supports id and alias', () => {
  const registry = createCommandRegistry();
  assert.equal(findCommand(registry, '/status').id, 'status');
  assert.equal(findCommand(registry, 'where-are-we').id, 'status');
});

test('duplicate aliases are rejected', () => {
  const registry = createCommandRegistry([
    { id: 'one', aliases: ['same'], surface: COMMAND_SURFACE.COMMAND_DECK, state: COMMAND_STATE.ENABLED, handlerIntent: 'ONE' },
    { id: 'two', aliases: ['same'], surface: COMMAND_SURFACE.WHATSAPP, state: COMMAND_STATE.ENABLED, handlerIntent: 'TWO' },
  ]);
  assert.equal(validateCommandRegistry(registry).errors.includes('duplicate-alias:same'), true);
});

test('disabled command blocks with exact action', () => {
  const route = routeOperatorCommand({ commandText: 'old-relay' });
  assert.equal(route.state, COMMAND_STATE.DISABLED);
  assert.match(route.exactUnblockAction, /source-controlled ignition/);
});

test('unknown command gives fallback action', () => {
  const route = routeOperatorCommand({ commandText: '/banana' });
  assert.equal(route.state, COMMAND_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.match(route.exactUnblockAction, /Unknown command/);
});

test('mutation command requires approval', () => {
  assert.equal(routeOperatorCommand({ commandText: '/ignite' }).finalVerdict, 'SOURCE_CONTROLLED_COMMAND_APPROVAL_REQUIRED');
  assert.equal(routeOperatorCommand({ commandText: '/ignite', operatorApproved: true }).finalVerdict, 'SOURCE_CONTROLLED_COMMAND_ROUTE_READY');
});

test('command list excludes disabled commands', () => {
  const commands = listSourceControlledCommands(createCommandRegistry());
  assert.equal(commands.some((command) => command.id === 'help'), true);
  assert.equal(commands.some((command) => command.id === 'legacy-relay'), false);
});
