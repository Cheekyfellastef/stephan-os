import assert from 'node:assert/strict';
import test from 'node:test';

import { projectStephanosControlPlaneSpine } from './stephanosControlPlaneSpineV1.mjs';

const healthyCore = Object.freeze({
  sourceHead: 'a'.repeat(40),
  readiness: 'READY',
  sovereignCommanderHealthy: true,
  backendHealthy: true,
  missionWorkerHealthy: true,
});

test('control-plane spine stays bootstrapping until one autonomous cycle completes', () => {
  const projected = projectStephanosControlPlaneSpine({
    coreState: healthyCore,
    flywheelStatus: {
      flywheelCycleRunning: true,
      flywheelLastCycleFinishedAtUtc: '',
      refillStatus: 'READY',
      octopusBuildVerdict: 'BUILDING',
    },
  });
  assert.equal(projected.wakeState, 'BOOTSTRAPPING');
  assert.equal(projected.awake, false);
  assert.equal(projected.controlPlaneFinalVerdict, 'STEPHANOS_CONTROL_PLANE_BOOTSTRAPPING');
});

test('control-plane spine only declares AWAKE with healthy dependencies and completed autonomous work', () => {
  const projected = projectStephanosControlPlaneSpine({
    coreState: healthyCore,
    flywheelStatus: {
      flywheelCycleRunning: false,
      flywheelLastCycleFinishedAtUtc: '2026-10-04T10:30:00.000Z',
      refillStatus: 'READY',
      refillMaterialActionsSucceeded: 2,
      refillSafeEligibleWorkRemaining: 1,
      refillProvenSafeFreeLanes: 3,
      octopusBuildVerdict: 'BUILDING',
      octopusNeedsRepair: false,
    },
  });
  assert.equal(projected.wakeState, 'AWAKE');
  assert.equal(projected.awake, true);
  assert.equal(projected.repairRequired, false);
});

test('control-plane spine degrades instead of narrating when a core dependency is unhealthy', () => {
  const projected = projectStephanosControlPlaneSpine({
    coreState: { ...healthyCore, readiness: 'DEGRADED', sovereignCommanderHealthy: false },
    flywheelStatus: {
      flywheelLastCycleFinishedAtUtc: '2026-10-04T10:30:00.000Z',
      refillStatus: 'READY',
      octopusBuildVerdict: 'IDLE_PROVEN',
    },
  });
  assert.equal(projected.wakeState, 'DEGRADED');
  assert.equal(projected.repairRequired, true);
  assert.equal(projected.repairReason, 'SOVEREIGN_COMMANDER_UNHEALTHY');
});

test('control-plane spine treats eligible work plus free lanes without material action as repair debt', () => {
  const projected = projectStephanosControlPlaneSpine({
    coreState: healthyCore,
    flywheelStatus: {
      flywheelLastCycleFinishedAtUtc: '2026-10-04T10:30:00.000Z',
      refillStatus: 'READY',
      refillMaterialActionsSucceeded: 0,
      refillSafeEligibleWorkRemaining: 4,
      refillProvenSafeFreeLanes: 6,
      octopusBuildVerdict: 'STALLED_WITH_CAPACITY',
      octopusNeedsRepair: true,
    },
  });
  assert.equal(projected.wakeState, 'DEGRADED');
  assert.equal(projected.strandedCapacity, true);
  assert.equal(projected.repairRequired, true);
});


test('control-plane spine reports DEGRADED immediately when startup dependencies are unhealthy', () => {
  const projected = projectStephanosControlPlaneSpine({
    coreState: {
      ...healthyCore,
      readiness: 'DEGRADED',
      backendHealthy: false,
    },
    flywheelStatus: {
      flywheelCycleRunning: false,
      flywheelLastCycleFinishedAtUtc: '',
      refillStatus: 'NOT_RUN',
      octopusBuildVerdict: 'WAITING',
    },
  });
  assert.equal(projected.wakeState, 'DEGRADED');
  assert.equal(projected.awake, false);
  assert.equal(projected.repairReason, 'BACKEND_8787_UNHEALTHY');
  assert.equal(projected.controlPlaneFinalVerdict, 'STEPHANOS_CONTROL_PLANE_REPAIR_REQUIRED');
});


test('proven no-work exact-grant wait is not falsely sent to self-repair', () => {
  const flywheelStatus = {
    flywheelLastCycleFinishedAtUtc: '2026-10-09T09:55:45.921Z',
    flywheelLastStatus: 'HOLD', flywheelLastBlockerCount: 1,
    flywheelLastIdleGrantWait: true, flywheelLastError: '',
    refillStatus: 'READY', refillNoRunnableSourceWorkProven: true,
    refillSafeEligibleWorkRemaining: 0, refillProvenSafeFreeLanes: 0,
    octopusBuildVerdict: 'IDLE_PROVEN', octopusNeedsRepair: false,
  };
  const idle = projectStephanosControlPlaneSpine({ coreState: healthyCore, flywheelStatus });
  assert.equal(idle.idleGrantWaitProven, true);
  assert.equal(idle.flywheelReconciliationBlocked, false);
  assert.equal(idle.repairRequired, false);
  assert.equal(idle.materialActionsLastCycle, 0);
  const unproven = projectStephanosControlPlaneSpine({ coreState: healthyCore, flywheelStatus: { ...flywheelStatus, refillNoRunnableSourceWorkProven: false } });
  assert.equal(unproven.flywheelReconciliationBlocked, true);
  assert.equal(unproven.repairRequired, true);
  const realFault = projectStephanosControlPlaneSpine({ coreState: healthyCore, flywheelStatus: { ...flywheelStatus, flywheelLastBlockerCount: 2 } });
  assert.equal(realFault.flywheelReconciliationBlocked, true);
});

test('control-plane spine refuses AWAKE after a blocked Flywheel reconciliation', () => {
  const projected = projectStephanosControlPlaneSpine({
    coreState: healthyCore,
    flywheelStatus: {
      flywheelLastCycleFinishedAtUtc: '2026-10-04T10:30:00.000Z',
      flywheelLastStatus: 'HOLD',
      flywheelLastBlockerCount: 2,
      flywheelLastError: '',
      refillStatus: 'READY',
      refillMaterialActionsSucceeded: 2,
      refillSafeEligibleWorkRemaining: 0,
      refillProvenSafeFreeLanes: 0,
      octopusBuildVerdict: 'BUILDING',
      octopusNeedsRepair: false,
    },
  });
  assert.equal(projected.wakeState, 'DEGRADED');
  assert.equal(projected.awake, false);
  assert.equal(projected.flywheelReconciliationBlocked, true);
  assert.equal(projected.repairReason, 'FLYWHEEL_RECONCILIATION_BLOCKED');
});
