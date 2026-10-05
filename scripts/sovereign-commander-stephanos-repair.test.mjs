import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runSovereignCommanderStephanosRepair,
} from './sovereign-commander-stephanos-repair.mjs';

const HEAD = 'a'.repeat(40);

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
