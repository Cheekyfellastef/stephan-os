import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE,
  BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER,
  BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY,
  MAILBOX_INGRESS_LOOKBACK_MS,
  MAILBOX_INGRESS_MAX_PAGES,
  MAILBOX_INGRESS_PAGE_SIZE,
  buildBattleBridgeOutboundBeacon,
  buildBattleBridgeOutboundBeaconBody,
  projectBeaconStatus,
  projectControllerLaneBeaconFacts,
  projectMailboxIngressLiveness,
  readRecentMailboxComments,
  projectMailboxPulseFacts,
  projectSovereignRepairBeaconFacts,
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
      issueNumber: 2808,
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
      issueNumber: 2808,
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

test('mailbox surface publishes bounded Sync pulse telemetry without exposing private fields', () => {
  const pulseRecord = {
    schemaVersion: 'stephanos.battle-bridge-sync-and-refresh-status.v1',
    observedAtUtc: '2026-10-02T17:40:00.000Z',
    sourceHead: HEAD,
    mailboxPulseObserved: true,
    mailboxPulse: {
      ok: false,
      classification: 'MAILBOX_PULSE_BLOCKED',
      blocker: 'MAILBOX_OUTBOX_GUARD_FAILED',
      detailCode: 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING',
      finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
      pulseAttempted: true,
      privatePath: 'C:/private',
    },
  };
  assert.deepEqual(projectMailboxPulseFacts(pulseRecord), {
    observed: true,
    observedAtUtc: '2026-10-02T17:40:00.000Z',
    sourceHead: HEAD,
    ok: false,
    classification: 'MAILBOX_PULSE_BLOCKED',
    blocker: 'MAILBOX_OUTBOX_GUARD_FAILED',
    detailCode: 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING',
    finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
    pulseAttempted: true,
  });

  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-02T17:40:05.000Z'),
    statusRecords: { mailbox: status({ timestampUtc: '2026-10-02T17:40:00.000Z', status: 'READY' }) },
    mailboxIngressObservation: { state: 'UNPROVEN', blocker: 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF', pendingRequestCount: 0 },
    syncAndRefreshRecord: pulseRecord,
  });
  const mailbox = record.surfaces.find((surface) => surface.id === 'mailbox');
  assert.equal(mailbox.mailboxPulseFacts.observed, true);
  assert.equal(mailbox.mailboxPulseFacts.blocker, 'MAILBOX_OUTBOX_GUARD_FAILED');
  assert.equal(mailbox.mailboxPulseFacts.detailCode, 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING');
  assert.doesNotMatch(JSON.stringify(mailbox.mailboxPulseFacts), /C:\/private/);
});

