import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MISSION_RUNTIME_SCHEMA_VERSION,
  RUNTIME_PHASE,
  buildMissionRuntimeContract,
  createMissionRuntimeSnapshot,
  validateMissionRuntimeSnapshot,
} from './missionRuntimeV1.mjs';

test('contract names the merged stack and truth rules', () => {
  const contract = buildMissionRuntimeContract();
  assert.equal(contract.schemaVersion, MISSION_RUNTIME_SCHEMA_VERSION);
  assert.deepEqual(contract.composedSystems, [
    'Mission Executive V1',
    'Mission Flywheel Director V1',
    'Shared Workspace Mission Room V2',
    'Project Intelligence V1',
    'Chat-to-Publish Bridge V1',
    'Platform/Runtime state',
  ]);
  assert.ok(contract.truthRules.some((rule) => rule.includes('Never report BUILDING without')));
});

test('emits blocked with exact unblock action when build evidence is missing', () => {
  const snapshot = createMissionRuntimeSnapshot({
    goalId: '#1323',
    goalTitle: 'Mission Runtime V1',
    idea: 'Compose the merged stack into a live mission snapshot.',
  });

  assert.equal(snapshot.phase, RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.match(snapshot.exactUnblockAction, /Record build evidence/);
  assert.equal(snapshot.commandDeck.status, RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(validateMissionRuntimeSnapshot(snapshot).valid, true);
});

test('reports building only when platform or runtime evidence exists', () => {
  const snapshot = createMissionRuntimeSnapshot({
    goalId: '#1323',
    goalTitle: 'Mission Runtime V1',
    platformRuntime: {
      activeBranch: 'feature/mission-runtime-v1',
      proofCommand: 'node --test shared/agents/missionRuntimeV1.test.mjs',
      lastActivity: 'source files created',
    },
  });

  assert.equal(snapshot.phase, RUNTIME_PHASE.BUILDING);
  assert.equal(snapshot.truth.neverReportBuildingWithoutEvidence, true);
  assert.equal(snapshot.currentProof.command, 'node --test shared/agents/missionRuntimeV1.test.mjs');
  assert.equal(snapshot.commandDeck.worker, 'CODEX');
});

test('preserves done as merged to main plus focused proof plus mission state update', () => {
  const snapshot = createMissionRuntimeSnapshot({
    goalId: '#1323',
    goalTitle: 'Mission Runtime V1',
    platformRuntime: {
      activeBranch: 'feature/mission-runtime-v1',
      prNumber: '1324',
      headSha: 'abc123',
      mergeSha: 'def456',
      sourceMerged: true,
      proofCommand: 'node --test shared/agents/missionRuntimeV1.test.mjs',
      proofPassed: true,
      focusedProofRecorded: true,
      missionStateUpdated: true,
      runtimeStateObserved: true,
      platformStateObserved: true,
      lastActivity: 'merged and mission state updated',
    },
  });

  assert.equal(snapshot.phase, RUNTIME_PHASE.DONE);
  assert.equal(snapshot.currentPr.status, 'MERGED_TO_MAIN');
  assert.equal(snapshot.currentProof.status, 'FOCUSED_PROOF_RECORDED');
  assert.equal(snapshot.truth.doneRequiresMergedProofAndMissionState, true);
  assert.equal(validateMissionRuntimeSnapshot(snapshot).finalVerdict, 'MISSION_RUNTIME_SNAPSHOT_PASS');
});

test('does not mark done when proof exists but merge or mission update evidence is missing', () => {
  const snapshot = createMissionRuntimeSnapshot({
    platformRuntime: {
      activeBranch: 'feature/mission-runtime-v1',
      prNumber: '1324',
      proofCommand: 'node --test shared/agents/missionRuntimeV1.test.mjs',
      proofPassed: true,
      focusedProofRecorded: true,
    },
  });

  assert.equal(snapshot.phase, RUNTIME_PHASE.WAITING_FOR_OPERATOR_APPROVAL);
  assert.notEqual(snapshot.phase, RUNTIME_PHASE.DONE);
});
