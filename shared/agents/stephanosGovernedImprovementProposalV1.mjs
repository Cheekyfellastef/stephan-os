export const STEPHANOS_GOVERNED_IMPROVEMENT_PROPOSAL_SCHEMA_VERSION =
  'stephanos.governed-improvement-proposal.v1';

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

export const STEPHANOS_IMPROVEMENT_CHANGE_CLASSES = Object.freeze([
  'BOUNDED_SOURCE_CHANGE',
  'KNOWN_REVERSIBLE_REPAIR',
  'NEW_GOAL_SCOPE',
  'EXACT_HEAD_MERGE',
  'DEPLOYMENT',
  'WINDOWS_RUNTIME_MUTATION',
  'OPENCLAW_MUTATION',
  'SPENDING_OR_EXTERNAL_ACCOUNT',
  'AUTHORITY_OR_CONSTITUTION_CHANGE',
]);

export const STEPHANOS_IMPROVEMENT_AUTHORITY_REQUIREMENTS = Object.freeze({
  BOUNDED_SOURCE_CHANGE: 'SOURCE_IMPLEMENTATION_AUTHORIZATION_REQUIRED',
  KNOWN_REVERSIBLE_REPAIR: 'BOUNDED_REPAIR_AUTHORIZATION_REQUIRED',
  NEW_GOAL_SCOPE: 'NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED',
  EXACT_HEAD_MERGE: 'EXACT_HEAD_MERGE_AUTHORIZATION_REQUIRED',
  DEPLOYMENT: 'DEPLOYMENT_AUTHORIZATION_REQUIRED',
  WINDOWS_RUNTIME_MUTATION: 'WINDOWS_RUNTIME_MUTATION_AUTHORIZATION_REQUIRED',
  OPENCLAW_MUTATION: 'OPENCLAW_MUTATION_AUTHORIZATION_REQUIRED',
  SPENDING_OR_EXTERNAL_ACCOUNT: 'SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZATION_REQUIRED',
  AUTHORITY_OR_CONSTITUTION_CHANGE: 'HIGH_RISK_OPERATOR_JUDGMENT_REQUIRED',
});

const CONSEQUENTIAL_UNOWNED_CHANGE_CLASSES = new Set([
  'EXACT_HEAD_MERGE',
  'DEPLOYMENT',
  'WINDOWS_RUNTIME_MUTATION',
  'OPENCLAW_MUTATION',
  'SPENDING_OR_EXTERNAL_ACCOUNT',
]);

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_REF = /^(?:#[1-9][0-9]*|[a-z0-9][a-z0-9._:/-]{0,180})$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const ALLOWED_INPUT_KEYS = Object.freeze([
  'gap',
  'architecture',
  'diagnosis',
  'proposal',
]);
const GAP_KEYS = Object.freeze([
  'gapId',
  'gapSource',
  'gapSummary',
  'operatorOutcome',
  'evidenceRefs',
]);
const ARCHITECTURE_KEYS = Object.freeze([
  'snapshotId',
  'repository',
  'sourceHead',
  'existingOwner',
  'activeWriter',
]);
const OWNER_KEYS = Object.freeze(['goalRef', 'componentRefs']);
const WRITER_KEYS = Object.freeze(['writerId', 'resourceScopes']);
const DIAGNOSIS_KEYS = Object.freeze([
  'rootCauseState',
  'rootCauseSummary',
  'researchRoute',
  'researchRefs',
]);
const PROPOSAL_KEYS = Object.freeze([
  'proposalId',
  'changeClass',
  'summary',
  'whyThisChange',
  'alternatives',
  'expectedBenefit',
  'blastRadius',
  'reversibility',
  'resourceScopes',
  'requiredReview',
  'requiredProof',
  'rollbackPlan',
  'attemptsAuthorityWidening',
]);

function text(value, maximum = 500) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) return '';
  return normalized;
}

