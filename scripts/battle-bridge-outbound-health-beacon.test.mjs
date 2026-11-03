import { CANONICAL_MAILBOX_ISSUE as activeMailboxIssueForTest } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  buildSovereignCommanderRepairReport,
  SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE,
} from '../shared/agents/sovereignCommanderRepairReportV1.mjs';

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
  projectSovereignRepairContinuity,
  projectSovereignCommanderBeaconFacts,
  readSovereignRepairCycleTail,
  mirrorBattleBridgeCompleteStateToSharedWorkspace,
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
      issueNumber: activeMailboxIssueForTest,
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
      issueNumber: activeMailboxIssueForTest,
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
    schemaVersion: 'shared-agent-workspace-record.v1',
    schema: 'stephanos.battle-bridge-sync-and-refresh-status.v1',
    statusId: 'battle-bridge-sync-and-refresh-current',
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
  assert.equal(projectMailboxPulseFacts({
    ...pulseRecord,
    schemaVersion: 'stephanos.battle-bridge-sync-and-refresh-status.v1',
    schema: undefined,
    statusId: undefined,
  }).observed, true);
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
          schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
          ok: true,
          readOnly: true,
          arbitraryShellAllowed: false,
          sourceMutationAllowed: false,
          mergeAuthority: false,
          secretMaterialIncluded: false,
          unknownMeansGreen: false,
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

const REPAIR_OBSERVED_AT = '2026-10-30T15:00:00.000Z';
const REPAIR_NOW = new Date('2026-10-30T15:00:30.000Z');

function qualifiedMaintenanceReport(repairOverrides = {}) {
  return buildSovereignCommanderRepairReport({
    cycleId: 'qualified-maintenance-beacon', completedAtUtc: REPAIR_OBSERVED_AT,
    repair: {
      scope: SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE, ok: true, blocker: '', sourceHead: HEAD,
      maintenance: {
        actionId: 'repair-goal-builder-flow', profile: 'MAINTENANCE_GOAL_BUILDER_V1',
        operationOk: true, terminalProven: true,
        terminalEvidenceSha256: 'b'.repeat(64), proofHash: 'c'.repeat(64),
      },
      steps: [{ actionId: 'repair-goal-builder-flow', ok: true,
        finalVerdict: 'SOVEREIGN_QUALIFIED_MAINTENANCE_COMPLETED', blocker: '' }],
      ...repairOverrides,
    },
  }).status;
}

test('actual qualified maintenance report reaches the public beacon with bounded evidence and no whole-system health', () => {
  const report = qualifiedMaintenanceReport();
  const withoutRepair = buildBattleBridgeOutboundBeacon({ sourceHead: HEAD, now: REPAIR_NOW });
  const beacon = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD, now: REPAIR_NOW,
    statusRecords: { sovereignRepair: {
      ...report, rawLog: 'PRIVATE_NATIVE_LOG',
      verification: { ...report.verification, privatePath: 'C:/private/native-receipt.json' },
    } },
  });
  const facts = beacon.sovereignRepair;
  assert.equal(facts.available, true);
  assert.equal(facts.state, 'MAINTENANCE_COMPLETED');
  assert.equal(facts.outcome, 'MAINTENANCE_COMPLETED');
  assert.equal(facts.status, 'OBSERVED');
  assert.equal(facts.trafficLight, 'AMBER');
  assert.equal(facts.finalVerdict, 'SOVEREIGN_MAINTENANCE_PROOF_OBSERVED');
  assert.equal(facts.blocker, '');
  assert.equal(facts.exactHeadMatch, true);
  assert.equal(facts.scope, SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE);
  assert.equal(facts.sourceHead, HEAD);
  assert.equal(facts.fullStephanosRepairProven, false);
  assert.deepEqual(facts.actions, report.actions);
  assert.deepEqual(facts.verification, report.verification);
  assert.equal('awake' in facts.verification, false);
  assert.equal(facts.verification.readiness, 'UNPROVEN');
  assert.equal(facts.verification.runtimeQualificationGranted, false);
  assert.deepEqual(beacon.telemetry, withoutRepair.telemetry);
  assert.equal(beacon.completeStateAnswerable, withoutRepair.completeStateAnswerable);
  const body = buildBattleBridgeOutboundBeaconBody(beacon);
  assert.match(body, /MAINTENANCE_COMPLETED/);
  assert.match(body, /QUALIFIED_GOAL_BUILDER_MAINTENANCE/);
  assert.match(body, new RegExp('b'.repeat(64)));
  assert.match(body, new RegExp('c'.repeat(64)));
  assert.doesNotMatch(body, /PRIVATE_NATIVE_LOG|private\/native-receipt/);
});

