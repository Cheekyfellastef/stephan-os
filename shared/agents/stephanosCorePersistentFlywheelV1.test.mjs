import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS,
  projectPersistentFlywheelTrigger,
  summarizePersistentFlywheelResult,
} from './stephanosCorePersistentFlywheelV1.mjs';

test('persistent Flywheel wakes on durable state change', () => {
  const projected = projectPersistentFlywheelTrigger({
    nowMs: 10_000,
    lastCycleAtMs: 9_000,
    eventFingerprint: 'worker:running',
    lastEventFingerprint: 'worker:idle',
    cycleRunning: false,
  });
  assert.equal(projected.shouldRun, true);
  assert.equal(projected.reason, 'PERSISTENT_FLYWHEEL_DURABLE_STATE_CHANGED');
});

test('persistent Flywheel has a bounded fallback reconciliation', () => {
  const projected = projectPersistentFlywheelTrigger({
    nowMs: DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS + 1,
    lastCycleAtMs: 0,
    eventFingerprint: 'stable',
    lastEventFingerprint: 'stable',
    cycleRunning: false,
  });
  assert.equal(projected.shouldRun, true);
  assert.equal(projected.reason, 'PERSISTENT_FLYWHEEL_FALLBACK_RECONCILIATION_DUE');
});

test('persistent Flywheel is single-flight', () => {
  const projected = projectPersistentFlywheelTrigger({
    nowMs: 120_000,
    lastCycleAtMs: 0,
    eventFingerprint: 'new',
    lastEventFingerprint: 'old',
    cycleRunning: true,
  });
  assert.equal(projected.shouldRun, false);
  assert.equal(projected.reason, 'PERSISTENT_FLYWHEEL_SINGLE_FLIGHT_ACTIVE');
});

test('Flywheel status summary stays bounded and does not expose blocker bodies', () => {
  const summary = summarizePersistentFlywheelResult({
    status: 'ACTIVE',
    action: 'ADVANCE_ACTIVE_LANE',
    blockers: ['secret-looking blocker text'],
    allowWorkerTick: true,
    boundedMutationSteps: 1,
    sourceRevision: 'a'.repeat(40),
  });
  assert.equal(summary.blockerCount, 1);
  assert.equal(Object.hasOwn(summary, 'blockers'), false);
  assert.equal(summary.safeSummaryOnly, true);
});

test('Core daemon embeds the canonical Flywheel instead of a second scheduler process', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /runDurableFlywheelStartupCycle/);
  assert.match(source, /PERSISTENT_FLYWHEEL_DURABLE_STATE_CHANGED/);
  assert.match(source, /canonicalSchedulerDelegation: true/);
  assert.match(source, /flywheelSingleFlight: true/);
  assert.match(source, /sourceMutationAllowed: false/);
  assert.match(source, /schedulerAuthority: false/);
  assert.doesNotMatch(source, /spawn\([^\n]*flywheel/i);
});
