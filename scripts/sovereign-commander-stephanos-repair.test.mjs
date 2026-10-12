import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTINUOUS_REPAIR_MAX_COMPOSED_TIMEOUT_MS,
  CONTINUOUS_REPAIR_STEP_TIMEOUTS,
  REQUIRED_COMMANDER_CAPABILITY_VERSION,
  runSovereignCommanderStephanosRepair,
} from './sovereign-commander-stephanos-repair.mjs';

const HEAD = 'a'.repeat(40);

test('repair-stephanos requires the current continuous-repair liveness capability', () => {
  assert.equal(REQUIRED_COMMANDER_CAPABILITY_VERSION, '2026-10-05-continuous-repair-reporting-v4');
});

function result(payload, status = 0) {
  return {
    ok: status === 0,
    status,
    stdout: JSON.stringify(payload),
    errorCode: '',
  };
}

test('repair-stephanos composes caretaker, goal-builder repair and fresh exact-head Core proof', () => {
  const calls = [];
  const queue = [
    result({
      healthy: true,
      coreDaemonHealthy: true,
      coreDaemonSourceHead: HEAD,
      finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY',
    }),
    result({
      ok: true,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN',
    }),
    result({
      ok: true,
      daemonHealthy: true,
      heartbeatAgeSeconds: 2,
      sourceHead: HEAD,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS',
    }),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    runStep: (step) => {
      calls.push(step.id);
      return queue.shift();
    },
  });

  assert.equal(repaired.ok, true);
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker',
    'repair-goal-builder-flow',
    'status-stephanos-core-daemon',
  ]);
  assert.equal(repaired.sourceHead, HEAD);
  assert.equal(repaired.core.awake, true);
  assert.equal(repaired.openClawSupportRequired, false);
  assert.deepEqual(repaired.openClawSupportActions, [
    'repair-openclaw-local',
    'repair-openclaw-standalone',
  ]);
  assert.equal(repaired.arbitraryShellAllowed, false);
  assert.equal(repaired.mergeAuthority, false);
});

test('continuous repair escalates controller-fabric attention through control-plane repair and retries goal builder', () => {
  const calls = [];
  const queue = [
    result({
      healthy: true,
      coreDaemonHealthy: true,
      coreDaemonSourceHead: HEAD,
      finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY',
    }),
    result({
      ok: false,
      blocker: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
    }, 2),
    result({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN',
    }),
    result({
      ok: true,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN',
    }),
    result({
      ok: true,
      daemonHealthy: true,
      heartbeatAgeSeconds: 2,
      sourceHead: HEAD,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS',
    }),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    continuousRepairCycle: true,
    runStep: (step) => {
      calls.push(step.id);
      return queue.shift();
    },
  });

  assert.equal(repaired.ok, true);
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker',
    'repair-goal-builder-flow',
    'repair-control-plane',
    'repair-goal-builder-flow',
    'status-stephanos-core-daemon',
  ]);
});


test('continuous repair retries builder after an unrelated fixed control-plane installer remains blocked', () => {
  const calls = [];
  const queue = [
    result({
      healthy: true,
      coreDaemonHealthy: true,
      coreDaemonSourceHead: HEAD,
      finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY',
    }),
    result({
      ok: false,
      blocker: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
    }, 2),
    result({
      ok: false,
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
      finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_BLOCKED',
    }, 1),
    result({
      ok: true,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN',
    }),
    result({
      ok: true,
      daemonHealthy: true,
      heartbeatAgeSeconds: 2,
      sourceHead: HEAD,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS',
    }),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    continuousRepairCycle: true,
    runStep: (step) => {
      calls.push(step.id);
      return queue.shift();
    },
  });

  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.equal(repaired.builderFlowRecovered, true);
  assert.equal(repaired.finalVerdict, 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_BLOCKED');
  assert.equal(repaired.controlPlaneRepairComplete, false);
  assert.equal(repaired.controlPlaneResidualBlocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker',
    'repair-goal-builder-flow',
    'repair-control-plane',
    'repair-goal-builder-flow',
    'status-stephanos-core-daemon',
  ]);
});


