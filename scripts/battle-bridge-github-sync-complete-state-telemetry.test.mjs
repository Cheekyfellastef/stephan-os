import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_SCHEMA,
  buildBattleBridgeCompleteStateTelemetry,
} from './battle-bridge-github-sync-complete-state-telemetry.mjs';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-08-25T14:40:00.000Z');

function surface(id, state = 'READY', overrides = {}) {
  return { id, state, observedAtUtc: '2026-08-25T14:39:50.000Z', ageMs: 10_000, head: HEAD, blocker: '', ...overrides };
}

function cleanSync(overrides = {}) {
  return {
    timestampUtc: '2026-08-25T14:39:50.000Z',
    classification: 'SYNC_NO_CHANGE',
    localHeadAfter: HEAD,
    remoteHeadObserved: HEAD,
    dirtClassification: {
      trackedSourceCount: 0,
      untrackedSourceCount: 0,
      runtimeOnlyCount: 0,
      generatedSourceCount: 0,
      unknownCount: 0,
      blocksSync: false,
      pathValuesPublished: false,
    },
    ...overrides,
  };
}

function readyBattleBridge() {
  return {
    timestampUtc: '2026-08-25T14:39:50.000Z',
    status: 'READY',
    observedServiceFacts: {
      backend: { ready: true, evidence: { detail: 'connected' } },
      'stephanos-ui': { ready: true, evidence: { detail: 'connected' } },
      'openclaw-gateway': { ready: true, evidence: { detail: 'connected' } },
      'shared-workspace': { ready: true, evidence: { detail: 'fresh' } },
    },
  };
}

function allSurfaces() {
  return [
    surface('githubSync', 'SYNC_NO_CHANGE'),
    surface('postSyncRefresh', 'POST_SYNC_RUNTIME_REFRESH_PASS'),
    surface('ignition', 'READY'),
    surface('battleBridge', 'READY'),
    surface('recoveryMesh', 'READY'),
    surface('mailbox', 'READY'),
    surface('missionWorker', 'MISSION_WORKER_TICK_PASS'),
  ];
}

function readyIgnition(overrides = {}) {
  return {
    timestampUtc: '2026-08-25T14:39:50.000Z',
    generatedAt: '2026-08-25T14:39:50.000Z',
    status: 'READY',
    builtHead: HEAD,
    servedHead: HEAD,
    runtimeHead: HEAD,
    phases: { housekeeping: { state: 'ready', nextOperatorAction: '' } },
    ...overrides,
  };
}

