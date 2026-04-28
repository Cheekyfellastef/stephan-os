import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateProjectProgress } from './projectProgressAdjudicator.mjs';
import { createSeedProjectProgressModel } from './projectProgressModel.mjs';

test('adjudicateProjectProgress returns seeded lanes and ranked next actions', () => {
  const projection = adjudicateProjectProgress({ model: createSeedProjectProgressModel() });

  assert.equal(Array.isArray(projection.lanes), true);
  assert.equal(projection.lanes.length >= 10, true);
  assert.equal(projection.nextBestActions[0].id, 'build-agent-task-layer-v1');
  assert.equal(projection.readiness.agent, 'not-started');
  assert.equal(projection.readiness.openClaw, 'blocked');
  assert.equal(projection.verificationStatus.status, 'started');
});

test('adjudicateProjectProgress advances next best action when Agent Task summary indicates canonical model exists', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'needs_adapter',
      openClawReadiness: 'needs_policy',
      nextAgentTaskAction: 'Wire existing Agent Tile to Agent Task projection',
      readinessScore: 52,
      agentTaskLayerBlockers: ['Agent tile is not consuming projection yet.'],
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'upgrade-agents-tile-status-surface');
  assert.equal(projection.readiness.agent, 'in_progress');
  assert.equal(projection.agentTaskEvidence?.nextAgentTaskAction, 'Wire existing Agent Tile to Agent Task projection');
});

test('adjudicateProjectProgress emits doctrine warnings for localhost assumption drift', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    runtimeStatus: { healthy: true },
    finalRouteTruth: { launchable: false, routeKind: 'localhost' },
    orchestrationSelectors: {
      capabilityPosture: {
        localAuthorityAvailable: false,
      },
    },
  });

  assert.equal(projection.doctrineWarnings.length >= 2, true);
  assert.match(projection.doctrineWarnings.join('\n'), /route launchability/i);
});
