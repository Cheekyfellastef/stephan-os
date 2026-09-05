import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_IMPROVEMENT_PRESENTATION_KIND,
  authorizationAllowsImprovementStepV1,
  buildStephanosImprovementRecordV1,
  classifyOperatorImprovementIntentV1,
  classifyPeerEvaluationOutcomeV1,
  createImproveStephanosPresentationV1,
  planStephanosImprovementExperienceV1,
} from './stephanosGovernedImprovementExperienceV1.mjs';

function record(overrides = {}) {
  return buildStephanosImprovementRecordV1({
    improvementId: 'improvement-001',
    gapSource: 'OPERATOR_REPORTED_GAP',
    gapSummary: 'The operator has to repeat a manual recovery step.',
    operatorOutcome: 'Known safe recovery should become easier without weakening approval boundaries.',
    observedEvidenceRefs: ['issue:#1281', 'proof:ignition-incident'],
    ownerLookupComplete: true,
    currentCanonicalOwner: '#1281',
    relatedGoalsAndPrs: ['#1281', '#1888'],
    currentArchitectureState: 'Existing self-healing Ignition source owner is known.',
    rootCauseState: 'KNOWN',
    researchRequired: false,
    candidateChanges: [{ changeId: 'reuse-existing-self-heal', summary: 'Attach the regression to the existing Ignition owner.', benefit: 'No duplicate controller.', risk: 'Low source-only scope.', reversible: true }],
    recommendedChange: 'Attach the requirement to the existing owner and use the normal construction machinery.',
    whyThisChange: 'The gap is already owned.',
    expectedBenefit: 'Less operator courier work.',
    blastRadius: 'bounded-existing-owner',
    riskClass: 'LOW',
    reversibility: 'REVERSIBLE',
    authorityRequired: ['SOURCE_IMPLEMENTATION_AUTHORIZED'],
    operatorAuthorizationState: 'PROPOSAL_ONLY',
    requiredReview: ['exact-head-review'],
    requiredProof: ['regression-proof'],
    rollbackPlan: 'Revert the bounded source change if proof regresses.',
    status: 'PROPOSAL',
    ...overrides,
  });
}

test('natural improvement language maps to meaningful gap classes without inventing an owner', () => {
  assert.equal(classifyOperatorImprovementIntentV1('This keeps breaking; make it self-healing.').gapSource, 'PERFORMANCE_OR_RELIABILITY_GAP');
  assert.equal(classifyOperatorImprovementIntentV1('Make this easier, it takes too many clicks.').gapSource, 'UI_EXPERIENCE_DEBT');
  assert.equal(classifyOperatorImprovementIntentV1('Stephanos should know this.').gapSource, 'KNOWLEDGE_OR_RETRIEVAL_GAP');
  assert.equal(classifyOperatorImprovementIntentV1('Why is this still dependent on Codex?').gapSource, 'PROVIDER_SOVEREIGNTY_GAP');
  assert.equal(classifyOperatorImprovementIntentV1('Improve this.').gapSource, 'OPERATOR_REPORTED_GAP');
});

test('failed cognitive answer feeds canonical cognition gap machinery', () => {
  const result = classifyPeerEvaluationOutcomeV1({ cognitivelyCorrect: false, hardToUse: false });
  assert.equal(result.classification, 'COGNITIVE_CAPABILITY_GAP');
  assert.equal(result.canonicalOwner, '#1308/#1607/#1721');
});

test('correct but awkward answer feeds UI experience debt instead of cognitive gap', () => {
  const result = classifyPeerEvaluationOutcomeV1({ cognitivelyCorrect: true, hardToUse: true });
  assert.equal(result.classification, 'EXPERIENCE_DEBT');
  assert.equal(result.canonicalOwner, '#1722');
});

test('existing-owner-first record forbids a duplicate new-goal candidate', () => {
  const item = record();
  assert.equal(item.currentCanonicalOwner, '#1281');
  assert.equal(item.newGoalCandidateAllowed, false);
  assert.equal(item.authority.productContractMayCreateScheduler, false);
  assert.equal(item.authority.productContractMayCreateBuildWorker, false);
});

test('new goal can only become a candidate after owner lookup completes and finds no owner', () => {
  const incomplete = record({ currentCanonicalOwner: '', ownerLookupComplete: false });
  assert.equal(incomplete.newGoalCandidateAllowed, false);
  const complete = record({ currentCanonicalOwner: '', ownerLookupComplete: true });
  assert.equal(complete.newGoalCandidateAllowed, true);
});

test('known existing owner routes the improvement back to that owner', () => {
  const item = record();
  const plan = planStephanosImprovementExperienceV1({ record: item });
  assert.equal(plan.action, 'ATTACH_TO_EXISTING_GOAL');
  assert.equal(plan.reason, 'existing-owner-first');
  assert.equal(plan.newSchedulerOrWorkerAllowed, false);
});

