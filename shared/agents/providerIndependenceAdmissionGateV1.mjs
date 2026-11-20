export const PROVIDER_INDEPENDENCE_ADMISSION_GATE_SCHEMA = 'stephanos.provider-independence-admission-gate.v1';

export const PROVIDER_INDEPENDENCE_VERDICT = Object.freeze({
  PASS_PROVIDER_INDEPENDENT: 'PASS_PROVIDER_INDEPENDENT',
  PASS_OPTIONAL_CODEX_SPECIALIST: 'PASS_OPTIONAL_CODEX_SPECIALIST',
  PASS_EXISTING_QUALIFIED_PARITY: 'PASS_EXISTING_QUALIFIED_PARITY',
  BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH: 'BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH',
  BLOCK_FALLBACK_REMOVED_WITHOUT_REPLACEMENT: 'BLOCK_FALLBACK_REMOVED_WITHOUT_REPLACEMENT',
  BLOCK_DECLARED_FALLBACK_UNQUALIFIED: 'BLOCK_DECLARED_FALLBACK_UNQUALIFIED',
  BLOCK_PORTABLE_CHECKPOINT_MISSING: 'BLOCK_PORTABLE_CHECKPOINT_MISSING',
  BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS: 'BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS',
  TEMPORARY_EXCEPTION_ACTIVE: 'TEMPORARY_EXCEPTION_ACTIVE',
});

export const PROVIDER_DEPENDENCY_MODE = Object.freeze({
  PROVIDER_INDEPENDENT: 'PROVIDER_INDEPENDENT',
  OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK: 'OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK',
  NON_CRITICAL_OBSERVABILITY_ONLY: 'NON_CRITICAL_OBSERVABILITY_ONLY',
  TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER: 'TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER',
  HARD_EXTERNAL_BOUNDARY_WITH_UNRELATED_WORK_ISOLATION: 'HARD_EXTERNAL_BOUNDARY_WITH_UNRELATED_WORK_ISOLATION',
  CODEX_ONLY_CRITICAL_PATH: 'CODEX_ONLY_CRITICAL_PATH',
});

export const PROVIDER_CLASS = Object.freeze({
  PROVIDER_NEUTRAL: 'PROVIDER_NEUTRAL',
  CODEX: 'CODEX',
  WORK_AGENTIC: 'WORK_AGENTIC',
  CHATGPT_GITHUB: 'CHATGPT_GITHUB',
  GITHUB_HOSTED: 'GITHUB_HOSTED',
  OPENCLAW_LOCAL: 'OPENCLAW_LOCAL',
  FOUNDRY_FORGE: 'FOUNDRY_FORGE',
  BATTLE_BRIDGE_FIXED: 'BATTLE_BRIDGE_FIXED',
  OTHER_NON_CODEX: 'OTHER_NON_CODEX',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{1,180}$/i;
const SAFE_REF = /^(?:#[1-9][0-9]*|[a-z0-9][a-z0-9._:@/-]{1,220})$/i;
const CONTRACT_ID = /^[a-z0-9][a-z0-9._:-]{2,180}$/i;
const PROVIDERS = new Set(Object.values(PROVIDER_CLASS));
const MODES = new Set(Object.values(PROVIDER_DEPENDENCY_MODE));
const CODEX_LIKE = new Set([PROVIDER_CLASS.CODEX, PROVIDER_CLASS.WORK_AGENTIC]);
const CRITICALITY = new Set(['NONE', 'OPTIONAL', 'CRITICAL_PATH']);
const QUALIFICATION = new Set(['PRODUCTION_ELIGIBLE', 'QUALIFIED_FOR_TASK_CLASS']);
const FAILURE_BEHAVIOUR = new Set(['ROUTE_AROUND_PROVIDER', 'CAPABILITY_BLOCKED_ONLY', 'UNRELATED_WORK_CONTINUES']);

const INPUT_KEYS = Object.freeze(['nowUtc', 'dependency', 'parityRoutes', 'retiringRouteIds', 'exception']);
const DEPENDENCY_KEYS = Object.freeze([
  'providerDependencyId',
  'capabilityClass',
  'provider',
  'mode',
  'whyProviderSpecific',
  'criticalPathImpact',
  'requiredTaskClass',
  'nonProviderSpecificContract',
  'qualifiedAlternatives',
  'portableCheckpointContract',
  'receiptContract',
  'failureBehaviour',
  'operatorImpact',
  'hardExternalBoundaryReason',
  'parityProofRefs',
]);
const ROUTE_KEYS = Object.freeze([
  'routeId',
  'provider',
  'taskClass',
  'qualificationState',
  'active',
  'portableCheckpointContract',
  'receiptContract',
  'proofRefs',
]);
const EXCEPTION_KEYS = Object.freeze([
  'exceptionId',
  'reason',
  'scope',
  'owner',
  'createdAt',
  'expiresAt',
  'blastRadius',
  'unblockedUnrelatedWork',
  'fallbackBuildGoal',
  'proofRequiredToRemoveException',
  'operatorApprovalRef',
]);

function text(value, maximum = 1200) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : '';
}

function timestamp(value) {
  const normalized = text(value, 80);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...allowed].sort());
}

