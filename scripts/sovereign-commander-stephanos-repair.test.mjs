import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSovereignCommanderContinuousRepairGuardian } from './sovereign-commander-http.mjs';

import {
  CONTINUOUS_REPAIR_MAX_COMPOSED_TIMEOUT_MS,
  CONTINUOUS_REPAIR_STEP_TIMEOUTS,
  REQUIRED_COMMANDER_CAPABILITY_VERSION,
  runSovereignCommanderStephanosRepair,
  runFixedStephanosRepairStep,
  projectIndependentCoreRepairV1,
} from './sovereign-commander-stephanos-repair.mjs';

const HEAD = 'a'.repeat(40);

test('production continuous steps never launch Windows descendants without native custody', () => {
  let processCalls = 0;
  const steps = [];
  const out = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD, continuousRepairCycle: true, gamingSafe: () => true,
    runStep(step) {
      steps.push(step);
      return runFixedStephanosRepairStep(step, { spawnSyncFn() {
        processCalls++;
        assert.equal(step.id, 'status-stephanos-core-daemon');
        return { status: 0, stdout: JSON.stringify({ sourceHead: HEAD,
          singleWriterProven: true, sourceHeadMatchesLive: true, gamingActive: false,
          repairRequired: true, readiness: 'DEGRADED' }) };
      } });
    },
  });
  assert.equal(processCalls, 1, 'only fixed read-only Core observation executes');
  assert.equal(out.ok, false);
  assert.equal(out.blocker, 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE');
  assert.equal(steps[0].requiresWindowsJobCustody, true);
  assert.equal(out.independentCoreRepair.dispatchAllowed, false);
  assert.equal(out.independentCoreRepair.originalR7Authority, false);
  assert.equal(out.steps[0].custodyReleased, true);
  assert.equal(out.steps[0].executionState, 'NOT_STARTED');
  assert.equal(Object.hasOwn(out.steps[0], 'status'), false);
});

test('real pre-spawn denial stays BLOCKED without starving manual owner admission; unknown execution stays held', async () => {
  for (const mode of ['not-started', 'gaming-before-observation', 'spawn-timeout', 'forged-not-started']) {
    let processCalls = 0;
    let governorReads = 0;
    const repair = runSovereignCommanderStephanosRepair({
      readHead: () => HEAD, continuousRepairCycle: true,
      gamingSafe: () => mode !== 'gaming-before-observation' || ++governorReads < 3,
      runStep(step) {
        if (mode === 'forged-not-started') return {
          ok: false, status: null, executionState: 'NOT_STARTED', custodyReleased: true,
          errorCode: 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE', stdout: '',
        };
        return runFixedStephanosRepairStep(step, { spawnSyncFn() {
          processCalls++;
          assert.equal(step.id, 'status-stephanos-core-daemon');
          return mode === 'spawn-timeout'
            ? { status: null, error: { code: 'ETIMEDOUT' } }
            : { status: 0, stdout: '{}' };
        } });
      },
    });
    assert.equal(processCalls, ['forged-not-started', 'gaming-before-observation'].includes(mode) ? 0 : 1);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const guardian = startSovereignCommanderContinuousRepairGuardian({
      spawnImpl: () => child,
      setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
    });
    assert.equal(guardian.runNow(), true);
    child.stdout.emit('data', 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT='
      + JSON.stringify({ ...repair, reporting: { ok: true, outcome: 'BLOCKED' } }) + '\n');
    child.emit('close', 2);
    const shouldHold = ['spawn-timeout', 'forged-not-started'].includes(mode);
    assert.equal(guardian.status().timeoutCustodyHeld, shouldHold, mode);
    assert.equal(guardian.status().lastOk, false);
    assert.equal(guardian.status().scheduled, !shouldHold);
    let manualCalls = 0;
    await guardian.withMaintenanceOwner({ plan: { processId: 'repair-ui-4173' } }, async () => {
      manualCalls++;
      return { ok: true, structuredContent: { status: 0, stdout: '' } };
    });
    assert.equal(manualCalls, shouldHold ? 0 : 1, mode);
    guardian.stop();
  }
});

