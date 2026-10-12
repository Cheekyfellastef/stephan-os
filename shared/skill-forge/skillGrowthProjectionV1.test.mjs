import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillTransferAssessmentV1, deriveSkillGrowthObservatoryV1 } from './skillGrowthProjectionV1.mjs';
const lesson = { schemaVersion: 'stephanos.closed-loop-learning.v1', state: 'RETRY_READY', capabilityId: 'route-diagnostics', teacherId: 'openclaw-local', exam: { passed: true, proofRefs: ['exam:a'] }, verification: { passed: true, proofRefs: ['runtime:a'] }, learningCandidate: { lessonId: 'route-diagnostics' } };
test('seed proposals never become installed capabilities or earned actor skills', () => {
  const view = deriveSkillGrowthObservatoryV1({ seedSkills: [{ id: 'seed-1', status: 'ACTIVE' }] });
  assert.equal(view.sourceTruth, 'UNAVAILABLE');
  assert.equal(view.summary.proposals, 1);
  assert.equal(view.summary.publishedSkillRecords, 0);
  assert.equal(view.summary.provenActiveTargets, 0);
  assert.equal(view.skillCandidates[0].provenance, 'STATIC_SEED_NOT_INSTALLED');
});
test('learning is visible, but exam and proof are not target runtime installation', () => {
  const view = deriveSkillGrowthObservatoryV1({ payload: { state: 'ready', records: { eventRecords: [{ eventId: 'evt-1', closedLoopLearning: lesson }], statusRecords: [{ participantId: 'openclaw-local', state: 'active' }] } } });
  assert.equal(view.summary.witnessedLearning, 1);
  assert.equal(view.summary.verifiedLessons, 1);
  assert.equal(view.observedActors[0].learningCount, 1);
  assert.equal(view.observedActors[0].skillCount, 0);
  assert.equal(view.timeline[0].stage, 'REVIEW');
});
test('skill transfer never grants authority even after exact proof bundle', () => {
  const base = { learning: lesson, sourceActor: 'openclaw-local', targetActor: 'openclaw-standalone' };
  const pending = buildSkillTransferAssessmentV1(base);
  assert.equal(pending.eligibleForExistingApprovedActivationRoute, false);
  assert.ok(pending.blockers.includes('targetRuntimeProven'));
  const checked = buildSkillTransferAssessmentV1({ ...base, targetRuntimeProof: { passed: true, proofRefs: ['runtime:pc'] }, scopeReview: { passed: true, proofRefs: ['scope:pc'] }, operatorApproval: { approved: true, proofRefs: ['approval:pc'] } });
  assert.equal(checked.eligibleForExistingApprovedActivationRoute, true);
  assert.equal(checked.activated, false);
  assert.equal(checked.canExecute, false);
});
