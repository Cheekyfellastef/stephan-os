import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_EXECUTIVE_QUESTION_CLASSES,
  BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA,
  buildBattleBridgeTelemetryAutorepairProjection,
} from './battleBridgeTelemetryAutorepairV1.mjs';

const HEAD = 'a'.repeat(40);

function surface(id, state = 'READY', overrides = {}) {
  return { id, state, head: HEAD, blocker: '', ...overrides };
}

const COMPLETE = [
  surface('githubSync', 'SYNC_NO_CHANGE', {
    dirtFacts: { known: true, blocksSync: false, blockingCount: 0 },
    housekeeperFacts: { observed: true, state: 'READY', head: HEAD, blocker: '' },
  }),
  surface('postSyncRefresh', 'REFRESH_COMPLETE'),
  surface('ignition', 'READY'),
  surface('battleBridge', 'READY', {
    runtimeHeads: { builtHead: HEAD, servedHead: HEAD, runtimeHead: HEAD },
    serviceFacts: {
      backend: { ready: true, state: 'READY', head: HEAD },
      'stephanos-ui': { ready: true, state: 'READY', head: HEAD },
      'openclaw-gateway': { ready: true, state: 'READY', head: HEAD },
      'shared-workspace': { ready: true, state: 'READY', head: HEAD },
    },
  }),
  surface('recoveryMesh', 'READY'),
  surface('mailbox', 'OBSERVED'),
  surface('missionWorker', 'MISSION_WORKER_TICK_PASS'),
];

test('complete exact-head telemetry answers all thirteen executive question classes with no repair candidate', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces: COMPLETE });
  assert.equal(projection.schemaVersion, BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA);
  assert.equal(projection.completeStateAnswerable, true);
  assert.equal(projection.surfaceTelemetryAnswerable, true);
  assert.equal(projection.telemetryCompleteness, 'COMPLETE');
  assert.equal(projection.requiredSurfaceCount, 7);
  assert.equal(projection.answeredSurfaceCount, 7);
  assert.equal(projection.unansweredSurfaceCount, 0);
  assert.deepEqual(projection.repairCandidates, []);
  assert.equal(projection.operatorNeededNow, false);
  assert.equal(projection.executive.questionCount, 13);
  assert.deepEqual(projection.executive.questions.map((entry) => entry.questionClass), BATTLE_BRIDGE_EXECUTIVE_QUESTION_CLASSES);
  assert.equal(projection.executive.completeStateAnswerable, true);
  assert.equal(projection.executive.executionAuthorizedByTelemetry, false);
  assert.equal(projection.executive.authorityGrantedByTelemetry, false);
  assert.equal(projection.finalVerdict, 'BATTLE_BRIDGE_COMPLETE_STATE_ANSWERABLE');
});

test('source-bound terminal-success post-sync proof remains valid when its clock age is stale but its exact head is current', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: COMPLETE.map((entry) => entry.id === 'postSyncRefresh'
      ? surface('postSyncRefresh', 'STALE', { rawState: 'REFRESH_COMPLETE' })
      : entry),
  });
  const postSync = projection.coverage.find((entry) => entry.surfaceId === 'postSyncRefresh');
  assert.equal(postSync.answered, true);
  assert.equal(postSync.state, 'CURRENT_EXACT_HEAD_EVENT_PROOF');
  assert.equal(postSync.gapClass, 'NONE');
});

test('stale exact-head blocked post-sync proof remains an explicit consequential repair candidate', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: COMPLETE.map((entry) => entry.id === 'postSyncRefresh'
      ? surface('postSyncRefresh', 'STALE', {
        rawState: 'BLOCKED_REFRESH_FAILED',
        blocker: 'BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED',
      })
      : entry),
  });
  const postSync = projection.coverage.find((entry) => entry.surfaceId === 'postSyncRefresh');
  assert.equal(postSync.answered, false);
  assert.equal(postSync.state, 'BLOCKED_REFRESH_FAILED');
  assert.equal(postSync.gapClass, 'OBSERVED_FAILURE_OR_BLOCKER');
  const repair = projection.repairCandidates.find((entry) => entry.surfaceId === 'postSyncRefresh');
  assert.equal(repair.blocker, 'BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED');
  assert.equal(repair.repairRoute, 'POST_SYNC_REFRESH');
  assert.equal(repair.repairDisposition, 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED');
  assert.equal(projection.executive.operatorNeeded, true);
});

test('stale exact-head post-sync plan is not promoted to terminal event proof', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: COMPLETE.map((entry) => entry.id === 'postSyncRefresh'
      ? surface('postSyncRefresh', 'STALE', { rawState: 'REFRESH_READY' })
      : entry),
  });
  const postSync = projection.coverage.find((entry) => entry.surfaceId === 'postSyncRefresh');
  assert.equal(postSync.answered, false);
  assert.equal(postSync.state, 'REFRESH_READY');
  assert.equal(postSync.gapClass, 'STALE_EVIDENCE');
  assert.match(
    projection.repairCandidates.find((entry) => entry.surfaceId === 'postSyncRefresh').blocker,
    /not terminal-success proof/,
  );
});

