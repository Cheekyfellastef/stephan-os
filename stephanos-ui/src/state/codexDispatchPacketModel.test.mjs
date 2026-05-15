import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexDispatchPacket } from './codexDispatchPacketModel.js';

test('buildCodexDispatchPacket creates approval-gated packet with canon/tests/proof', () => {
  const packet = buildCodexDispatchPacket({ operatorMessage: 'get codex to fix this ui pane', operatorIntent: 'codex-dispatch', chatContextPack: { affectedSubsystems: ['ui'], relevantCanon: [{ text: 'dist is never source of truth' }] } });
  assert.equal(packet.version, 'codex-dispatch-packet.v1');
  assert.equal(packet.approvalRequired, true);
  assert.equal(packet.status, 'ready-for-approval');
  assert.ok(packet.requiredTests.length > 0);
  assert.ok(packet.canonRules.join(' ').includes('dist is never source of truth'));
  assert.equal(packet.browserProofRequired, true);
});
