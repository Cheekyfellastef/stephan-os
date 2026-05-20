import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResponsePlan } from './responsePlanner.js';

test('merge-decision missing PR evidence returns wait and proof required', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'merge-decision', relevantCanon: [], contextProviderIdsUsed: [] }, uiRealityStatus: { severity: 'OK' } });
  assert.equal(plan.answerShape, 'merge-decision');
  assert.equal(plan.mergeDecision, 'wait');
  assert.equal(plan.proofRequired, 'yes');
});

test('merge-decision missing checks requires proof', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'merge-decision' }, contextProviderSnapshot: { contextProviderProofState: { buildVerifyStatus: 'unknown' } }, uiRealityStatus: { severity: 'OK' }, supportSnapshotSummary: { prEvidenceInputDetected: 'yes' } });
  assert.equal(plan.proofRequired, 'yes');
  assert.equal(plan.mergeDecision, 'wait');
});

test('codex-prompt mode returns prompt sections', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'codex-prompt' } });
  assert.ok(plan.requiredSections.includes('forbidden-actions'));
});

test('diagnosis and architecture/direct-answer stay compact', () => {
  assert.equal(buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'diagnosis' } }).answerShape, 'diagnosis');
  assert.equal(buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'architecture-guidance' } }).answerShape, 'architecture-guidance');
  assert.equal(buildResponsePlan({}).answerShape, 'direct-answer');
});

test('identity-recall uses operator profile when known and unknown fallback when missing', () => {
  const known = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'identity-recall', providerSummaries: { operatorProfile: { known: 'yes', operatorName: 'Stephan' } } } });
  assert.equal(known.identityRecallUsed, 'yes');
  assert.equal(known.operatorNameUsed, 'yes');
  assert.equal(known.identityPromptInjected, 'yes');
  assert.equal(known.operatorProfilePromptLinePresent, 'yes');
  assert.match(known.identityGuidance, /Stephan/);
  const nonHardcoded = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'identity-recall', providerSummaries: { operatorProfile: { known: 'yes', operatorName: 'Alex' } } } });
  assert.match(nonHardcoded.identityGuidance, /Alex/);
  const unknown = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'identity-recall', providerSummaries: { operatorProfile: { known: 'no' } } } });
  assert.equal(unknown.operatorNameUsed, 'no');
  assert.equal(unknown.identityPromptInjected, 'no');
  assert.equal(unknown.operatorProfilePromptLinePresent, 'no');
  assert.match(unknown.identityGuidance, /does not include a known operator name/);
});


test('codex-dispatch mode reports approval next action', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'codex-dispatch' } });
  assert.equal(plan.answerShape, 'codex-dispatch');
  assert.equal(plan.codexPromptRequired, 'yes');
  assert.equal(plan.proofRequired, 'yes');
});


test('failed checks map to no in merge-decision mode', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'merge-decision' }, supportSnapshotSummary: { prEvidenceInputDetected: 'yes', prEvidenceMergeReadiness: 'needs-amendment' }, uiRealityStatus: { severity: 'OK' } });
  assert.equal(plan.mergeDecision, 'no');
});

test('unavailable github evidence keeps merge decision at wait', () => {
  const plan = buildResponsePlan({
    chatContextPack: { recommendedResponseMode: 'merge-decision' },
    supportSnapshotSummary: { prEvidenceInputDetected: 'yes' },
    githubPrEvidence: { status: 'needs-connector', prNumber: 123 },
    uiRealityStatus: { severity: 'OK' },
  });
  assert.equal(plan.mergeDecision, 'wait');
});

test('fetched merged github evidence maps to already-merged without missing evidence warning', () => {
  const plan = buildResponsePlan({
    chatContextPack: { recommendedResponseMode: 'merge-decision' },
    supportSnapshotSummary: { prEvidenceInputDetected: 'yes' },
    githubPrEvidence: { status: 'fetched', mergeReadiness: 'already-merged', merged: true, checksStatus: 'passed', buildStatus: 'passed', verifyStatus: 'passed', missingProof: [] },
    uiRealityStatus: { severity: 'OK' },
    missionState: { testsPassed: 'yes' },
  });
  assert.equal(plan.mergeDecision, 'already-merged');
  assert.equal(plan.warnings.some((warning) => /PR evidence missing/i.test(warning)), false);
});
