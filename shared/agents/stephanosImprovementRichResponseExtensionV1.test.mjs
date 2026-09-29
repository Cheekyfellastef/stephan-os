import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStephanosImprovementRecordV1,
  createImproveStephanosPresentationV1,
  planStephanosImprovementExperienceV1,
} from './stephanosGovernedImprovementExperienceV1.mjs';
import {
  STEPHANOS_IMPROVEMENT_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION,
  buildStephanosImprovementRichResponseExtensionV1,
} from './stephanosImprovementRichResponseExtensionV1.mjs';

function presentation(overrides = {}) {
  const record = buildStephanosImprovementRecordV1({
    improvementId: 'improvement-001',
    gapSource: 'UI_EXPERIENCE_DEBT',
    gapSummary: 'The operator cannot see the improvement proof without opening several unrelated views.',
    operatorOutcome: 'Make the improvement state concise and inspectable in the existing Conversation Canvas.',
    observedEvidenceRefs: ['issue:#1903', 'proof:conversation-canvas-gap'],
    ownerLookupComplete: true,
    currentCanonicalOwner: '#1903',
    relatedGoalsAndPrs: ['#1903', '#1801'],
    currentArchitectureState: 'The existing governed improvement experience and Conversation Canvas owners are known.',
    rootCauseState: 'KNOWN',
    researchRequired: false,
    candidateChanges: [
      {
        changeId: 'reuse-improve-stephanos-canvas',
        summary: 'Project the governed improvement presentation through the existing rich-response and Canvas path.',
        benefit: 'Keeps one renderer and one durable truth path.',
        risk: 'Presentation mapping could omit a governance field.',
        reversible: true,
      },
    ],
    recommendedChange: 'Reuse the existing rich-response and Conversation Canvas path for IMPROVE_STEPHANOS.',
    whyThisChange: 'The product already has canonical improvement and Canvas owners.',
    expectedBenefit: 'Gap, evidence, owner, alternatives, risk, authority, progress and proof become visible together.',
    blastRadius: 'presentation-only',
    riskClass: 'LOW',
    reversibility: 'REVERSIBLE',
    authorityRequired: ['SOURCE_IMPLEMENTATION_AUTHORIZED'],
    operatorAuthorizationState: 'PROPOSAL_ONLY',
    requiredReview: ['exact-head-review'],
    requiredProof: ['served-canvas-regression'],
    rollbackPlan: 'Remove the extension and retain the existing standalone improvement presentation.',
    status: 'PROPOSAL',
    ...overrides,
  });
  const plan = planStephanosImprovementExperienceV1({ record });
  return createImproveStephanosPresentationV1({
    record,
    plan,
    completedProofRefs: ['proof:source-contract-green'],
  });
}

test('governed improvement presentation maps into the existing rich-response structured fields', () => {
  const result = buildStephanosImprovementRichResponseExtensionV1({ improvementPresentation: presentation() });
  assert.equal(result.valid, true);
  assert.equal(result.schemaVersion, STEPHANOS_IMPROVEMENT_RICH_RESPONSE_EXTENSION_SCHEMA_VERSION);
  assert.equal(result.improvementLineage.improvementId, 'improvement-001');
  assert.equal(result.improvementLineage.existingOwner, '#1903');
  assert.equal(result.improvementLineage.constructionExecutionOwnedHere, false);
  assert.deepEqual(result.structured.visualisationCandidates, ['IMPROVE_STEPHANOS']);
  assert.equal(result.structured.goalsMissions[0].ref, '#1903');
  assert.equal(result.structured.goalsMissions[0].state, 'PROPOSAL');
  assert.deepEqual(result.structured.goalsMissions[0].evidenceRefs, [
    'issue:#1903',
    'proof:conversation-canvas-gap',
    'proof:source-contract-green',
  ]);
});

test('alternatives preserve benefit risk and reversibility for Conversation Canvas comparison', () => {
  const result = buildStephanosImprovementRichResponseExtensionV1({ improvementPresentation: presentation() });
  assert.equal(result.structured.options.length, 1);
  assert.equal(result.structured.options[0].optionId, 'reuse-improve-stephanos-canvas');
  assert.match(result.structured.options[0].tradeoff, /Benefit: Keeps one renderer/);
  assert.match(result.structured.options[0].tradeoff, /Risk: Presentation mapping could omit/);
  assert.match(result.structured.options[0].tradeoff, /Reversible: YES/);
});

test('recommended action keeps risk rollback progress and proof gating visible without execution authority', () => {
  const result = buildStephanosImprovementRichResponseExtensionV1({ improvementPresentation: presentation() });
  assert.equal(result.structured.recommendedAction.actionId, 'improve:improvement-001:next');
  assert.match(result.structured.recommendedAction.rationale, /Rollback:/);
  assert.match(result.structured.recommendedAction.rationale, /Status: PROPOSAL/);
  assert.match(result.structured.recommendedAction.rationale, /Next: ATTACH_TO_EXISTING_GOAL/);
  assert.equal(result.structured.recommendedAction.requiresApproval, 'YES');
  assert.equal(result.structured.approvalState.state, 'REQUIRED');
  assert.ok(result.structured.unknowns.includes('Required proof before completion: served-canvas-regression'));
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.commandExecutionAllowed, false);
  assert.equal(result.authority.approvalAuthorityAdded, false);
});

test('matching material authorization is presented as approved but does not widen authority', () => {
  const result = buildStephanosImprovementRichResponseExtensionV1({
    improvementPresentation: presentation({ operatorAuthorizationState: 'SOURCE_IMPLEMENTATION_AUTHORIZED' }),
  });
  assert.equal(result.valid, true);
  assert.equal(result.structured.approvalState.state, 'APPROVED');
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.constructionExecutionOwnedHere, false);
});

test('unknown root cause and missing owner remain explicit unknowns rather than becoming invented truth', () => {
  const result = buildStephanosImprovementRichResponseExtensionV1({
    improvementPresentation: presentation({
      currentCanonicalOwner: '',
      ownerLookupComplete: true,
      rootCauseState: 'UNKNOWN',
      recommendedChange: '',
    }),
  });
  assert.equal(result.valid, true);
  assert.equal(result.improvementLineage.existingOwner, null);
  assert.ok(result.structured.unknowns.includes('Improvement root cause remains UNKNOWN.'));
  assert.ok(result.structured.unknowns.includes('No existing canonical owner is yet established for this improvement gap.'));
  assert.ok(result.structured.unknowns.includes('No evidence-backed improvement change has been selected yet.'));
});

test('widened product authority is rejected before rich-response composition', () => {
  const base = presentation();
  const widened = {
    ...base,
    authority: {
      ...base.authority,
      productContractMayMutateSource: true,
    },
  };
  const result = buildStephanosImprovementRichResponseExtensionV1({ improvementPresentation: widened });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('improvement-presentation-authority-must-remain-governed'));
  assert.equal(result.structured, null);
});

test('wrong presentation kind and invalid owner lineage fail closed', () => {
  const base = presentation();
  const wrongKind = buildStephanosImprovementRichResponseExtensionV1({
    improvementPresentation: { ...base, kind: 'RESEARCH_EXPEDITION' },
  });
  assert.equal(wrongKind.valid, false);
  assert.ok(wrongKind.errors.includes('improvement-presentation-kind-mismatch'));

  const invalidOwner = buildStephanosImprovementRichResponseExtensionV1({
    improvementPresentation: { ...base, existingOwner: 'owner with spaces' },
  });
  assert.equal(invalidOwner.valid, false);
  assert.ok(invalidOwner.errors.includes('existing-owner-ref-invalid'));
});
