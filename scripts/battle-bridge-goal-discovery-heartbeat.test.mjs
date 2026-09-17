import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runBattleBridgeGoalDiscoveryHeartbeat } from './battle-bridge-goal-discovery-heartbeat.mjs';

function captureTrack() {
  const published = [];
  return {
    published,
    publishTrack: async (track) => {
      published.push(track);
      return { ok: true, reason: 'TEST_TRACK_CAPTURED' };
    },
  };
}

test('goal discovery heartbeat delegates to the existing critical backlog conveyor without authority widening', async () => {
  let calls = 0;
  const capture = captureTrack();
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor: async () => {
      calls += 1;
      return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
    },
    buildClaimedGoal: async () => ({ processed: false, success: false, reason: 'queue-empty' }),
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:00:00.000Z'),
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
  assert.equal(capture.published.length, 1);
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'HEARTBEAT').state, 'PASS');
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'ELIGIBLE_GOAL').state, 'WAITING');
});

test('goal discovery heartbeat fails closed when the conveyor blocks and publishes the stopped marble position', async () => {
  const capture = captureTrack();
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor: async () => ({ ok: false, blocker: 'NO_QUALIFIED_CAPACITY' }),
    buildClaimedGoal: async () => { throw new Error('must not build'); },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:01:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED');
  assert.equal(capture.published.length, 1);
  assert.equal(result.autonomyTrack.currentGate, 'HEARTBEAT');
  assert.equal(result.autonomyTrack.blocker, 'NO_QUALIFIED_CAPACITY');
});

test('held elastic mission is parked, published as blocked, and does not stop controller continuity', async () => {
  const capture = captureTrack();
  let buildCalls = 0;
  const conveyor = async () => ({
    ok: true,
    classification: 'ELASTIC_GOAL_MISSION_SELECTED',
    elasticAdmission: { selectedMission: { missionId: 'critical-1622-elastic-goal', issueNumber: 1622 } },
    elasticIgnition: {
      ok: true,
      classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
      dispatchCount: 0,
      held: [{ missionId: 'critical-1622-elastic-goal', reason: 'SOURCE_REVISION_NOT_ADMITTED' }],
    },
  });

  const built = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor,
    buildClaimedGoal: async () => {
      buildCalls += 1;
      return {
        processed: true,
        success: true,
        missionId: 'critical-2009-elastic-goal',
        actionId: 'action-2009',
        testsPassed: true,
        finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
      };
    },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:01:30.000Z'),
  });
  assert.equal(buildCalls, 1);
  assert.equal(built.ok, true);
  assert.equal(built.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  assert.equal(built.elasticHold.held[0].missionId, 'critical-1622-elastic-goal');
  assert.equal(built.materialProgress, true);
  assert.equal(built.autonomyTrack.gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'PASS');

  const heldCapture = captureTrack();
  let queueEmptyCalls = 0;
  const swept = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor,
    maxWorkConservingAttempts: 3,
    buildClaimedGoal: async () => {
      queueEmptyCalls += 1;
      return { processed: false, success: false, reason: 'queue-empty' };
    },
    publishTrack: heldCapture.publishTrack,
    now: new Date('2026-09-15T12:01:31.000Z'),
  });
  assert.equal(queueEmptyCalls, 3);
  assert.equal(swept.ok, true);
  assert.equal(swept.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_WORK_CONSERVING_SWEEP_EXHAUSTED');
  assert.equal(swept.workConservingSweepExhausted, true);
  assert.equal(swept.noRunnableSourceWorkProven, false);
  assert.equal(swept.heldLaneParked, true);
  assert.equal(swept.controllerContinuity, 'CONTINUE_NEXT_SWEEP');
  assert.deepEqual(swept.parkedLaneBlockers, [
    'critical-1622-elastic-goal:SOURCE_REVISION_NOT_ADMITTED',
  ]);
  assert.equal(heldCapture.published.length, 3);
  assert.equal(swept.autonomyTrack.currentGate, 'CLAIM');
  assert.equal(swept.autonomyTrack.currentState, 'BLOCKED');
  assert.match(swept.autonomyTrack.blocker, /SOURCE_REVISION_NOT_ADMITTED/);
  assert.equal(swept.mergeAuthority, false);
  assert.equal(swept.runtimeMutationAuthority, false);
});

