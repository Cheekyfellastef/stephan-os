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
    buildClaimedGoal: async () => ({ processed: false, reason: 'queue-empty' }),
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-15T12:00:00.000Z'),
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE');
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
    now: new Date('2026-09-15T12:02:00.000Z'),
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
