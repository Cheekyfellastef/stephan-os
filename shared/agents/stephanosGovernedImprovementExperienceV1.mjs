import { createHash } from 'node:crypto';

export const STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION = 'stephanos.governed-improvement-experience.v1';
export const STEPHANOS_IMPROVEMENT_PRESENTATION_KIND = 'IMPROVE_STEPHANOS';

export const STEPHANOS_IMPROVEMENT_GAP_SOURCES = Object.freeze([
  'OPERATOR_REPORTED_GAP',
  'STEPHANOS_CONVERSATIONAL_GAP',
  'STEPHANOS_RESEARCH_DISCOVERY',
  'RUNTIME_OR_PROOF_FAILURE',
  'RECURRING_MACHINERY_FAILURE',
  'UI_EXPERIENCE_DEBT',
  'PROVIDER_SOVEREIGNTY_GAP',
  'SECURITY_OR_AUTHORITY_GAP',
  'PERFORMANCE_OR_RELIABILITY_GAP',
  'MISSING_CAPABILITY',
  'ARCHITECTURE_DEBT',
  'AUTOMATION_DEBT',
  'KNOWLEDGE_OR_RETRIEVAL_GAP',
]);

export const STEPHANOS_IMPROVEMENT_ACTIONS = Object.freeze([
  'ATTACH_TO_EXISTING_GOAL',
  'PREPARE_BOUNDED_IMPROVEMENT_PROPOSAL',
  'IMPLEMENT_UNDER_EXISTING_AUTHORITY',
  'REQUEST_ONE_MATERIAL_AUTHORIZATION',
  'REPORT_HARD_EXTERNAL_BOUNDARY',
]);

export const STEPHANOS_IMPROVEMENT_AUTHORITY_CLASSES = Object.freeze([
  'PROPOSAL_ONLY',
  'SOURCE_IMPLEMENTATION_AUTHORIZED',
  'BOUNDED_REPAIR_AUTHORIZED',
  'NEW_GOAL_SCOPE_AUTHORIZED',
  'EXACT_HEAD_MERGE_AUTHORIZED',
  'DEPLOYMENT_AUTHORIZED',
  'WINDOWS_RUNTIME_MUTATION_AUTHORIZED',
  'OPENCLAW_MUTATION_AUTHORIZED',
  'SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZED',
]);

export const STEPHANOS_IMPROVEMENT_RESEARCH_ROUTES = Object.freeze([
  'NO_RESEARCH_NEEDED_KNOWN_REPAIR',
  'DIRECT_BOUNDED_RESEARCH',
  'SPECIALIST_RESEARCH',
  'MULTI_AGENT_RESEARCH_COUNCIL',
  'EXPERIMENT_REQUIRED',
  'OPERATOR_JUDGMENT_REQUIRED',
]);

const SAFE_ID = /^(?:#[1-9][0-9]{0,9}|[a-z0-9][a-z0-9._:#-]{0,127})$/i;
const GAP_SOURCES = new Set(STEPHANOS_IMPROVEMENT_GAP_SOURCES);
const AUTHORITY_CLASSES = new Set(STEPHANOS_IMPROVEMENT_AUTHORITY_CLASSES);
const RESEARCH_ROUTES = new Set(STEPHANOS_IMPROVEMENT_RESEARCH_ROUTES);

function plainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return null;
    }
    return value;
  } catch {
    return null;
  }
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function id(value, fallback = '') {
  const result = text(value);
  return SAFE_ID.test(result) ? result : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function frozen(values) {
  return Object.freeze([...values]);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
    productContractMayCreateScheduler: false,
    productContractMayCreateBuildWorker: false,
    productContractMayMutateSource: false,
    productContractMayMerge: false,
    productContractMayDeploy: false,
    productContractMayMutateWindows: false,
    productContractMayMutateOpenClaw: false,
    productContractMaySpend: false,
    productContractMayChangeExternalAccount: false,
    productContractMayWidenAgentAuthority: false,
    constructionExecutionOwner: 'existing-goal-flywheel-and-qualified-construction-machinery',
    operatorConsequentialAuthorityPreserved: true,
  });
}

export function classifyOperatorImprovementIntentV1(input = '') {
  const message = text(input).toLowerCase();
  if (!message) return Object.freeze({ valid: false, gapSource: 'OPERATOR_REPORTED_GAP', signal: 'empty' });
  if (/keeps? breaking|self[- ]?heal|fragile|reliab/.test(message)) {
    return Object.freeze({ valid: true, gapSource: 'PERFORMANCE_OR_RELIABILITY_GAP', signal: 'recurring-reliability' });
  }
  if (/easier|too many clicks|faff|awkward|hard to use|ui|screen|looks?/.test(message)) {
    return Object.freeze({ valid: true, gapSource: 'UI_EXPERIENCE_DEBT', signal: 'experience-friction' });
  }
  if (/should know|doesn.?t know|cannot answer|can.?t answer|knowledge|remember/.test(message)) {
    return Object.freeze({ valid: true, gapSource: 'KNOWLEDGE_OR_RETRIEVAL_GAP', signal: 'knowledge-or-retrieval' });
  }
  if (/codex|provider|sovereign|fallback|substitut/.test(message)) {
    return Object.freeze({ valid: true, gapSource: 'PROVIDER_SOVEREIGNTY_GAP', signal: 'provider-resilience' });
  }
  return Object.freeze({ valid: true, gapSource: 'OPERATOR_REPORTED_GAP', signal: 'generic-improvement' });
}

