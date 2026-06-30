import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_PACKET_KIND,
  buildOperatorCommandActionContract,
  createOperatorCommandActionPacket,
  validateOperatorCommandActionPacket,
} from './operatorCommandActionLaneV1.mjs';

test('contract exposes source-controlled command action lane', () => {
  const contract = buildOperatorCommandActionContract();
  assert.equal(contract.finalVerdict, 'OPERATOR_COMMAND_ACTION_CONTRACT_READY');
  assert.equal(contract.sourceOfTruth, 'sourceControlledCommandsV1');
  assert.equal(contract.supportedCommandIds.includes('ignition'), true);
  assert.equal(contract.supportedCommandIds.includes('recovery'), true);
});

test('status route is read-only and valid', () => {
  const packet = createOperatorCommandActionPacket({ commandText: '/status', currentGoal: '#1285' });
  assert.equal(packet.packetKind, ACTION_PACKET_KIND.READ_STATUS);
  assert.equal(packet.readOnly, true);
  assert.equal(packet.guardedAction, false);
  assert.equal(validateOperatorCommandActionPacket(packet).valid, true);
});

test('help route returns copy-safe command list', () => {
  const packet = createOperatorCommandActionPacket({ commandText: '/help', currentGoal: '#1285' });
  assert.equal(packet.packetKind, ACTION_PACKET_KIND.SHOW_HELP);
  assert.equal(packet.commands.some((command) => command.id === 'help'), true);
  assert.equal(packet.commands.some((command) => command.id === 'legacy-relay'), false);
});

test('start route requires approval before guarded action', () => {
  const blocked = createOperatorCommandActionPacket({ commandText: '/ignite', currentGoal: '#1285' });
  const approved = createOperatorCommandActionPacket({ commandText: '/ignite', operatorApproved: true, currentGoal: '#1285' });
  assert.equal(blocked.packetKind, ACTION_PACKET_KIND.BLOCKED);
  assert.match(blocked.nextAction, /Approve/);
  assert.equal(approved.packetKind, ACTION_PACKET_KIND.START_RUNTIME);
  assert.equal(approved.guardedAction, true);
  assert.equal(validateOperatorCommandActionPacket(approved).valid, true);
});

test('repair route requires approval and carries blocker context', () => {
  const packet = createOperatorCommandActionPacket({
    commandText: '/recover',
    operatorApproved: true,
    currentGoal: '#1285',
    blocker: 'Runtime did not refresh cleanly.',
  });
  assert.equal(packet.packetKind, ACTION_PACKET_KIND.PLAN_REPAIR);
  assert.equal(packet.blocker, 'Runtime did not refresh cleanly.');
  assert.equal(packet.guardedAction, true);
});

test('unknown route blocks with exact action', () => {
  const packet = createOperatorCommandActionPacket({ commandText: '/not-real', currentGoal: '#1285' });
  assert.equal(packet.packetKind, ACTION_PACKET_KIND.BLOCKED);
  assert.match(packet.nextAction, /Unknown command/);
});

test('validator blocks malformed packet', () => {
  const result = validateOperatorCommandActionPacket({
    schemaVersion: 'operator-command-action-lane.v1',
    kind: 'stephanos.operator_command_action_lane.packet',
    packetKind: ACTION_PACKET_KIND.BLOCKED,
    currentGoal: '#1285',
    proofCommand: 'node --test shared/agents/operatorCommandActionLaneV1.test.mjs',
    nextAction: '',
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-command-route'), true);
});