test('current partial truth exposes exact blind spots and a fixed control-plane repair candidate', () => {
  const record = buildBattleBridgeCompleteStateTelemetry({
    sourceHead: HEAD,
    now: NOW,
    surfaces: [
      surface('githubSync', 'SYNC_NO_CHANGE'),
      surface('postSyncRefresh', 'STALE'),
      surface('ignition', 'STALE', { observedAtUtc: '', ageMs: null, head: '' }),
      surface('battleBridge', 'UNKNOWN', { head: '' }),
      surface('recoveryMesh', 'UNPROVEN', { observedAtUtc: '', ageMs: null, head: '', blocker: 'STATUS_MISSING' }),
      surface('mailbox', 'UNPROVEN', { head: '', blocker: 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF' }),
      surface('missionWorker', 'UNKNOWN', { head: 'b'.repeat(40) }),
    ],
    statusRecords: {
      githubSync: cleanSync(),
      battleBridge: readyBattleBridge(),
      ignition: { generatedAt: '2026-08-25T14:39:50.000Z', phases: { housekeeping: { state: 'ready', nextOperatorAction: '' } } },
    },
  });

  assert.equal(record.schemaVersion, BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_SCHEMA);
  assert.equal(record.source.localHead, HEAD);
  assert.equal(record.source.remoteMainHead, HEAD);
  assert.equal(record.source.exactMainMatch, true);
  assert.equal(record.coverage.verdict, 'DEGRADED');
  assert.ok(record.coverage.missingEvidence.includes('BUILT_HEAD_MISSING'));
  assert.ok(record.coverage.missingEvidence.includes('SERVED_HEAD_MISSING'));
  assert.ok(record.coverage.missingEvidence.includes('RUNTIME_HEAD_MISSING'));
  assert.ok(!record.coverage.missingEvidence.includes('HOUSEKEEPER_EXECUTION_RECEIPT_MISSING'));
  assert.equal(record.housekeeper.state, 'IGNITION_HOUSEKEEPING_READY');
  assert.equal(record.selfHealing.currentState, 'FIXED_CONTROL_PLANE_REPAIR_CANDIDATE');
  assert.equal(record.selfHealing.candidateFamily, 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILIATION');
  assert.ok(record.selfHealing.targetIds.includes('recoveryMesh'));
  assert.ok(record.selfHealing.targetIds.includes('mailbox'));
  assert.equal(record.selfHealing.requiredAuthority, 'WINDOWS_RUNTIME_MUTATION');
  assert.equal(record.selfHealing.automaticExecutionEligible, false);
  assert.equal(record.selfHealing.executionAuthorizedByTelemetry, false);
  assert.equal(record.runtimeMutationAllowed, false);
  assert.equal(record.authorityGrantedByTelemetry, false);
});

test('complete fresh evidence answers every state class and reports no repair needed', () => {
  const record = buildBattleBridgeCompleteStateTelemetry({
    sourceHead: HEAD,
    now: NOW,
    surfaces: allSurfaces(),
    statusRecords: { githubSync: cleanSync(), battleBridge: readyBattleBridge(), ignition: readyIgnition() },
  });

  assert.equal(record.coverage.verdict, 'COMPLETE');
  assert.deepEqual(record.coverage.unanswerableQuestionClasses, []);
  assert.equal(record.delivery.sourceBuiltMatch, true);
  assert.equal(record.delivery.sourceServedMatch, true);
  assert.equal(record.delivery.sourceRuntimeMatch, true);
  assert.equal(record.services.backend.ready, true);
  assert.equal(record.services.ui.ready, true);
  assert.equal(record.services.openClaw.ready, true);
  assert.equal(record.services.sharedWorkspace.ready, true);
  assert.equal(record.housekeeper.lastExecutionObserved, true);
  assert.equal(record.selfHealing.currentState, 'NO_REPAIR_NEEDED');
  assert.equal(record.finalVerdict, 'BATTLE_BRIDGE_COMPLETE_STATE_TELEMETRY_READY');
});

test('blocking source dirt is never converted into automatic cleanup authority', () => {
  const record = buildBattleBridgeCompleteStateTelemetry({
    sourceHead: HEAD,
    now: NOW,
    surfaces: allSurfaces(),
    statusRecords: {
      githubSync: cleanSync({
        classification: 'BLOCKED_DIRTY_SOURCE',
        dirtClassification: {
          trackedSourceCount: 1,
          untrackedSourceCount: 1,
          runtimeOnlyCount: 2,
          generatedSourceCount: 0,
          unknownCount: 0,
          blocksSync: true,
          pathValuesPublished: false,
        },
      }),
      battleBridge: readyBattleBridge(),
      ignition: readyIgnition(),
    },
  });

  assert.equal(record.source.dirt.classification, 'BLOCKING_SOURCE_DIRT');
  assert.equal(record.housekeeper.sourceCleanupAllowedByTelemetry, false);
  assert.equal(record.selfHealing.currentState, 'BLOCKED_BY_SOURCE_PRESERVATION_BOUNDARY');
  assert.equal(record.selfHealing.candidateFamily, 'SOURCE_DIRT_DIAGNOSIS_AND_PRESERVATION');
  assert.equal(record.selfHealing.automaticExecutionEligible, true);
  assert.equal(record.repairExecutionAllowed, false);
});

test('a separately qualified exact family and target policy makes fixed self-heal eligible without telemetry granting authority', () => {
  const record = buildBattleBridgeCompleteStateTelemetry({
    sourceHead: HEAD,
    now: NOW,
    surfaces: allSurfaces().map((entry) => entry.id === 'recoveryMesh' ? surface('recoveryMesh', 'FAILED', { blocker: 'TASK_STOPPED' }) : entry),
    statusRecords: {
      githubSync: cleanSync(),
      battleBridge: readyBattleBridge(),
      ignition: readyIgnition(),
      selfHealingPolicy: {
        automaticExecutionAllowed: true,
        operatorNeeded: false,
        allowedFamilies: ['BATTLE_BRIDGE_CONTROL_PLANE_RECONCILIATION'],
        allowedTargetIds: ['recoveryMesh'],
      },
    },
  });

  assert.equal(record.selfHealing.currentState, 'FIXED_CONTROL_PLANE_SELF_HEAL_READY');
  assert.equal(record.selfHealing.automaticExecutionEligible, true);
  assert.equal(record.selfHealing.requiredAuthority, 'EXISTING_QUALIFIED_SELF_HEAL_POLICY');
  assert.equal(record.selfHealing.executionAuthorizedByTelemetry, false);
  assert.equal(record.authorityGrantedByTelemetry, false);
});

test('stale delivery evidence becomes one bounded Ignition and refresh candidate', () => {
  const surfaces = allSurfaces().map((entry) => entry.id === 'ignition' || entry.id === 'postSyncRefresh'
    ? surface(entry.id, 'STALE', { blocker: 'STATUS_STALE' })
    : entry);
  const record = buildBattleBridgeCompleteStateTelemetry({
    sourceHead: HEAD,
    now: NOW,
    surfaces,
    statusRecords: { githubSync: cleanSync(), battleBridge: readyBattleBridge(), ignition: readyIgnition() },
  });

  assert.equal(record.selfHealing.currentState, 'IGNITION_REFRESH_RECOVERY_CANDIDATE');
  assert.equal(record.selfHealing.candidateFamily, 'BOUND_IGNITION_AND_REFRESH_RECOVERY');
  assert.deepEqual(record.selfHealing.targetIds, ['postSyncRefresh', 'ignition']);
  assert.equal(record.selfHealing.operatorNeeded, true);
});

test('healthy services with only runtime heads missing select an automatic read-only proof refresh', () => {
  const record = buildBattleBridgeCompleteStateTelemetry({
    sourceHead: HEAD,
    now: NOW,
    surfaces: allSurfaces(),
    statusRecords: {
      githubSync: cleanSync(),
      battleBridge: readyBattleBridge(),
      ignition: { ...readyIgnition(), builtHead: '', servedHead: '', runtimeHead: '' },
    },
  });

  assert.deepEqual(record.coverage.unanswerableQuestionClasses, ['DELIVERY_AND_RUNTIME_HEADS']);
  assert.equal(record.selfHealing.currentState, 'READ_ONLY_RUNTIME_PROOF_REFRESH_READY');
  assert.equal(record.selfHealing.automaticExecutionEligible, true);
  assert.equal(record.selfHealing.operatorNeeded, false);
  assert.equal(record.selfHealing.requiredAuthority, 'READ_ONLY_FIXED_PROOF');
});

test('invalid source identity fails closed', () => {
  assert.throws(() => buildBattleBridgeCompleteStateTelemetry({ sourceHead: 'not-a-head' }), /COMPLETE_STATE_SOURCE_HEAD_INVALID/);
});