test('continuous repair attempts independent repair for unproven elastic admission without claiming green', () => {
  const calls = [];
  const queue = [
    result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
    result({ ok: false, blocker: 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN' }, 2),
    result({ ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN' }),
    result({ ok: false, blocker: 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN' }, 2),
  ];
  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    continuousRepairCycle: true,
    runStep: (step) => { calls.push(step.id); return queue.shift(); },
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN');
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker',
    'repair-goal-builder-flow',
    'repair-control-plane',
    'repair-goal-builder-flow',
  ]);
});

test('continuous repair escalation fits inside the enclosing 220-second action budget', () => {
  assert.equal(CONTINUOUS_REPAIR_MAX_COMPOSED_TIMEOUT_MS, 190_000);
  assert.deepEqual(CONTINUOUS_REPAIR_STEP_TIMEOUTS, {
    caretaker: 30_000,
    goalBuilderInitial: 60_000,
    controlPlane: 40_000,
    goalBuilderRetry: 50_000,
    coreStatus: 10_000,
  });

  const observedTimeouts = [];
  const queue = [
    result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
    result({ ok: false, blocker: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED' }, 2),
    result({ ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN' }),
    result({ ok: true, finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN' }),
    result({
      ok: true,
      daemonHealthy: true,
      heartbeatAgeSeconds: 2,
      sourceHead: HEAD,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
    }),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    continuousRepairCycle: true,
    runStep: (step) => {
      observedTimeouts.push(step.timeoutMs);
      return queue.shift();
    },
  });

  assert.equal(repaired.ok, true);
  assert.deepEqual(observedTimeouts, [30_000, 60_000, 40_000, 50_000, 10_000]);
  assert.ok(observedTimeouts.reduce((sum, value) => sum + value, 0) < 220_000);
});

test('mailbox-held repair-stephanos never repairs its own control plane', () => {
  const calls = [];
  const queue = [
    result({
      healthy: true,
      coreDaemonHealthy: true,
      coreDaemonSourceHead: HEAD,
      finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY',
    }),
    result({
      ok: false,
      blocker: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
    }, 2),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    continuousRepairCycle: false,
    runStep: (step) => {
      calls.push(step.id);
      return queue.shift();
    },
  });

  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED');
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker',
    'repair-goal-builder-flow',
  ]);
});

test('repair-stephanos accepts bounded busy Core proof without recycling active repair work', () => {
  const queue = [
    result({
      healthy: true,
      coreDaemonHealthy: true,
      coreDaemonSourceHead: HEAD,
      finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY',
    }),
    result({
      ok: true,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN',
    }),
    result({
      ok: true,
      daemonHealthy: true,
      heartbeatAgeSeconds: 180,
      heartbeatFresh: false,
      busyGraceActive: true,
      sourceHead: HEAD,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS',
    }),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    runStep: () => queue.shift(),
  });

  assert.equal(repaired.ok, true);
  assert.equal(repaired.core.busyGraceActive, true);
  assert.equal(repaired.core.heartbeatFresh, false);
});

test('repair-stephanos fails closed when Core proof is stale or from the wrong head', () => {
  const queue = [
    result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
    result({ ok: true, finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN' }),
    result({
      ok: false,
      daemonHealthy: true,
      heartbeatAgeSeconds: 999,
      sourceHead: 'b'.repeat(40),
      readiness: 'RELOAD_REQUIRED',
      repairReason: 'SOURCE_HEAD_STALE',
    }, 2),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    runStep: () => queue.shift(),
  });

  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'SOURCE_HEAD_STALE');
  assert.equal(repaired.finalVerdict, 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_BLOCKED');
});


test('repair-stephanos rejects a fresh but degraded Core that still requires repair', () => {
  const queue = [
    result({
      healthy: true,
      coreDaemonHealthy: true,
      coreDaemonSourceHead: HEAD,
      finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY',
    }),
    result({
      ok: true,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN',
    }),
    result({
      ok: true,
      daemonHealthy: true,
      heartbeatAgeSeconds: 2,
      sourceHead: HEAD,
      readiness: 'DEGRADED',
      wakeState: 'DEGRADED',
      awake: false,
      repairRequired: true,
      repairReason: 'BACKEND_8787_UNHEALTHY_AFTER_REPAIR',
      finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS',
    }),
  ];

  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD,
    runStep: () => queue.shift(),
  });

  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'BACKEND_8787_UNHEALTHY_AFTER_REPAIR');
  assert.equal(repaired.finalVerdict, 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_BLOCKED');
});
