import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA,
  buildBattleBridgeTelemetryAutorepairProjection,
} from './battleBridgeTelemetryAutorepairV1.mjs';

const HEAD = 'a'.repeat(40);

function surface(id, state = 'READY', overrides = {}) {
  return { id, state, head: HEAD, blocker: '', ...overrides };
}

const COMPLETE = [
  surface('githubSync', 'SYNC_NO_CHANGE'),
  surface('postSyncRefresh', 'REFRESH_COMPLETE'),
  surface('ignition', 'READY'),
  surface('battleBridge', 'READY'),
  surface('recoveryMesh', 'READY'),
  surface('mailbox', 'OBSERVED'),
  surface('missionWorker', 'MISSION_WORKER_TICK_PASS'),
];

test('complete exact-head telemetry is answerable with no repair candidate', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces: COMPLETE });
  assert.equal(projection.schemaVersion, BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA);
  assert.equal(projection.completeStateAnswerable, true);
  assert.equal(projection.telemetryCompleteness, 'COMPLETE');
  assert.equal(projection.requiredSurfaceCount, 7);
  assert.equal(projection.answeredSurfaceCount, 7);
  assert.equal(projection.unansweredSurfaceCount, 0);
  assert.deepEqual(projection.repairCandidates, []);
  assert.equal(projection.operatorNeededNow, false);
  assert.equal(projection.finalVerdict, 'BATTLE_BRIDGE_COMPLETE_STATE_ANSWERABLE');
});

test('source-bound post-sync proof remains valid when its clock age is stale but its exact head is current', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: HEAD,
    surfaces: COMPLETE.map((entry) => entry.id === 'postSyncRefresh' ? surface('postSyncRefresh', 'STALE') : entry),
  });
  const postSync = projection.coverage.find((entry) => entry.surfaceId === 'postSyncRefresh');
  assert.equal(postSync.answered, true);
  assert.equal(postSync.state, 'CURRENT_EXACT_HEAD_EVENT_PROOF');
  assert.equal(postSync.gapClass, 'NONE');
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
  assert.match(projection.nextAutomaticAction, /battleBridge/);
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
});

test('missing surfaces are explicit gaps and cannot disappear from completeness accounting', () => {
  const projection = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: HEAD, surfaces: [] });
  assert.equal(projection.requiredSurfaceCount, 7);
  assert.equal(projection.answeredSurfaceCount, 0);
  assert.equal(projection.unansweredSurfaceCount, 7);
  assert.equal(projection.repairCandidates.length, 7);
});

test('invalid source identity fails closed', () => {
  assert.throws(
    () => buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: 'not-a-head', surfaces: COMPLETE }),
    /BATTLE_BRIDGE_TELEMETRY_SOURCE_HEAD_INVALID/,
  );
});