test('matching trusted ACCEPTED receipt preserves normal mailbox readiness', () => {
  const ingress = projectMailboxIngressLiveness([commandComment(), receiptComment()], {
    sourceHead: HEAD,
    now: new Date('2026-08-21T00:20:00.000Z'),
  });
  assert.deepEqual(ingress, { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
});

test('expired unaccepted exact-head command no longer blocks the live bounded lookback', () => {
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
    state: 'UNPROVEN',
    blocker: 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF',
    pendingRequestCount: 0,
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


test('outbound beacon exposes controller lane proof without changing telemetry surface count', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-06T16:00:30.000Z'),
    statusRecords: {
      controllerLaneStatus: {
        statusId: 'controller-lane-status-current',
        controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
        timestampUtc: '2026-10-06T16:00:00.000Z',
        controllerLaneStatus: {
          capturedAtUtc: '2026-10-06T16:00:00.000Z',
          physical: {
            expected: 5,
            building: 0,
            amber: 0,
            red: 1,
            unknown: 0,
            allCurrent: true,
            allObservedEnabled: true,
            finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED',
            controllers: [{
              controllerId: 'octopus-controller',
              freshness: 'CURRENT',
              activityState: 'IDLE',
              trafficLight: 'RED',
              materialLaneCount: 0,
              activeLaneCount: 0,
              parkedLaneCount: 0,
              safeEligibleWorkRemaining: 2,
              blocker: 'CONTROLLER_NO_MATERIAL_PROGRESS',
            }],
          },
          logical: {
            current: true,
            valid: true,
            physicalControllerCount: 5,
            total: 4,
            active: 0,
            tracking: 4,
            parked: 0,
            retired: 0,
            selectedForAdmission: 1,
            finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
            blockers: [],
          },
          lanes: {
            targetMaterialLanes: 15,
            activeMaterialLaneCount: 0,
            activeLaneClaimCount: 0,
            freeTargetLaneSlots: 15,
            runnableBacklogCount: 2,
            parkedPhysicalLaneCount: 0,
            refillHealth: 'RED',
            refillState: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
          },
        },
      },
    },
  });
  assert.equal(record.controllerLaneStatus.trafficLight, 'RED');
  assert.equal(record.controllerLaneStatus.physical.controllers[0].controllerId, 'octopus-controller');
  assert.equal(record.controllerLaneStatus.lanes.runnableBacklogCount, 2);
  assert.equal(record.surfaces.some((surface) => surface.id === 'controllerLaneStatus'), false);
  assert.equal(record.telemetry.requiredSurfaceCount, 7);
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

test('mailbox ingress observation walks bounded newest pages instead of buffering the whole issue', () => {
  const observedAt = new Date('2026-08-21T04:00:00.000Z');
  const calls = [];
  const comments = Array.from({ length: 75 }, (_, index) => ({
    id: index + 1,
    created_at: new Date(Date.parse('2026-08-20T22:30:00.000Z') + index * 5 * 60 * 1000).toISOString(),
    user: { login: OWNER },
    body: index === 74 ? commandComment({ requestId: 'bounded-page-probe-0001' }).body : 'noise',
  }));
  const runCommand = (_exe, args) => {
    calls.push(args);
    const endpoint = String(args[1] || '');
    if (!endpoint.includes('/comments?')) {
      return { ok: true, stdout: JSON.stringify({ comments: comments.length }) };
    }
    const query = new URL('https://example.invalid/?' + endpoint.split('?')[1]).searchParams;
    const page = Number(query.get('page'));
    const perPage = Number(query.get('per_page'));
    const start = (page - 1) * perPage;
    return { ok: true, stdout: JSON.stringify(comments.slice(start, start + perPage)) };
  };

  const result = readRecentMailboxComments('C:/repo', observedAt, {
    runCommand,
    pageSize: 25,
    maxPages: 4,
  });

  assert.ok(result.length > 0);
  assert.ok(result.every((comment) => Date.parse(comment.created_at) >= Date.parse('2026-08-21T00:00:00.000Z')));
  assert.equal(calls.some((args) => args.includes('--paginate')), false);
  assert.equal(calls.some((args) => args.includes('--slurp')), false);
  assert.ok(calls.length <= 7);
});

test('mailbox ingress observation fails closed when the four-hour window exceeds bounded page coverage', () => {
  const observedAt = new Date('2026-08-21T04:00:00.000Z');
  const total = MAILBOX_INGRESS_PAGE_SIZE * (MAILBOX_INGRESS_MAX_PAGES + 2);
  const recent = Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    created_at: new Date(Date.parse('2026-08-21T03:00:00.000Z') + index * 1000).toISOString(),
    user: { login: OWNER },
    body: 'noise',
  }));
  const runCommand = (_exe, args) => {
    const endpoint = String(args[1] || '');
    if (!endpoint.includes('/comments?')) return { ok: true, stdout: JSON.stringify({ comments: total }) };
    const query = new URL('https://example.invalid/?' + endpoint.split('?')[1]).searchParams;
    const page = Number(query.get('page'));
    const perPage = Number(query.get('per_page'));
    const start = (page - 1) * perPage;
    return { ok: true, stdout: JSON.stringify(recent.slice(start, start + perPage)) };
  };

  assert.throws(
    () => readRecentMailboxComments('C:/repo', observedAt, { runCommand }),
    /OUTBOUND_BEACON_MAILBOX_INGRESS_LOOKBACK_EXCEEDS_BOUNDED_PAGE_WINDOW/,
  );
});

