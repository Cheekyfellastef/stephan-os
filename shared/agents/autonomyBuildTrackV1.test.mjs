import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTONOMY_BUILD_TRACK_STATUS_ID,
  projectHeartbeatAutonomyBuildTrack,
  projectWorkspaceAutonomyBuildTrack,
} from './autonomyBuildTrackV1.mjs';

test('heartbeat track shows safe idle before an eligible goal exists', () => {
  const track = projectHeartbeatAutonomyBuildTrack({
    timestampUtc: '2026-09-15T12:00:00.000Z',
    conveyorResult: { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' },
    sourceBuild: { processed: false, reason: 'queue-empty' },
  });
  assert.equal(track.gates.find((gate) => gate.id === 'HEARTBEAT').state, 'PASS');
  assert.equal(track.gates.find((gate) => gate.id === 'ELIGIBLE_GOAL').state, 'WAITING');
  assert.equal(track.gates.find((gate) => gate.id === 'SELECT').state, 'NOT_REACHED');
  assert.equal(track.autonomousLoopProven, false);
});

test('heartbeat track proves select claim source test and terminal receipt when a real build succeeds', () => {
  const track = projectHeartbeatAutonomyBuildTrack({
    timestampUtc: '2026-09-15T12:01:00.000Z',
    conveyorResult: {
      ok: true,
      classification: 'ELASTIC_GOAL_MISSION_SELECTED',
      elasticAdmission: { selectedMission: { missionId: 'critical-2236-elastic-goal', issueNumber: 2236 } },
      elasticIgnition: { ok: true, dispatchCount: 1, sourceRevision: 'a'.repeat(40) },
    },
    sourceBuild: {
      processed: true,
      success: true,
      missionId: 'critical-2236-elastic-goal',
      actionId: 'action-2236',
      testsPassed: true,
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED',
    },
  });
  for (const id of ['HEARTBEAT', 'ELIGIBLE_GOAL', 'SELECT', 'CLAIM', 'SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT']) {
    assert.equal(track.gates.find((gate) => gate.id === id).state, 'PASS', id);
  }
  assert.equal(track.gates.find((gate) => gate.id === 'REVIEW_HANDOFF').state, 'NOT_REACHED');
  assert.equal(track.issueNumber, 2236);
});

test('workspace projection identifies the control-plane lifeboat interlock as the first blocked signal', () => {
  const nowMs = Date.parse('2026-09-15T12:00:00.000Z');
  const track = projectWorkspaceAutonomyBuildTrack({
    nowMs,
    staleAfterMs: 60 * 60 * 1000,
    statusRecords: [
      {
        statusId: 'battle-bridge-github-sync-current',
        timestampUtc: '2026-09-15T11:59:30.000Z',
        status: 'SYNC_NO_CHANGE',
        sourceHead: 'b'.repeat(40),
      },
      {
        statusId: 'post-sync-runtime-refresh-current',
        timestampUtc: '2026-09-15T11:58:00.000Z',
        status: 'REFRESH_BLOCKED',
        blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryLifeboat',
      },
    ],
  });
  assert.equal(track.gates.find((gate) => gate.id === 'SYNC').state, 'PASS');
  assert.equal(track.gates.find((gate) => gate.id === 'CONTROL_PLANE').state, 'BLOCKED');
  assert.equal(track.gates.find((gate) => gate.id === 'HEARTBEAT').state, 'NOT_REACHED');
  assert.equal(track.currentGate, 'CONTROL_PLANE');
  assert.equal(track.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryLifeboat');
});

test('fresh heartbeat signal proves the control-plane interlock has cleared', () => {
  const nowMs = Date.parse('2026-09-15T12:00:00.000Z');
  const heartbeatTrack = projectHeartbeatAutonomyBuildTrack({
    timestampUtc: '2026-09-15T11:59:50.000Z',
    conveyorResult: { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' },
    sourceBuild: { processed: false, reason: 'queue-empty' },
  });
  const track = projectWorkspaceAutonomyBuildTrack({
    nowMs,
    statusRecords: [
      { statusId: 'battle-bridge-github-sync-current', timestampUtc: '2026-09-15T11:59:45.000Z', status: 'SYNC_NO_CHANGE' },
      {
        statusId: AUTONOMY_BUILD_TRACK_STATUS_ID,
        timestampUtc: heartbeatTrack.timestampUtc,
        autonomyTrack: heartbeatTrack,
      },
    ],
  });
  assert.equal(track.gates.find((gate) => gate.id === 'CONTROL_PLANE').state, 'PASS');
  assert.equal(track.gates.find((gate) => gate.id === 'HEARTBEAT').state, 'PASS');
  assert.equal(track.currentGate, 'ELIGIBLE_GOAL');
});
