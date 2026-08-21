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
      recoveryMesh: status(),
      mailbox: status(),
      missionWorker: status(),
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
});

test('missing and stale status cannot be painted green', () => {
  const missing = projectBeaconStatus(null, { id: 'x', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(missing.state, 'UNPROVEN');
  const stale = projectBeaconStatus(status({ timestampUtc: '2026-08-18T14:20:00Z' }), { id: 'x', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(stale.state, 'STALE');
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
    commandComment({ requestId: 'foreign-command-0000001', user: 'attacker' }),
    commandComment({ requestId: 'foreign-repository-0001', repository: 'other/repo' }),
    commandComment({ requestId: 'fresh-command-000000001', createdAt: '2026-08-21T00:15:00.000Z' }),
  ];
  const ingress = projectMailboxIngressLiveness(comments, {
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
  });
  assert.deepEqual(ingress, { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
});

test('unavailable ingress observation downgrades a locally READY mailbox but never overrides an already-stale mailbox', () => {
  const unavailable = { state: 'UNPROVEN', blocker: 'MAILBOX_INGRESS_OBSERVATION_UNAVAILABLE', pendingRequestCount: 0 };
  const ready = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
    statusRecords: { mailbox: status({ timestampUtc: '2026-08-21T00:19:00.000Z', status: 'READY' }) },
    mailboxIngressObservation: unavailable,
  }).surfaces.find((surface) => surface.id === 'mailbox');
  assert.equal(ready.state, 'UNPROVEN');
  assert.equal(ready.blocker, 'MAILBOX_INGRESS_OBSERVATION_UNAVAILABLE');

  const stale = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
    statusRecords: { mailbox: status({ timestampUtc: '2026-08-20T20:00:00.000Z', status: 'READY' }) },
    mailboxIngressObservation: unavailable,
  }).surfaces.find((surface) => surface.id === 'mailbox');
  assert.equal(stale.state, 'STALE');
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