function safeId(value) {
  const normalized = text(value, 121);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function safeRef(value) {
  const normalized = text(value, 181);
  return SAFE_REF.test(normalized) ? normalized : '';
}

function safeRepository(value) {
  if (typeof value !== 'string' || value !== value.trim()) return '';
  const normalized = text(value, 180);
  if (!SAFE_REPOSITORY.test(normalized)) return '';
  const [owner, repository] = normalized.split('/');
  if (owner === '.' || owner === '..' || repository === '.' || repository === '..') return '';
  return normalized;
}

function safeRefs(value, { minimum = 0, maximum = 16 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const refs = value.map((item) => safeRef(item));
  if (refs.some((item) => !item)) return null;
  if (new Set(refs).size !== refs.length) return null;
  return Object.freeze(refs);
}

function safeResourceScope(value) {
  const normalized = safeRef(value);
  if (!normalized) return '';
  const canonical = normalized.replace(/\/+$/, '');
  if (!canonical) return '';
  const parts = canonical.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return '';
  return canonical;
}

function safeResourceScopes(value, { minimum = 0, maximum = 16 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const scopes = value.map((item) => safeResourceScope(item));
  if (scopes.some((item) => !item)) return null;
  if (new Set(scopes).size !== scopes.length) return null;
  return Object.freeze(scopes);
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function dataOnlySnapshot(value, path = '$', depth = 0, budget = { count: 0 }) {
  if (depth > 8) throw new Error(`${path}: maximum depth exceeded`);
  budget.count += 1;
  if (budget.count > 256) throw new Error(`${path}: maximum item budget exceeded`);

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 4000) throw new Error(`${path}: string too large`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number rejected`);
    return value;
  }
  if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)) {
    throw new Error(`${path}: unsupported value type`);
  }

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path}: custom array rejected`);
    if (value.length > 64) throw new Error(`${path}: array too large`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) throw new Error(`${path}: symbol-keyed array property rejected`);
    const expectedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
    if (ownKeys.some((key) => !expectedKeys.has(key))) throw new Error(`${path}: extra array property rejected`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = descriptors[key];
      if (!descriptor) throw new Error(`${path}: sparse array rejected`);
      if (!descriptor.enumerable) throw new Error(`${path}[${index}]: non-enumerable array element rejected`);
      if (!('value' in descriptor)) throw new Error(`${path}[${index}]: accessor rejected`);
      items.push(dataOnlySnapshot(descriptor.value, `${path}[${index}]`, depth + 1, budget));
    }
    return items;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${path}: custom object rejected`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) throw new Error(`${path}: symbol-keyed property rejected`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of ownKeys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable) throw new Error(`${path}.${key}: non-enumerable property rejected`);
    if (!('value' in descriptor)) throw new Error(`${path}.${key}: accessor rejected`);
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`${path}.${key}: prototype-shaping key rejected`);
    }
  }

  const result = {};
  for (const key of ownKeys) {
    result[key] = dataOnlySnapshot(descriptors[key].value, `${path}.${key}`, depth + 1, budget);
  }
  return result;
}

function scopeOverlap(left, right) {
  const a = left.replace(/\/+$/, '');
  const b = right.replace(/\/+$/, '');
  if (!a || !b) return true;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function overlap(left, right) {
  return left.some((leftScope) => right.some((rightScope) => scopeOverlap(leftScope, rightScope)));
}

function blocked(base, status, blocker, nextAction) {
  return Object.freeze({
    ...base,
    status,
    blocker,
    nextAction,
    proposalReady: false,
    implementationAllowed: false,
    goalCreationAllowed: false,
    dispatchAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    authorityWideningAllowed: false,
  });
}

export function planStephanosGovernedImprovementProposalV1(input = {}) {
  let packet;
  try {
    packet = dataOnlySnapshot(input);
  } catch {
    return blocked(
      {
        schemaVersion: STEPHANOS_GOVERNED_IMPROVEMENT_PROPOSAL_SCHEMA_VERSION,
        gapId: '',
        sourceHead: '',
        currentOwnerGoal: '',
        authorityRequired: '',
      },
      'SAFE_HOLD',
      'invalid-data-only-envelope',
      'REPAIR_IMPROVEMENT_INPUT_ENVELOPE',
    );
  }

  const base = {
    schemaVersion: STEPHANOS_GOVERNED_IMPROVEMENT_PROPOSAL_SCHEMA_VERSION,
    gapId: safeId(packet?.gap?.gapId),
    sourceHead: text(packet?.architecture?.sourceHead, 40).toLowerCase(),
    currentOwnerGoal: safeRef(packet?.architecture?.existingOwner?.goalRef),
    authorityRequired: '',
  };

  if (!exactKeys(packet, ALLOWED_INPUT_KEYS)
    || !exactKeys(packet.gap, GAP_KEYS)
    || !exactKeys(packet.architecture, ARCHITECTURE_KEYS)
    || !exactKeys(packet.diagnosis, DIAGNOSIS_KEYS)
    || !exactKeys(packet.proposal, PROPOSAL_KEYS)) {
    return blocked(base, 'SAFE_HOLD', 'unknown-or-missing-envelope-fields', 'REPAIR_IMPROVEMENT_INPUT_ENVELOPE');
  }

  const gapSource = text(packet.gap.gapSource, 80);
  const gapSummary = text(packet.gap.gapSummary, 1000);
  const operatorOutcome = text(packet.gap.operatorOutcome, 1000);
  const evidenceRefs = safeRefs(packet.gap.evidenceRefs, { minimum: 1, maximum: 16 });
  const repository = safeRepository(packet.architecture.repository);
  const snapshotId = safeId(packet.architecture.snapshotId);
  const sourceHead = text(packet.architecture.sourceHead, 40).toLowerCase();

  if (!base.gapId
    || !STEPHANOS_IMPROVEMENT_GAP_SOURCES.includes(gapSource)
    || !gapSummary
    || !operatorOutcome
    || !evidenceRefs
    || !repository
    || !snapshotId
    || !FULL_SHA.test(sourceHead)) {
    return blocked(base, 'SAFE_HOLD', 'gap-or-architecture-evidence-invalid', 'REFRESH_CANONICAL_GAP_EVIDENCE');
  }

  let owner = null;
  if (packet.architecture.existingOwner !== null) {
    if (!exactKeys(packet.architecture.existingOwner, OWNER_KEYS)) {
      return blocked(base, 'SAFE_HOLD', 'existing-owner-envelope-invalid', 'REFRESH_CANONICAL_OWNER');
    }
    const goalRef = safeRef(packet.architecture.existingOwner.goalRef);
    const componentRefs = safeRefs(packet.architecture.existingOwner.componentRefs, { minimum: 1, maximum: 12 });
    if (!goalRef || !componentRefs) {
      return blocked(base, 'SAFE_HOLD', 'existing-owner-evidence-invalid', 'REFRESH_CANONICAL_OWNER');
    }
    owner = Object.freeze({ goalRef, componentRefs });
    base.currentOwnerGoal = goalRef;
  }

  let activeWriter = null;
  if (packet.architecture.activeWriter !== null) {
    if (!exactKeys(packet.architecture.activeWriter, WRITER_KEYS)) {
      return blocked(base, 'SAFE_HOLD', 'active-writer-envelope-invalid', 'REFRESH_RESOURCE_OWNERSHIP');
    }
    const writerId = safeId(packet.architecture.activeWriter.writerId);
    const resourceScopes = safeResourceScopes(packet.architecture.activeWriter.resourceScopes, { minimum: 1, maximum: 16 });
    if (!writerId || !resourceScopes) {
      return blocked(base, 'SAFE_HOLD', 'active-writer-evidence-invalid', 'REFRESH_RESOURCE_OWNERSHIP');
    }
    activeWriter = Object.freeze({ writerId, resourceScopes });
  }

  const rootCauseState = text(packet.diagnosis.rootCauseState, 40);
  const rootCauseSummary = text(packet.diagnosis.rootCauseSummary, 1000);
  const researchRoute = text(packet.diagnosis.researchRoute, 80);
  const researchRefs = safeRefs(packet.diagnosis.researchRefs, { minimum: 0, maximum: 16 });

  if (!['KNOWN', 'UNKNOWN'].includes(rootCauseState) || !researchRefs) {
    return blocked(base, 'SAFE_HOLD', 'diagnosis-envelope-invalid', 'REPAIR_DIAGNOSIS_EVIDENCE');
  }

  const changeClass = text(packet.proposal.changeClass, 80);
  const attemptsAuthorityWidening = packet.proposal.attemptsAuthorityWidening;
  if (!STEPHANOS_IMPROVEMENT_CHANGE_CLASSES.includes(changeClass)
    || typeof attemptsAuthorityWidening !== 'boolean') {
    return blocked(base, 'SAFE_HOLD', 'improvement-proposal-incomplete', 'COMPLETE_BOUNDED_IMPROVEMENT_PROPOSAL');
  }
  if (attemptsAuthorityWidening || changeClass === 'AUTHORITY_OR_CONSTITUTION_CHANGE') {
    return blocked(
      { ...base, authorityRequired: 'HIGH_RISK_OPERATOR_JUDGMENT_REQUIRED' },
      'OPERATOR_JUDGMENT_REQUIRED',
      'self-improvement-cannot-widen-its-own-authority',
      'PRESENT_HIGH_RISK_IMPROVEMENT_FOR_EXPLICIT_OPERATOR_JUDGMENT',
    );
  }

  if (rootCauseState === 'UNKNOWN') {
    if (!['DIRECT_BOUNDED_RESEARCH', 'SPECIALIST_RESEARCH', 'MULTI_AGENT_RESEARCH_COUNCIL', 'EXPERIMENT_REQUIRED'].includes(researchRoute)) {
      return blocked(base, 'SAFE_HOLD', 'unknown-root-cause-without-bounded-research-route', 'SELECT_BOUNDED_RESEARCH_ROUTE');
    }
    return blocked(
      base,
      'RESEARCH_REQUIRED',
      'root-cause-not-yet-proven',
      `ROUTE_RESEARCH_THROUGH_1902:${researchRoute}`,
    );
  }
  if (!rootCauseSummary) {
    return blocked(base, 'SAFE_HOLD', 'known-root-cause-missing-summary', 'REPAIR_DIAGNOSIS_EVIDENCE');
  }

  const proposalId = safeId(packet.proposal.proposalId);
  const summary = text(packet.proposal.summary, 1200);
  const whyThisChange = text(packet.proposal.whyThisChange, 1200);
  const alternatives = Array.isArray(packet.proposal.alternatives)
    ? packet.proposal.alternatives.map((item) => text(item, 500)).filter(Boolean)
    : [];
  const expectedBenefit = text(packet.proposal.expectedBenefit, 1200);
  const blastRadius = text(packet.proposal.blastRadius, 600);
  const reversibility = text(packet.proposal.reversibility, 600);
  const resourceScopes = safeResourceScopes(packet.proposal.resourceScopes, { minimum: 1, maximum: 16 });
  const requiredReview = safeRefs(packet.proposal.requiredReview, { minimum: 1, maximum: 12 });
  const requiredProof = safeRefs(packet.proposal.requiredProof, { minimum: 1, maximum: 16 });
  const rollbackPlan = text(packet.proposal.rollbackPlan, 1000);

  if (!proposalId
    || !summary
    || !whyThisChange
    || alternatives.length < 1
    || alternatives.length > 8
    || !expectedBenefit
    || !blastRadius
    || !reversibility
    || !resourceScopes
    || !requiredReview
    || !requiredProof
    || !rollbackPlan) {
    return blocked(base, 'SAFE_HOLD', 'improvement-proposal-incomplete', 'COMPLETE_BOUNDED_IMPROVEMENT_PROPOSAL');
  }

  const authorityRequired = STEPHANOS_IMPROVEMENT_AUTHORITY_REQUIREMENTS[changeClass];
  base.authorityRequired = authorityRequired;

  if (activeWriter && overlap(activeWriter.resourceScopes, resourceScopes)) {
    return blocked(
      base,
      'EXISTING_IMPLEMENTATION_OWNER_ACTIVE',
      `resource-owned-by:${activeWriter.writerId}`,
      'WAIT_FOR_OR_RECONCILE_EXISTING_OWNER',
    );
  }

  if (owner && changeClass === 'NEW_GOAL_SCOPE') {
    return blocked(
      { ...base, authorityRequired: '' },
      'SAFE_HOLD',
      'new-goal-scope-conflicts-with-existing-owner',
      'RECLASSIFY_CHANGE_UNDER_EXISTING_OWNER',
    );
  }

  if (!owner && CONSEQUENTIAL_UNOWNED_CHANGE_CLASSES.has(changeClass)) {
    return Object.freeze({
      ...blocked(
        { ...base, authorityRequired },
        'SAFE_HOLD',
        'consequential-change-has-no-canonical-owner',
        `ESTABLISH_CANONICAL_OWNER_BEFORE_${authorityRequired}`,
      ),
      recommendation: Object.freeze({
        proposalId,
        changeClass,
        summary,
        rootCauseSummary,
        resourceScopes,
      }),
    });
  }

  if (!owner) {
    return Object.freeze({
      ...blocked(
        { ...base, authorityRequired: 'NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED' },
        'NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED',
        'no-canonical-owner-found',
        'PRESENT_ONE_BOUNDED_NEW_GOAL_SCOPE_FOR_OPERATOR_AUTHORIZATION',
      ),
      recommendation: Object.freeze({
        proposalId,
        changeClass,
        summary,
        rootCauseSummary,
        resourceScopes,
      }),
    });
  }

  return Object.freeze({
    schemaVersion: STEPHANOS_GOVERNED_IMPROVEMENT_PROPOSAL_SCHEMA_VERSION,
    status: 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER',
    blocker: '',
    gapId: base.gapId,
    gapSource,
    sourceHead,
    architectureSnapshotId: snapshotId,
    repository,
    currentOwnerGoal: owner.goalRef,
    currentOwnerComponents: owner.componentRefs,
    proposal: Object.freeze({
      proposalId,
      changeClass,
      summary,
      whyThisChange,
      alternatives: Object.freeze(alternatives),
      expectedBenefit,
      blastRadius,
      reversibility,
      resourceScopes,
      requiredReview,
      requiredProof,
      rollbackPlan,
    }),
    evidenceRefs,
    diagnosis: Object.freeze({
      rootCauseState,
      rootCauseSummary,
      researchRoute,
      researchRefs,
    }),
    authorityRequired,
    nextAction: `PRESENT_BOUNDED_PROPOSAL_FOR_${authorityRequired}`,
    proposalReady: true,
    implementationAllowed: false,
    goalCreationAllowed: false,
    dispatchAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    authorityWideningAllowed: false,
  });
}