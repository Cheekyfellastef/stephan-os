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
