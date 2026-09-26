import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runBattleBridgeGoalDiscoveryHeartbeat } from './battle-bridge-goal-discovery-heartbeat.mjs';

const lifeboatReady = async () => ({
  ok: true,
  available: true,
  workerId: 'stephanos-forge-lifeboat-local',
  finalVerdict: 'FORGE_LIFEBOAT_LANE_6_CAPACITY_PUBLISHED',
  mergeAuthority: false,
  runtimeMutationAuthority: false,
});

const githubLifeboatReady = async () => ({
  ok: true,
  available: true,
  workerId: 'stephanos-github-lifeboat-external',
  finalVerdict: 'GITHUB_LIFEBOAT_LANE7_READY',
  mergeAuthority: false,
  deploymentAuthority: false,
  runtimeMutationAuthority: false,
});

function heartbeat(options = {}) {
  return runBattleBridgeGoalDiscoveryHeartbeat({
    refreshLifeboatCapacity: lifeboatReady,
    refreshGithubLifeboat: githubLifeboatReady,
    ...options,
  });
}

test('goal discovery heartbeat refreshes Lane 7 then Lane 6 before delegating to the existing critical backlog conveyor', async () => {
  const order = [];
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    refreshGithubLifeboat: async () => {
      order.push('github-lifeboat');
      return githubLifeboatReady();
    },
    refreshLifeboatCapacity: async () => {
      order.push('lifeboat');
      return lifeboatReady();
    },
    conveyor: async () => {
      order.push('conveyor');
      return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
    },
    buildClaimedGoal: async () => ({ processed:false, success:false, reason:'queue-empty' }),
  });
  assert.deepEqual(order, ['github-lifeboat', 'lifeboat', 'conveyor']);
  assert.equal(result.githubLifeboat.available, true);
  assert.equal(result.lifeboatCapacity.available, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('Lane 7 receives canonical git command by default and preserves an explicit caller override', async () => {
  const observedGitCommands = [];
  const run = (githubLifeboatOptions = {}) => runBattleBridgeGoalDiscoveryHeartbeat({
    githubLifeboatOptions,
    refreshGithubLifeboat: async (options) => {
      observedGitCommands.push(options.gitCommand);
      return githubLifeboatReady();
    },
    refreshLifeboatCapacity: lifeboatReady,
    conveyor: async () => ({ ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }),
    buildClaimedGoal: async () => ({ processed:false, success:false, reason:'queue-empty' }),
  });

  await run();
  await run({ gitCommand: 'test-git-override' });

  assert.deepEqual(observedGitCommands, ['git', 'test-git-override']);
});

test('unavailable Lane 7 does not strand Lane 6 or other admitted work', async () => {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    refreshGithubLifeboat: async () => { throw new Error('github-writer-offline'); },
    refreshLifeboatCapacity: lifeboatReady,
    conveyor: async () => ({ ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }),
    buildClaimedGoal: async () => ({ processed:false, success:false, reason:'queue-empty' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.githubLifeboat.available, false);
  assert.match(result.githubLifeboat.reason, /github-writer-offline/);
  assert.equal(result.lifeboatCapacity.available, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE');
});

test('unavailable Lane 6 does not strand other admitted work', async () => {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    refreshGithubLifeboat: githubLifeboatReady,
    refreshLifeboatCapacity: async () => { throw new Error('ollama-offline'); },
    conveyor: async () => ({ ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }),
    buildClaimedGoal: async () => ({ processed:false, success:false, reason:'queue-empty' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.lifeboatCapacity.available, false);
  assert.match(result.lifeboatCapacity.reason, /ollama-offline/);
  assert.equal(result.githubLifeboat.available, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE');
});

test('goal discovery heartbeat delegates to the existing critical backlog conveyor without authority widening', async () => {
  let calls = 0;
  const result = await heartbeat({
    conveyor: async () => {
      calls += 1;
      return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
    },
    buildClaimedGoal: async () => ({ processed:false, success:false, reason:'queue-empty' }),
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE');
  assert.equal(result.noRunnableSourceWorkProven, true);
  assert.equal(result.materialProgress, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.destructiveGitAllowed, false);
});

test('goal discovery heartbeat fails closed when the conveyor blocks', async () => {
  const result = await heartbeat({
    conveyor: async () => ({ ok: false, blocker: 'NO_QUALIFIED_CAPACITY' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED');
});

test('held elastic mission does not strand admitted work or stop controller continuity', async () => {
  let buildCalls = 0;
  let conveyorCalls = 0;
  const built = await heartbeat({
    maxWorkConservingAttempts: 2,
    conveyor: async () => {
      conveyorCalls += 1;
      if (conveyorCalls === 2) return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
      return {
        ok: true,
        classification: 'ELASTIC_GOAL_MISSION_SELECTED',
        elasticIgnition: {
          classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
          dispatchCount: 0,
          held: [{ missionId: 'critical-2009-elastic-goal', reason: 'DISTINCT_PROVEN_EXTERNAL_CAPACITY_UNAVAILABLE' }],
        },
      };
    },
    buildClaimedGoal: async () => {
      buildCalls += 1;
      return buildCalls === 1
        ? { processed: true, success: true, missionId: 'goal-built', reason: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED' }
        : { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(buildCalls, 2);
  assert.equal(built.ok, true);
  assert.equal(built.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  assert.equal(built.materialActionsSucceeded, 1);
  assert.equal(built.materialProgress, true);
  assert.equal(built.controllerContinuity, 'RETURN_WORK_CONSERVING');

  let queueEmptyCalls = 0;
  const heldConveyor = async () => ({
    ok: true,
    classification: 'ELASTIC_GOAL_MISSION_SELECTED',
    elasticIgnition: {
      classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
      dispatchCount: 0,
      held: [{ missionId: 'critical-2009-elastic-goal', reason: 'DISTINCT_PROVEN_EXTERNAL_CAPACITY_UNAVAILABLE' }],
    },
  });
  const swept = await heartbeat({
    conveyor: heldConveyor,
    maxWorkConservingAttempts: 3,
    buildClaimedGoal: async () => {
      queueEmptyCalls += 1;
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(queueEmptyCalls, 3);
  assert.equal(swept.ok, true);
  assert.equal(swept.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_WORK_CONSERVING_SWEEP_EXHAUSTED');
  assert.equal(swept.workConservingSweepExhausted, true);
  assert.equal(swept.noRunnableSourceWorkProven, false);
  assert.equal(swept.heldLaneParked, true);
  assert.equal(swept.controllerContinuity, 'CONTINUE_NEXT_SWEEP');
  assert.deepEqual(swept.parkedLaneBlockers, [
    'critical-2009-elastic-goal:DISTINCT_PROVEN_EXTERNAL_CAPACITY_UNAVAILABLE',
  ]);
  assert.equal(swept.mergeAuthority, false);
  assert.equal(swept.runtimeMutationAuthority, false);
});

test('blocked claimed source lane is parked and the same run continues to another build', async () => {
  let buildCalls = 0;
  let conveyorCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 4,
    conveyor: async () => {
      conveyorCalls += 1;
      return conveyorCalls === 3
        ? { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }
        : { ok: true, classification: 'ELASTIC_GOAL_MISSION_SELECTED' };
    },
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls === 1) {
        return {
          processed: true,
          success: false,
          missionId: 'goal-a',
          error: 'EXACT_HEAD_REVIEW_WAIT',
          finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED',
        };
      }
      if (buildCalls === 2) {
        return {
          processed: true,
          success: true,
          missionId: 'goal-b',
          finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
        };
      }
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(conveyorCalls, 3);
  assert.equal(buildCalls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.materialProgress, true);
  assert.equal(result.materialActionsSucceeded, 1);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  assert.equal(result.sourceBuild.missionId, 'goal-b');
  assert.deepEqual(result.parkedLaneBlockers, ['goal-a:EXACT_HEAD_REVIEW_WAIT']);
  assert.equal(result.sweepAttemptCount, 3);
});

test('thrown source-builder exception parks only that lane and the same sweep continues', async () => {
  let buildCalls = 0;
  let conveyorCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 4,
    conveyor: async () => {
      conveyorCalls += 1;
      if (conveyorCalls === 3) return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
      return {
        ok: true,
        classification: 'ELASTIC_GOAL_MISSION_SELECTED',
        elasticAdmission: {
          selectedMission: { missionId: conveyorCalls === 1 ? 'goal-explodes' : 'goal-healthy' },
        },
      };
    },
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls === 1) throw new Error('provider-process-disconnected');
      if (buildCalls === 2) {
        return {
          processed: true,
          success: true,
          missionId: 'goal-healthy',
          finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
        };
      }
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });

  assert.equal(buildCalls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.materialActionsSucceeded, 1);
  assert.equal(result.sourceBuild.missionId, 'goal-healthy');
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  assert.deepEqual(result.parkedLaneBlockers, [
    'claimed-source-lane:provider-process-disconnected',
  ]);
});

test('thrown source-builder exception binds mission identity only when the error proves it', async () => {
  let buildCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 2,
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: { selectedMission: { missionId: 'newer-selected-mission' } },
      elasticIgnition: {
        dispatchCount: 0,
        held: [{ missionId: 'newer-selected-mission', reason: 'OTHER_LANE_WAIT' }],
      },
    }),
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls === 1) {
        const error = new Error('exact claimed worker failed');
        error.missionId = 'older-claimed-mission';
        error.actionId = 'older-claimed-action';
        throw error;
      }
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });

  assert.equal(result.ok, true);
  assert.ok(result.parkedLaneBlockers.includes('older-claimed-mission:exact claimed worker failed'));
  assert.ok(!result.parkedLaneBlockers.some((blocker) => blocker.startsWith('newer-selected-mission:exact claimed worker failed')));
});

test('orphan recovery hold is parked instead of being misreported as clean queue-empty', async () => {
  let buildCalls = 0;
  let conveyorCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 4,
    conveyor: async () => {
      conveyorCalls += 1;
      return conveyorCalls === 3
        ? { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }
        : { ok: true, classification: 'ELASTIC_GOAL_MISSION_SELECTED' };
    },
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls === 1) {
        return {
          processed: false,
          success: false,
          missionId: 'goal-recovery-hold',
          reason: 'exact recovery truth requires reconciliation',
          finalVerdict: 'PROVIDER_NEUTRAL_ORPHAN_RECOVERY_HOLD',
        };
      }
      if (buildCalls === 2) {
        return {
          processed: true,
          success: true,
          missionId: 'goal-independent',
          finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
        };
      }
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });

  assert.equal(buildCalls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.materialActionsSucceeded, 1);
  assert.equal(result.sourceBuild.missionId, 'goal-independent');
  assert.deepEqual(result.parkedLaneBlockers, [
    'goal-recovery-hold:exact recovery truth requires reconciliation',
  ]);
});

test('held queue-empty lane is retried within the same bounded sweep and can discover later material work', async () => {
  let buildCalls = 0;
  let conveyorCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 4,
    conveyor: async () => {
      conveyorCalls += 1;
      if (conveyorCalls === 4) return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
      return {
        ok: true,
        classification: 'ELASTIC_GOAL_MISSION_SELECTED',
        elasticIgnition: {
          classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
          dispatchCount: 0,
          held: [{ missionId: 'goal-held', reason: 'PROVIDER_TEMPORARILY_UNAVAILABLE' }],
        },
      };
    },
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls < 3) return { processed: false, success: false, reason: 'queue-empty' };
      if (buildCalls === 3) {
        return {
          processed: true,
          success: true,
          missionId: 'goal-product',
          finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
        };
      }
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(buildCalls, 4);
  assert.equal(result.materialProgress, true);
  assert.equal(result.materialActionsSucceeded, 1);
  assert.equal(result.sourceBuild.missionId, 'goal-product');
  assert.equal(result.sweepAttemptCount, 4);
  assert.deepEqual(result.parkedLaneBlockers, ['goal-held:PROVIDER_TEMPORARILY_UNAVAILABLE']);
});

test('explicit sweep budgets above five are honored instead of silently clamped', async () => {
  let buildCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 7,
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticIgnition: {
        classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
        dispatchCount: 0,
        held: [{ missionId: 'goal-held', reason: 'PROVIDER_TEMPORARILY_UNAVAILABLE' }],
      },
    }),
    buildClaimedGoal: async () => {
      buildCalls += 1;
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(buildCalls, 7);
  assert.equal(result.sweepAttemptCount, 7);
  assert.equal(result.workConservingSweepExhausted, true);
});

test('default octopus sweep widens beyond eight when more resource-disjoint runnable missions are already admitted', async () => {
  let buildCalls = 0;
  const runnableMissions = Array.from({ length: 10 }, (_, index) => ({ missionId: `goal-wide-${index + 1}` }));
  const result = await heartbeat({
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: { runnableMissions },
      elasticIgnition: {
        classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
        dispatchCount: 0,
        held: [{ missionId: 'goal-wide-held', reason: 'PROVIDER_TEMPORARILY_UNAVAILABLE' }],
      },
    }),
    buildClaimedGoal: async () => {
      buildCalls += 1;
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(buildCalls, 10);
  assert.equal(result.sweepAttemptCount, 10);
  assert.equal(result.workConservingSweepExhausted, true);
});

test('historical terminal elastic mission records do not inflate the current octopus sweep budget', async () => {
  let buildCalls = 0;
  const terminalHistory = Array.from({ length: 40 }, (_, index) => ({
    missionId: `critical-${3000 + index}-elastic-goal`,
    currentPhase: 'COMPLETE',
  }));
  const result = await heartbeat({
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: {
        elasticMissions: terminalHistory,
        activeMissions: [],
        runnableMissions: [],
        admittedIssueNumbers: [],
      },
      elasticIgnition: {
        classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
        dispatchCount: 0,
        dispatched: [],
        held: [{ missionId: 'goal-current-held', reason: 'PROVIDER_TEMPORARILY_UNAVAILABLE' }],
      },
    }),
    buildClaimedGoal: async () => {
      buildCalls += 1;
      return { processed: false, success: false, reason: 'queue-empty' };
    },
  });
  assert.equal(buildCalls, 8);
  assert.equal(result.sweepAttemptCount, 8);
  assert.equal(result.workConservingSweepExhausted, true);
});

test('Battle Bridge sync coordinator owns goal discovery after successful convergence', async () => {
  const coordinatorSource = await readFile(new URL('./battle-bridge-github-sync-and-refresh.mjs', import.meta.url), 'utf8');
  const launcherSource = await readFile(new URL('./windows/run-battle-bridge-github-sync-hidden.ps1', import.meta.url), 'utf8');
  assert.match(coordinatorSource, /battle-bridge-goal-discovery-heartbeat\.mjs/);
  assert.match(coordinatorSource, /runFreshGoalDiscoveryHeartbeat\(sourceHead\)/);
  assert.match(coordinatorSource, /heartbeatUrl\.searchParams\.set\('sourceHead', sourceHead\)/);
  assert.match(coordinatorSource, /typeof goalDiscoveryHeartbeat === 'function'/);
  assert.doesNotMatch(coordinatorSource, /import \{ runBattleBridgeGoalDiscoveryHeartbeat \}/);
  assert.match(coordinatorSource, /SYNC_AND_REFRESH_GOAL_DISCOVERY_BLOCKED/);
  assert.doesNotMatch(launcherSource, /battle-bridge-goal-discovery-heartbeat\.mjs|goalDiscoveryPath/);
  assert.doesNotMatch(launcherSource, /Invoke-Expression|cmd\.exe|reset --hard|git clean|git push/i);
});
