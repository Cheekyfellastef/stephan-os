import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE,
  BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER,
  BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY,
  buildBattleBridgeOutboundBeacon,
  buildBattleBridgeOutboundBeaconBody,
  projectBeaconStatus,
} from './battle-bridge-outbound-health-beacon.mjs';

const HEAD = 'a'.repeat(40);

function status(overrides = {}) {
  return {
    timestampUtc: '2026-08-18T14:30:00.000Z',
    status: 'HEALTHY',
    sourceHead: HEAD,
    ...overrides,
  };
}

test('beacon publishes only fixed repository/issue identity and safe authority flags', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-18T14:31:00.000Z'),
    statusRecords: {
      githubSync: status({ classification: 'SYNC_NO_CHANGE' }),
      postSyncRefresh: status({ finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS' }),
      ignition: status({ status: 'READY' }),
      battleBridge: status(),
      recoveryMesh: status({ classification: 'RECOVERY_MESH_ALL_SERVICES_HEALTHY' }),
      recoveryMeshLaunch: status({ classification: 'RECOVERY_MESH_RUNNER_COMPLETED' }),
      workerWatchdog: status({ classification: 'WORKER_WATCHDOG_HEALTHY' }),
      workerWatchdogLaunch: status({ classification: 'WATCHDOG_RUNNER_COMPLETED' }),
      mailbox: status({ status: 'READY' }),
      missionWorker: status({ status: 'HEALTHY' }),
    },
  });
  assert.equal(record.repository, BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY);
  assert.equal(record.issueNumber, BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE);
  assert.equal(record.sourceHead, HEAD);
  assert.equal(record.branch, 'main');
  assert.equal(record.readOnly, true);
  assert.equal(record.sourceMutationAllowed, false);
  assert.equal(record.taskMutationAllowed, false);
  assert.equal(record.processRestartAllowed, false);
  assert.equal(record.arbitraryShellAllowed, false);
  assert.equal(record.destructiveGitAllowed, false);
  assert.equal(record.liveOpenClawUpdateAllowed, false);
  assert.equal(record.pcRestartAllowed, false);
  assert.equal(record.secretValuesPublished, false);
  assert.equal(record.blockerCount, 0);
  assert.equal(record.freshness, 'FRESH');
  assert.deepEqual(record.surfaces.map((surface) => surface.id), [
    'githubSync',
    'postSyncRefresh',
    'ignition',
    'battleBridge',
    'recoveryMesh',
    'recoveryMeshLaunch',
    'workerWatchdog',
    'workerWatchdogLaunch',
    'mailbox',
    'missionWorker',
  ]);
});

test('missing and stale status cannot be painted green', () => {
  const missing = projectBeaconStatus(null, { id: 'x', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(missing.state, 'UNPROVEN');
  const stale = projectBeaconStatus(status({ timestampUtc: '2026-08-18T14:20:00Z' }), { id: 'x', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(stale.state, 'STALE');
});

test('fresh typed watchdog and Recovery Mesh failures degrade the beacon instead of disappearing', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-18T14:31:00.000Z'),
    statusRecords: {
      recoveryMeshLaunch: status({ classification: 'RECOVERY_MESH_RUNNER_FAILED', blocker: 'RECOVERY_MESH_RUNNER_FAILED' }),
      workerWatchdog: status({ classification: 'WORKER_WATCHDOG_RECOVERY_FAILED', blocker: 'WORKER_WATCHDOG_RECOVERY_FAILED' }),
      workerWatchdogLaunch: status({ classification: 'WATCHDOG_RUNNER_COMPLETED' }),
    },
  });
  assert.equal(record.freshness, 'DEGRADED');
  assert.ok(record.blockers.includes('recoveryMeshLaunch:RECOVERY_MESH_RUNNER_FAILED'));
  assert.ok(record.blockers.includes('workerWatchdog:WORKER_WATCHDOG_RECOVERY_FAILED'));
});

test('beacon body is one bounded marker plus json record', () => {
  const record = buildBattleBridgeOutboundBeacon({ sourceHead: HEAD, now: new Date('2026-08-18T14:31:00Z') });
  const body = buildBattleBridgeOutboundBeaconBody(record);
  assert.match(body, new RegExp(BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /stephanos\.battle-bridge-outbound-health-beacon\.v1/);
  assert.doesNotMatch(body, /password|private key|authorization|bearer/i);
});

test('invalid source head fails closed', () => {
  assert.throws(() => buildBattleBridgeOutboundBeacon({ sourceHead: 'not-a-head' }), /OUTBOUND_BEACON_SOURCE_HEAD_INVALID/);
});