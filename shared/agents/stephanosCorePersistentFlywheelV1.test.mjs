import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS,
  projectPersistentFlywheelTrigger,
  summarizeLogicalGoalControllerFabric,
  summarizePersistentFlywheelResult,
  summarizePersistentRefillSweep,
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
  assert.match(source, /projectPersistentFlywheelTrigger/);
  assert.match(source, /lastFlywheelWakeReason = trigger\.reason/);
  assert.match(source, /canonicalSchedulerDelegation: true/);
  assert.match(source, /flywheelSingleFlight: true/);
  assert.match(source, /sourceMutationAllowed: false/);
  assert.match(source, /schedulerAuthority: false/);
  assert.doesNotMatch(source, /spawn\([^\n]*flywheel/i);
});

test('logical goal controllers are first-class persistent Flywheel occupancy evidence', () => {
  const summary = summarizeLogicalGoalControllerFabric({
    authoritativeProjection: {
      logicalGoalControllerFabric: {
        valid: true,
        controllers: [
          { continuityState: 'ACTIVE', selectedForAdmission: true, retired: false },
          { continuityState: 'TRACKING', selectedForAdmission: false, retired: false },
          { continuityState: 'PARKED', selectedForAdmission: false, retired: false },
          { continuityState: 'RETIRED', selectedForAdmission: false, retired: true },
        ],
      },
    },
  }, 15);
  assert.equal(summary.logicalLaneTruth, 'CURRENT');
  assert.equal(summary.logicalControllerCount, 3);
  assert.equal(summary.logicalActiveLaneCount, 1);
  assert.equal(summary.logicalTrackingLaneCount, 1);
  assert.equal(summary.logicalParkedLaneCount, 1);
  assert.equal(summary.logicalSelectedForAdmissionCount, 1);
  assert.equal(summary.logicalLaneDeficitToTarget, 14);
});

test('persistent refill summary preserves work-conserving evidence without raw blocker bodies', () => {
  const summary = summarizePersistentRefillSweep({
    ok: true,
    materialActionsSucceeded: 4,
    sweepAttemptCount: 7,
    cycleDecision: { safeEligibleWorkRemaining: 2, provenSafeFreeLanes: 3 },
    parkedLaneBlockers: ['lane-a:blocker'],
    workConservingSweepExhausted: true,
    finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_WORK_CONSERVING_SWEEP_EXHAUSTED',
  });
  assert.equal(summary.refillMaterialActionsSucceeded, 4);
  assert.equal(summary.refillSweepAttemptCount, 7);
  assert.equal(summary.refillSafeEligibleWorkRemaining, 2);
  assert.equal(summary.refillProvenSafeFreeLanes, 3);
  assert.equal(summary.refillParkedLaneCount, 1);
  assert.equal(Object.hasOwn(summary, 'parkedLaneBlockers'), false);
});

test('Core daemon reuses canonical work-conserving refill up to the 15-lane target', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /TARGET_MATERIAL_LANES = 15/);
  assert.match(source, /maxWorkConservingAttempts: TARGET_MATERIAL_LANES/);
  assert.match(source, /summarizeLogicalGoalControllerFabric/);
});

test('persistent refill stays behind the existing gaming-protected posture', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /PERSISTENT_FLYWHEEL_GAMING_PROTECTED/);
  assert.match(source, /maybeStartPersistentFlywheel\(sourceHead, state\.gamingActive\)/);
});
