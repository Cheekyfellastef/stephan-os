import test from 'node:test';
import assert from 'node:assert/strict';

import { runBattleBridgeGoalDiscoveryHeartbeat } from './battle-bridge-goal-discovery-heartbeat.mjs';

const lifeboatReady = async () => ({ ok: true, available: true, finalVerdict: 'FORGE_LIFEBOAT_LANE_6_CAPACITY_PUBLISHED' });
const githubLifeboatReady = async () => ({ ok: true, available: true, sourceHead: 'a'.repeat(40), finalVerdict: 'GITHUB_LIFEBOAT_LANE7_READY' });
const claimAckReady = async () => ({ ok: true, published: true, finalVerdict: 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_CURRENT' });

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

function heartbeat(options = {}) {
  return runBattleBridgeGoalDiscoveryHeartbeat({
    refreshLifeboatCapacity: lifeboatReady,
    refreshGithubLifeboat: githubLifeboatReady,
    refreshGithubLifeboatClaimAck: claimAckReady,
    ...options,
  });
}

test('idle heartbeat publishes truthful native-autonomy waiting position without widening authority', async () => {
  const capture = captureTrack();
  const result = await heartbeat({
    conveyor: async () => ({ ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }),
    buildClaimedGoal: async () => ({ processed: false, success: false, reason: 'queue-empty' }),
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-22T06:30:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE');
  assert.equal(capture.published.length, 1);
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'HEARTBEAT').state, 'PASS');
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'ELIGIBLE_GOAL').state, 'WAITING');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('conveyor blocker publishes the exact stopped gate while preserving lifeboat evidence', async () => {
  const capture = captureTrack();
  const result = await heartbeat({
    conveyor: async () => ({ ok: false, blocker: 'NO_QUALIFIED_CAPACITY' }),
    buildClaimedGoal: async () => { throw new Error('must not build'); },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-22T06:31:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.githubLifeboat.available, true);
  assert.equal(result.lifeboatCapacity.available, true);
  assert.equal(capture.published.length, 1);
  assert.equal(result.autonomyTrack.currentGate, 'HEARTBEAT');
  assert.equal(result.autonomyTrack.blocker, 'NO_QUALIFIED_CAPACITY');
});

test('successful claimed source build publishes SELECT through terminal receipt while leaving review handoff unclaimed', async () => {
  const capture = captureTrack();
  const result = await heartbeat({
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: { selectedMission: { missionId: 'critical-2237-elastic-goal', issueNumber: 2237 } },
      elasticIgnition: { ok: true, dispatchCount: 1, sourceRevision: 'a'.repeat(40) },
    }),
    buildClaimedGoal: async () => ({
      processed: true,
      success: true,
      missionId: 'critical-2237-elastic-goal',
      actionId: 'action-2237',
      testsPassed: true,
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
    }),
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-22T06:32:00.000Z'),
  });

  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  for (const id of ['SELECT', 'CLAIM', 'SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT']) {
    assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === id).state, 'PASS', id);
  }
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'REVIEW_HANDOFF').state, 'NOT_REACHED');
  assert.equal(capture.published.length, 1);
});

test('blocked claimed lane is published then the same heartbeat continues to resource-disjoint material work', async () => {
  const capture = captureTrack();
  let buildCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 3,
    conveyor: async () => ({
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: { selectedMission: { missionId: `goal-${buildCalls + 1}`, issueNumber: 2237 } },
    }),
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls === 1) return { processed: true, success: false, missionId: 'goal-a', error: 'EXACT_HEAD_REVIEW_WAIT' };
      return { processed: true, success: true, missionId: 'goal-b', actionId: 'action-b', testsPassed: true };
    },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-22T06:33:00.000Z'),
  });

  assert.equal(buildCalls, 2);
  assert.deepEqual(result.parkedLaneBlockers, ['goal-a:EXACT_HEAD_REVIEW_WAIT']);
  assert.equal(capture.published.length, 2);
  assert.equal(capture.published[0].gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'BLOCKED');
  assert.equal(result.autonomyTrack.gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'PASS');
});
