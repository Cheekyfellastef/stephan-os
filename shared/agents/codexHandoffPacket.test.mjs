import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCodexHandoffPacket } from './codexHandoffPacket.mjs';

test('buildCodexHandoffPacket returns manual prompt packet with expected doctrine and safety fields', () => {
  const packet = buildCodexHandoffPacket({
    model: {
      taskIdentity: {
        title: 'Codex packet rollout',
        operatorIntent: 'Ship supervised handoff packet mode.',
        taskType: 'feature',
        targetArea: 'agent-layer',
      },
      approvalGates: {
        required: ['approve_scope', 'approve_handoff'],
        approved: ['approve_scope', 'approve_handoff'],
      },
      taskConstraints: {
        allowedFiles: ['shared/agents/agentTaskProjection.mjs'],
        blockedFiles: ['apps/stephanos/dist/**'],
        requiredChecks: ['npm run stephanos:build', 'npm run stephanos:verify'],
      },
      handoff: {
        handoffTarget: 'codex',
        handoffMode: 'manual_prompt',
      },
    },
  });

  assert.equal(packet.mode, 'manual_prompt');
  assert.equal(packet.ready, true);
  assert.match(packet.packetText, /Do not commit secrets/i);
  assert.match(packet.packetText, /Do not bypass Stephanos doctrine/i);
  assert.match(packet.packetText, /Expected report format/i);
});

test('buildCodexHandoffPacket reports blockers when approvals are pending', () => {
  const packet = buildCodexHandoffPacket({
    model: {
      taskIdentity: {
        title: 'Blocked packet',
        operatorIntent: 'Wait for approvals.',
      },
      handoff: {
        handoffTarget: 'codex',
        handoffMode: 'manual_prompt',
      },
    },
    approvalPending: ['approve_handoff'],
  });

  assert.equal(packet.ready, false);
  assert.match(packet.packetSummary, /blocked/i);
  assert.match(packet.packetSummary, /approve_handoff/i);
  assert.equal(packet.nextActionLabel, 'Complete task scope first');
});
