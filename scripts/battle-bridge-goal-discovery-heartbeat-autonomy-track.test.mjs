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


test('goal discovery heartbeat cannot create a legacy critical mission outside the durable controller', async () => {
  let observedOptions = null;
  const result = await heartbeat({
    conveyor: async (options) => {
      observedOptions = options;
      return { ok: true, classification: 'CREATE_NEXT_MISSION_DEFERRED_TO_DURABLE_CONTROLLER' };
    },
    buildClaimedGoal: async () => ({ processed: false, success: false, reason: 'queue-empty' }),
    publishTrack: async () => ({ ok: true }),
    now: new Date('2026-09-22T06:30:30.000Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(observedOptions.allowLegacyMissionCreation, false);
  assert.equal(observedOptions.admissionOwner, 'battle-bridge-goal-discovery');
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

test('successful source work re-observes and advances two distinct goals before work-conserving return', async () => {
  const capture = captureTrack();
  let attempt = 0;
  const result = await heartbeat({
    conveyor: async () => {
      attempt += 1;
      if (attempt <= 2) {
        const issueNumber = 2236 + attempt;
        return {
          ok: true,
          classification: 'ELASTIC_GOAL_MISSION_SELECTED',
          elasticAdmission: {
            selectedMission: { missionId: `critical-${issueNumber}-elastic-goal`, issueNumber },
            runnableMissions: [
              { missionId: `critical-${issueNumber}-elastic-goal` },
              ...(attempt === 1 ? [{ missionId: 'critical-2238-elastic-goal' }] : []),
            ],
          },
          elasticIgnition: { ok: true, dispatchCount: 1, sourceRevision: 'a'.repeat(40), availableSlots: 1 },
        };
      }
      return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
    },
    buildClaimedGoal: async () => {
      if (attempt <= 2) {
        const issueNumber = 2236 + attempt;
        return {
          processed: true,
          success: true,
          missionId: `critical-${issueNumber}-elastic-goal`,
          actionId: `action-${issueNumber}`,
          testsPassed: true,
          finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
        };
      }
      return { processed: false, success: false, reason: 'queue-empty' };
    },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-22T06:32:00.000Z'),
  });

  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED');
  assert.equal(result.materialActionsSucceeded, 2);
  assert.deepEqual(result.successfulMissionIds, [
    'critical-2237-elastic-goal',
    'critical-2238-elastic-goal',
  ]);
  assert.equal(result.sweepAttemptCount, 3);
  assert.equal(result.noRunnableSourceWorkProven, true);
  assert.equal(result.controllerContinuity, 'RETURN_WORK_CONSERVING');
  assert.equal(result.cycleDecision.returnAllowed, true);
  assert.equal(capture.published.length, 3);
  assert.equal(new Set(capture.published.map((track) => track.cycleId)).size, 1);
  for (const attemptTrace of result.sweepAttempts.slice(0, 2)) {
    assert.equal(attemptTrace.gateStates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'PASS');
    assert.equal(attemptTrace.gateStates.find((gate) => gate.id === 'TERMINAL_RECEIPT').state, 'PASS');
    assert.equal(attemptTrace.gateStates.find((gate) => gate.id === 'REVIEW_HANDOFF').state, 'WAITING');
  }
  assert.equal(result.autonomyTrack.materialActionsSucceeded, 2);
  assert.equal(result.autonomyTrack.currentGate, 'ELIGIBLE_GOAL');
});

test('blocked claimed lane is published then the same heartbeat continues to resource-disjoint material work', async () => {
  const capture = captureTrack();
  let buildCalls = 0;
  let conveyorCalls = 0;
  const result = await heartbeat({
    maxWorkConservingAttempts: 3,
    conveyor: async () => {
      conveyorCalls += 1;
      if (conveyorCalls === 3) return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
      return {
        ok: true,
        classification: 'ELASTIC_GOAL_MISSION_SELECTED',
        elasticAdmission: { selectedMission: { missionId: `goal-${conveyorCalls}`, issueNumber: 2236 + conveyorCalls } },
      };
    },
    buildClaimedGoal: async () => {
      buildCalls += 1;
      if (buildCalls === 1) return { processed: true, success: false, missionId: 'goal-a', error: 'EXACT_HEAD_REVIEW_WAIT' };
      if (buildCalls === 2) return { processed: true, success: true, missionId: 'goal-b', actionId: 'action-b', testsPassed: true };
      return { processed: false, success: false, reason: 'queue-empty' };
    },
    publishTrack: capture.publishTrack,
    now: new Date('2026-09-22T06:33:00.000Z'),
  });

  assert.equal(buildCalls, 3);
  assert.equal(conveyorCalls, 3);
  assert.deepEqual(result.parkedLaneBlockers, ['goal-a:EXACT_HEAD_REVIEW_WAIT']);
  assert.equal(result.materialActionsSucceeded, 1);
  assert.deepEqual(result.successfulMissionIds, ['goal-b']);
  assert.equal(capture.published.length, 3);
  assert.equal(capture.published[0].gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'BLOCKED');
  assert.equal(capture.published[1].gates.find((gate) => gate.id === 'SOURCE_CHANGED').state, 'PASS');
  assert.equal(capture.published[1].gates.find((gate) => gate.id === 'REVIEW_HANDOFF').state, 'WAITING');
  assert.equal(result.autonomyTrack.currentGate, 'ELIGIBLE_GOAL');
});