test('stale or unproven runtime surfaces become explicit repair candidates rather than false green', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: [
      ...COMPLETE.filter((entry) => !['ignition', 'recoveryMesh'].includes(entry.id)),
      surface('ignition', 'STALE', { head: '' }),
      surface('recoveryMesh', 'UNPROVEN', { head: '', blocker: 'STATUS_MISSING' }),
    ],
  });
  assert.equal(projection.completeStateAnswerable, false);
  assert.equal(projection.unansweredSurfaceCount, 2);
  assert.equal(projection.consequentialAuthorizationCandidateCount, 2);
  assert.equal(projection.operatorAuthorizationState, 'OPERATOR_AUTHORIZATION_NOT_PRESENT');
  assert.equal(projection.operatorNeededNow, true);
  assert.deepEqual(
    projection.repairCandidates.map((entry) => [entry.surfaceId, entry.repairRoute, entry.repairDisposition]),
    [
      ['ignition', 'IGNITION', 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED'],
      ['recoveryMesh', 'RECOVERY_MESH_RECONCILIATION', 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED'],
    ],
  );
});

test('read-only telemetry and mailbox proof gaps remain autonomously diagnosable without granting runtime authority', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: [
      ...COMPLETE.filter((entry) => !['battleBridge', 'mailbox'].includes(entry.id)),
      surface('battleBridge', 'UNKNOWN', { head: '', blocker: '' }),
      surface('mailbox', 'UNPROVEN', { head: '', blocker: 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF' }),
    ],
  });
  assert.equal(projection.safeAutomaticCandidateCount, 2);
  assert.equal(projection.consequentialAuthorizationCandidateCount, 0);
  assert.equal(projection.operatorNeededNow, false);
  assert.equal(projection.autonomousRepairPolicy.diagnoseKnownGapsWithoutOperator, true);
  assert.equal(projection.autonomousRepairPolicy.executeReadOnlyProofRefreshWithoutOperator, true);
  assert.equal(projection.autonomousRepairPolicy.executeConsequentialRuntimeMutationWithoutExactAuthorization, false);
  assert.equal(projection.executive.nextAutomaticAction, 'CANONICAL_SOURCE_TELEMETRY_REPAIR');
  assert.equal(projection.executive.executionAuthorizedByTelemetry, false);
});

test('wrong-head worker proof is rejected even when its state text looks healthy', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: COMPLETE.map((entry) => entry.id === 'missionWorker'
      ? surface('missionWorker', 'MISSION_WORKER_TICK_PASS', { head: 'b'.repeat(40) })
      : entry),
  });
  const worker = projection.coverage.find((entry) => entry.surfaceId === 'missionWorker');
  assert.equal(worker.answered, false);
  assert.equal(worker.gapClass, 'EXACT_HEAD_MISMATCH');
  const repair = projection.repairCandidates.find((entry) => entry.surfaceId === 'missionWorker');
  assert.equal(repair.repairRoute, 'MISSION_WORKER_RECONCILIATION');
  assert.equal(repair.operatorAuthorizationState, 'OPERATOR_AUTHORIZATION_NOT_PRESENT');
  assert.equal(projection.executive.operatorNeeded, true);
});

test('missing surfaces are explicit gaps and cannot disappear from completeness accounting', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces: [] });
  assert.equal(projection.requiredSurfaceCount, 7);
  assert.equal(projection.answeredSurfaceCount, 0);
  assert.equal(projection.unansweredSurfaceCount, 7);
  assert.equal(projection.repairCandidates.length, 7);
  assert.equal(projection.executive.questionCount, 13);
  assert.equal(projection.executive.completeStateAnswerable, false);
});

test('clean source still remains incomplete when Housekeeper execution truth is missing and routes source telemetry repair', () => {
  const surfaces = COMPLETE.map((entry) => entry.id === 'githubSync'
    ? surface('githubSync', 'SYNC_NO_CHANGE', { dirtFacts: { known: true, blocksSync: false, blockingCount: 0 } })
    : entry);
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces });
  const question = projection.executive.questions.find((entry) => entry.questionClass === 'SOURCE_DIRT_AND_HOUSEKEEPER');
  assert.equal(question.answered, false);
  assert.equal(question.blocker, 'HOUSEKEEPER_CYCLE_TELEMETRY_MISSING');
  assert.equal(projection.executive.nextAutomaticAction, 'CANONICAL_SOURCE_TELEMETRY_REPAIR');
  assert.equal(projection.executive.operatorNeeded, false);
  assert.equal(projection.executive.runtimeMutationAllowedByTelemetry, false);
});