test('timeout, missing exit status and parent exit never prove Windows descendant exclusion', () => {
  const step = { id: 'repair-control-plane', executable: process.execPath,
    args: [], timeoutMs: 1000 };
  for (const child of [
    { status: null }, { status: null, error: { code: 'ETIMEDOUT' } },
    { status: 0 }, { status: 1 },
  ]) {
    const out = runFixedStephanosRepairStep(step, { spawnSyncFn: () => child });
    assert.equal(out.custodyReleased, false);
    assert.equal(out.descendantExclusionProven, false);
    if (child.status === null) assert.equal(out.ok, false);
  }
});

test('forged Core/native custody flags cannot enroll an executor or widen Core-only scope', () => {
  const core = { sourceHead: HEAD, singleWriterProven: true,
    sourceHeadMatchesLive: true, gamingActive: false, readiness: 'DEGRADED',
    jobObjectProven: true, signed: true, dispatchAllowed: true,
    originalR7Authority: true, descendantExclusionProven: true };
  for (const delta of [{}, { sourceHead: 'b'.repeat(40) }, { singleWriterProven: false },
    { sourceHeadMatchesLive: false }, { gamingActive: true }, { gamingActive: undefined }]) {
    const p = projectIndependentCoreRepairV1({ ...core, ...delta }, HEAD, true);
    assert.equal(p.dispatchAllowed, false);
    assert.equal(p.mutationAttempted, false);
    assert.equal(p.taskSchedulerAuthority, false);
    assert.equal(p.serviceRestartAuthority, false);
    assert.equal(p.controllerInstallerAuthority, false);
    assert.equal(p.originalR7Authority, false);
    assert.equal(p.descendantExclusionProven, false);
  }
});

