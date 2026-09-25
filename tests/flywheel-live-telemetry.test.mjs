import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFlywheelTelemetryView } from '../shared/runtime/flywheelTelemetryModel.mjs';

test('Flywheel live view projects canonical shared-workspace telemetry', () => {
  const view = deriveFlywheelTelemetryView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'ready',
    reason: 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL',
    livePortfolio: {
      source: 'LIVE_GITHUB',
      githubOpenPrCount: 4,
    },
    projection: {
      goals: [{ issue: '#1' }, { issue: '#2' }, { issue: '#3' }],
      queueDispatcher: {
        dispatcherState: 'RUNNING',
        queueDepth: 2,
        currentJob: '#2 Build live Flywheel telemetry',
        capabilityMode: 'automated_dispatch_supported',
      },
      captainsBridge: {
        buildOrchestration: {
          selectedGoal: '#2 Build live Flywheel telemetry',
          selectedLane: 'lane-3',
          phase: 'BUILDING',
          actor: 'STEPHANOS',
        },
        mergePipeline: {
          prNumber: 2401,
          phase: 'PROVING',
          headSha: '0123456789abcdef0123456789abcdef01234567',
          finalVerdict: 'WAITING_FOR_PROOF',
        },
        runtimeHealth: {
          overallTrafficLight: 'GREEN',
          services: [{ id: 'publisher' }, { id: 'backend' }],
        },
        exactNextAction: 'Keep chewing.',
      },
      openClawCapabilityLadder: {
        canRunNow: ['read-only-proof', 'source-builder'],
        blocked: ['desktop-mutation'],
        needsApproval: ['merge'],
      },
      operatorAttention: {
        blockers: ['PROOF_REQUIRED'],
        exactNextAction: 'Capture focused proof.',
      },
    },
  });

  assert.equal(view.valid, true);
  assert.equal(view.statusLabel, 'LIVE');
  assert.equal(view.metrics.find((metric) => metric.label === 'Goals in Feed')?.value, '3');
  assert.equal(view.metrics.find((metric) => metric.label === 'Queue Depth')?.value, '2');
  assert.equal(view.metrics.find((metric) => metric.label === 'Open PRs')?.value, '4');
  assert.equal(view.stateItems.find((item) => item.id === 'merge-pipeline')?.value, 'PR #2401');
  assert.match(view.stateItems.find((item) => item.id === 'merge-pipeline')?.summary || '', /01234567/);
  assert.equal(view.exactNextAction, 'Capture focused proof.');
});

test('Flywheel live view preserves stale truth instead of calling it live', () => {
  const view = deriveFlywheelTelemetryView({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'stale',
    reason: 'STALE_WORKSPACE_RECORDS',
    projection: {
      goals: [],
      operatorAttention: { blockers: [] },
    },
  });

  assert.equal(view.valid, true);
  assert.equal(view.statusLabel, 'STALE');
  assert.equal(view.feedState, 'stale');
  assert.equal(view.reason, 'STALE_WORKSPACE_RECORDS');
});

test('Flywheel live view rejects missing or malformed feed contracts', () => {
  const view = deriveFlywheelTelemetryView({
    schemaVersion: 'wrong.schema',
    state: 'ready',
    projection: { goals: [] },
  });

  assert.equal(view.valid, false);
  assert.equal(view.statusLabel, 'BACKEND UNREACHABLE');
  assert.match(view.exactNextAction, /Restore the shared workspace telemetry feed/);
});