function safeList(value, { maximum = 24, refs = false } = {}) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const values = value.map((item) => text(item, refs ? 221 : 181));
  const pattern = refs ? SAFE_REF : SAFE_ID;
  if (values.some((item) => !item || !pattern.test(item))) return null;
  if (new Set(values).size !== values.length) return null;
  return Object.freeze(values);
}

function isPlainData(value, depth = 0, budget = { count: 0 }) {
  if (depth > 8) return false;
  budget.count += 1;
  if (budget.count > 512) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index) || !isPlainData(value[index], depth + 1, budget)) return false;
    }
    return true;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
    if (!isPlainData(descriptor.value, depth + 1, budget)) return false;
  }
  return true;
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    dispatchAllowed: false,
    providerQualificationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    windowsRuntimeAuthority: false,
    openClawMutationAuthority: false,
    spendingOrAccountAuthority: false,
    leaseSeizureAllowed: false,
  });
}

function result(base, finalVerdict, blockers = [], extras = {}) {
  return Object.freeze({
    ...base,
    ...extras,
    blockers: Object.freeze([...blockers]),
    finalVerdict,
    authorityBoundary: authorityBoundary(),
  });
}

function validRoute(route) {
  if (!exactKeys(route, ROUTE_KEYS)) return false;
  const proofRefs = safeList(route.proofRefs, { maximum: 16, refs: true });
  return SAFE_ID.test(text(route.routeId, 181))
    && PROVIDERS.has(route.provider)
    && !CODEX_LIKE.has(route.provider)
    && CONTRACT_ID.test(text(route.taskClass, 181))
    && QUALIFICATION.has(route.qualificationState)
    && typeof route.active === 'boolean'
    && CONTRACT_ID.test(text(route.portableCheckpointContract, 181))
    && CONTRACT_ID.test(text(route.receiptContract, 181))
    && proofRefs !== null
    && proofRefs.length > 0;
}

function routeMatchesDependency(route, dependency, retiringRouteIds) {
  return validRoute(route)
    && route.active === true
    && !retiringRouteIds.includes(route.routeId)
    && route.taskClass === dependency.requiredTaskClass
    && route.portableCheckpointContract === dependency.portableCheckpointContract
    && route.receiptContract === dependency.receiptContract;
}

function validateException(exception, nowMs) {
  if (!exactKeys(exception, EXCEPTION_KEYS)) return { valid: false, reason: 'temporary-exception-envelope-invalid' };
  const created = timestamp(exception.createdAt);
  const expires = timestamp(exception.expiresAt);
  const valid = SAFE_ID.test(text(exception.exceptionId, 181))
    && text(exception.reason)
    && text(exception.scope)
    && SAFE_ID.test(text(exception.owner, 181))
    && created !== null
    && expires !== null
    && created <= nowMs
    && expires > nowMs
    && expires > created
    && expires - created <= 30 * 24 * 60 * 60 * 1000
    && text(exception.blastRadius)
    && exception.unblockedUnrelatedWork === true
    && /^#[1-9][0-9]*$/.test(text(exception.fallbackBuildGoal, 32))
    && text(exception.proofRequiredToRemoveException)
    && SAFE_REF.test(text(exception.operatorApprovalRef, 221));
  return { valid: Boolean(valid), reason: valid ? '' : 'temporary-exception-expired-or-invalid' };
}