test('actual blocked maintenance and prelaunch denial retain scope and faults without inventing source or terminal proof', () => {
  for (const sourceHead of [HEAD, '']) {
    const report = qualifiedMaintenanceReport({
      ok: false, blocker: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD', sourceHead,
      maintenance: undefined,
      steps: [{ actionId: 'repair-goal-builder-flow', ok: false,
        finalVerdict: 'SOVEREIGN_QUALIFIED_MAINTENANCE_BLOCKED',
        blocker: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD' }],
    });
    const facts = projectSovereignRepairBeaconFacts(report, HEAD, REPAIR_NOW.getTime());
    assert.equal(facts.available, true);
    assert.equal(facts.outcome, 'BLOCKED');
    assert.equal(facts.status, 'ATTENTION_REQUIRED');
    assert.equal(facts.state, sourceHead ? 'BLOCKED' : 'UNPROVEN');
    assert.equal(facts.trafficLight, sourceHead ? 'RED' : 'AMBER');
    assert.equal(facts.exactHeadMatch, Boolean(sourceHead));
    assert.equal(facts.scope, SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE);
    assert.equal(facts.blocker, 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
    assert.equal(facts.sourceHead, sourceHead);
    assert.deepEqual(facts.actions, report.actions);
    assert.deepEqual(facts.verification, report.verification);
    assert.equal(facts.verification.operationCompleted, false);
    assert.equal(facts.verification.terminalEvidenceSha256, '');
    assert.equal(facts.verification.proofHash, '');
    assert.equal(facts.verification.runtimeQualificationGranted, false);
  }
});

test('scoped report contract rejects malformed identities, missing scope and wider success claims', () => {
  const report = qualifiedMaintenanceReport();
  const verificationVariants = [
    { sourceHead: 'd'.repeat(40) }, { sourceHead: [HEAD] }, { sourceHead: `${HEAD}extra` },
    { maintenanceActionId: 'repair-stephanos' }, { maintenanceProfile: 'SOURCE_TASK_V1' },
    { operationCompleted: false }, { operationCompleted: 'true' },
    { readiness: 'READY' }, { fullStephanosRepairProven: true },
    { runtimeQualificationGranted: true }, { runtimeQualificationGranted: 'false' },
    { terminalEvidenceSha256: '' }, { terminalEvidenceSha256: 'private/path' },
    { terminalEvidenceSha256: 'b'.repeat(65) }, { terminalEvidenceSha256: ['b'.repeat(64)] },
    { proofHash: '' }, { proofHash: 'c'.repeat(63) }, { proofHash: 'c'.repeat(65) },
  ];
  const variants = [
    { scope: undefined }, { scope: null }, { scope: 'ALL_STEPHANOS_REPAIRED' },
    { outcome: 'HEALTHY', status: 'READY' }, { outcome: 'REPAIRED', status: 'READY' },
    { status: 'READY' }, { status: 'ATTENTION_REQUIRED' },
    { sourceHead: '' }, { sourceHead: [HEAD] }, { sourceHead: `${HEAD}extra` },
    { sourceHead: `${HEAD}extra`, verification: { ...report.verification, sourceHead: `${HEAD}extra` } },
    { fullStephanosRepairProven: true }, { fullStephanosRepairProven: undefined },
    { arbitraryShellAllowed: true }, { sourceMutationAllowed: true }, { mergeAuthority: true },
    { detectedFaults: ['UNRESOLVED_FAULT'] }, { actions: [] }, { actions: undefined }, { actions: [null] },
    { actions: [{ ...report.actions[0], ok: false }] },
    { actions: [{ ...report.actions[0], ok: 'true' }] },
    { actions: [{ ...report.actions[0], blocker: 'UNRESOLVED_FAULT' }] },
    { actions: [{ ...report.actions[0], blocker: ' ' }] },
    { actions: [{ ...report.actions[0], blocker: undefined }] },
    { actions: [{ ...report.actions[0], finalVerdict: 'STEPHANOS_ALL_HEALTHY' }] },
    { actions: [{ ...report.actions[0], actionId: 'repair-stephanos' }] },
    { verification: null },
    ...verificationVariants.map(patch => ({ verification: { ...report.verification, ...patch } })),
    { scope: undefined, fullStephanosRepairProven: undefined, outcome: 'HEALTHY', status: 'READY' },
  ];
  for (const patch of variants) {
    const facts = projectSovereignRepairBeaconFacts({ ...report, ...patch }, HEAD, REPAIR_NOW.getTime());
    assert.equal(facts.available, false, JSON.stringify(patch));
    assert.equal(facts.blocker, 'SOVEREIGN_REPAIR_REPORT_INVALID', JSON.stringify(patch));
    assert.notEqual(facts.trafficLight, 'GREEN');
  }
});

test('stale, future-dated and other-head maintenance evidence remains visible without current proof', () => {
  const report = qualifiedMaintenanceReport();
  const variants = [
    { record: { ...report, timestampUtc: '2026-10-30T14:50:00.000Z' }, expectedHead: HEAD, state: 'STALE' },
    { record: { ...report, timestampUtc: '2026-10-30T15:10:00.000Z' }, expectedHead: HEAD, state: 'STALE' },
    { record: report, expectedHead: 'd'.repeat(40), state: 'HEAD_MISMATCH' },
    { record: report, expectedHead: `${HEAD}extra`, state: 'HEAD_MISMATCH' },
    { record: report, expectedHead: [HEAD], state: 'HEAD_MISMATCH' },
  ];
  for (const variant of variants) {
    const facts = projectSovereignRepairBeaconFacts(variant.record, variant.expectedHead, REPAIR_NOW.getTime());
    assert.equal(facts.available, true);
    assert.equal(facts.state, variant.state);
    assert.equal(facts.trafficLight, 'AMBER');
    assert.equal(facts.finalVerdict, 'SOVEREIGN_REPAIR_PROOF_UNPROVEN');
    assert.equal(facts.scope, SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE);
    assert.deepEqual(facts.verification, report.verification);
    assert.ok(facts.blocker);
  }
});

test('actual legacy report outcomes retain their health semantics and unknown heartbeat age', () => {
  const cases = [
    { repair: { ok: true }, outcome: 'HEALTHY', trafficLight: 'GREEN' },
    { repair: { ok: true, steps: [{ actionId: 'caretaker', ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_RESTARTED' }] }, outcome: 'REPAIRED', trafficLight: 'GREEN' },
    { repair: { ok: false }, outcome: 'NEEDS_REPAIR', trafficLight: 'RED' },
    { repair: { ok: false, blocker: 'CORE_HEARTBEAT_UNPROVEN' }, outcome: 'BLOCKED', trafficLight: 'RED' },
  ];
  for (const fixture of cases) {
    const report = buildSovereignCommanderRepairReport({
      repair: { ...fixture.repair, sourceHead: HEAD }, cycleId: 'legacy-beacon',
      completedAtUtc: REPAIR_OBSERVED_AT,
    }).status;
    const facts = projectSovereignRepairBeaconFacts(report, HEAD, REPAIR_NOW.getTime());
    assert.equal(facts.available, true);
    assert.equal(facts.outcome, fixture.outcome);
    assert.equal(facts.trafficLight, fixture.trafficLight);
    assert.equal(facts.verification.heartbeatAgeSeconds, null);
    assert.equal('scope' in facts, false);
  }
});


test('controller lane proof exposes bounded red physical and logical blockers without paths', () => {
  const projected = projectControllerLaneBeaconFacts({
    statusId: 'controller-lane-status-current',
    controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    timestampUtc: '2026-10-06T16:00:00.000Z',
    controllerLaneStatus: {
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      readOnly: true,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      secretMaterialIncluded: false,
      unknownMeansGreen: false,
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

test('controller lane proof fails closed when nested authority contract is incomplete', () => {
  const projected = projectControllerLaneBeaconFacts({
    statusId: 'controller-lane-status-current',
    controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    timestampUtc: '2026-10-06T16:00:00.000Z',
    controllerLaneStatus: {
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      capturedAtUtc: '2026-10-06T16:00:00.000Z',
    },
  }, Date.parse('2026-10-06T16:00:30.000Z'));
  assert.equal(projected.available, false);
  assert.equal(projected.state, 'UNPROVEN');
  assert.equal(projected.blocker, 'CONTROLLER_LANE_STATUS_CONTRACT_INVALID');
});

test('red controller lane proof degrades canonical beacon summary and answerability', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-06T16:00:30.000Z'),
    statusRecords: {
      controllerLaneStatus: {
        statusId: 'controller-lane-status-current',
        controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
        timestampUtc: '2026-10-06T16:00:00.000Z',
        controllerLaneStatus: {
          schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
          ok: true,
          readOnly: true,
          arbitraryShellAllowed: false,
          sourceMutationAllowed: false,
          mergeAuthority: false,
          secretMaterialIncluded: false,
          unknownMeansGreen: false,
          capturedAtUtc: '2026-10-06T16:00:00.000Z',
          physical: { expected: 5, building: 0, amber: 0, red: 1, unknown: 0, allCurrent: true, allObservedEnabled: true, finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED', controllers: [{ controllerId: 'octopus-controller', freshness: 'CURRENT', activityState: 'IDLE', trafficLight: 'RED', materialLaneCount: 0, activeLaneCount: 0, parkedLaneCount: 0, safeEligibleWorkRemaining: 1, blocker: 'CONTROLLER_NO_MATERIAL_PROGRESS' }] },
          logical: { current: true, valid: true, physicalControllerCount: 5, total: 1, active: 0, tracking: 1, parked: 0, retired: 0, selectedForAdmission: 1, finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY', blockers: [] },
          lanes: { targetMaterialLanes: 15, activeMaterialLaneCount: 0, activeLaneClaimCount: 0, freeTargetLaneSlots: 15, runnableBacklogCount: 1, parkedPhysicalLaneCount: 0, refillHealth: 'RED', refillState: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED' },
        },
      },
    },
  });
  assert.equal(record.freshness, 'DEGRADED');
  assert.equal(record.completeStateAnswerable, false);
  assert.ok(record.blockers.includes('CONTROLLER_NO_MATERIAL_PROGRESS'));
  assert.ok(record.blockerCount > 0);
});

test('controller lane proof never paints fresh but unbound green status green', () => {
  const projected = projectControllerLaneBeaconFacts({
    statusId: 'controller-lane-status-current',
    controllerLaneStatusSchemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    timestampUtc: '2026-10-06T16:00:00.000Z',
    controllerLaneStatus: {
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      readOnly: true,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      secretMaterialIncluded: false,
      unknownMeansGreen: false,
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


test('beacon projects bounded current-head autonomy and Octopus grant truth without raw internals', () => {
  const now = new Date('2026-10-06T12:10:00.000Z');
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now,
    coreStatusRecord: {
      heartbeatAtUtc: '2026-10-06T12:09:55.000Z',
      sourceHead: HEAD,
      daemonHealthy: true,
      flywheelCycleRunning: false,
      flywheelLastStatus: 'READY',
      flywheelLastAction: 'REFILL',
      flywheelLastBlockerCount: 1,
      octopusBuildVerdict: 'STALLED_WITH_CAPACITY',
      octopusNeedsRepair: true,
      octopusMaterialActionsLastCycle: 0,
      octopusEligibleWorkRemaining: 4,
      octopusProvenSafeFreeLanes: 11,
      octopusSelfHealAttemptCount: 3,
      octopusSelfHealLastVerdict: 'OCTOPUS_SELF_HEAL_ACTION_BLOCKED',
      octopusSelfHealLastBlocker: 'CONTROLLER_FLEET_ATTENTION_REQUIRED',
      octopusSelfHealControlPlaneEscalationCount: 1,
      refillFinalVerdict: 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE',
      refillSafeEligibleWorkRemaining: 4,
      refillMaterialActionsSucceeded: 0,
      logicalLaneTruth: 'CURRENT',
      logicalActiveLaneCount: 0,
      logicalSelectedForAdmissionCount: 4,
      secret: 'MUST_NOT_ESCAPE',
      arbitraryPath: 'C:\\secret\\path',
    },
  });
  assert.equal(record.autonomy.state, 'CURRENT');
  assert.equal(record.autonomy.exactHeadMatch, true);
  assert.equal(record.autonomy.daemonHealthy, true);
  assert.equal(record.autonomy.octopusBuildVerdict, 'STALLED_WITH_CAPACITY');
  assert.equal(record.autonomy.octopusEligibleWorkRemaining, 4);
  assert.equal(record.autonomy.octopusProvenSafeFreeLanes, 11);
  assert.equal(record.autonomy.octopusSelfHealLastBlocker, 'CONTROLLER_FLEET_ATTENTION_REQUIRED');
  assert.equal(record.autonomy.refillMaterialActionsSucceeded, 0);
  assert.equal(record.autonomy.logicalSelectedForAdmissionCount, 4);
  const body = buildBattleBridgeOutboundBeaconBody(record);
  assert.doesNotMatch(body, /MUST_NOT_ESCAPE/);
  assert.doesNotMatch(body, /secret\\\\path/);
});

test('beacon marks autonomy stale or head-mismatched instead of painting it green', () => {
  const stale = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-06T12:10:00.000Z'),
    coreStatusRecord: {
      heartbeatAtUtc: '2026-10-06T12:00:00.000Z',
      sourceHead: HEAD,
      daemonHealthy: true,
    },
  });
  assert.equal(stale.autonomy.state, 'STALE');

  const mismatch = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-06T12:10:00.000Z'),
    coreStatusRecord: {
      heartbeatAtUtc: '2026-10-06T12:09:59.000Z',
      sourceHead: 'b'.repeat(40),
      daemonHealthy: true,
    },
  });
  assert.equal(mismatch.autonomy.state, 'HEAD_MISMATCH');
  assert.equal(mismatch.autonomy.exactHeadMatch, false);
});

test('beacon keeps missing core autonomy evidence explicitly unproven', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-06T12:10:00.000Z'),
    coreStatusRecord: null,
  });
  assert.equal(record.autonomy.observed, false);
  assert.equal(record.autonomy.state, 'UNPROVEN');
  assert.equal(record.autonomy.blocker, 'CORE_STATUS_MISSING');
});

test('beacon fails closed on materially future-dated core heartbeat', () => {
  const record = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-10-06T12:10:00.000Z'),
    coreStatusRecord: {
      heartbeatAtUtc: '2026-10-06T12:20:01.000Z',
      sourceHead: HEAD,
      daemonHealthy: true,
    },
  });
  assert.equal(record.autonomy.observed, true);
  assert.equal(record.autonomy.state, 'STALE');
  assert.equal(record.autonomy.ageMs, null);
  assert.equal(record.autonomy.blocker, 'CORE_STATUS_FUTURE_DATED');
});

function maintenanceCycle(id, completedAtUtc, digest = 'd', repairOverrides = {}) {
  return buildSovereignCommanderRepairReport({
    cycleId: id,
    startedAtUtc: new Date(Date.parse(completedAtUtc) - 10_000).toISOString(),
    completedAtUtc,
    repair: {
      scope: SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE, ok: true, blocker: '', sourceHead: HEAD,
      maintenance: {
        actionId: 'repair-goal-builder-flow', profile: 'MAINTENANCE_GOAL_BUILDER_V1',
        operationOk: true, terminalProven: true,
        terminalEvidenceSha256: digest.repeat(64), proofHash: 'c'.repeat(64),
      },
      steps: [{ actionId: 'repair-goal-builder-flow', ok: true,
        finalVerdict: 'SOVEREIGN_QUALIFIED_MAINTENANCE_COMPLETED', blocker: '' }],
      ...repairOverrides,
    },
  });
}

const CONTINUITY_NOW = Date.parse('2026-10-30T15:03:00.000Z');
const PREVIOUS_CYCLE = maintenanceCycle('previous-cycle', '2026-10-30T15:01:00.000Z', 'd');
const LATEST_CYCLE = maintenanceCycle('latest-cycle', '2026-10-30T15:02:00.000Z', 'e');

function continuity(events = [PREVIOUS_CYCLE.event, LATEST_CYCLE.event], overrides = {}) {
  return projectSovereignRepairContinuity({
    currentRecord: LATEST_CYCLE.status, history: { readOk: true, events },
    expectedHead: HEAD, nowMs: CONTINUITY_NOW, ...overrides,
  });
}

test('two distinct qualified guardian completions are visible without claiming whole-system repair', () => {
  const result = continuity();
  assert.equal(result.state, 'REPEATED_MAINTENANCE_OBSERVED');
  assert.equal(result.twoDistinctMaintenanceCompletionsObserved, true);
  assert.deepEqual(result.cycles.map(cycle => cycle.cycleId), ['latest-cycle', 'previous-cycle']);
  assert.equal(result.currentMatchesLatest, true);
  assert.equal(result.fullStephanosRepairProven, false);
  assert.equal(result.physicalWorkerPickupProven, false);
  assert.equal(result.runtimeQualificationGranted, false);
  assert.equal(result.sourceMutationAllowed, false);
  const beacon = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD, now: new Date(CONTINUITY_NOW),
    statusRecords: { sovereignRepair: LATEST_CYCLE.status },
    sovereignRepairHistory: { readOk: true, events: [PREVIOUS_CYCLE.event, LATEST_CYCLE.event] },
  });
  assert.deepEqual(beacon.sovereignRepairContinuity, result);
  assert.match(buildBattleBridgeOutboundBeaconBody(beacon), /REPEATED_MAINTENANCE_OBSERVED/);
});

test('duplicates, replayed terminal evidence and overlapping cycles never establish two completions', () => {
  const duplicate = continuity([LATEST_CYCLE.event, LATEST_CYCLE.event]);
  assert.equal(duplicate.distinctGuardianCyclesObserved, 1);
  assert.equal(duplicate.twoDistinctMaintenanceCompletionsObserved, false);
  const reused = maintenanceCycle('latest-cycle', '2026-10-30T15:02:00.000Z', 'd');
  assert.equal(continuity([PREVIOUS_CYCLE.event, reused.event], {
    currentRecord: reused.status,
  }).twoDistinctMaintenanceCompletionsObserved, false);
  const overlapping = { ...LATEST_CYCLE.event, cycleStartedAtUtc: '2026-10-30T15:00:55.000Z' };
  assert.equal(continuity([PREVIOUS_CYCLE.event, overlapping]).twoDistinctMaintenanceCompletionsObserved, false);
});

test('stale, wrong-head, future, corrupt or mismatched journal evidence cannot prove continuing repair', () => {
  assert.equal(continuity(undefined, { nowMs: CONTINUITY_NOW + 600_000 }).state, 'STALE');
  assert.equal(continuity(undefined, { expectedHead: 'f'.repeat(40) }).state, 'HEAD_MISMATCH');
  const future = { ...LATEST_CYCLE.event, timestampUtc: '2026-10-30T15:04:00.000Z' };
  const corrupt = { ...LATEST_CYCLE.event, verification: { ...LATEST_CYCLE.event.verification, proofHash: '' } };
  for (const event of [future, corrupt, null, { ...LATEST_CYCLE.event, eventKind: 'foreign' }]) {
    const result = continuity([PREVIOUS_CYCLE.event, event]);
    assert.equal(result.state, 'UNPROVEN');
    assert.equal(result.twoDistinctMaintenanceCompletionsObserved, false);
  }
  assert.equal(continuity(undefined, { currentRecord: PREVIOUS_CYCLE.status }).currentMatchesLatest, false);
  assert.equal(continuity(undefined, { history: { readOk: false, events: [PREVIOUS_CYCLE.event, LATEST_CYCLE.event] } }).state, 'UNPROVEN');
});

test('a recent failed cycle remains visible instead of selecting two older successes', () => {
  const blocked = maintenanceCycle('blocked-cycle', '2026-10-30T15:02:30.000Z', 'f', {
    ok: false, blocker: 'NATIVE_OPERATION_BLOCKED',
    maintenance: { operationOk: false, terminalProven: false },
    steps: [{ actionId: 'repair-goal-builder-flow', ok: false,
      finalVerdict: 'SOVEREIGN_QUALIFIED_MAINTENANCE_BLOCKED', blocker: 'NATIVE_OPERATION_BLOCKED' }],
  });
  const result = continuity([PREVIOUS_CYCLE.event, LATEST_CYCLE.event, blocked.event], {
    currentRecord: blocked.status,
  });
  assert.equal(result.state, 'ATTENTION_REQUIRED');
  assert.equal(result.cycles[0].cycleId, 'blocked-cycle');
  assert.equal(result.cycles[0].blocker, 'NATIVE_OPERATION_BLOCKED');
  assert.equal(result.twoDistinctMaintenanceCompletionsObserved, false);
});

test('manual cycles, contradictory duplicate IDs and private event fields do not become recurring proof', () => {
  const manual = { ...LATEST_CYCLE.event, source: 'operator-request' };
  assert.equal(continuity([PREVIOUS_CYCLE.event, manual]).twoDistinctMaintenanceCompletionsObserved, false);
  const conflicting = { ...LATEST_CYCLE.event, cycleStartedAtUtc: '2026-10-30T15:01:49.000Z' };
  assert.equal(continuity([PREVIOUS_CYCLE.event, LATEST_CYCLE.event, conflicting]).historyValid, false);
  const privateEvent = { ...LATEST_CYCLE.event, rawLog: 'PRIVATE_NATIVE_LOG', privatePath: 'C:/secrets/token' };
  assert.doesNotMatch(JSON.stringify(continuity([PREVIOUS_CYCLE.event, privateEvent])), /PRIVATE_NATIVE_LOG|secrets\/token/);
});

test('repair history reads a bounded journal tail and rejects malformed or linked files', () => {
  const root = mkdtempSync(join(tmpdir(), 'sovereign-beacon-tail-'));
  try {
    const workspace = join(root, 'workspace');
    const repo = join(root, 'repo');
    const eventsDir = join(workspace, 'events');
    mkdirSync(eventsDir, { recursive: true });
    const path = join(eventsDir, 'sovereign-commander-repair-cycles.ndjson');
    // The invalid old prefix is larger than the entire permitted read window.
    writeFileSync(path, 'PRIVATE_OLD_LOG'.repeat(10_000) + '\n'
      + [PREVIOUS_CYCLE.event, LATEST_CYCLE.event].map(event => JSON.stringify(event)).join('\n') + '\n');
    const history = readSovereignRepairCycleTail(workspace, repo);
    assert.equal(history.readOk, true);
    assert.equal(history.events.length, 2);
    assert.equal(continuity(undefined, { history }).twoDistinctMaintenanceCompletionsObserved, true);
    writeFileSync(path, JSON.stringify(LATEST_CYCLE.event) + '\n{partial');
    assert.equal(readSovereignRepairCycleTail(workspace, repo).readOk, false);
    writeFileSync(path, 'x'.repeat(70_000));
    assert.equal(readSovereignRepairCycleTail(workspace, repo).readOk, false);
    rmSync(path);
    const outside = join(root, 'outside.json');
    writeFileSync(outside, JSON.stringify(LATEST_CYCLE.event) + '\n');
    try {
      symlinkSync(outside, path);
      assert.equal(readSovereignRepairCycleTail(workspace, repo).readOk, false);
    } catch (error) {
      if (error.code !== 'EPERM') throw error; // Windows without symlink privilege.
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function productionFunction(source, name) {
  const match = source.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `production function ${name} exists`);
  return match[0].replace(/^export /, '');
}

for (const file of ['battle-bridge-outbound-health-beacon.mjs', 'battle-bridge-outbound-health-beacon-core.mjs']) {
  for (const existingId of [0, 123]) {
    test(`${file} publishes ${existingId ? 'PATCH' : 'POST'} large Unicode JSON through stdin`, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const body = 'repair telemetry \ud83d\udfe2 \u6e2c\u8a66\n'.repeat(20_000);
      let captured = null;
      let invalidations = 0;
      const constants = {
        BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY, BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE,
        buildBattleBridgeOutboundBeaconMaterialBody: value => value,
      };
      const context = {
        ...constants, core: constants, MAX_GITHUB_BYTES: 512 * 1024,
        BATTLE_BRIDGE_WINDOWS_HOST: { githubCli: 'FIXED_GH' },
        text: value => String(value || ''), existingBeaconCommentId: () => existingId,
        invalidateBrokeredGithubObservation: () => { invalidations += 1; },
        publishBrokeredGithubMutation: options => ({ ...options.publish(options.body), published: true }),
        spawnSync: (executable, args, options) => {
          captured = { executable, args, options };
          assert.equal(executable, 'FIXED_GH');
          assert.equal(args.some(arg => arg.includes(body)), false);
          assert.deepEqual(Array.from(args.slice(-2)), ['--input', '-']);
          assert.equal(options.shell, false);
          assert.equal(options.windowsHide, true);
          assert.equal(JSON.parse(options.input).body, body);
          // Exercise the real child-process stdin channel, with no GitHub or shell.
          const child = spawnSync(process.execPath, ['-e',
            "let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>process.stdout.write(require('node:crypto').createHash('sha256').update(JSON.parse(input).body).digest('hex')));"], {
            input: options.input, encoding: 'utf8', shell: false, timeout: 5_000,
          });
          assert.equal(child.status, 0, child.stderr);
          assert.equal(child.stdout, createHash('sha256').update(body).digest('hex'));
          return child;
        },
        body,
      };
      const result = runInNewContext(productionFunction(source, 'runFixed') + '\n'
        + productionFunction(source, 'publishBeacon') + "\npublishBeacon('/repo', body)", context);
      assert.equal(result, existingId ? 'UPDATED' : 'CREATED');
      assert.equal(captured.args[2], existingId ? 'PATCH' : 'POST');
      assert.equal(captured.args[3], existingId
        ? `repos/${BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/comments/${existingId}`
        : `repos/${BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments`);
      assert.equal(invalidations, existingId ? 0 : 1);
      context.spawnSync = () => ({ status: 1, stderr: 'PRIVATE_FAILURE_DETAIL' });
      assert.throws(() => runInNewContext(productionFunction(source, 'runFixed') + '\n'
        + productionFunction(source, 'publishBeacon') + "\npublishBeacon('/repo', body)", context),
      /OUTBOUND_BEACON_GITHUB_PUBLISH_FAILED/);
    });
  }
}

test('complete sovereign local telemetry is saved before an external publication failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'sovereign-beacon-local-'));
  try {
    const workspace = join(root, 'workspace');
    const source = readFileSync(new URL('battle-bridge-outbound-health-beacon.mjs', import.meta.url), 'utf8');
    const base = buildBattleBridgeOutboundBeacon({ sourceHead: HEAD, now: new Date(CONTINUITY_NOW) });
    const context = {
      process, resolve, join, homedir: () => root,
      core: {
        runBattleBridgeOutboundHealthBeacon: options => {
          assert.equal(options.publish(), 'CAPTURED_FOR_WATCHDOG_AUGMENTATION');
          return { ok: true, record: base };
        },
        buildBattleBridgeOutboundBeaconBody,
      },
      readJsonBounded: () => null,
      WORKER_WATCHDOG_SPEC: { path: 'status/watchdog.json' },
      SOVEREIGN_REPAIR_SPEC: { path: 'status/repair.json' },
      CONTROLLER_LANE_STATUS_SPEC: { path: 'status/lanes.json' },
      SOVEREIGN_RELAY_STATUS_PATH: 'status/relay.json',
      augmentRecordWithWorkerWatchdog: record => record,
      projectControlTowerBuildBeaconFactsV1: () => ({}),
      projectPublicGoalGateObservatoryV1: () => ({}),
      readCommissionedGateLedger: () => null,
      projectSovereignRepairContinuity, readSovereignRepairCycleTail, projectSovereignCommanderBeaconFacts,
      options: {
        env: { USERPROFILE: root, STEPHANOS_SHARED_AGENT_WORKSPACE: workspace },
        mirror: mirrorBattleBridgeCompleteStateToSharedWorkspace,
        publish: () => {
          const local = JSON.parse(readFileSync(join(workspace, 'status', 'battle-bridge-complete-state-current.json'), 'utf8'));
          assert.equal(local.sourceHead, HEAD);
          assert.equal(local.observedAtUtc, new Date(CONTINUITY_NOW).toISOString());
          assert.equal(local.finalVerdict, 'BATTLE_BRIDGE_OUTBOUND_HEALTH_OBSERVATION_READY');
          assert.doesNotMatch(local.finalVerdict, /PUBLISHED/);
          assert.equal(local.sovereignRepairContinuity.twoDistinctMaintenanceCompletionsObserved, false);
          assert.equal(local.sovereignCommander.blocker, 'COMMANDER_HEALTH_NOT_OBSERVED');
          assert.equal(local.sovereignCommander.executionProven, false);
          throw new Error('GITHUB_UNAVAILABLE_TEST');
        },
      },
    };
    assert.throws(() => runInNewContext(productionFunction(source, 'runBattleBridgeOutboundHealthBeacon')
      + '\nrunBattleBridgeOutboundHealthBeacon(options)', context), /GITHUB_UNAVAILABLE_TEST/);
    assert.equal(JSON.parse(readFileSync(join(workspace, 'status', 'battle-bridge-complete-state-current.json'), 'utf8')).sourceHead, HEAD);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