test('mailbox ingress tail probe includes a receipt posted after an exact-multiple comment count snapshot', () => {
  const observedAt = new Date('2026-08-21T04:00:00.000Z');
  const calls = [];
  const pageSize = 25;
  const command = commandComment({
    requestId: 'tail-race-probe-0001',
    createdAt: '2026-08-21T03:20:00.000Z',
    expiresAt: '2026-08-21T05:00:00.000Z',
  });
  const receipt = receiptComment({
    requestId: 'tail-race-probe-0001',
    createdAt: '2026-08-21T03:21:00.000Z',
  });
  const filler = Array.from({ length: 49 }, (_, index) => ({
    id: index + 10,
    created_at: new Date(Date.parse('2026-08-20T23:30:00.000Z') + index * 4 * 60 * 1000).toISOString(),
    user: { login: OWNER },
    body: 'noise',
  }));
  const snapshotComments = [...filler, { ...command, id: 1000 }];
  const runCommand = (_exe, args) => {
    calls.push(args);
    const endpoint = String(args[1] || '');
    if (!endpoint.includes('/comments?')) {
      return { ok: true, stdout: JSON.stringify({ comments: 50 }) };
    }
    const query = new URL('https://example.invalid/?' + endpoint.split('?')[1]).searchParams;
    const page = Number(query.get('page'));
    const perPage = Number(query.get('per_page'));
    if (page === 3) {
      const pageThreeReads = calls.filter((call) => String(call[1] || '').includes('page=3')).length;
      return { ok: true, stdout: JSON.stringify(pageThreeReads >= 2 ? [{ ...receipt, id: 2000 }] : []) };
    }
    const start = (page - 1) * perPage;
    return { ok: true, stdout: JSON.stringify(snapshotComments.slice(start, start + perPage)) };
  };

  const comments = readRecentMailboxComments('C:/repo', observedAt, {
    runCommand,
    pageSize,
    maxPages: 4,
  });
  const ingress = projectMailboxIngressLiveness(comments, {
    sourceHead: HEAD,
    now: observedAt,
    graceMs: 10 * 60 * 1000,
  });

  assert.equal(comments.some((comment) => comment.id === 2000), true);
  assert.deepEqual(ingress, { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
});

test('mailbox ingress tail reprobe includes a receipt appended to the metadata-derived last page', () => {
  const observedAt = new Date('2026-08-21T04:00:00.000Z');
  const calls = [];
  const pageSize = 25;
  const command = commandComment({
    requestId: 'tail-fill-probe-0001',
    createdAt: '2026-08-21T03:20:00.000Z',
    expiresAt: '2026-08-21T05:00:00.000Z',
  });
  const receipt = receiptComment({
    requestId: 'tail-fill-probe-0001',
    createdAt: '2026-08-21T03:21:00.000Z',
  });
  const filler = Array.from({ length: 48 }, (_, index) => ({
    id: index + 10,
    created_at: new Date(Date.parse('2026-08-20T23:30:00.000Z') + index * 4 * 60 * 1000).toISOString(),
    user: { login: OWNER },
    body: 'noise',
  }));
  const snapshotComments = [...filler, { ...command, id: 1000 }];
  let pageTwoReads = 0;
  const runCommand = (_exe, args) => {
    calls.push(args);
    const endpoint = String(args[1] || '');
    if (!endpoint.includes('/comments?')) {
      return { ok: true, stdout: JSON.stringify({ comments: 49 }) };
    }
    const query = new URL('https://example.invalid/?' + endpoint.split('?')[1]).searchParams;
    const page = Number(query.get('page'));
    const perPage = Number(query.get('per_page'));
    const start = (page - 1) * perPage;
    if (page === 2) {
      pageTwoReads += 1;
      const nextComments = pageTwoReads >= 2
        ? [...snapshotComments, { ...receipt, id: 2000 }]
        : snapshotComments;
      return { ok: true, stdout: JSON.stringify(nextComments.slice(start, start + perPage)) };
    }
    return { ok: true, stdout: JSON.stringify(snapshotComments.slice(start, start + perPage)) };
  };

  const comments = readRecentMailboxComments('C:/repo', observedAt, {
    runCommand,
    pageSize,
    maxPages: 4,
  });
  const ingress = projectMailboxIngressLiveness(comments, {
    sourceHead: HEAD,
    now: observedAt,
    graceMs: 10 * 60 * 1000,
  });

  assert.equal(pageTwoReads >= 2, true);
  assert.equal(comments.some((comment) => comment.id === 2000), true);
  assert.deepEqual(ingress, { state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
});


test('fresh exact-head Sovereign repair report projects GREEN proof', () => {
  const report = {
    reportSchema: 'stephanos.sovereign-commander-repair-report.v1',
    statusId: 'sovereign-commander-repair-current',
    timestampUtc: '2026-10-05T22:30:00.000Z',
    status: 'READY',
    outcome: 'HEALTHY',
    cycleId: 'cycle-proof-001',
    sourceHead: HEAD,
    detectedFaults: [],
    actions: [
      { actionId: 'status-stephanos-core-daemon', ok: true, finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS', blocker: '' },
    ],
    verification: {
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      heartbeatFresh: true,
      busyGraceActive: false,
      heartbeatAgeSeconds: 2,
    },
  };
  const projected = projectSovereignRepairBeaconFacts(
    report,
    HEAD,
    Date.parse('2026-10-05T22:30:30.000Z'),
  );
  assert.equal(projected.trafficLight, 'GREEN');
  assert.equal(projected.state, 'HEALTHY');
  assert.equal(projected.exactHeadMatch, true);
  assert.equal(projected.verification.awake, true);
  assert.equal(projected.finalVerdict, 'SOVEREIGN_REPAIR_PROOF_GREEN');
});

test('Sovereign repair proof never paints missing stale wrong-head or blocked truth green', () => {
  const nowMs = Date.parse('2026-10-05T22:30:30.000Z');
  const base = {
    reportSchema: 'stephanos.sovereign-commander-repair-report.v1',
    statusId: 'sovereign-commander-repair-current',
    timestampUtc: '2026-10-05T22:30:00.000Z',
    status: 'READY',
    outcome: 'HEALTHY',
    cycleId: 'cycle-proof-002',
    sourceHead: HEAD,
    detectedFaults: [],
    actions: [],
    verification: {},
  };
  assert.equal(projectSovereignRepairBeaconFacts(null, HEAD, nowMs).trafficLight, 'GREY');
  assert.equal(projectSovereignRepairBeaconFacts(
    { ...base, timestampUtc: '2026-10-05T22:20:00.000Z' },
    HEAD,
    nowMs,
  ).trafficLight, 'AMBER');
  assert.equal(projectSovereignRepairBeaconFacts(
    { ...base, sourceHead: 'b'.repeat(40) },
    HEAD,
    nowMs,
  ).trafficLight, 'AMBER');
  const blocked = projectSovereignRepairBeaconFacts({
    ...base,
    status: 'ATTENTION_REQUIRED',
    outcome: 'BLOCKED',
    detectedFaults: ['BACKEND_8787_UNHEALTHY_AFTER_REPAIR'],
  }, HEAD, nowMs);
  assert.equal(blocked.trafficLight, 'RED');
  assert.equal(blocked.blocker, 'BACKEND_8787_UNHEALTHY_AFTER_REPAIR');
});

test('Sovereign repair proof is bounded and strips unsafe path-like material', () => {
  const projected = projectSovereignRepairBeaconFacts({
    reportSchema: 'stephanos.sovereign-commander-repair-report.v1',
    statusId: 'sovereign-commander-repair-current',
    timestampUtc: '2026-10-05T22:30:00.000Z',
    status: 'ATTENTION_REQUIRED',
    outcome: 'BLOCKED',
    cycleId: 'cycle-proof-003',
    sourceHead: HEAD,
    detectedFaults: ['C:/Users/private/token.txt', 'SAFE_BLOCKER'],
    actions: [{
      actionId: 'repair-step',
      ok: false,
      finalVerdict: 'BLOCKED',
      blocker: 'C:/private/path',
    }],
    verification: {},
  }, HEAD, Date.parse('2026-10-05T22:30:30.000Z'));
  const serialized = JSON.stringify(projected);
  assert.deepEqual(projected.detectedFaults, ['SAFE_BLOCKER']);
  assert.equal(projected.actions[0].blocker, '');
  assert.doesNotMatch(serialized, /C:\/|C:\\\\|private\/path|token\.txt/i);
  assert.equal(projected.rawPathsReturned, false);
  assert.equal(projected.secretMaterialIncluded, false);
});


test('controller lane proof exposes bounded red physical and logical blockers without paths', () => {
  const projected = projectControllerLaneBeaconFacts({
    statusId: 'controller-lane-status-current',
    controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    timestampUtc: '2026-10-06T16:00:00.000Z',
    controllerLaneStatus: {
      capturedAtUtc: '2026-10-06T16:00:00.000Z',
      physical: {
        expected: 5,
        building: 0,
        amber: 0,
        red: 1,
        unknown: 0,
        allCurrent: true,
        allObservedEnabled: true,
        finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED',
        controllers: [
          {
            controllerId: 'controller-1',
            freshness: 'CURRENT',
            activityState: 'IDLE',
            trafficLight: 'RED',
            materialLaneCount: 0,
            activeLaneCount: 0,
            parkedLaneCount: 0,
            safeEligibleWorkRemaining: 3,
            blocker: 'CONTROLLER_HEARTBEAT_STALE',
          },
          {
            controllerId: 'controller-2',
            freshness: 'CURRENT',
            activityState: 'IDLE',
            trafficLight: 'AMBER',
            materialLaneCount: 0,
            activeLaneCount: 0,
            parkedLaneCount: 0,
            safeEligibleWorkRemaining: 0,
            blocker: 'C:/private/path',
          },
        ],
      },
      logical: {
        current: true,
        valid: false,
        physicalControllerCount: 5,
        total: 12,
        active: 0,
        tracking: 12,
        parked: 0,
        retired: 0,
        selectedForAdmission: 1,
        finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_HOLD',
        blockers: ['MISSION_SCHEDULER_SCHEMA_INVALID_OR_MISSING'],
      },
      lanes: {
        targetMaterialLanes: 15,
        activeMaterialLaneCount: 0,
        activeLaneClaimCount: 0,
        freeTargetLaneSlots: 15,
        runnableBacklogCount: 3,
        parkedPhysicalLaneCount: 0,
        refillHealth: 'RED',
        refillState: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
      },
    },
  }, Date.parse('2026-10-06T16:00:30.000Z'));

  assert.equal(projected.available, true);
  assert.equal(projected.trafficLight, 'RED');
  assert.equal(projected.physical.red, 1);
  assert.equal(projected.physical.controllers[0].controllerId, 'controller-1');
  assert.equal(projected.physical.controllers[0].blocker, 'CONTROLLER_HEARTBEAT_STALE');
  assert.equal(projected.physical.controllers[1].blocker, '');
  assert.equal(projected.logical.valid, false);
  assert.deepEqual(projected.logical.blockers, ['MISSION_SCHEDULER_SCHEMA_INVALID_OR_MISSING']);
  assert.equal(projected.lanes.runnableBacklogCount, 3);
  assert.equal(projected.lanes.freeTargetLaneSlots, 15);
  assert.ok(projected.attentionBlockers.includes('CONTROLLER_HEARTBEAT_STALE'));
  assert.ok(projected.attentionBlockers.includes('MISSION_SCHEDULER_SCHEMA_INVALID_OR_MISSING'));
  assert.equal(projected.sourceHeadBound, false);
  assert.equal(projected.exactHeadMatch, null);
  assert.equal(projected.unknownMeansGreen, false);
  assert.doesNotMatch(JSON.stringify(projected), /C:\/private|private\/path/i);
});

test('controller lane proof never paints fresh but unbound green status green', () => {
  const projected = projectControllerLaneBeaconFacts({
    statusId: 'controller-lane-status-current',
    controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    timestampUtc: '2026-10-06T16:00:00.000Z',
    controllerLaneStatus: {
      capturedAtUtc: '2026-10-06T16:00:00.000Z',
      physical: {
        expected: 5,
        building: 0,
        amber: 0,
        red: 0,
        unknown: 0,
        allCurrent: true,
        allObservedEnabled: true,
        finalVerdict: 'CONTROLLER_FLEET_READY',
        controllers: [],
      },
      logical: {
        current: true,
        valid: true,
        physicalControllerCount: 5,
        total: 0,
        active: 0,
        tracking: 0,
        parked: 0,
        retired: 0,
        selectedForAdmission: 0,
        finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
        blockers: [],
      },
      lanes: {
        targetMaterialLanes: 15,
        activeMaterialLaneCount: 0,
        activeLaneClaimCount: 0,
        freeTargetLaneSlots: 15,
        runnableBacklogCount: 0,
        parkedPhysicalLaneCount: 0,
        refillHealth: 'GREEN',
        refillState: 'NO_SAFE_ELIGIBLE_WORK_REPORTED',
      },
    },
  }, Date.parse('2026-10-06T16:00:30.000Z'));
  assert.equal(projected.trafficLight, 'AMBER');
  assert.equal(projected.finalVerdict, 'CONTROLLER_LANE_PROOF_UNPROVEN');
  assert.equal(projected.sourceHeadBound, false);
});


test('outbound beacon exposes Sovereign repair proof without changing telemetry surface count', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-05T22:30:30.000Z'),
    statusRecords: {
      sovereignRepair: {
        reportSchema: 'stephanos.sovereign-commander-repair-report.v1',
        statusId: 'sovereign-commander-repair-current',
        timestampUtc: '2026-10-05T22:30:00.000Z',
        status: 'READY',
        outcome: 'HEALTHY',
        cycleId: 'cycle-proof-004',
        sourceHead: HEAD,
        detectedFaults: [],
        actions: [],
        verification: { readiness: 'READY', wakeState: 'AWAKE', awake: true, heartbeatFresh: true },
      },
    },
  });
  assert.equal(record.sovereignRepair.trafficLight, 'GREEN');
  assert.equal(record.sovereignRepair.outcome, 'HEALTHY');
  assert.equal(record.surfaces.some((surface) => surface.id === 'sovereignRepair'), false);
  assert.equal(record.telemetry.requiredSurfaceCount, 7);
});
