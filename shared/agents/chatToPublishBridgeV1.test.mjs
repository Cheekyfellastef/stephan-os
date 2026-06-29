import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PACKET_STATUS,
  buildChatToPublishBridgeContract,
  createBattleBridgePublishCommand,
  createChatToPublishCompletion,
  createChatToPublishPacket,
  validateChatToPublishPacket,
} from './chatToPublishBridgeV1.mjs';

test('contract exposes packet statuses and completion rule', () => {
  const contract = buildChatToPublishBridgeContract();

  assert.equal(contract.finalVerdict, 'CHAT_TO_PUBLISH_BRIDGE_CONTRACT_READY');
  assert.equal(contract.packetStatuses.includes('READY_FOR_PUBLISH_LANE'), true);
  assert.equal(contract.completionRule.includes('merge evidence'), true);
});

test('valid packet is ready for publish lane', () => {
  const packet = createChatToPublishPacket({
    goalId: '#1315',
    branch: 'feature/chat-to-publish-bridge-v1',
    proofCommand: 'node --test shared/agents/chatToPublishBridgeV1.test.mjs',
    sourceFiles: [
      { path: 'shared/agents/chatToPublishBridgeV1.mjs', content: 'export const ok = true;' },
      { path: 'shared/agents/chatToPublishBridgeV1.test.mjs', content: 'import test from \'node:test\';' },
    ],
  });

  const validation = validateChatToPublishPacket(packet);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, PACKET_STATUS.READY_FOR_PUBLISH_LANE);
  assert.equal(packet.exactHeadMergeRequired, true);
  assert.equal(packet.approvalGated, true);
});

test('packet rejects forbidden runtime scope', () => {
  const packet = createChatToPublishPacket({
    goalId: '#1315',
    proofCommand: 'node --test shared/agents/chatToPublishBridgeV1.test.mjs',
    sourceFiles: [
      { path: 'runtime/generated.js', content: 'nope' },
    ],
  });

  const validation = validateChatToPublishPacket(packet);

  assert.equal(validation.valid, false);
  assert.equal(validation.status, PACKET_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(validation.errors.some((error) => error.includes('runtime')), true);
});

test('packet rejects missing proof and unsafe approval flags', () => {
  const packet = createChatToPublishPacket({
    goalId: '#1315',
    exactHeadMergeRequired: false,
    approvalGated: false,
    sourceFiles: [
      { path: 'shared/agents/chatToPublishBridgeV1.mjs', content: 'export const ok = true;' },
    ],
  });

  const validation = validateChatToPublishPacket(packet);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('missing-proof-command'), true);
  assert.equal(validation.errors.includes('exact-head-merge-required'), true);
  assert.equal(validation.errors.includes('approval-gated-required'), true);
});

test('battle bridge command is deterministic for valid packet', () => {
  const packet = createChatToPublishPacket({
    goalId: '#1315',
    proofCommand: 'node --test shared/agents/chatToPublishBridgeV1.test.mjs',
    sourceFiles: [
      { path: 'shared/agents/chatToPublishBridgeV1.mjs', content: 'export const ok = true;' },
    ],
  });

  const command = createBattleBridgePublishCommand(packet);

  assert.equal(command.status, PACKET_STATUS.READY_FOR_PUBLISH_LANE);
  assert.equal(command.finalVerdict, 'CHAT_TO_PUBLISH_COMMAND_READY');
  assert.equal(command.command, 'npm run stephanos:publish-merge -- --packet tmp/chat-publish/1315.json');
});

test('battle bridge command blocks invalid packet', () => {
  const command = createBattleBridgePublishCommand(createChatToPublishPacket({ goalId: '#1315' }));

  assert.equal(command.status, PACKET_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(command.command, '');
  assert.equal(command.validation.valid, false);
});

test('completion requires PR, head sha, merge sha, and proof pass', () => {
  const blocked = createChatToPublishCompletion({ goalId: '#1315', prNumber: '1318', proofPassed: true });
  const done = createChatToPublishCompletion({
    goalId: '#1315',
    prNumber: '1318',
    headSha: 'abc123',
    mergeSha: 'def456',
    proofCommand: 'node --test shared/agents/chatToPublishBridgeV1.test.mjs',
    proofPassed: true,
  });

  assert.equal(blocked.finalVerdict, 'CHAT_TO_PUBLISH_COMPLETION_BLOCKED');
  assert.equal(done.status, 'DONE');
  assert.equal(done.finalVerdict, 'CHAT_TO_PUBLISH_COMPLETION_DONE');
});