export function classifyPeerEvaluationOutcomeV1(input = {}) {
  const item = plainObject(input);
  if (!item) return Object.freeze({ valid: false, classification: 'UNKNOWN', canonicalOwner: null });
  if (item.cognitivelyCorrect === false) {
    return Object.freeze({
      valid: true,
      classification: 'COGNITIVE_CAPABILITY_GAP',
      canonicalOwner: '#1308/#1607/#1721',
      experienceDebtAlsoPresent: item.hardToUse === true,
    });
  }
  if (item.cognitivelyCorrect === true && item.hardToUse === true) {
    return Object.freeze({
      valid: true,
      classification: 'EXPERIENCE_DEBT',
      canonicalOwner: '#1722',
      experienceDebtAlsoPresent: true,
    });
  }
  return Object.freeze({
    valid: true,
    classification: 'ANSWER_AND_EXPERIENCE_ACCEPTABLE',
    canonicalOwner: null,
    experienceDebtAlsoPresent: false,
  });
}

export function buildStephanosImprovementRecordV1(input = {}) {
  try {
    const request = plainObject(input);
    if (!request) return null;
    const gapSummary = text(request.gapSummary);
    if (!gapSummary) return null;
    const gapSource = text(request.gapSource, 'OPERATOR_REPORTED_GAP').toUpperCase();
    if (!GAP_SOURCES.has(gapSource)) return null;
    const ownerLookupComplete = request.ownerLookupComplete === true;
    const currentCanonicalOwner = id(request.currentCanonicalOwner);
    const authorityRequired = unique(list(request.authorityRequired).map((entry) => text(entry).toUpperCase()).filter((entry) => AUTHORITY_CLASSES.has(entry)));
    const researchRoute = text(request.researchRoute, request.researchRequired === true ? 'DIRECT_BOUNDED_RESEARCH' : 'NO_RESEARCH_NEEDED_KNOWN_REPAIR').toUpperCase();
    if (!RESEARCH_ROUTES.has(researchRoute)) return null;
    const improvementId = id(request.improvementId, `improvement-${hash({ gapSource, gapSummary, currentCanonicalOwner }).slice(0, 24)}`);
    const alternatives = list(request.candidateChanges).map((entry) => {
      const item = plainObject(entry);
      if (!item) return null;
      const changeId = id(item.changeId);
      const summary = text(item.summary);
      if (!changeId || !summary) return null;
      return Object.freeze({
        changeId,
        summary,
        benefit: text(item.benefit),
        risk: text(item.risk),
        reversible: item.reversible === true,
      });
    }).filter(Boolean);
    const recordCore = Object.freeze({
      schemaVersion: STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION,
      improvementId,
      gapSource,
      gapSummary,
      operatorOutcome: text(request.operatorOutcome),
      observedEvidenceRefs: frozen(unique(list(request.observedEvidenceRefs).map((entry) => text(entry)).filter(Boolean))),
      ownerLookupComplete,
      currentCanonicalOwner: currentCanonicalOwner || null,
      relatedGoalsAndPrs: frozen(unique(list(request.relatedGoalsAndPrs).map((entry) => text(entry)).filter(Boolean))),
      currentArchitectureState: text(request.currentArchitectureState, 'UNKNOWN'),
      rootCauseState: text(request.rootCauseState, 'UNKNOWN').toUpperCase(),
      researchRequired: request.researchRequired === true,
      researchRoute,
      researchRefs: frozen(unique(list(request.researchRefs).map((entry) => text(entry)).filter(Boolean))),
      candidateChanges: frozen(alternatives),
      recommendedChange: text(request.recommendedChange),
      whyThisChange: text(request.whyThisChange),
      expectedBenefit: text(request.expectedBenefit),
      blastRadius: text(request.blastRadius, 'UNKNOWN'),
      riskClass: text(request.riskClass, 'UNKNOWN').toUpperCase(),
      reversibility: text(request.reversibility, 'UNKNOWN').toUpperCase(),
      resourceScopes: frozen(unique(list(request.resourceScopes).map((entry) => text(entry)).filter(Boolean))),
      authorityRequired: frozen(authorityRequired),
      operatorAuthorizationState: text(request.operatorAuthorizationState, 'PROPOSAL_ONLY').toUpperCase(),
      implementationOwner: text(request.implementationOwner, 'existing-goal-flywheel-and-qualified-construction-machinery'),
      requiredReview: frozen(unique(list(request.requiredReview).map((entry) => text(entry)).filter(Boolean))),
      requiredProof: frozen(unique(list(request.requiredProof).map((entry) => text(entry)).filter(Boolean))),
      rollbackPlan: text(request.rollbackPlan, 'Define rollback before consequential execution.'),
      status: text(request.status, 'PROPOSAL'),
      newGoalCandidateAllowed: ownerLookupComplete && !currentCanonicalOwner,
      authority: authorityBoundary(),
    });
    return Object.freeze({ ...recordCore, recordFingerprint: hash(recordCore) });
  } catch {
    return null;
  }
}

