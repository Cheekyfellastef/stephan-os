import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessWorkspaceBindingV1,
  buildWorkspaceIntegrityMeshV1,
} from './workspaceIntegrityMeshV1.mjs';

const nowMs = Date.parse('2026-10-07T20:00:00.000Z');

test('binding is green only with fresh complete provenance, reconciliation and synthetic proof', () => {
  const result = assessWorkspaceBindingV1({
    workspaceId: 'flywheel',
    componentId: 'seed-card:workspace-integrity-provenance',
    componentKind: 'seed-card',
    sourceId: 'shared-workspace:workspace-integrity-provenance',
    transportId: '/api/shared-workspace/hydrate',
    transformationId: 'seed-garden-projection',
    consumerId: 'flywheel-seed-canopy',
    sourceSchemaVersion: 'seed.v1',
    expectedSchemaVersion: 'seed.v1',
    sourceUnit: 'percent',
    expectedUnit: 'percent',
    sourceState: 'CURRENT',
    observedAtUtc: '2026-10-07T19:59:30.000Z',
    sourceValue: 37,
    renderedValue: 37,
    renderedValueObserved: true,
    consumerRegistered: true,
    syntheticProofCurrent: true,
  }, { nowMs, staleAfterMs: 60_000 });

  assert.equal(result.trafficLight, 'GREEN');
  assert.equal(result.provenEndToEnd, true);
  assert.deepEqual(result.hardFaults, []);
  assert.deepEqual(result.unknowns, []);
});

test('missing rendered-value and synthetic proof stays amber instead of pretending healthy', () => {
  const result = assessWorkspaceBindingV1({
    workspaceId: 'flywheel',
    componentId: 'dataset:dashboard',
    sourceId: 'dashboard',
    transportId: '/api/shared-workspace/hydrate',
    transformationId: 'workspace-hydration-bundle',
    consumerId: 'flywheel',
    sourceSchemaVersion: 'stephanos.backend.shared-workspace-dashboard-feed.v1',
    expectedSchemaVersion: 'stephanos.backend.shared-workspace-dashboard-feed.v1',
    sourceState: 'CURRENT',
    observedAtUtc: '2026-10-07T19:59:30.000Z',
    consumerRegistered: true,
  }, { nowMs, staleAfterMs: 60_000 });

  assert.equal(result.trafficLight, 'AMBER');
  assert.equal(result.provenEndToEnd, false);
  assert.ok(result.unknowns.includes('RENDERED_VALUE_UNOBSERVED'));
  assert.ok(result.unknowns.includes('SYNTHETIC_PROOF_MISSING'));
});

test('schema mismatch, orphan consumer or source-render contradiction is red', () => {
  const result = assessWorkspaceBindingV1({
    workspaceId: 'landing',
    componentId: 'card:goal-count',
    sourceId: 'dashboard',
    transportId: '/api/shared-workspace/hydrate',
    transformationId: 'goal-count',
    consumerId: '',
    sourceSchemaVersion: 'dashboard.v2',
    expectedSchemaVersion: 'dashboard.v1',
    sourceState: 'CURRENT',
    observedAtUtc: '2026-10-07T19:59:30.000Z',
    sourceValue: 51,
    renderedValue: 12,
    renderedValueObserved: true,
    consumerRegistered: false,
    syntheticProofCurrent: true,
  }, { nowMs, staleAfterMs: 60_000 });

  assert.equal(result.trafficLight, 'RED');
  assert.ok(result.hardFaults.includes('ORPHAN_CONSUMER'));
  assert.ok(result.hardFaults.includes('SCHEMA_MISMATCH'));
  assert.ok(result.hardFaults.includes('SOURCE_RENDER_MISMATCH'));
});

test('integrity mesh exposes important sources that have no declared consumer', () => {
  const mesh = buildWorkspaceIntegrityMeshV1({
    nowMs,
    importantSources: ['dashboard', 'vr-playtest'],
    bindings: [{
      workspaceId: 'flywheel',
      componentId: 'dataset:dashboard',
      sourceId: 'dashboard',
      transportId: '/api/shared-workspace/hydrate',
      transformationId: 'workspace-hydration-bundle',
      consumerId: 'flywheel',
      sourceState: 'CURRENT',
      observedAtUtc: '2026-10-07T19:59:30.000Z',
    }],
  });
  assert.deepEqual(mesh.unconsumedImportantSources, ['vr-playtest']);
  assert.equal(mesh.finalVerdict, 'WORKSPACE_INTEGRITY_BROKEN');
});
