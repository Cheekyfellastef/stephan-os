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


test('a claimed ACTIVE record does not count as installed without recipient exact-revision live proof', () => {
  const record = { timestampUtc: '2026-10-12T10:00:00Z', skillForge: {
    schemaVersion: 'stephanos.skill-provenance.v1', skillId: 'diagnostics',
    name: 'Diagnostics', status: 'ACTIVE', allowedTargets: ['openclaw-standalone'],
    proofRefs: ['source:1'],
  }};
  const payload = { state: 'ready', records: { capabilityRecords: [record] } };
  const unproven = deriveSkillGrowthObservatoryV1({ payload });
  assert.equal(unproven.summary.publishedSkillRecords, 1);
  assert.equal(unproven.summary.provenActiveTargets, 0);
  record.skillForge.targetRuntimeProofs = [{
    actorId: 'openclaw-standalone', passed: true, installedRevision: 'sha256:recorded-revision',
    operatorApprovalRef: 'approval:1', proofRefs: ['runtime:target-1'],
  }];
  const proven = deriveSkillGrowthObservatoryV1({ payload });
  assert.equal(proven.summary.provenActiveTargets, 1);
  assert.equal(proven.observedActors.find(a => a.id === 'openclaw-standalone').skillCount, 1);
});


test('deluxe Skill Forge includes canonical Sovereign Conjurer draft packets as non-installed proposals', () => {
  const draft = {
    schemaVersion: 'stephanos.sovereign-capability-skill-packet.v1',
    id: 'sovereign-skill-windows-service-ownership',
    name: 'Sovereign capability: windows-service-ownership',
    plainEnglishSummary: 'Build a guarded service inspector.',
    whySuggested: 'Validated Sovereign learning event, not runtime proof.',
    status: 'DRAFT', riskLevel: 'HIGH', permissionLevel: 'NEEDS_OPERATOR_APPROVAL',
    canonicalOwnerGoal: '#2573', activationAllowed: false,
    executionAllowed: false, constructionAdmissionAllowed: false, mergeAuthority: false,
    localPath: 'C:/private/operator',
  };
  const status = {
    kind: 'stephanos.shared_workspace.status',
    statusId: 'sovereign-commander-capability-parity-current',
    canonicalOwnerGoal: '#2573',
    timestampUtc: '2026-10-12T11:35:00Z',
    capabilityParity: { buildableGapCount: 3 },
    capabilityCompiler: {
      schemaVersion: 'stephanos.sovereign-commander-capability-compiler.v1',
      skillConjurerSchema: 'stephanos.sovereign-commander-skill-conjurer.v1',
      skillForgeActivationAllowed: false,
      automaticCapabilityConstructionAllowed: false,
      nativeGapCandidateCount: 1,
      skillForgeCandidates: [draft],
    },
  };
  const payload = { state: 'ready', records: { statusRecords: [status] } };
  const view = deriveSkillGrowthObservatoryV1({ payload, nowUtc: '2026-10-12T11:36:00Z' });
  assert.equal(view.summary.sovereignDrafts, 1);
  assert.equal(view.summary.sovereignNativeGaps, 1);
  assert.equal(view.summary.sovereignParityGaps, 3);
  assert.equal(view.summary.sovereignStatusTruth, 'CURRENT');
  const skill = view.skillCandidates.find(item => item.id === draft.id);
  assert.equal(skill.status, 'DRAFT');
  assert.equal(skill.provenance, 'SOVEREIGN_GUARDED_DRAFT_NOT_INSTALLED');
  assert.equal(view.summary.provenActiveTargets, 0);
  assert.equal(JSON.stringify(view).includes('C:/private/operator'), false);
});

test('deluxe Skill Forge never labels stale or self-authorising proposals as installed', () => {
  const safe = {
    schemaVersion: 'stephanos.sovereign-capability-skill-packet.v1',
    id: 'sovereign-skill-bounded-probe', status: 'DRAFT', canonicalOwnerGoal: '#2573',
    activationAllowed: false, executionAllowed: false, constructionAdmissionAllowed: false, mergeAuthority: false,
  };
  const status = {
    kind: 'stephanos.shared_workspace.status',
    statusId: 'sovereign-commander-capability-parity-current',
    canonicalOwnerGoal: '#2573',
    timestampUtc: '2026-10-12T10:00:00Z',
    capabilityCompiler: {
      schemaVersion: 'stephanos.sovereign-commander-capability-compiler.v1',
      skillConjurerSchema: 'stephanos.sovereign-commander-skill-conjurer.v1',
      skillForgeActivationAllowed: false,
      automaticCapabilityConstructionAllowed: false,
      skillForgeCandidates: [safe, {...safe, id:'sovereign-skill-unsafe', activationAllowed: true}],
    },
  };
  const payload = {state:'ready',records:{statusRecords:[status]}};
  const stale = deriveSkillGrowthObservatoryV1({ payload, nowUtc: '2026-10-12T11:36:00Z' });
  assert.equal(stale.summary.sovereignStatusTruth, 'STALE');
  assert.equal(stale.summary.sovereignDrafts, 1);
  assert.equal(stale.skillCandidates.find(x=>x.id===safe.id).provenance, 'SOVEREIGN_STALE_DRAFT_NOT_INSTALLED');
  const invalid = structuredClone(payload);
  invalid.records.statusRecords[0].capabilityCompiler.skillForgeActivationAllowed = true;
  assert.equal(deriveSkillGrowthObservatoryV1({payload:invalid,nowUtc:'2026-10-12T10:01:00Z'}).summary.sovereignDrafts, 0);
});
