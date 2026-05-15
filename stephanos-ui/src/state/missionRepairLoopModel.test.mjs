import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionRepairLoopModel } from './missionRepairLoopModel.js';

const base = {
  missionId: 'm1',
  title: 'Repair foo',
  objective: 'Fix issue',
  currentAttempt: 1,
  maxAttempts: 3,
  acceptanceCriteria: ['build passes'],
  forbiddenActions: ['no auto merge'],
  requiredProof: ['npm run stephanos:verify'],
  latestCodexSummary: 'patched',
  latestTestResults: 'pass',
  latestBuildVerifyStatus: 'pass',
  latestSupportSnapshotStatus: {
    uiRealityStatus: 'OK',
    acceptanceFieldsMatch: true,
    browserProofRequired: false,
    browserProofAvailable: true,
  },
};

test('failed build blocks merge', () => {
  const model = buildMissionRepairLoopModel({ ...base, latestBuildVerifyStatus: 'fail' });
  assert.equal(model.status, 'blocked');
  assert.equal(model.mergeRecommendation, 'hold');
});

test('UI Reality FAIL creates repair-needed state', () => {
  const model = buildMissionRepairLoopModel({ ...base, latestSupportSnapshotStatus: { ...base.latestSupportSnapshotStatus, uiRealityStatus: 'FAIL' } });
  assert.equal(model.status, 'needs-repair');
});

test('browser proof missing creates needs-proof for UI tasks', () => {
  const model = buildMissionRepairLoopModel({ ...base, latestSupportSnapshotStatus: { ...base.latestSupportSnapshotStatus, browserProofRequired: true, browserProofAvailable: false } });
  assert.equal(model.status, 'needs-proof');
});

test('all acceptance fields pass creates passed state', () => {
  const model = buildMissionRepairLoopModel(base);
  assert.equal(model.status, 'passed');
});

test('max attempts blocks and asks operator', () => {
  const model = buildMissionRepairLoopModel({ ...base, currentAttempt: 3 });
  assert.equal(model.status, 'blocked');
  assert.equal(model.operatorDecisionRequired, true);
});

test('next prompt is generated from failing fields', () => {
  const model = buildMissionRepairLoopModel({ ...base, failingAcceptanceFields: ['Support Snapshot acceptance mismatch'] });
  assert.match(model.nextPrompt, /Support Snapshot acceptance mismatch/);
});

test('merge recommendation follows proof state', () => {
  const passModel = buildMissionRepairLoopModel(base);
  const failModel = buildMissionRepairLoopModel({ ...base, latestTestResults: 'fail' });
  assert.equal(passModel.mergeRecommendation, 'merge-candidate');
  assert.equal(failModel.mergeRecommendation, 'hold');
});
