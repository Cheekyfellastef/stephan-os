import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE,
  BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER,
  BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY,
  MAILBOX_INGRESS_LOOKBACK_MS,
  buildBattleBridgeOutboundBeacon,
  buildBattleBridgeOutboundBeaconBody,
  projectBeaconStatus,
  projectMailboxIngressLiveness,
  projectMailboxReceipts,
} from './battle-bridge-outbound-health-beacon.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = 'Cheekyfellastef';

function status(overrides = {}) {
  return {
    timestampUtc: '2026-08-18T14:30:00.000Z',
    status: 'HEALTHY',
    sourceHead: HEAD,
    ...overrides,
  };
}

function commandComment({
  requestId = 'beacon-ingress-diagnostic-0001',
  expectedHead = HEAD,
  createdAt = '2026-08-21T00:00:00.000Z',
  expiresAt = '2026-08-21T02:00:00.000Z',
  user = OWNER,
  repository = 'Cheekyfellastef/stephan-os',
} = {}) {
  return {
    id: 1,
    created_at: createdAt,
    user: { login: user },
    body: `\`\`\`stephanos-battle-bridge-command\n${JSON.stringify({
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId,
      operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
      repository,
      issueNumber: 1507,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead,
      expiresAt,
    })}\n\`\`\``,
  };
}

function receiptComment({
  requestId = 'beacon-ingress-diagnostic-0001',
  expectedHead = HEAD,
  createdAt = '2026-08-21T00:05:00.000Z',
  user = OWNER,
} = {}) {
  return {
    id: 2,
    created_at: createdAt,
    user: { login: user },
    body: `<!-- stephanos-battle-bridge-command-receipt -->\n\`\`\`json\n${JSON.stringify({
      schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
      requestId,
      operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1507,
      branch: 'main',
      expectedHead,
      state: 'ACCEPTED',
      acceptedAt: createdAt,
      heartbeatAt: createdAt,
      completedAt: '',
      blocker: '',
      proofRefs: [],
      result: null,
    })}\n\`\`\``,
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
  assert.deepEqual(record.mailboxReceipts, []);
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

test('mailbox receipt projection exposes bounded correlation truth and rejects unsafe detail', () => {
  const receipts = projectMailboxReceipts({
    activeReceipt: {
      requestId: 'bb-recovery-wake-000c1cd1-20260818t1554z',
      operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
      state: 'RUNNING',
      expectedHead: HEAD,
      heartbeatAt: '2026-08-18T15:58:00.000Z',
      blocker: '',
      finalVerdict: 'RECOVERY_WAKE_RUNNING',
    },
    recentReceipts: [
      {
        requestId: 'bb-recovery-wake-000c1cd1-20260818t1554z',
        operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
        state: 'DONE',
        expectedHead: HEAD,
        completedAt: '2026-08-18T15:59:00.000Z',
        blocker: '',
        finalVerdict: 'RECOVERY_MESH_WAKE_DISPATCHED',
      },
      {
        requestId: 'bb-diag-safe-20260818t1559z',
        operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
        state: 'BLOCKED',
        expectedHead: HEAD,
        completedAt: '2026-08-18T16:00:00.000Z',
        blocker: 'C:\\Users\\secret\\leak.txt',
        finalVerdict: 'COMMAND_EXECUTION_BLOCKED',
      },
      { requestId: '../unsafe', operation: 'ARBITRARY', state: 'DONE' },
    ],
  });

  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].requestId, 'bb-recovery-wake-000c1cd1-20260818t1554z');
  assert.equal(receipts[0].state, 'RUNNING');
  assert.equal(receipts[0].expectedHead, HEAD);
  assert.equal(receipts[1].requestId, 'bb-diag-safe-20260818t1559z');
  assert.equal(receipts[1].blocker, '');
  assert.equal(receipts[1].finalVerdict, 'COMMAND_EXECUTION_BLOCKED');
});

test('beacon carries recent sanitized mailbox receipts for remote recovery correlation', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-18T16:01:00.000Z'),
    statusRecords: {
      mailbox: status({
        status: 'READY',
        timestampUtc: '2026-08-18T16:00:59.000Z',
        recentReceipts: [{
          requestId: 'bb-recovery-wake-000c1cd1-20260818t1554z',
          operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
          state: 'DONE',
          expectedHead: HEAD,
          completedAt: '2026-08-18T16:00:30.000Z',
          blocker: 'RECOVERY_MESH_TASK_START_FAILED',
          finalVerdict: 'COMMAND_EXECUTION_BLOCKED',
        }],
      }),
    },
  });

  assert.equal(record.mailboxReceipts.length, 1);
  assert.equal(record.mailboxReceipts[0].requestId, 'bb-recovery-wake-000c1cd1-20260818t1554z');
  assert.equal(record.mailboxReceipts[0].operation, 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH');
  assert.equal(record.mailboxReceipts[0].blocker, 'RECOVERY_MESH_TASK_START_FAILED');
});

