import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexCapacityDashboardProjection } from './codexCapacityDashboardProjection.mjs';
import { CODEX_AVAILABILITY, CODEX_TASK_CLASS, createMeterObservation } from './codexCapacityGovernorV1.mjs';

test('dashboard shows capacity, banked reset expiry, route, and stack velocity', () => {
  const dashboard = buildCodexCapacityDashboardProjection({
    nowUtc: '2026-07-17T12:00:00.000Z',
    observation: createMeterObservation({
      observedAtUtc: '2026-07-17T12:00:00.000Z',
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
    }),
    tasks: [{ taskId: 'task-large', taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION }],
    standingOperatorPolicyActive: true,
    stackVelocity: { verifiedCapabilitySlices: 8, elapsedDays: 28, codexContributionFraction: 0.25, primaryConstraint: 'meter capacity' },
  });
  assert.equal(dashboard.readOnly, true);
  assert.equal(dashboard.bankedResets.count, 4);
  assert.equal(dashboard.bankedResets.nextResetId, 'reset-1');
  assert.equal(dashboard.bankedResets.actionReady, true);
  assert.equal(dashboard.forecast.dispatchAllowed, false);
  assert.equal(dashboard.stackVelocity.currentSlicesPerWeek, 2);
  assert.match(dashboard.summary, /earliest-expiring banked reset/i);
});
