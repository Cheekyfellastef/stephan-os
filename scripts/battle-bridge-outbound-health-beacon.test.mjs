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

test('projection recognizes source-bound post-sync head and Ignition generatedAt fields', () => {
  const postSync = projectBeaconStatus({
    timestampUtc: '2026-08-18T14:20:00Z',
    afterHead: HEAD,
    classification: 'REFRESH_COMPLETE',
  }, { id: 'postSyncRefresh', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(postSync.state, 'STALE');
  assert.equal(postSync.head, HEAD);
  assert.equal(postSync.rawState, 'REFRESH_COMPLETE');

  const ignition = projectBeaconStatus({
    generatedAt: '2026-08-18T14:30:30Z',
    trafficLight: 'green',
  }, { id: 'ignition', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(ignition.state, 'GREEN');
  assert.equal(ignition.observedAtUtc, '2026-08-18T14:30:30.000Z');
});

test('projection publishes only sanitized dirt counts plus bounded service/runtime identity', () => {
  const projected = projectBeaconStatus({
    timestampUtc: '2026-08-18T14:30:30Z',
    classification: 'SYNC_NO_CHANGE',
    sourceHead: HEAD,
    dirtClassification: {
      trackedSourceCount: 1,
      untrackedSourceCount: 2,
      unknownCount: 0,
      runtimeOnlyCount: 3,
      generatedSourceCount: 4,
      blocksSync: true,
      blockingSamples: ['secret/private-path.txt'],
    },
    housekeeper: { state: 'READY', sourceHead: HEAD, completedAt: '2026-08-18T14:30:20Z' },
    servedRuntimeProof: { sourceHead: HEAD },
    builtHead: HEAD,
    runtimeHead: HEAD,
    observedServiceFacts: { backend: { ready: true, state: 'READY', sourceHead: HEAD, path: 'C:/private' } },
  }, { id: 'githubSync', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(projected.dirtFacts.known, true);
  assert.equal(projected.dirtFacts.blocksSync, true);
  assert.equal(projected.dirtFacts.blockingCount, 3);
  assert.equal(projected.dirtFacts.pathValuesPublished, false);
  assert.equal(projected.housekeeperFacts.observed, true);
  assert.equal(projected.housekeeperFacts.head, HEAD);
  assert.equal(projected.runtimeHeads.builtHead, HEAD);
  assert.equal(projected.runtimeHeads.servedHead, HEAD);
  assert.equal(projected.runtimeHeads.runtimeHead, HEAD);
  assert.deepEqual(projected.serviceFacts.backend, { ready: true, state: 'READY', head: HEAD });
  assert.doesNotMatch(JSON.stringify(projected), /private-path|C:\/private/);
});

test('mission worker phase is usable state evidence instead of collapsing to UNKNOWN', () => {
  const worker = projectBeaconStatus({
    timestampUtc: '2026-08-18T14:30:30Z',
    phase: 'MISSION_WORKER_TICK_PASS',
    headSha: HEAD,
  }, { id: 'missionWorker', staleAfterMs: 60_000 }, Date.parse('2026-08-18T14:31:00Z'));
  assert.equal(worker.state, 'MISSION_WORKER_TICK_PASS');
  assert.equal(worker.head, HEAD);
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
  assert.equal(mailbox.ingressState, 'BLOCKED_COMMAND_INGRESS_UNOBSERVED');
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

test('beacon embeds thirteen-class complete-state telemetry and separates read-only diagnosis from consequential repair', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
    statusRecords: {
      githubSync: status({
        timestampUtc: '2026-08-21T00:19:30.000Z',
        classification: 'SYNC_NO_CHANGE',
        dirtClassification: { trackedSourceCount: 0, untrackedSourceCount: 0, unknownCount: 0, runtimeOnlyCount: 1, generatedSourceCount: 0, blocksSync: false },
        housekeeper: { state: 'READY', sourceHead: HEAD, completedAt: '2026-08-21T00:19:20.000Z' },
      }),
      postSyncRefresh: status({ timestampUtc: '2026-08-20T23:00:00.000Z', afterHead: HEAD, classification: 'REFRESH_COMPLETE', sourceHead: '' }),
      ignition: { generatedAt: '2026-08-20T23:00:00.000Z', trafficLight: 'green', sourceHead: HEAD },
      battleBridge: status({
        timestampUtc: '2026-08-21T00:19:30.000Z',
        status: 'READY',
        builtHead: HEAD,
        servedRuntimeProof: { sourceHead: HEAD },
        runtimeHead: HEAD,
        observedServiceFacts: {
          backend: { ready: true, state: 'READY', sourceHead: HEAD },
          'stephanos-ui': { ready: true, state: 'READY', sourceHead: HEAD },
          'openclaw-gateway': { ready: true, state: 'READY', sourceHead: HEAD },
          'shared-workspace': { ready: true, state: 'READY', sourceHead: HEAD },
        },
      }),
      mailbox: status({ timestampUtc: '2026-08-21T00:19:30.000Z', status: 'READY' }),
      missionWorker: status({ timestampUtc: '2026-08-21T00:19:30.000Z', phase: 'MISSION_WORKER_TICK_PASS', status: '', headSha: HEAD, sourceHead: '' }),
    },
    mailboxIngressObservation: { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 },
  });
  assert.equal(record.telemetry.schemaVersion, 'stephanos.battle-bridge-telemetry-autorepair.v1');
  assert.equal(record.telemetry.executive.questionCount, 13);
  assert.equal(record.telemetry.coverage.find((entry) => entry.surfaceId === 'postSyncRefresh').answered, true);
  assert.equal(record.telemetry.coverage.find((entry) => entry.surfaceId === 'recoveryMesh').answered, false);
  assert.equal(record.telemetry.repairCandidates.find((entry) => entry.surfaceId === 'recoveryMesh').repairDisposition, 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED');
  assert.equal(record.operatorAuthorizationState, 'OPERATOR_AUTHORIZATION_NOT_PRESENT');
  assert.equal(record.operatorNeeded, true);
  assert.equal(record.telemetry.executive.executionAuthorizedByTelemetry, false);
  assert.equal(record.telemetry.executive.authorityGrantedByTelemetry, false);
});

test('qualified fixed self-heal can be identified but never authorized by the beacon itself', () => {
  const base = {
    githubSync: status({ classification: 'SYNC_NO_CHANGE', dirtClassification: { trackedSourceCount: 0, untrackedSourceCount: 0, unknownCount: 0, blocksSync: false }, housekeeper: { state: 'READY', sourceHead: HEAD } }),
    postSyncRefresh: status({ classification: 'REFRESH_COMPLETE' }),
    ignition: status({ status: 'READY' }),
    recoveryMesh: status({ status: 'READY' }),
    mailbox: status({ status: 'READY' }),
    missionWorker: status({ status: '', phase: 'MISSION_WORKER_TICK_PASS', headSha: HEAD, sourceHead: '' }),
    battleBridge: status({
      status: 'READY', builtHead: HEAD, servedRuntimeProof: { sourceHead: HEAD }, runtimeHead: HEAD,
      observedServiceFacts: {
        backend: { ready: false, state: 'DEGRADED', sourceHead: HEAD },
        'stephanos-ui': { ready: true, state: 'READY', sourceHead: HEAD },
        'openclaw-gateway': { ready: true, state: 'READY', sourceHead: HEAD },
        'shared-workspace': { ready: true, state: 'READY', sourceHead: HEAD },
      },
    }),
  };
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-18T14:31:00.000Z'),
    statusRecords: base,
    mailboxIngressObservation: { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 },
    qualifiedRepairPolicies: [{
      policyId: 'backend-fixed-v1', exactHead: HEAD, repairRoute: 'BACKEND_8787_RECONCILIATION', targetIds: ['backend'],
      reviewed: true, fixedCommand: true, reversible: true, operatorNeeded: false, authorityWideningAllowed: false,
    }],
  });
  assert.equal(record.telemetry.executive.qualifiedSelfHealEligible, true);
  assert.equal(record.nextAutomaticAction, 'QUALIFIED_FIXED_SELF_HEAL');
  assert.equal(record.operatorNeeded, false);
  assert.equal(record.telemetry.executive.executionAuthorizedByTelemetry, false);
  assert.equal(record.processRestartAllowed, false);
});

test('beacon body is one bounded marker plus json record without secret-bearing material', () => {
  const record = buildBattleBridgeOutboundBeacon({ sourceHead: HEAD, now: new Date('2026-08-18T14:31:00Z') });
  const body = buildBattleBridgeOutboundBeaconBody(record);
  assert.match(body, new RegExp(BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /stephanos\.battle-bridge-outbound-health-beacon\.v1/);
  assert.doesNotMatch(body, /password|private key|bearer/i);
});

test('invalid source head fails closed', () => {
  assert.throws(() => buildBattleBridgeOutboundBeacon({ sourceHead: 'not-a-head' }), /OUTBOUND_BEACON_SOURCE_HEAD_INVALID/);
});