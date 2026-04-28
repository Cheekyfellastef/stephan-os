import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentTaskProjection } from './agentTaskProjection.mjs';

test('agent task projection defaults codex to manual handoff and openclaw to needs_policy', () => {
  const projection = buildAgentTaskProjection();
  assert.equal(projection.operatorSurface.codexReadiness, 'manual_handoff_only');
  assert.equal(projection.operatorSurface.openClawReadiness, 'needs_policy');
  assert.equal(projection.compactSurface.agentTaskLayerStatus, 'preparing');
  assert.equal(typeof projection.readinessSummary.readinessScore, 'number');
});

test('agent task projection exposes readiness summary payload for mission dashboard consumption', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskLifecycle: { state: 'in_progress' },
      agentReadiness: {
        stephanos: 'ready',
        codex: 'ready',
        openclaw: 'blocked',
        manual: 'available',
      },
      approvalGates: {
        required: ['approve_scope', 'approve_handoff'],
        approved: ['approve_scope'],
      },
      handoff: {
        handoffReady: false,
        handoffMode: 'manual_prompt',
        handoffBlockers: ['Waiting for approve_handoff.'],
      },
    },
  });

  assert.equal(projection.readinessSummary.agentTaskLayerStatus, 'in_progress');
  assert.equal(projection.readinessSummary.codexReadiness, 'ready');
  assert.equal(projection.readinessSummary.openClawReadiness, 'blocked');
  assert.equal(projection.readinessSummary.nextAgentTaskAction.length > 0, true);
  assert.equal(projection.readinessSummary.agentTaskLayerBlockers.length > 0, true);
});

test('agent task projection exposes codex manual handoff packet summary and packet text', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskIdentity: {
        title: 'Manual handoff',
        operatorIntent: 'Prepare Codex packet.',
      },
      taskLifecycle: { state: 'in_progress' },
      approvalGates: {
        required: ['approve_scope', 'approve_handoff'],
        approved: ['approve_scope', 'approve_handoff'],
      },
      handoff: {
        handoffReady: true,
        handoffTarget: 'codex',
        handoffMode: 'manual_prompt',
      },
    },
  });

  assert.equal(projection.operatorSurface.codexHandoffPacketMode, 'manual_prompt');
  assert.equal(projection.operatorSurface.codexHandoffPacketReady, true);
  assert.match(projection.operatorSurface.codexHandoffPacketSummary, /ready/i);
  assert.match(projection.operatorSurface.codexHandoffPacketText, /Codex Manual Handoff Packet \(v1\)/i);
  assert.equal(projection.readinessSummary.codexManualHandoffReady, true);
});
