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

test('buildCodexDispatchPacket uses mission repair bridge draft and remains approval gated', () => {
  const packet = buildCodexDispatchPacket({
    missionRepairCodexBridge: {
      codexDispatchPacketDraft: {
        missionTitle: 'Repair copy feedback proof',
        missionClass: 'ui-repair',
        targetSubsystems: ['ui-reality'],
        forbiddenActions: ['Do not bypass operator approval'],
        requiredTests: ['node --test stephanos-ui/src/state/missionRepairCodexBridge.test.mjs'],
        codexPrompt: 'Source/Dist Truth Rules: source is truth; dist is generated output only.',
      },
    },
  });
  assert.equal(packet.status, 'ready-for-approval');
  assert.equal(packet.missionTitle, 'Repair copy feedback proof');
  assert.equal(packet.approvalRequired, true);
  assert.match(packet.codexPrompt, /Source\/Dist Truth Rules/);
});