export function planStephanosImprovementExperienceV1(input = {}) {
  try {
    const record = plainObject(input.record);
    if (!record || record.schemaVersion !== STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION) return null;
    let action;
    let reason;
    if (input.hardExternalBoundary === true) {
      action = 'REPORT_HARD_EXTERNAL_BOUNDARY';
      reason = 'external-boundary-cannot-be-safely-built-away';
    } else if (!record.ownerLookupComplete) {
      action = 'PREPARE_BOUNDED_IMPROVEMENT_PROPOSAL';
      reason = 'canonical-owner-resolution-required-before-new-work';
    } else if (record.currentCanonicalOwner) {
      action = 'ATTACH_TO_EXISTING_GOAL';
      reason = 'existing-owner-first';
    } else if (record.authorityRequired.some((entry) => entry !== 'PROPOSAL_ONLY') && record.operatorAuthorizationState === 'PROPOSAL_ONLY') {
      action = 'REQUEST_ONE_MATERIAL_AUTHORIZATION';
      reason = 'material-authority-not-yet-granted';
    } else if (input.existingBoundedSourceAuthority === true && record.authorityRequired.every((entry) => ['PROPOSAL_ONLY', 'SOURCE_IMPLEMENTATION_AUTHORIZED'].includes(entry))) {
      action = 'IMPLEMENT_UNDER_EXISTING_AUTHORITY';
      reason = 'bounded-source-authority-already-matches-described-scope';
    } else {
      action = 'PREPARE_BOUNDED_IMPROVEMENT_PROPOSAL';
      reason = record.researchRequired ? 'research-evidence-required-before-change-selection' : 'bounded-proposal-required-before-execution';
    }
    return Object.freeze({
      schemaVersion: STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION,
      valid: true,
      improvementId: record.improvementId,
      action,
      reason,
      constructionExecutionOwner: record.implementationOwner,
      newSchedulerOrWorkerAllowed: false,
      authority: authorityBoundary(),
    });
  } catch {
    return null;
  }
}

export function authorizationAllowsImprovementStepV1(input = {}) {
  const request = plainObject(input);
  if (!request) return false;
  const authorization = text(request.authorization, 'PROPOSAL_ONLY').toUpperCase();
  const requestedStep = text(request.requestedStep).toUpperCase();
  if (!AUTHORITY_CLASSES.has(authorization) || !AUTHORITY_CLASSES.has(requestedStep)) return false;
  if (requestedStep === 'PROPOSAL_ONLY') return true;
  return authorization === requestedStep;
}

export function createImproveStephanosPresentationV1(input = {}) {
  try {
    const record = plainObject(input.record);
    const plan = plainObject(input.plan);
    if (!record || record.schemaVersion !== STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION || !plan || plan.valid !== true) return null;
    return Object.freeze({
      schemaVersion: STEPHANOS_GOVERNED_IMPROVEMENT_SCHEMA_VERSION,
      kind: STEPHANOS_IMPROVEMENT_PRESENTATION_KIND,
      improvementId: record.improvementId,
      gap: Object.freeze({
        summary: record.gapSummary,
        source: record.gapSource,
        whyItMatters: record.operatorOutcome || record.expectedBenefit || 'Operator impact requires explicit evidence-backed improvement.',
      }),
      evidence: Object.freeze({
        refs: record.observedEvidenceRefs,
        rootCauseState: record.rootCauseState,
        researchRoute: record.researchRoute,
        researchRefs: record.researchRefs,
      }),
      existingOwner: record.currentCanonicalOwner,
      proposal: Object.freeze({
        recommendedChange: record.recommendedChange || 'No change selected yet.',
        whyThisChange: record.whyThisChange || 'Awaiting evidence-backed selection.',
        alternatives: record.candidateChanges,
        expectedBenefit: record.expectedBenefit,
      }),
      riskRollback: Object.freeze({
        riskClass: record.riskClass,
        blastRadius: record.blastRadius,
        reversibility: record.reversibility,
        rollbackPlan: record.rollbackPlan,
      }),
      authorityNeeded: record.authorityRequired,
      authorizationState: record.operatorAuthorizationState,
      progress: Object.freeze({ status: record.status, nextAction: plan.action, reason: plan.reason }),
      proof: Object.freeze({ required: record.requiredProof, completedRefs: frozen(unique(list(input.completedProofRefs).map((entry) => text(entry)).filter(Boolean))) }),
      presentationRules: Object.freeze({
        summaryFirst: true,
        progressiveDisclosure: true,
        evidenceExpandable: true,
        alternativesExpandable: true,
        rawConstructionTranscriptShownByDefault: false,
        authorityMustRemainVisible: true,
      }),
      authority: authorityBoundary(),
    });
  } catch {
    return null;
  }
}