test('blocking source dirt triggers diagnosis and never becomes cleanup authority', () => {
  const surfaces = COMPLETE.map((entry) => entry.id === 'githubSync'
    ? surface('githubSync', 'SYNC_NO_CHANGE', {
      dirtFacts: { known: true, blocksSync: true, blockingCount: 2 },
      housekeeperFacts: { observed: true, state: 'BLOCKED', head: HEAD, blocker: 'SOURCE_DIRT_BLOCKED' },
    })
    : entry);
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces });
  const question = projection.executive.questions.find((entry) => entry.questionClass === 'SOURCE_DIRT_AND_HOUSEKEEPER');
  assert.equal(question.blocker, 'SOURCE_DIRT_BLOCKS_SYNC');
  assert.equal(question.nextAutomaticAction, 'READ_ONLY_DIAGNOSIS');
  assert.equal(projection.executive.nextAutomaticAction, 'READ_ONLY_DIAGNOSIS');
  assert.equal(projection.executive.sourceMutationAllowedByTelemetry, false);
  assert.equal(projection.executive.arbitraryShellAllowed, false);
});

test('missing delivery identity selects bounded read-only exact-head proof refresh before operator escalation', () => {
  const surfaces = COMPLETE.map((entry) => entry.id === 'battleBridge'
    ? surface('battleBridge', 'READY', {
      serviceFacts: entry.serviceFacts,
      runtimeHeads: { builtHead: HEAD, servedHead: '', runtimeHead: HEAD },
    })
    : entry);
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces });
  const question = projection.executive.questions.find((entry) => entry.questionClass === 'DELIVERY_AND_RUNTIME_HEADS');
  assert.equal(question.answered, false);
  assert.equal(question.nextAutomaticAction, 'READ_ONLY_EXACT_HEAD_PROOF_REFRESH');
  assert.equal(projection.executive.nextAutomaticAction, 'READ_ONLY_EXACT_HEAD_PROOF_REFRESH');
  assert.equal(projection.executive.operatorNeeded, false);
});

test('degraded exact-head backend requires interactive authority when no separately qualified self-heal policy exists', () => {
  const surfaces = COMPLETE.map((entry) => entry.id === 'battleBridge'
    ? surface('battleBridge', 'READY', {
      runtimeHeads: entry.runtimeHeads,
      serviceFacts: { ...entry.serviceFacts, backend: { ready: false, state: 'DEGRADED', head: HEAD } },
    })
    : entry);
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces });
  const backend = projection.executive.questions.find((entry) => entry.questionClass === 'BACKEND_HEALTH');
  assert.equal(backend.nextAutomaticAction, 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED');
  assert.equal(projection.executive.operatorNeeded, true);
  assert.equal(projection.executive.operatorAuthorizationState, 'OPERATOR_AUTHORIZATION_NOT_PRESENT');
  assert.equal(projection.executive.repairExecutionAllowed, false);
});

test('separately reviewed exact-head fixed policy can mark one backend self-heal eligible without telemetry granting execution', () => {
  const surfaces = COMPLETE.map((entry) => entry.id === 'battleBridge'
    ? surface('battleBridge', 'READY', {
      runtimeHeads: entry.runtimeHeads,
      serviceFacts: { ...entry.serviceFacts, backend: { ready: false, state: 'DEGRADED', head: HEAD } },
    })
    : entry);
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces,
    qualifiedRepairPolicies: [{
      policyId: 'backend-8787-fixed-recovery-v1',
      exactHead: HEAD,
      repairRoute: 'BACKEND_8787_RECONCILIATION',
      targetIds: ['backend'],
      reviewed: true,
      fixedCommand: true,
      reversible: true,
      operatorNeeded: false,
      authorityWideningAllowed: false,
    }],
  });
  assert.equal(projection.executive.qualifiedSelfHealEligible, true);
  assert.equal(projection.executive.nextAutomaticAction, 'QUALIFIED_FIXED_SELF_HEAL');
  assert.equal(projection.executive.operatorNeeded, false);
  assert.equal(projection.executive.executionAuthorizedByTelemetry, false);
  assert.equal(projection.executive.repairExecutionAllowed, false);
  assert.equal(projection.executive.authorityGrantedByTelemetry, false);
});

test('policy with wrong head, widened authority or incomplete fixed-target identity cannot qualify self-heal', () => {
  const surfaces = COMPLETE.map((entry) => entry.id === 'battleBridge'
    ? surface('battleBridge', 'READY', {
      runtimeHeads: entry.runtimeHeads,
      serviceFacts: { ...entry.serviceFacts, backend: { ready: false, state: 'DEGRADED', head: HEAD } },
    })
    : entry);
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces,
    qualifiedRepairPolicies: [{
      policyId: 'unsafe', exactHead: 'b'.repeat(40), repairRoute: 'BACKEND_8787_RECONCILIATION', targetIds: ['backend'],
      reviewed: true, fixedCommand: true, reversible: true, operatorNeeded: false, authorityWideningAllowed: true,
    }],
  });
  assert.equal(projection.executive.qualifiedSelfHealEligible, false);
  assert.equal(projection.executive.nextAutomaticAction, 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED');
  assert.equal(projection.executive.operatorNeeded, true);
});

test('invalid source identity fails closed', () => {
  assert.throws(
    () => buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: 'not-a-head', surfaces: COMPLETE }),
    /BATTLE_BRIDGE_TELEMETRY_SOURCE_HEAD_INVALID/,
  );
});