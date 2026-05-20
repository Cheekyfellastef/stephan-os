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
  missionVerificationReadinessLevel: 'ready',
  missionVerificationProofStatus: 'passed',
  sourceTruthsUsed: ['uiRealityStatus', 'missionVerificationProofStatus'],
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

test('Mission Repair Loop generates Codex prompt when UI Reality FAIL exists', () => {
  const model = buildMissionRepairLoopModel({
    ...base,
    latestSupportSnapshotStatus: { ...base.latestSupportSnapshotStatus, uiRealityStatus: 'FAIL' },
    failingAcceptanceFields: ['UI Reality copy feedback drift'],
  });
  assert.equal(model.codexPromptAvailable, true);
  assert.match(model.codexPromptDraft, /Forbidden actions:/);
  assert.match(model.codexPromptDraft, /Required tests:/);
  assert.match(model.codexPromptDraft, /Support snapshot proof fields:/);
  assert.equal(model.mergeRecommendation, 'hold');
});

test('Mission Repair Loop does not generate Codex prompt when status is passed', () => {
  const model = buildMissionRepairLoopModel(base);
  assert.equal(model.status, 'passed');
  assert.equal(model.codexPromptAvailable, false);
  assert.equal(model.codexPromptDraft, '');
});

test('merge recommendation follows verification proof state', () => {
  const passModel = buildMissionRepairLoopModel(base);
  const failModel = buildMissionRepairLoopModel({ ...base, missionVerificationProofStatus: 'failed' });
  assert.equal(passModel.mergeRecommendation, 'merge-candidate');
  assert.equal(failModel.mergeRecommendation, 'hold');
});

test('model reports source truths used', () => {
  const model = buildMissionRepairLoopModel(base);
  assert.deepEqual(model.sourceTruthsUsed, ['uiRealityStatus', 'missionVerificationProofStatus']);
});

test('duplicate authority is not introduced when source truths are declared', () => {
  const model = buildMissionRepairLoopModel(base);
  assert.equal(model.duplicateAuthorityDetected, 'no');
});

test('fetched github PR evidence is linked as canonical evidence for loop state', () => {
  const model = buildMissionRepairLoopModel({
    ...base,
    prEvidenceIntake: { status: 'no_pr_evidence', mergeReadiness: 'hold' },
    githubPrEvidence: { status: 'fetched', mergeReadiness: 'already-merged', checksStatus: 'passed', buildStatus: 'passed', verifyStatus: 'passed', merged: true, missingProof: [] },
  });
  assert.equal(model.latestPrEvidenceStatus, 'fetched');
  assert.equal(model.latestPrEvidenceMergeReadiness, 'already-merged');
});