test('fresh receipt-index READY cannot hide an exact-head command that never reaches ACCEPTED', () => {
  const ingress = projectMailboxIngressLiveness([commandComment()], {
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
  });
  assert.deepEqual(ingress, {
    state: 'BLOCKED_COMMAND_INGRESS_UNOBSERVED',
    blocker: 'PENDING_EXACT_HEAD_COMMAND_NOT_ACCEPTED',
    pendingRequestCount: 1,
  });

  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
    statusRecords: { mailbox: status({ timestampUtc: '2026-08-21T00:19:00.000Z', status: 'READY' }) },
    mailboxIngressObservation: ingress,
  });
  const mailbox = record.surfaces.find((surface) => surface.id === 'mailbox');
  assert.equal(mailbox.state, 'BLOCKED_COMMAND_INGRESS_UNOBSERVED');
  assert.equal(mailbox.blocker, 'PENDING_EXACT_HEAD_COMMAND_NOT_ACCEPTED');
  assert.ok(record.blockers.includes('mailbox:PENDING_EXACT_HEAD_COMMAND_NOT_ACCEPTED'));
  assert.equal(record.freshness, 'DEGRADED');
});

test('matching trusted ACCEPTED receipt preserves normal mailbox readiness', () => {
  const ingress = projectMailboxIngressLiveness([commandComment(), receiptComment()], {
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
  });
  assert.deepEqual(ingress, { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
});

test('expired unaccepted exact-head command remains blocked across the live bounded lookback', () => {
  assert.ok(MAILBOX_INGRESS_LOOKBACK_MS >= 4 * 60 * 60 * 1000);
  const ingress = projectMailboxIngressLiveness([
    commandComment({
      requestId: 'flywheel-dirt-diag-13f13144-20260820T2358Z',
      createdAt: '2026-08-20T23:58:50.000Z',
      expiresAt: '2026-08-21T01:30:00.000Z',
    }),
  ], {
    sourceHead: HEAD,
    now: new Date('2026-08-21T02:03:50.405Z'),
  });
  assert.deepEqual(ingress, {
    state: 'BLOCKED_COMMAND_INGRESS_UNOBSERVED',
    blocker: 'PENDING_EXACT_HEAD_COMMAND_NOT_ACCEPTED',
    pendingRequestCount: 1,
  });
});

test('a newer mature exact-head command with a correlated receipt supersedes an older missed command', () => {
  const newerRequest = 'beacon-ingress-recovery-0002';
  const ingress = projectMailboxIngressLiveness([
    commandComment({
      requestId: 'beacon-ingress-missed-0001',
      createdAt: '2026-08-20T23:58:50.000Z',
      expiresAt: '2026-08-21T01:30:00.000Z',
    }),
    commandComment({
      requestId: newerRequest,
      createdAt: '2026-08-21T01:40:00.000Z',
      expiresAt: '2026-08-21T03:30:00.000Z',
    }),
    receiptComment({ requestId: newerRequest, createdAt: '2026-08-21T01:55:00.000Z' }),
  ], {
    sourceHead: HEAD,
    now: new Date('2026-08-21T02:03:50.405Z'),
  });
  assert.deepEqual(ingress, { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
});

test('a receipt for the same request id on the wrong head cannot mask exact-head ingress failure', () => {
  const requestId = 'beacon-ingress-head-bind-0001';
  const ingress = projectMailboxIngressLiveness([
    commandComment({ requestId }),
    receiptComment({ requestId, expectedHead: 'b'.repeat(40) }),
  ], {
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
  });
  assert.deepEqual(ingress, {
    state: 'BLOCKED_COMMAND_INGRESS_UNOBSERVED',
    blocker: 'PENDING_EXACT_HEAD_COMMAND_NOT_ACCEPTED',
    pendingRequestCount: 1,
  });
});

test('wrong-head foreign and still-within-grace commands do not create false ingress blockers', () => {
  const comments = [
    commandComment({ requestId: 'wrong-head-command-0001', expectedHead: 'b'.repeat(40) }),
    comm