import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_METER_VISIBILITY_STATE,
  buildCodexCapacityDashboardProjection,
} from './codexCapacityDashboardProjection.mjs';
import { CODEX_AVAILABILITY, CODEX_TASK_CLASS, createMeterObservation } from './codexCapacityGovernorV1.mjs';

const NOW = '2026-07-17T12:00:00.000Z';

test('dashboard shows capacity, banked reset expiry, route, and stack velocity', () => {
  const dashboard = buildCodexCapacityDashboardProjection({
    nowUtc: NOW,
    observation: createMeterObservation({
      observedAtUtc: NOW,
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      confidence: 'high',
      naturalResetAtUtc: '2026-07-20T20:25:00.000Z',
      bankedResets: [
        { resetId: 'reset-2', expiresAtUtc: '2026-07-25T12:00:00.000Z' },
        { resetId: 'reset-1', expiresAtUtc: '2026-07-18T12:00:00.000Z' },
        { resetId: 'reset-4', expiresAtUtc: '2026-07-30T12:00:00.000Z' },
        { resetId: 'reset-3', expiresAtUtc: '2026-07-27T12:00:00.000Z' },
      ],
      source: 'battle-bridge-authenticated-codex-ui',
    }),
    tasks: [{ taskId: 'task-large', taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION }],
    standingOperatorPolicyActive: true,
    stackVelocity: { verifiedCapabilitySlices: 8, elapsedDays: 28, codexContributionFraction: 0.25, primaryConstraint: 'meter capacity' },
  });
  assert.equal(dashboard.readOnly, true);
  assert.equal(dashboard.meter.visibilityState, CODEX_METER_VISIBILITY_STATE.DIRECT);
  assert.equal(dashboard.meter.remainingPercent, 0);
  assert.equal(dashboard.bankedResets.count, 4);
  assert.equal(dashboard.bankedResets.nextResetId, 'reset-1');
  assert.equal(dashboard.bankedResets.actionReady, true);
  assert.equal(dashboard.forecast.dispatchAllowed, false);
  assert.equal(dashboard.stackVelocity.currentSlicesPerWeek, 2);
  assert.match(dashboard.summary, /earliest-expiring banked reset/i);
});

test('dashboard next reset excludes expired observations and matches the prepared action', () => {
  const dashboard = buildCodexCapacityDashboardProjection({
    nowUtc: NOW,
    observation: createMeterObservation({
      observedAtUtc: NOW,
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      confidence: 'high',
      naturalResetAtUtc: '2026-07-20T20:25:00.000Z',
      bankedResets: [
        { resetId: 'reset-expired', expiresAtUtc: '2026-07-17T11:00:00.000Z' },
        { resetId: 'reset-live', expiresAtUtc: '2026-07-18T12:00:00.000Z' },
      ],
      source: 'battle-bridge-authenticated-codex-ui',
    }),
    tasks: [{ taskId: 'task-large', taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION }],
    standingOperatorPolicyActive: true,
  });
  assert.equal(dashboard.bankedResets.count, 2);
  assert.equal(dashboard.bankedResets.nextResetId, 'reset-live');
  assert.equal(dashboard.bankedResets.nextExpiryUtc, '2026-07-18T12:00:00.000Z');
  assert.equal(dashboard.bankedResets.actionReady, true);
  assert.match(dashboard.summary, /reset-live/);
});

test('dashboard preserves an unobserved meter as unknown instead of painting zero percent', () => {
  const dashboard = buildCodexCapacityDashboardProjection({
    nowUtc: NOW,
    observation: createMeterObservation({
      observedAtUtc: NOW,
      source: 'codex-status-reader-blocked',
    }),
    tasks: [{ taskId: 'task-large', taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION }],
  });

  assert.equal(dashboard.meter.visibilityState, CODEX_METER_VISIBILITY_STATE.UNKNOWN);
  assert.equal(dashboard.meter.remainingPercent, null);
  assert.equal(dashboard.meter.safelySchedulablePercent, null);
  assert.equal(dashboard.forecast.shortfallPercent, null);
  assert.equal(dashboard.meter.remainingPercentObserved, false);
  assert.equal(dashboard.meter.availabilityObserved, false);
  assert.equal(dashboard.forecast.dispatchAllowed, false);
  assert.match(dashboard.summary, /No remaining percentage is claimed/i);
});

test('dashboard labels complete but stale evidence as stale and blocks dispatch', () => {
  const dashboard = buildCodexCapacityDashboardProjection({
    nowUtc: NOW,
    observation: createMeterObservation({
      observedAtUtc: '2026-07-17T11:30:00.000Z',
      remainingPercent: 80,
      availability: CODEX_AVAILABILITY.AVAILABLE,
      confidence: 'high',
      source: 'battle-bridge-authenticated-codex-ui',
    }),
    tasks: [{ taskId: 'task-large', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
  });

  assert.equal(dashboard.meter.visibilityState, CODEX_METER_VISIBILITY_STATE.STALE);
  assert.equal(dashboard.meter.remainingPercent, 80);
  assert.equal(dashboard.meter.trusted, false);
  assert.equal(dashboard.forecast.dispatchAllowed, false);
  assert.match(dashboard.summary, /stale/i);
});

test('dashboard labels medium-confidence or estimated complete evidence as inferred', () => {
  const dashboard = buildCodexCapacityDashboardProjection({
    nowUtc: NOW,
    observation: createMeterObservation({
      observedAtUtc: NOW,
      remainingPercent: 65,
      availability: CODEX_AVAILABILITY.AVAILABLE,
      confidence: 'medium',
      source: 'inferred-from-dispatch-receipts',
    }),
    tasks: [{ taskId: 'task-large', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
  });

  assert.equal(dashboard.meter.visibilityState, CODEX_METER_VISIBILITY_STATE.INFERRED);
  assert.equal(dashboard.meter.remainingPercent, 65);
  assert.equal(dashboard.meter.source, 'inferred-from-dispatch-receipts');
  assert.match(dashboard.summary, /inferred rather than high-confidence direct truth/i);
});
