export const CODEX_DEPENDENCY_PARITY_MATRIX_SCHEMA = 'stephanos.codex-dependency-parity-matrix.v1';
export const CODEX_DEPENDENCY_TOUCHPOINT_SCHEMA = 'stephanos.codex-dependency-touchpoint.v1';

export const CODEX_USE_CLASS = Object.freeze({
  OPTIONAL_SPECIALIST: 'OPTIONAL_SPECIALIST',
  PREFERRED_BUT_REPLACEABLE: 'PREFERRED_BUT_REPLACEABLE',
  FALLBACK_ONLY: 'FALLBACK_ONLY',
  CRITICAL_PATH: 'CRITICAL_PATH',
  OBSERVABILITY_ONLY: 'OBSERVABILITY_ONLY',
  LEGACY_OR_DEAD: 'LEGACY_OR_DEAD',
});

export const COVERAGE_VERDICT = Object.freeze({
  PARITY_PROVEN: 'PARITY_PROVEN',
  PARITY_SOURCE_READY_NEEDS_LIVE_PROOF: 'PARITY_SOURCE_READY_NEEDS_LIVE_PROOF',
  NON_CODEX_ROUTE_EXISTS_NEEDS_QUALIFICATION: 'NON_CODEX_ROUTE_EXISTS_NEEDS_QUALIFICATION',
  MISSING_NON_CODEX_ROUTE: 'MISSING_NON_CODEX_ROUTE',
  HARD_EXTERNAL_BOUNDARY_ISOLATED: 'HARD_EXTERNAL_BOUNDARY_ISOLATED',
  LEGACY_NON_CRITICAL: 'LEGACY_NON_CRITICAL',
  AMBIGUOUS_FAIL_CLOSED: 'AMBIGUOUS_FAIL_CLOSED',
});

export const ROUTE_QUALIFICATION_STATE = Object.freeze({
  PRODUCTION_ELIGIBLE: 'PRODUCTION_ELIGIBLE',
  SOURCE_READY: 'SOURCE_READY',
  EVALUATED: 'EVALUATED',
  DISCOVERED: 'DISCOVERED',
  UNKNOWN: 'UNKNOWN',
});