test('unknown owner blocks execution and requires bounded proposal/owner resolution', () => {
  const item = record({ currentCanonicalOwner: '', ownerLookupComplete: false });
  const plan = planStephanosImprovementExperienceV1({ record: item });
  assert.equal(plan.action, 'PREPARE_BOUNDED_IMPROVEMENT_PROPOSAL');
  assert.equal(plan.reason, 'canonical-owner-resolution-required-before-new-work');
});

test('research-required improvement remains a proposal and carries research refs without granting change authority', () => {
  const item = record({
    currentCanonicalOwner: '',
    ownerLookupComplete: true,
    researchRequired: true,
    researchRoute: 'MULTI_AGENT_RESEARCH_COUNCIL',
    researchRefs: ['research-mission:#1902-example'],
    authorityRequired: ['PROPOSAL_ONLY'],
  });
  const plan = planStephanosImprovementExperienceV1({ record: item });
  assert.equal(plan.action, 'PREPARE_BOUNDED_IMPROVEMENT_PROPOSAL');
  assert.equal(plan.reason, 'research-evidence-required-before-change-selection');
  assert.equal(plan.authority.productContractMayMutateSource, false);
});

test('material authority is requested explicitly instead of inferred from a general proposal', () => {
  const item = record({
    currentCanonicalOwner: '',
    ownerLookupComplete: true,
    authorityRequired: ['WINDOWS_RUNTIME_MUTATION_AUTHORIZED'],
    operatorAuthorizationState: 'PROPOSAL_ONLY',
  });
  const plan = planStephanosImprovementExperienceV1({ record: item });
  assert.equal(plan.action, 'REQUEST_ONE_MATERIAL_AUTHORIZATION');
});

test('authorization classes do not imply later merge runtime account or spend authority', () => {
  assert.equal(authorizationAllowsImprovementStepV1({ authorization: 'SOURCE_IMPLEMENTATION_AUTHORIZED', requestedStep: 'SOURCE_IMPLEMENTATION_AUTHORIZED' }), true);
  assert.equal(authorizationAllowsImprovementStepV1({ authorization: 'SOURCE_IMPLEMENTATION_AUTHORIZED', requestedStep: 'EXACT_HEAD_MERGE_AUTHORIZED' }), false);
  assert.equal(authorizationAllowsImprovementStepV1({ authorization: 'EXACT_HEAD_MERGE_AUTHORIZED', requestedStep: 'DEPLOYMENT_AUTHORIZED' }), false);
  assert.equal(authorizationAllowsImprovementStepV1({ authorization: 'WINDOWS_RUNTIME_MUTATION_AUTHORIZED', requestedStep: 'OPENCLAW_MUTATION_AUTHORIZED' }), false);
  assert.equal(authorizationAllowsImprovementStepV1({ authorization: 'PROPOSAL_ONLY', requestedStep: 'SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZED' }), false);
});

test('hard external boundary is reported instead of converted into unsafe work', () => {
  const item = record({ currentCanonicalOwner: '', ownerLookupComplete: true });
  const plan = planStephanosImprovementExperienceV1({ record: item, hardExternalBoundary: true });
  assert.equal(plan.action, 'REPORT_HARD_EXTERNAL_BOUNDARY');
});

test('Improve Stephanos presentation keeps gap evidence owner proposal risk authority progress and proof visible', () => {
  const item = record();
  const plan = planStephanosImprovementExperienceV1({ record: item });
  const presentation = createImproveStephanosPresentationV1({ record: item, plan, completedProofRefs: [] });
  assert.equal(presentation.kind, STEPHANOS_IMPROVEMENT_PRESENTATION_KIND);
  assert.equal(presentation.gap.summary, item.gapSummary);
  assert.deepEqual(presentation.evidence.refs, ['issue:#1281', 'proof:ignition-incident']);
  assert.equal(presentation.existingOwner, '#1281');
  assert.equal(presentation.proposal.recommendedChange, item.recommendedChange);
  assert.equal(presentation.riskRollback.rollbackPlan, item.rollbackPlan);
  assert.deepEqual(presentation.authorityNeeded, ['SOURCE_IMPLEMENTATION_AUTHORIZED']);
  assert.equal(presentation.progress.nextAction, 'ATTACH_TO_EXISTING_GOAL');
  assert.deepEqual(presentation.proof.required, ['regression-proof']);
  assert.equal(presentation.presentationRules.progressiveDisclosure, true);
  assert.equal(presentation.presentationRules.rawConstructionTranscriptShownByDefault, false);
});
