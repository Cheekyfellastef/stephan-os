import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStephanosIntegrationSpine } from './integrationSpineModel.js';

test('integration spine is read-only projection of existing models and keeps subsystem references', () => {
  const operatorRelief = { status: 'needs-verify', nextBestAction: { label: 'Run stephanos verify' }, evidenceGaps: [{ label: 'Verify evidence missing' }] };
  const routeAdjudicator = { launchState: 'blocked', blockedReason: 'route unreachable', suggestedAction: 'repair route', confidence: 'low' };
  const supportSnapshot = { routeStatus: 'degraded' };

  const projection = buildStephanosIntegrationSpine({ operatorRelief, routeAdjudicator, supportSnapshot, telemetry: { streams: ['runtime'] } });

  assert.equal(projection.readonly, true);
  assert.equal(projection.version, 'integration-spine.v1.readonly');
  assert.equal(projection.levels.captainView.activeMissionState, 'needs-verify');
  assert.equal(projection.levels.captainView.nextBestAction, 'Run stephanos verify');
  assert.equal(projection.levels.captainView.majorBlockers[0], 'Verify evidence missing');
  assert.equal(projection.levels.subsystemView.operatorRelief, operatorRelief);
  assert.equal(projection.levels.subsystemView.routeAdjudicator, routeAdjudicator);
  assert.deepEqual(projection.levels.engineeringView.telemetryStreams, ['runtime']);
});

test('integration spine department runtime summary derives from adjudicator/support truth without authority mutation', () => {
  const projection = buildStephanosIntegrationSpine({
    routeAdjudicator: { launchState: 'ready', blockedReason: 'none', suggestedAction: 'continue' },
    supportSnapshot: { routeStatus: 'healthy', operatorBoundary: { operatorBoundaryAlert: 'none' } },
    runtimeStatus: { routeStatus: 'healthy' },
  });

  const runtime = projection.levels.departmentView.find((d) => d.id === 'runtime');
  assert.equal(runtime.summary, 'ready');
  assert.equal(runtime.nextAction, 'continue');
  assert.equal(runtime.evidence[0].systemId, 'runtimeAdjudicator');
  assert.equal(runtime.evidence[0].authority, 'read-only projection');
});