const VALID_CODEX_USE_CLASSES = new Set(Object.values(CODEX_USE_CLASS));
const VALID_ROUTE_QUALIFICATION_STATES = new Set(Object.values(ROUTE_QUALIFICATION_STATE));
const FULL_SHA = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function uniqueSorted(values) {
  return Object.freeze([...new Set(values.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
}

function freezeRoute(route = {}) {
  return Object.freeze({
    routeId: text(route.routeId),
    provider: text(route.provider),
    capabilityClass: text(route.capabilityClass),
    active: route.active !== false,
    qualificationState: VALID_ROUTE_QUALIFICATION_STATES.has(text(route.qualificationState))
      ? text(route.qualificationState)
      : ROUTE_QUALIFICATION_STATE.UNKNOWN,
    sourceReady: bool(route.sourceReady),
    liveProof: bool(route.liveProof),
    proofFreshness: text(route.proofFreshness) || 'UNKNOWN',
    portableCheckpoint: bool(route.portableCheckpoint),
    receiptParity: bool(route.receiptParity),
    proofParity: bool(route.proofParity),
    operatorApprovalParity: bool(route.operatorApprovalParity),
    proofRefs: uniqueSorted(Array.isArray(route.proofRefs) ? route.proofRefs : []),
  });
}

function normalizeCandidate(candidate = {}, index = 0) {
  const touchpointId = text(candidate.touchpointId);
  const capabilityClass = text(candidate.capabilityClass);
  const codexUseClass = text(candidate.codexUseClass);
  const currentPrimaryRoute = text(candidate.currentPrimaryRoute);
  const sourceRef = text(candidate.pathOrGoalRef || candidate.sourceRef);
  const routes = Object.freeze((Array.isArray(candidate.nonCodexRoutes) ? candidate.nonCodexRoutes : [])
    .map(freezeRoute)
    .filter((route) => route.routeId));

  const structuralProblems = [];
  if (!touchpointId) structuralProblems.push('touchpoint-id-missing');
  if (!capabilityClass) structuralProblems.push('capability-class-missing');
  if (!VALID_CODEX_USE_CLASSES.has(codexUseClass)) structuralProblems.push('codex-use-class-invalid');
  if (!text(candidate.component)) structuralProblems.push('component-missing');
  if (!text(candidate.owningGoal)) structuralProblems.push('owning-goal-missing');
  if (typeof candidate.workCreditCoupled !== 'boolean') structuralProblems.push('work-credit-coupled-missing');
  if (typeof candidate.active !== 'boolean') structuralProblems.push('active-state-missing');
  if (typeof candidate.criticalPath !== 'boolean') structuralProblems.push('critical-path-state-missing');

  return Object.freeze({
    schema: CODEX_DEPENDENCY_TOUCHPOINT_SCHEMA,
    candidateIndex: index,
    touchpointId,
    pathOrGoalRef: sourceRef,
    component: text(candidate.component),
    capabilityClass,
    codexUseClass,
    provider: text(candidate.provider) || 'CODEX_OR_WORK',
    workCreditCoupled: bool(candidate.workCreditCoupled),
    active: candidate.active !== false,
    criticalPath: bool(candidate.criticalPath, codexUseClass === CODEX_USE_CLASS.CRITICAL_PATH),
    owningGoal: text(candidate.owningGoal),
    currentPrimaryRoute,
    nonCodexRoutes: routes,
    hardExternalBoundary: bool(candidate.hardExternalBoundary),
    unrelatedWorkIsolation: bool(candidate.unrelatedWorkIsolation),
    proofRefs: uniqueSorted(Array.isArray(candidate.proofRefs) ? candidate.proofRefs : []),
    missingGapOwner: text(candidate.missingGapOwner),
    structuralProblems: Object.freeze(structuralProblems),
  });
}

function routeContractIdentity(route) {
  return JSON.stringify([
    route.routeId,
    route.provider,
    route.capabilityClass,
    route.active,
    route.qualificationState,
    route.sourceReady,
    route.liveProof,
    route.proofFreshness,
    route.portableCheckpoint,
    route.receiptParity,
    route.proofParity,
    route.operatorApprovalParity,
  ]);
}

function mergeRoutes(instances) {
  const byRouteId = new Map();
  const conflicts = [];
  for (const instance of instances) {
    for (const route of instance.nonCodexRoutes) {
      const prior = byRouteId.get(route.routeId);
      if (!prior) {
        byRouteId.set(route.routeId, route);
        continue;
      }
      if (routeContractIdentity(prior) !== routeContractIdentity(route)) {
        conflicts.push(`route-contract-conflict:${route.routeId}`);
        continue;
      }
      byRouteId.set(route.routeId, Object.freeze({
        ...prior,
        proofRefs: uniqueSorted([...prior.proofRefs, ...route.proofRefs]),
      }));
    }
  }
  return {
    routes: Object.freeze([...byRouteId.values()].sort((a, b) => a.routeId.localeCompare(b.routeId))),
    conflicts: uniqueSorted(conflicts),
  };
}

function conflictingField(instances, field) {
  return uniqueSorted(instances.map((instance) => String(instance[field]))).length > 1;
}

function fullyQualifiedRoute(route, capabilityClass) {
  return route.active
    && route.capabilityClass === capabilityClass
    && route.qualificationState === ROUTE_QUALIFICATION_STATE.PRODUCTION_ELIGIBLE
    && route.sourceReady
    && route.liveProof
    && route.proofFreshness === 'FRESH'
    && route.portableCheckpoint
    && route.receiptParity
    && route.proofParity
    && route.operatorApprovalParity;
}

function sourceReadyRoute(route, capabilityClass) {
  return route.active
    && route.capabilityClass === capabilityClass
    && (route.qualificationState === ROUTE_QUALIFICATION_STATE.SOURCE_READY
      || route.qualificationState === ROUTE_QUALIFICATION_STATE.PRODUCTION_ELIGIBLE)
    && route.sourceReady;
}

function evaluateTouchpoint(record) {
  const blockers = [];
  if (record.structuralProblems.length || record.conflicts.length) {
    return {
      coverageVerdict: COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED,
      blockers: uniqueSorted([...record.structuralProblems, ...record.conflicts]),
      selectedRouteIds: Object.freeze([]),
    };
  }

  if (!record.active || record.codexUseClass === CODEX_USE_CLASS.LEGACY_OR_DEAD) {
    return {
      coverageVerdict: COVERAGE_VERDICT.LEGACY_NON_CRITICAL,
      blockers: Object.freeze([]),
      selectedRouteIds: Object.freeze([]),
    };
  }

  if (record.hardExternalBoundary && record.unrelatedWorkIsolation) {
    return {
      coverageVerdict: COVERAGE_VERDICT.HARD_EXTERNAL_BOUNDARY_ISOLATED,
      blockers: Object.freeze([]),
      selectedRouteIds: Object.freeze([]),
    };
  }

  const activeRoutes = record.nonCodexRoutes.filter((route) => route.active && route.capabilityClass === record.capabilityClass);
  const proven = activeRoutes.filter((route) => fullyQualifiedRoute(route, record.capabilityClass));
  if (proven.length) {
    return {
      coverageVerdict: COVERAGE_VERDICT.PARITY_PROVEN,
      blockers: Object.freeze([]),
      selectedRouteIds: uniqueSorted(proven.map((route) => route.routeId)),
    };
  }

  if (!record.criticalPath) {
    return {
      coverageVerdict: COVERAGE_VERDICT.LEGACY_NON_CRITICAL,
      blockers: Object.freeze([]),
      selectedRouteIds: Object.freeze([]),
    };
  }

  if (!activeRoutes.length) {
    blockers.push('qualified-non-codex-route-missing');
    if (!record.missingGapOwner) blockers.push('missing-gap-owner-unresolved');
    return {
      coverageVerdict: COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE,
      blockers: uniqueSorted(blockers),
      selectedRouteIds: Object.freeze([]),
    };
  }

  const sourceReady = activeRoutes.filter((route) => sourceReadyRoute(route, record.capabilityClass));
  if (sourceReady.length) {
    for (const route of sourceReady) {
      if (!route.liveProof) blockers.push(`live-proof-missing:${route.routeId}`);
      if (route.proofFreshness !== 'FRESH') blockers.push(`proof-not-fresh:${route.routeId}`);
      if (!route.portableCheckpoint) blockers.push(`portable-checkpoint-parity-missing:${route.routeId}`);
      if (!route.receiptParity) blockers.push(`receipt-parity-missing:${route.routeId}`);
      if (!route.proofParity) blockers.push(`proof-parity-missing:${route.routeId}`);
      if (!route.operatorApprovalParity) blockers.push(`operator-approval-parity-missing:${route.routeId}`);
    }
    return {
      coverageVerdict: COVERAGE_VERDICT.PARITY_SOURCE_READY_NEEDS_LIVE_PROOF,
      blockers: uniqueSorted(blockers),
      selectedRouteIds: uniqueSorted(sourceReady.map((route) => route.routeId)),
    };
  }

  blockers.push(...activeRoutes.map((route) => `route-not-production-qualified:${route.routeId}`));
  return {
    coverageVerdict: COVERAGE_VERDICT.NON_CODEX_ROUTE_EXISTS_NEEDS_QUALIFICATION,
    blockers: uniqueSorted(blockers),
    selectedRouteIds: uniqueSorted(activeRoutes.map((route) => route.routeId)),
  };
}

function mergeTouchpointGroup(instances) {
  const ordered = [...instances].sort((a, b) => a.candidateIndex - b.candidateIndex);
  const first = ordered[0];
  const conflicts = [];
  for (const field of ['component', 'capabilityClass', 'codexUseClass', 'provider', 'workCreditCoupled', 'active', 'criticalPath', 'owningGoal']) {
    if (conflictingField(ordered, field)) conflicts.push(`touchpoint-field-conflict:${field}`);
  }
  const routeMerge = mergeRoutes(ordered);
  conflicts.push(...routeMerge.conflicts);
  const gapOwners = uniqueSorted(ordered.map((instance) => instance.missingGapOwner));
  if (gapOwners.length > 1) conflicts.push('touchpoint-field-conflict:missingGapOwner');
  const structuralProblems = uniqueSorted(ordered.flatMap((instance) => instance.structuralProblems));
  const record = {
    schema: CODEX_DEPENDENCY_TOUCHPOINT_SCHEMA,
    touchpointId: first.touchpointId,
    sourceRefs: uniqueSorted(ordered.map((instance) => instance.pathOrGoalRef)),
    component: first.component,
    capabilityClass: first.capabilityClass,
    codexUseClass: first.codexUseClass,
    provider: first.provider,
    workCreditCoupled: first.workCreditCoupled,
    active: first.active,
    criticalPath: first.criticalPath,
    owningGoal: first.owningGoal,
    currentPrimaryRoutes: uniqueSorted(ordered.map((instance) => instance.currentPrimaryRoute)),
    nonCodexRoutes: routeMerge.routes,
    hardExternalBoundary: ordered.some((instance) => instance.hardExternalBoundary),
    unrelatedWorkIsolation: ordered.every((instance) => !instance.hardExternalBoundary || instance.unrelatedWorkIsolation),
    proofRefs: uniqueSorted(ordered.flatMap((instance) => instance.proofRefs)),
    missingGapOwner: gapOwners[0] || '',
    structuralProblems,
    conflicts: uniqueSorted(conflicts),
  };
  const evaluated = evaluateTouchpoint(record);
  return Object.freeze({
    ...record,
    coverageVerdict: evaluated.coverageVerdict,
    blockers: evaluated.blockers,
    selectedRouteIds: evaluated.selectedRouteIds,
    authority: Object.freeze({
      sourceMutation: false,
      dispatch: false,
      providerQualification: false,
      merge: false,
      deployment: false,
      runtimeMutation: false,
      spendingOrAccount: false,
      leaseSeizure: false,
    }),
  });
}

function validObservedAt(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export function buildCodexDependencyParityMatrixV1(input = {}) {
  const observedAtUtc = validObservedAt(input.observedAtUtc);
  if (!observedAtUtc) throw new Error('observedAtUtc must be a valid timestamp');
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const normalized = candidates.map(normalizeCandidate);
  const groups = new Map();
  normalized.forEach((candidate) => {
    const key = candidate.touchpointId || `__invalid_${candidate.candidateIndex}`;
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  });
  const touchpoints = Object.freeze([...groups.values()]
    .map(mergeTouchpointGroup)
    .sort((a, b) => a.touchpointId.localeCompare(b.touchpointId)));
  const verdictCounts = Object.fromEntries(Object.values(COVERAGE_VERDICT).map((verdict) => [verdict, 0]));
  touchpoints.forEach((touchpoint) => { verdictCounts[touchpoint.coverageVerdict] += 1; });
  const criticalGapCount = touchpoints.filter((touchpoint) => (
    touchpoint.active
    && touchpoint.criticalPath
    && ![COVERAGE_VERDICT.PARITY_PROVEN, COVERAGE_VERDICT.HARD_EXTERNAL_BOUNDARY_ISOLATED].includes(touchpoint.coverageVerdict)
  )).length;
  const unownedCriticalGapCount = touchpoints.filter((touchpoint) => (
    touchpoint.active
    && touchpoint.criticalPath
    && touchpoint.coverageVerdict === COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE
    && !touchpoint.missingGapOwner
  )).length;

  return Object.freeze({
    schema: CODEX_DEPENDENCY_PARITY_MATRIX_SCHEMA,
    observedAtUtc,
    touchpointCount: touchpoints.length,
    touchpoints,
    verdictCounts: Object.freeze(verdictCounts),
    criticalGapCount,
    unownedCriticalGapCount,
    admissionReady: criticalGapCount === 0
      && touchpoints.every((touchpoint) => touchpoint.coverageVerdict !== COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED),
    authority: Object.freeze({
      sourceMutation: false,
      dispatch: false,
      providerQualification: false,
      merge: false,
      deployment: false,
      runtimeMutation: false,
      spendingOrAccount: false,
      leaseSeizure: false,
    }),
  });
}

export function isFullSha(value) {
  return FULL_SHA.test(text(value));
}
