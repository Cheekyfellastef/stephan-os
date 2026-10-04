import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS,
  DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS,
  projectOctopusSelfHealDecision,
  projectPersistentFlywheelTrigger,
  summarizeLogicalGoalControllerFabric,
  summarizeOctopusBuildProductivity,
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

test('Octopus self-heal decision fires only for unhealthy build truth and respects cooldown', () => {
  const unhealthy = projectOctopusSelfHealDecision(
    { octopusNeedsRepair: true },
    { nowMs: 1_000, lastAttemptAtMs: null },
  );
  assert.equal(unhealthy.shouldRepair, true);
  assert.equal(unhealthy.reason, 'OCTOPUS_SELF_HEAL_REQUIRED');

  const coolingDown = projectOctopusSelfHealDecision(
    { octopusNeedsRepair: true },
    {
      nowMs: 600_000,
      lastAttemptAtMs: 600_000 - DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS + 1,
    },
  );
  assert.equal(coolingDown.shouldRepair, false);
  assert.equal(coolingDown.reason, 'OCTOPUS_SELF_HEAL_COOLDOWN_ACTIVE');
  assert.ok(coolingDown.retryAfterMs > 0);

  const healthy = projectOctopusSelfHealDecision(
    { octopusNeedsRepair: false },
    { nowMs: 600_000, lastAttemptAtMs: null },
  );
  assert.equal(healthy.shouldRepair, false);
  assert.equal(healthy.reason, 'OCTOPUS_SELF_HEAL_NOT_REQUIRED');
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

test('Octopus productivity exposes material build truth and detects unused capacity', () => {
  const building = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 3,
    refillSweepAttemptCount: 5,
    refillSafeEligibleWorkRemaining: 2,
    refillProvenSafeFreeLanes: 4,
    refillNoRunnableSourceWorkProven: false,
    refillWorkConservingSweepExhausted: false,
    refillParkedLaneCount: 0,
  }, { lastMaterialBuildAtUtc: '2026-10-03T21:45:00.000Z' });
  assert.equal(building.octopusBuildVerdict, 'BUILDING');
  assert.equal(building.octopusNeedsRepair, false);
  assert.equal(building.octopusMaterialActionsLastCycle, 3);
  assert.equal(building.octopusLastMaterialBuildAtUtc, '2026-10-03T21:45:00.000Z');

  const stalled = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 0,
    refillSweepAttemptCount: 15,
    refillSafeEligibleWorkRemaining: 3,
    refillProvenSafeFreeLanes: 5,
    refillNoRunnableSourceWorkProven: false,
    refillWorkConservingSweepExhausted: true,
    refillParkedLaneCount: 0,
  });
  assert.equal(stalled.octopusBuildVerdict, 'STALLED_WITH_CAPACITY');
  assert.equal(stalled.octopusBuildStallDetected, true);
  assert.equal(stalled.octopusNeedsRepair, true);

  const idle = summarizeOctopusBuildProductivity({
    refillStatus: 'READY',
    refillMaterialActionsSucceeded: 0,
    refillSweepAttemptCount: 1,
    refillSafeEligibleWorkRemaining: 0,
    refillProvenSafeFreeLanes: 0,
    refillNoRunnableSourceWorkProven: true,
    refillWorkConservingSweepExhausted: false,
    refillParkedLaneCount: 0,
  });
  assert.equal(idle.octopusBuildVerdict, 'IDLE_PROVEN');
  assert.equal(idle.octopusNeedsRepair, false);
});

test('Core daemon reuses canonical work-conserving refill up to the 15-lane target', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /TARGET_MATERIAL_LANES = 15/);
  assert.match(source, /maxWorkConservingAttempts: TARGET_MATERIAL_LANES/);
  assert.match(source, /summarizeLogicalGoalControllerFabric/);
});

test('Core daemon runs Octopus material refill before Flywheel reconciliation and isolates failures', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  const refillIndex = source.indexOf('const refill = await runBattleBridgeGoalDiscoveryHeartbeat');
  const flywheelIndex = source.indexOf('const result = await runDurableFlywheelStartupCycle');
  assert.ok(refillIndex >= 0);
  assert.ok(flywheelIndex >= 0);
  assert.ok(refillIndex < flywheelIndex, 'Octopus refill must run before Flywheel reconciliation');
  assert.match(source, /lastRefillError = ''/);
  assert.match(source, /OCTOPUS_REFILL_CYCLE_FAILED/);
  assert.match(source, /summarizeOctopusBuildProductivity/);
  assert.match(source, /octopusLastError/);
});

test('Core daemon consumes Octopus repair truth through bounded Sovereign recovery and verifies refill', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /lastOctopusBuildSummary\.octopusNeedsRepair/);
  assert.match(source, /projectOctopusSelfHealDecision/);
  assert.match(source, /OCTOPUS_SELF_HEAL_ACTION_ID = 'repair-goal-builder-flow'/);
  assert.match(source, /SOVEREIGN_COMMANDER_OPERATION\.MAINTENANCE_ACTION/);
  assert.match(source, /executeSovereignCommanderCommandV1/);
  assert.match(source, /await maybeSelfHealOctopus\(sourceHead\)/);
  assert.match(source, /A thrown refill and a truthfully stalled refill are both repair/);
  assert.match(source, /const verificationRefill = await runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /OCTOPUS_SELF_HEAL_VERIFIED_RECOVERED/);
  assert.match(source, /OCTOPUS_SELF_HEAL_COOLDOWN_MS/);
  assert.doesNotMatch(source, /DESKTOP_COMMANDER.*octopus/i);
});

test('persistent refill stays behind the existing gaming-protected posture', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /PERSISTENT_FLYWHEEL_GAMING_PROTECTED/);
  assert.match(source, /maybeStartPersistentFlywheel\(sourceHead, state\.gamingActive\)/);
});


test('Core daemon breaks the Commander repair circular dependency and publishes wake truth', async () => {
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /ensureSovereignCommanderRuntime/);
  assert.match(source, /maybeRepairCoreDependencies/);
  assert.match(source, /BATTLE_BRIDGE_SELF_HEAL_ACTION_ID = 'repair-battle-bridge'/);
  assert.match(source, /CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED/);
  assert.match(source, /projectStephanosControlPlaneSpine/);
  assert.match(source, /controlPlane\.wakeState/);
  assert.match(source, /dependencySelfHealEnabled: true/);
});
