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


test('an ACTIVE installation claim does not prove an actual recipient skill invocation', () => {
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
  const actor = proven.observedActors.find(a => a.id === 'openclaw-standalone');
  assert.equal(proven.summary.installedClaimTargets, 1);
  assert.equal(actor.installedClaimCount, 1);
  assert.equal(actor.invocationProofVerdict, 'RECIPIENT_SKILL_INVOCATION_INDEPENDENT_PROOF_REQUIRED');
  assert.equal(proven.summary.provenActiveTargets, 0);
  assert.equal(actor.skillCount, 0);
  assert.equal(proven.stages.find(stage => stage.id === 'ACTIVE').count, 0);
});


test('stale and unavailable feeds retain skill history but never prove an active OpenClaw skill', () => {
  const record = { timestampUtc: '2026-11-03T14:00:00Z', skillForge: {
    schemaVersion: 'stephanos.skill-provenance.v1',
    skillId: 'openclaw-verified-example',
    name: 'Verified example', status: 'ACTIVE',
    allowedTargets: ['openclaw-local'], proofRefs: ['source:verified'],
    targetRuntimeProofs: [{
      actorId: 'openclaw-local', passed: true,
      installedRevision: 'sha256:verified-revision',
      operatorApprovalRef: 'approval:qualified',
      proofRefs: ['runtime:verified'],
    }],
  } };
  for (const state of ['ready', 'stale', 'unavailable', 'error', 'STALE']) {
    const view = deriveSkillGrowthObservatoryV1({
      payload: { state, records: { capabilityRecords: [record] } },
    });
    assert.equal(view.summary.publishedSkillRecords, 1, state);
    assert.equal(view.publishedSkills[0].id, 'openclaw-verified-example', state);
    const expectedInstalled = state === 'ready' ? 1 : 0;
    assert.equal(view.observedActors.find(a => a.id === 'openclaw-local').installedClaimCount, expectedInstalled, state);
    assert.equal(view.summary.installedClaimTargets, expectedInstalled, state);
    assert.equal(view.observedActors.find(a => a.id === 'openclaw-local').skillCount, 0, state);
    assert.equal(view.summary.provenActiveTargets, 0, state);
    assert.equal(view.stages.find(s => s.id === 'ACTIVE').count, 0, state);
    if (state !== 'ready') assert.notEqual(view.sourceTruth, 'REPORTED', state);
  }
});

test('canonical external intake is an uninstalled review draft, never an ACTIVE agent skill', () => {
  const externalSkillIntake = {
    schemaVersion: 'stephanos.external-skill-review.v1',
    verdict: 'REVIEW_REQUIRED',
    targetActor: 'openclaw-local',
    name: 'Imported example',
    claimedRegistry: 'github',
    sourceRevision: 'a'.repeat(40),
    contentSha256: 'b'.repeat(64),
    status: 'ACTIVE',
    instructionSignals: [],
  };
  const view = deriveSkillGrowthObservatoryV1({
    payload: { state: 'ready', records: { capabilityRecords: [
      { externalSkillIntake },
    ] } },
  });
  assert.equal(view.summary.proposals, 1);
  assert.equal(view.summary.publishedSkillRecords, 0);
  assert.equal(view.summary.provenActiveTargets, 0);
  assert.equal(view.skillCandidates[0].status, 'DRAFT');
  assert.equal(view.skillCandidates[0].permissionLevel, 'PROPOSE_ONLY');
  assert.equal(view.skillCandidates[0].provenance, 'EXTERNAL_DRAFT_NOT_INSTALLED');

  const untrusted = deriveSkillGrowthObservatoryV1({ payload: {
    state: 'ready', records: { capabilityRecords: [
      { externalSkillIntake: { ...externalSkillIntake, targetActor: 'openclaw-standalone' } },
      { externalSkillIntake: { ...externalSkillIntake, contentSha256: 'unverified' } },
    ] },
  } });
  assert.equal(untrusted.summary.proposals, 0);
});


test('unsigned local tool traces, zero calls and forged invocation fields cannot activate a skill', () => {
  const base = {
    schemaVersion: 'stephanos.skill-provenance.v1',
    skillId: 'stephanos-conveyor-custody-forensics',
    name: 'Conveyor custody forensics',
    status: 'ACTIVE',
    allowedTargets: ['openclaw-standalone'],
    proofRefs: ['source:verified'],
    targetRuntimeProofs: [{
      actorId: 'openclaw-standalone', passed: true,
      installedRevision: 'sha256:installed-revision',
      operatorApprovalRef: 'approval:bounded',
      proofRefs: ['runtime:installed'],
    }],
  };
  const variants = [
    {},
    { toolSummary: { calls: 0 }, runId: 'claimed-read' },
    { toolSummary: { calls: 4 }, toolNames: ['read','read','read','write'] },
    { invoked: true, verified: true, toolTraceVerified: true },
    { toolInvocationProofs: [{
      schemaVersion: 'stephanos.openclaw-forensic-tool-trace.v1',
      reason: 'LOCAL_TRACE_READ_ONLY_OBSERVED', observedReadOnly: true,
      evidenceClass: 'UNSIGNED_LOCAL_TRACE_NOT_OS_AUTHORITY',
      agent: 'openclaw-standalone', toolCount: 1, observedTargets: ['conveyor'],
    }] },
  ];
  for (const [index, forged] of variants.entries()) {
    const record = { timestampUtc: '2026-11-03T21:00:00Z',
      skillForge: { ...base, ...forged } };
    const view = deriveSkillGrowthObservatoryV1({
      payload: { state: 'ready', records: { capabilityRecords: [record] } },
    });
    const actor = view.observedActors.find(a => a.id === 'openclaw-standalone');
    assert.equal(view.summary.publishedSkillRecords, 1, index);
    assert.equal(actor.installedClaimCount, 1, index);
    assert.equal(actor.skillCount, 0, index);
    assert.equal(actor.invocationProofVerdict,
      'RECIPIENT_SKILL_INVOCATION_INDEPENDENT_PROOF_REQUIRED', index);
    assert.equal(view.summary.provenActiveTargets, 0, index);
    assert.equal(view.stages.find(s => s.id === 'ACTIVE').count, 0, index);
  }
});

test('Skill Forge consumes the backend verified gate ledger inside the projection envelope', () => {
  const sourceHead = 'a'.repeat(40);
  const gates = Array.from({ length: 23 }, (_, i) => ({
    id: i + 1, title: 'Gate ' + (i + 1), owner: 'canonical-gate-owner',
    status: i === 14 ? 'FAIL' : 'UNVERIFIED',
    typedBlocker: i === 14 ? 'MISSING_CAPABILITY' : '',
    proofRef: i === 14 ? 'workspace:proof/goal-gate-15' : '',
  }));
  const projection = {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    observationStatus: 'EVIDENCE_AVAILABLE', sourceHead,
    observedAtUtc: new Date().toISOString(), gates,
  };
  const view = deriveSkillGrowthObservatoryV1({
    payload: { state: 'ready', projection: { goalBuildGateObservatory: projection } },
  });
  assert.equal(view.gateRepair.summary.failedGateCount, 1);
  assert.equal(view.gateRepair.summary.skillReviewDraftCount, 1);
  assert.equal(view.skillCandidates[0].provenance, 'GATE_FAILURE_REVIEW_DRAFT_NOT_INSTALLED');
  const wrongEnvelope = deriveSkillGrowthObservatoryV1({
    payload: { state: 'ready', goalBuildGateObservatory: projection },
  });
  assert.equal(wrongEnvelope.gateRepair.sourceTruth, 'UNVERIFIED');
});