test('blocked claimed source lane is parked and the same run continues to another build', async () => {
  const capture = captureTrack();
  let buildCalls = 0;
  let conveyorCalls = 0;
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    maxWorkConservingAttempts: 4,
    conveyor: async () => {
      conveyorCalls += 1;
      return {
        ok: true,
        classification: 'ELASTIC_GOAL_MISSION_SELECTED',
        elasticAdmission: { selectedMission: { missionId: `goal-${conveyorCalls}`, issueNumber: 2237 } },
      };
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
      return {
        processed: true,
        success: true,
        missionId: 'goal-b',
        actionId: 'action-goal-b',
        testsPassed: true,
        finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
      };
    },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:02:00.000Z'),
  });
  assert.equal(conveyorCalls, 2);
  assert.equal(buildCalls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.materialProgress, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  assert.equal(result.sourceBuild.missionId, 'goal-b');
  assert.deepEqual(result.parkedLaneBlockers, ['goal-a:EXACT_HEAD_REVIEW_WAIT']);
  assert.equal(result.sweepAttemptCount, 2);
  assert.equal(capture.published.length, 2);
  assert.equal(capture.published[0].gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'BLOCKED');
  for (const id of ['SELECT', 'CLAIM', 'SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT']) {
    assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === id).state, 'PASS', id);
  }
});

test('held queue-empty lane is retried within the same bounded sweep and can discover later material work', async () => {
  const capture = captureTrack();
  let buildCalls = 0;
  const conveyor = async () => ({
    ok: true,
    classification: 'ELASTIC_GOAL_MISSION_SELECTED',
    elasticAdmission: { selectedMission: { missionId: 'goal-held', issueNumber: 2237 } },
    elasticIgnition: {
      classification: 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD',
      dispatchCount: 0,
      held: [{ missionId: 'goal-held', reason: 'PROVIDER_TEMPORARILY_UNAVAILABLE' }],
    },
  });
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor,
    maxWorkConservingAttempts: 4,
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls < 3) return { processed: false, success: false, reason: 'queue-empty' };
      return {
        processed: true,
        success: true,
        missionId: 'goal-product',
        actionId: 'action-goal-product',
        testsPassed: true,
        finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
      };
    },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:03:00.000Z'),
  });
  assert.equal(buildCalls, 3);
  assert.equal(result.materialProgress, true);
  assert.equal(result.sourceBuild.missionId, 'goal-product');
  assert.equal(result.sweepAttemptCount, 3);
  assert.deepEqual(result.parkedLaneBlockers, ['goal-held:PROVIDER_TEMPORARILY_UNAVAILABLE']);
  assert.equal(capture.published.length, 3);
  assert.equal(capture.published[0].currentGate, 'CLAIM');
  assert.equal(capture.published[0].currentState, 'BLOCKED');
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'PASS');
});

test('goal discovery heartbeat publishes source/test/terminal receipt progress for a real source build', async () => {
  const capture = captureTrack();
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: { selectedMission: { missionId: 'critical-2236-elastic-goal', issueNumber: 2236 } },
      elasticIgnition: { ok: true, dispatchCount: 1, sourceRevision: 'a'.repeat(40) },
    }),
    buildClaimedGoal: async () => ({
      processed: true,
      success: true,
      missionId: 'critical-2236-elastic-goal',
      actionId: 'action-2236',
      testsPassed: true,
    }),
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:04:00.000Z'),
  });
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  for (const id of ['SELECT', 'CLAIM', 'SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT']) {
    assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === id).state, 'PASS', id);
  }
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'REVIEW_HANDOFF').state, 'NOT_REACHED');
});

test('Battle Bridge sync coordinator owns goal discovery after successful convergence', async () => {
  const coordinatorSource = await readFile(new URL('./battle-bridge-github-sync-and-refresh.mjs', import.meta.url), 'utf8');
  const launcherSource = await readFile(new URL('./windows/run-battle-bridge-github-sync-hidden.ps1', import.meta.url), 'utf8');
  assert.match(coordinatorSource, /battle-bridge-goal-discovery-heartbeat\.mjs/);
  assert.match(coordinatorSource, /goalDiscoveryHeartbeat\s*=\s*runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(coordinatorSource, /const goalDiscovery = await goalDiscoveryHeartbeat\(\)/);
  assert.match(coordinatorSource, /SYNC_AND_REFRESH_GOAL_DISCOVERY_BLOCKED/);
  assert.doesNotMatch(launcherSource, /battle-bridge-goal-discovery-heartbeat\.mjs|goalDiscoveryPath/);
  assert.doesNotMatch(launcherSource, /Invoke-Expression|cmd\.exe|reset --hard|git clean|git push/i);
});
