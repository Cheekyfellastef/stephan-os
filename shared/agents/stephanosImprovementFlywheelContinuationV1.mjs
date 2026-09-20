import { createHash } from 'node:crypto';

import { planStephanosGovernedImprovementProposalV1 } from './stephanosGovernedImprovementProposalV1.mjs';
import {
  buildStephanosImprovementRecordV1,
  planStephanosImprovementExperienceV1,
} from './stephanosGovernedImprovementExperienceV1.mjs';

export const STEPHANOS_IMPROVEMENT_FLYWHEEL_CONTINUATION_SCHEMA_VERSION =
  'stephanos.improvement-flywheel-continuation.v1';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  goalCreationAllowed: false,
  dispatchAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  authorityWideningAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hashId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
}

function goalRef(record = {}) {
  for (const candidate of [
    record.issueNumber,
    record.issue,
    String(record.relatedIssue ?? '').replace(/^#/, ''),
    String(record.goalId ?? '').replace(/^goal-/, ''),
  ]) {
    const issue = Number(candidate);
    if (Number.isSafeInteger(issue) && issue > 0) return `#${issue}`;
  }
  return '';
}

function gapSource(rootCauseClass) {
  if (['KNOWLEDGE_NOT_INGESTED', 'CANONICAL_STATE_NOT_PROJECTED', 'MEMORY_NOT_RETAINED', 'MEMORY_NOT_RETRIEVABLE', 'CONTEXT_NOT_ROUTED'].includes(rootCauseClass)) {
    return 'KNOWLEDGE_OR_RETRIEVAL_GAP';
  }
  if (['TOOL_OR_DATA_SOURCE_MISSING', 'TOOL_PRESENT_BUT_NOT_DISCOVERABLE', 'PARTICIPANT_NOT_CONNECTED', 'AGENT_CAPABILITY_CONTRACT_GAP'].includes(rootCauseClass)) {
    return 'MISSING_CAPABILITY';
  }
  if (['QUESTION_ANSWER_TRANSPORT_MISSING', 'CROSS_PARTICIPANT_COHERENCE_GAP'].includes(rootCauseClass)) {
    return 'AUTOMATION_DEBT';
  }
  if (rootCauseClass === 'FRESHNESS_OR_OBSERVABILITY_GAP') return 'PERFORMANCE_OR_RELIABILITY_GAP';
  return 'STEPHANOS_CONVERSATIONAL_GAP';
}

function componentRef(capability) {
  const normalized = text(capability).replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `component://${normalized || 'conversation-capability'}`;
}

function sourceHeadFrom(input = {}) {
  for (const candidate of [input.sourceHead, input.existingGoalRecord?.headSha, input.existingGoalRecord?.sourceHead]) {
    const normalized = text(candidate).toLowerCase();
    if (FULL_SHA.test(normalized)) return normalized;
  }
  return '';
}

function repositoryFrom(input = {}) {
  return text(input.repository || input.existingGoalRecord?.repository || 'Cheekyfellastef/stephan-os');
}

function sourceAuthorizationState(goal = {}) {
  return text(goal.operatorAuthorizationState).toUpperCase() === 'SOURCE_IMPLEMENTATION_AUTHORIZED'
    ? 'SOURCE_IMPLEMENTATION_AUTHORIZED'
    : 'PROPOSAL_ONLY';
}

function safeHold(status, blocker, nextAction, gapId = '') {
  return Object.freeze({
    schemaVersion: STEPHANOS_IMPROVEMENT_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    status,
    blocker,
    nextAction,
    gapId,
    planner: null,
    improvementRecord: null,
    executionPlan: null,
    executionDisposition: 'HOLD',
    proposalReady: false,
    authority: AUTHORITY,
  });
}

function buildExecutionPlan({ proposal, gap, goal, ownerRef }) {
  if (proposal?.proposalReady !== true || !proposal?.proposal) return null;
  const authorizationState = sourceAuthorizationState(goal);
  const record = buildStephanosImprovementRecordV1({
    improvementId: proposal.proposal.proposalId,
    gapSource: proposal.gapSource,
    gapSummary: text(gap.summary) || proposal.proposal.summary,
    operatorOutcome: proposal.proposal.expectedBenefit,
    observedEvidenceRefs: proposal.evidenceRefs,
    ownerLookupComplete: true,
    currentCanonicalOwner: ownerRef,
    relatedGoalsAndPrs: [ownerRef],
    currentArchitectureState: `Canonical owner ${ownerRef} is bound to exact source head ${proposal.sourceHead}.`,
    rootCauseState: proposal.diagnosis?.rootCauseState || 'KNOWN',
    researchRequired: false,
    researchRoute: 'NO_RESEARCH_NEEDED_KNOWN_REPAIR',
    researchRefs: proposal.diagnosis?.researchRefs || proposal.evidenceRefs,
    candidateChanges: [{
      changeId: proposal.proposal.proposalId,
      summary: proposal.proposal.summary,
      benefit: proposal.proposal.expectedBenefit,
      risk: proposal.proposal.blastRadius,
      reversible: true,
    }],
    recommendedChange: proposal.proposal.summary,
    whyThisChange: proposal.proposal.whyThisChange,
    expectedBenefit: proposal.proposal.expectedBenefit,
    blastRadius: proposal.proposal.blastRadius,
    riskClass: 'BOUNDED',
    reversibility: 'REVERSIBLE',
    resourceScopes: proposal.proposal.resourceScopes,
    authorityRequired: ['SOURCE_IMPLEMENTATION_AUTHORIZED'],
    operatorAuthorizationState: authorizationState,
    implementationOwner: 'existing-goal-flywheel-and-qualified-construction-machinery',
    requiredReview: proposal.proposal.requiredReview,
    requiredProof: proposal.proposal.requiredProof,
    rollbackPlan: proposal.proposal.rollbackPlan,
    status: 'PROPOSAL_READY',
  });
  if (!record) return null;
  const existingBoundedSourceAuthority = authorizationState === 'SOURCE_IMPLEMENTATION_AUTHORIZED';
  const plan = planStephanosImprovementExperienceV1({
    record,
    existingBoundedSourceAuthority,
  });
  if (!plan) return null;
  return Object.freeze({ record, plan, existingBoundedSourceAuthority });
}

export function buildStephanosImprovementFlywheelContinuationV1(input = {}) {
  const gap = input.gapObservation;
  const ownerRef = goalRef(input.existingGoalRecord);
  if (!gap?.gapId || !gap?.rootCauseClass || !gap?.affectedCapability) {
    return safeHold('SAFE_HOLD', 'gap-observation-incomplete', 'REFRESH_CANONICAL_GAP_EVIDENCE');
  }
  if (!SAFE_GOAL_REF.test(ownerRef)) {
    return safeHold('CANONICAL_OWNER_REQUIRED', 'existing-scheduler-goal-required', 'ESTABLISH_CANONICAL_OWNER', gap.gapId);
  }
  const sourceHead = sourceHeadFrom(input);
  if (!sourceHead) {
    return safeHold('EXACT_SOURCE_HEAD_REQUIRED', 'exact-source-head-not-proven', 'REFRESH_EXACT_SOURCE_IDENTITY', gap.gapId);
  }

  const repository = repositoryFrom(input);
  const evidenceRefs = Array.isArray(gap.proofRefs) && gap.proofRefs.length
    ? [...gap.proofRefs]
    : Array.isArray(input.evidenceRefs) && input.evidenceRefs.length
      ? [...input.evidenceRefs]
      : [];
  if (!evidenceRefs.length) {
    return safeHold('SAFE_HOLD', 'gap-evidence-refs-required', 'REFRESH_CANONICAL_GAP_EVIDENCE', gap.gapId);
  }

  const capabilityRef = componentRef(gap.affectedCapability);
  const proposalId = hashId('improvement', [gap.gapSignature, ownerRef, sourceHead]);
  const proposal = planStephanosGovernedImprovementProposalV1({
    gap: {
      gapId: gap.gapId,
      gapSource: gapSource(gap.rootCauseClass),
      gapSummary: text(gap.summary) || `Repair ${gap.rootCauseClass} affecting ${gap.affectedCapability}.`,
      operatorOutcome: 'Restore the missing capability, retain safety boundaries, and replay the originating question for proof.',
      evidenceRefs,
    },
    architecture: {
      snapshotId: hashId('architecture', [repository, sourceHead, ownerRef]),
      repository,
      sourceHead,
      existingOwner: {
        goalRef: ownerRef,
        componentRefs: [capabilityRef],
      },
      activeWriter: null,
    },
    diagnosis: {
      rootCauseState: 'KNOWN',
      rootCauseSummary: `${gap.rootCauseClass} was deterministically classified from the capability-gap intake evidence.`,
      researchRoute: 'NONE_REQUIRED_FOR_KNOWN_ROOT_CAUSE',
      researchRefs: evidenceRefs,
    },
    proposal: {
      proposalId,
      changeClass: 'BOUNDED_SOURCE_CHANGE',
      summary: `Repair ${gap.affectedCapability} under ${ownerRef}.`,
      whyThisChange: `The originating Q&A produced ${gap.rootCauseClass}; leaving it unconnected would keep the same capability gap in the flywheel.`,
      alternatives: ['Retain the current behavior and keep the gap open for later investigation.'],
      expectedBenefit: 'The repaired capability can return grounded evidence and the original question can be replayed as regression proof.',
      blastRadius: `Bounded to ${ownerRef} and ${gap.affectedCapability}.`,
      reversibility: 'Source-only bounded change can be reverted through the normal protected source workflow.',
      resourceScopes: [`component/${text(gap.affectedCapability).replace(/[^a-z0-9._:-]+/gi, '-').toLowerCase()}`],
      requiredReview: ['review://provider-neutral-exact-head'],
      requiredProof: ['proof://originating-question-replay'],
      rollbackPlan: 'Revert the bounded source repair and retain the durable gap observation if regression proof fails.',
      attemptsAuthorityWidening: false,
    },
  });

  const execution = buildExecutionPlan({
    proposal,
    gap,
    goal: input.existingGoalRecord,
    ownerRef,
  });
  const executionDisposition = execution?.plan?.action === 'IMPLEMENT_UNDER_EXISTING_AUTHORITY'
    ? 'ROUTE_IMPLEMENTATION_UNDER_EXISTING_AUTHORITY'
    : execution?.plan?.action === 'ATTACH_TO_EXISTING_GOAL'
      ? 'ATTACH_AND_AWAIT_REQUIRED_SOURCE_AUTHORITY'
      : 'HOLD';
  const nextAction = executionDisposition === 'ROUTE_IMPLEMENTATION_UNDER_EXISTING_AUTHORITY'
    ? 'ROUTE_TO_EXISTING_GOAL_CONSTRUCTION_MACHINERY'
    : text(proposal.nextAction);

  return Object.freeze({
    schemaVersion: STEPHANOS_IMPROVEMENT_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    status: plannerStatus(proposal),
    blocker: text(proposal.blocker),
    nextAction,
    gapId: gap.gapId,
    planner: proposal,
    improvementRecord: execution?.record || null,
    executionPlan: execution?.plan || null,
    executionDisposition,
    proposalReady: proposal.proposalReady === true,
    authority: AUTHORITY,
  });
}

function plannerStatus(proposal) {
  return text(proposal?.status) || 'SAFE_HOLD';
}