test('repair-stephanos requires the current continuous-repair liveness capability', () => {
  assert.equal(REQUIRED_COMMANDER_CAPABILITY_VERSION, '2026-10-13-private-mcp-batch-metadata-v5');
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
    continuousRepairCycle: true, gamingSafe: () => true,
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
    continuousRepairCycle: true, gamingSafe: () => true,
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
    continuousRepairCycle: true, gamingSafe: () => true,
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

test('held R7 builder preserves separate Core diagnosis without launching unsafe installers', () => {
  const calls = [];
  const steps = [];
  const queue = [
    result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
    result({ ok: false, blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING' }, 2),
    result({
      ok: true, daemonHealthy: true, sourceHead: HEAD,
      singleWriterProven: true, sourceHeadMatchesLive: true,
      gamingActive: false, readiness: 'DEGRADED', repairRequired: true,
    }),
    result({ ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN' }),
  ];
  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD, continuousRepairCycle: true, gamingSafe: () => true,
    runStep: (step) => { calls.push(step.id); steps.push(step); return queue.shift(); },
  });
  assert.equal(repaired.ok, false);
  assert.equal(steps.at(-1).id, 'status-stephanos-core-daemon');
  assert.equal(repaired.blocker, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker', 'repair-goal-builder-flow',
    'status-stephanos-core-daemon',
  ]);
  assert.equal(repaired.steps.at(-1).ok, true);
  assert.equal(repaired.independentCoreRepair.exactCoreFaultObserved, true);
  assert.equal(repaired.independentCoreRepair.dispatchAllowed, false);
  assert.equal(repaired.independentCoreRepair.blocker,
    'SOVEREIGN_CORE_ONLY_CANCELLABLE_BACKEND_UNQUALIFIED');
  assert.equal(repaired.sourceMutationAllowed, false);
  assert.equal(repaired.mergeAuthority, false);
});

test('held R7 builder never authorises maintenance while gaming or with unverified Core ownership', () => {
  for (const overrides of [
    { gamingActive: true },
    { gamingActive: undefined },
    { singleWriterProven: false },
    { sourceHeadMatchesLive: false },
    { sourceHead: 'b'.repeat(40) },
  ]) {
    const calls = [];
    const queue = [
      result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
      result({ ok: false, blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING' }, 2),
      result({
        ok: true, sourceHead: HEAD, singleWriterProven: true,
        sourceHeadMatchesLive: true, gamingActive: false, readiness: 'DEGRADED',
        repairRequired: true, ...overrides,
      }),
    ];
    const repaired = runSovereignCommanderStephanosRepair({
      readHead: () => HEAD, continuousRepairCycle: true, gamingSafe: () => true,
      runStep: (step) => { calls.push(step.id); return queue.shift(); },
    });
    assert.equal(repaired.ok, false);
    assert.equal(repaired.blocker, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
    assert.deepEqual(calls, [
      'sovereign-control-plane-caretaker', 'repair-goal-builder-flow',
      'status-stephanos-core-daemon',
    ]);
  }
});

test('held R7 builder never triggers installer, even if Core health is degraded', () => {
  const calls = [];
  const queue = [
    result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
    result({ ok: false, blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING' }, 2),
    result({
      ok: true, sourceHead: HEAD, singleWriterProven: true,
      sourceHeadMatchesLive: true, gamingActive: false,
      readiness: 'READY', repairRequired: false,
    }),
  ];
  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD, continuousRepairCycle: true, gamingSafe: () => true,
    runStep: (step) => { calls.push(step.id); return queue.shift(); },
  });
  assert.equal(repaired.blocker, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
  assert.deepEqual(calls, [
    'sovereign-control-plane-caretaker', 'repair-goal-builder-flow',
    'status-stephanos-core-daemon',
  ]);
});


test('original R7 hold with independently DEGRADED Core never starts uncancellable Windows descendant',()=>{
  const calls=[];
  const queue=[
    result({healthy:true,coreDaemonHealthy:true,coreDaemonSourceHead:HEAD}),
    result({ok:false,blocker:'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING'},2),
    result({ok:true,sourceHead:HEAD,singleWriterProven:true,
      sourceHeadMatchesLive:true,gamingActive:false,readiness:'DEGRADED',repairRequired:true}),
  ];
  const out=runSovereignCommanderStephanosRepair({
    readHead:()=>HEAD,continuousRepairCycle:true,gamingSafe:()=>true,
    runStep:step=>{calls.push(step.id);if(step.id==='repair-control-plane')throw Error('unsafe Windows installer');return queue.shift()},
  });
  assert.equal(out.ok,false);
  assert.equal(out.blocker,'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
  assert.deepEqual(calls,['sovereign-control-plane-caretaker','repair-goal-builder-flow','status-stephanos-core-daemon']);
  assert.equal(out.mergeAuthority,false);
  assert.equal(out.sourceMutationAllowed,false);
});
test('unattended guardian refuses even caretaker when gaming is active or governor unknown', () => {
  for (const gamingSafe of [() => false, () => null, () => { throw Error('governor unavailable'); }]) {
    let calls = 0;
    const repaired = runSovereignCommanderStephanosRepair({
      readHead: () => HEAD, continuousRepairCycle: true,
      gamingSafe, runStep: () => { calls++; return result({ ok: true }); },
    });
    assert.equal(repaired.ok, false);
    assert.equal(repaired.blocker, 'SOVEREIGN_COMMANDER_UNATTENDED_GAMING_GUARD_BLOCKED');
    assert.equal(calls, 0);
  }
});

test('unattended guardian rechecks governor when gaming starts between fixed actions', () => {
  let governorReads = 0;
  let actions = 0;
  const repaired = runSovereignCommanderStephanosRepair({
    readHead: () => HEAD, continuousRepairCycle: true,
    gamingSafe: () => ++governorReads === 1 || governorReads === 2,
    runStep: () => {
      actions++;
      return result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD });
    },
  });
  assert.equal(actions, 1); // only caretaker; no goal-builder is launched
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'SOVEREIGN_COMMANDER_UNATTENDED_GAMING_GUARD_BLOCKED');
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
    continuousRepairCycle: true, gamingSafe: () => true,
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

test('repair-stephanos does not mistake missing or null heartbeat age for a fresh Core', () => {
  for (const heartbeatAgeSeconds of [undefined, null, -1, NaN]) {
    const queue = [
      result({ healthy: true, coreDaemonHealthy: true, coreDaemonSourceHead: HEAD }),
      result({ ok: true, finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN' }),
      result({
        ok: true, daemonHealthy: true, heartbeatAgeSeconds,
        sourceHead: HEAD, readiness: 'READY', wakeState: 'AWAKE',
        awake: true, repairRequired: false,
      }),
    ];
    const repaired = runSovereignCommanderStephanosRepair({
      readHead: () => HEAD, runStep: () => queue.shift(),
    });
    assert.equal(repaired.ok, false, `invalid heartbeat age ${String(heartbeatAgeSeconds)}`);
    assert.equal(repaired.finalVerdict, 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_BLOCKED');
  }
});