export function evaluateProviderIndependenceAdmissionV1(input = {}) {
  const base = {
    schemaVersion: PROVIDER_INDEPENDENCE_ADMISSION_GATE_SCHEMA,
    providerDependencyId: text(input?.dependency?.providerDependencyId, 181),
    capabilityClass: text(input?.dependency?.capabilityClass, 181),
    provider: text(input?.dependency?.provider, 80),
    mode: text(input?.dependency?.mode, 120),
    evaluatedAtUtc: text(input?.nowUtc, 80),
    selectedAlternativeRouteIds: Object.freeze([]),
    concentrationRiskVisible: false,
  };

  if (!isPlainData(input)
    || !exactKeys(input, INPUT_KEYS)
    || !exactKeys(input.dependency, DEPENDENCY_KEYS)) {
    return result(base, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS, ['provider-dependency-envelope-invalid']);
  }

  const nowMs = timestamp(input.nowUtc);
  const dependency = input.dependency;
  const qualifiedAlternatives = safeList(dependency.qualifiedAlternatives, { maximum: 16 });
  const parityProofRefs = safeList(dependency.parityProofRefs, { maximum: 16, refs: true });
  const retiringRouteIds = safeList(input.retiringRouteIds, { maximum: 16 });
  const routes = input.parityRoutes;

  const identityValid = nowMs !== null
    && SAFE_ID.test(text(dependency.providerDependencyId, 181))
    && CONTRACT_ID.test(text(dependency.capabilityClass, 181))
    && PROVIDERS.has(dependency.provider)
    && MODES.has(dependency.mode)
    && text(dependency.whyProviderSpecific)
    && CRITICALITY.has(dependency.criticalPathImpact)
    && CONTRACT_ID.test(text(dependency.requiredTaskClass, 181))
    && CONTRACT_ID.test(text(dependency.nonProviderSpecificContract, 181))
    && qualifiedAlternatives !== null
    && typeof dependency.portableCheckpointContract === 'string'
    && CONTRACT_ID.test(text(dependency.receiptContract, 181))
    && FAILURE_BEHAVIOUR.has(dependency.failureBehaviour)
    && text(dependency.operatorImpact)
    && typeof dependency.hardExternalBoundaryReason === 'string'
    && parityProofRefs !== null
    && Array.isArray(routes)
    && routes.length <= 32
    && retiringRouteIds !== null;

  if (!identityValid || routes.some((route) => !validRoute(route))) {
    return result(base, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS, ['provider-dependency-or-parity-evidence-invalid']);
  }

  if (!CONTRACT_ID.test(text(dependency.portableCheckpointContract, 181))) {
    return result(base, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PORTABLE_CHECKPOINT_MISSING, ['portable-checkpoint-contract-missing']);
  }

  const routeById = new Map(routes.map((route) => [route.routeId, route]));
  const declaredRoutes = qualifiedAlternatives.map((routeId) => routeById.get(routeId)).filter(Boolean);
  const declaredMissing = qualifiedAlternatives.filter((routeId) => !routeById.has(routeId));
  const qualifyingRoutes = routes.filter((route) => routeMatchesDependency(route, dependency, retiringRouteIds));
  const declaredQualifying = declaredRoutes.filter((route) => routeMatchesDependency(route, dependency, retiringRouteIds));
  const selectedAlternativeRouteIds = Object.freeze(declaredQualifying.map((route) => route.routeId).sort());
  base.selectedAlternativeRouteIds = selectedAlternativeRouteIds;

  const qualifiedBeforeRetirement = routes.filter((route) => routeMatchesDependency(route, dependency, []));
  if (retiringRouteIds.length > 0 && qualifiedBeforeRetirement.length > 0 && qualifyingRoutes.length === 0) {
    return result(
      { ...base, concentrationRiskVisible: true },
      PROVIDER_INDEPENDENCE_VERDICT.BLOCK_FALLBACK_REMOVED_WITHOUT_REPLACEMENT,
      ['last-qualified-non-codex-fallback-would-be-removed'],
    );
  }

  if (declaredMissing.length > 0 || declaredQualifying.length !== qualifiedAlternatives.length) {
    return result(
      { ...base, concentrationRiskVisible: CODEX_LIKE.has(dependency.provider) },
      PROVIDER_INDEPENDENCE_VERDICT.BLOCK_DECLARED_FALLBACK_UNQUALIFIED,
      ['declared-fallback-not-qualified-for-exact-task-contract'],
    );
  }

  const codexLike = CODEX_LIKE.has(dependency.provider);
  const critical = dependency.criticalPathImpact === 'CRITICAL_PATH';
  const optional = dependency.criticalPathImpact === 'OPTIONAL';

  if (dependency.mode === PROVIDER_DEPENDENCY_MODE.TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER) {
    const exception = validateException(input.exception, nowMs);
    if (!exception.valid) {
      return result(
        { ...base, concentrationRiskVisible: true },
        PROVIDER_INDEPENDENCE_VERDICT.BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH,
        [exception.reason],
      );
    }
    return result(
      { ...base, concentrationRiskVisible: true },
      PROVIDER_INDEPENDENCE_VERDICT.TEMPORARY_EXCEPTION_ACTIVE,
      [],
      { exceptionId: input.exception.exceptionId, exceptionExpiresAt: input.exception.expiresAt },
    );
  }

  if (dependency.mode === PROVIDER_DEPENDENCY_MODE.HARD_EXTERNAL_BOUNDARY_WITH_UNRELATED_WORK_ISOLATION) {
    const isolated = critical
      && text(dependency.hardExternalBoundaryReason)
      && dependency.failureBehaviour === 'CAPABILITY_BLOCKED_ONLY';
    if (!isolated) {
      return result(
        { ...base, concentrationRiskVisible: true },
        PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS,
        ['hard-external-boundary-isolation-not-proven'],
      );
    }
    return result(
      { ...base, concentrationRiskVisible: true },
      PROVIDER_INDEPENDENCE_VERDICT.PASS_PROVIDER_INDEPENDENT,
      [],
      { hardExternalBoundary: true },
    );
  }

  if (codexLike && critical) {
    if (dependency.mode === PROVIDER_DEPENDENCY_MODE.CODEX_ONLY_CRITICAL_PATH) {
      return result(
        { ...base, concentrationRiskVisible: true },
        PROVIDER_INDEPENDENCE_VERDICT.BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH,
        ['codex-or-work-is-sole-critical-path-provider'],
      );
    }
    if (dependency.mode !== PROVIDER_DEPENDENCY_MODE.OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK || declaredQualifying.length === 0) {
      return result(
        { ...base, concentrationRiskVisible: true },
        PROVIDER_INDEPENDENCE_VERDICT.BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH,
        ['critical-provider-dependency-lacks-qualified-non-codex-route'],
      );
    }
    return result(
      base,
      PROVIDER_INDEPENDENCE_VERDICT.PASS_EXISTING_QUALIFIED_PARITY,
      [],
    );
  }

  if (codexLike && (optional || dependency.mode === PROVIDER_DEPENDENCY_MODE.NON_CRITICAL_OBSERVABILITY_ONLY)) {
    if (dependency.mode === PROVIDER_DEPENDENCY_MODE.OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK && declaredQualifying.length === 0) {
      return result(
        { ...base, concentrationRiskVisible: true },
        PROVIDER_INDEPENDENCE_VERDICT.BLOCK_DECLARED_FALLBACK_UNQUALIFIED,
        ['optional-specialist-fallback-not-qualified'],
      );
    }
    return result(base, PROVIDER_INDEPENDENCE_VERDICT.PASS_OPTIONAL_CODEX_SPECIALIST, []);
  }

  if (dependency.mode === PROVIDER_DEPENDENCY_MODE.PROVIDER_INDEPENDENT || !codexLike) {
    return result(base, PROVIDER_INDEPENDENCE_VERDICT.PASS_PROVIDER_INDEPENDENT, []);
  }

  return result(
    base,
    PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS,
    ['provider-dependency-mode-not-admissible-for-classification'],
  );
}
