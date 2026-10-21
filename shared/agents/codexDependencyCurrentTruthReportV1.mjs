import {
  CODEX_USE_CLASS,
  COVERAGE_VERDICT,
  ROUTE_QUALIFICATION_STATE,
  buildCodexDependencyParityMatrixV1,
  isFullSha,
} from './codexDependencyParityMatrixV1.mjs';
import {
  CODEX_DEPENDENCY_DISCOVERY_SCHEMA,
  discoverCodexDependencyRepositoryCandidatesV1,
} from './codexDependencyRepositoryDiscoveryV1.mjs';

export const CODEX_DEPENDENCY_CURRENT_TRUTH_REPORT_SCHEMA = 'stephanos.codex-dependency-current-truth-report.v1';
export const CANONICAL_STEPHANOS_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const PROVIDER_ROUTE_EVIDENCE_CLASS = 'CANONICAL_PROVIDER_ROUTE_PROOF';
export const HARD_BOUNDARY_EVIDENCE_CLASS = 'CANONICAL_HARD_BOUNDARY_PROOF';

export const CURRENT_TRUTH_REPORT_STATE = Object.freeze({
  CURRENT_PROVIDER_INDEPENDENT: 'CURRENT_PROVIDER_INDEPENDENT',
  CURRENT_PARITY_GAPS: 'CURRENT_PARITY_GAPS',
  BLOCKED_OBSERVATION_INCOMPLETE: 'BLOCKED_OBSERVATION_INCOMPLETE',
  BLOCKED_SEMANTIC_CLASSIFICATION: 'BLOCKED_SEMANTIC_CLASSIFICATION',
  BLOCKED_EVIDENCE_CONFLICT: 'BLOCKED_EVIDENCE_CONFLICT',
});

const VALID_QUALIFICATION_STATES = new Set(Object.values(ROUTE_QUALIFICATION_STATE));
const VALID_CODEX_USE_CLASSES = new Set(Object.values(CODEX_USE_CLASS));

function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function uniqueSorted(values) {
  return Object.freeze([...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b)));
}

function authorityProjection() {
  return Object.freeze({
    sourceMutation: false,
    dispatch: false,
    providerQualification: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    openClawMutation: false,
    spendingOrAccount: false,
    leaseSeizure: false,
  });
}

function dataOnly(value, path = 'value', depth = 0) {
  if (depth > 10) throw new Error(`${path} exceeds maximum depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be a plain array`);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`${path} must not be sparse`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^\d+$/.test(key) || Number(key) >= value.length) {
        throw new Error(`${path} contains a non-index array property`);
      }
    }
    return value.map((entry, index) => dataOnly(entry, `${path}[${index}]`, depth + 1));
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${path} must contain data-only plain objects`);
  }
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`${path} contains a symbol key`);
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${path} contains a forbidden key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw new Error(`${path}.${key} must be a data property`);
    result[key] = dataOnly(value[key], `${path}.${key}`, depth + 1);
  }
  return result;
}

function normalizeGapOwners(records = []) {
  const owners = new Map();
  const problems = [];
  for (const raw of records) {
    const record = dataOnly(raw, 'gapOwner');
    const touchpointId = text(record.touchpointId);
    const owner = text(record.ownerGoal || record.owner);
    if (!touchpointId || !owner) {
      problems.push('gap-owner-record-incomplete');
      continue;
    }
    const prior = owners.get(touchpointId);
    if (prior && prior !== owner) {
      problems.push(`gap-owner-conflict:${touchpointId}`);
      continue;
    }
    owners.set(touchpointId, owner);
  }
  return { owners, problems };
}

function routeEvidenceContract(record) {
  return JSON.stringify([
    record.routeId,
    record.provider,
    record.capabilityClass,
    record.active,
    record.qualificationState,
    record.sourceReady,
    record.liveProof,
    record.sourceHead,
    record.portableCheckpoint,
    record.receiptParity,
    record.proofParity,
    record.operatorApprovalParity,
    record.freshUntilUtc,
  ]);
}

function normalizeProviderEvidence(records = [], { sourceHead, observedAtUtc }) {
  const groups = new Map();
  const problems = [];

  records.forEach((raw, index) => {
    const record = dataOnly(raw, `providerEvidence[${index}]`);
    const routeId = text(record.routeId);
    const provider = text(record.provider);
    const capabilityClass = text(record.capabilityClass);
    const evidenceObservedAtUtc = validTimestamp(record.observedAtUtc);
    const freshUntilUtc = validTimestamp(record.freshUntilUtc);
    const evidenceSourceHead = text(record.sourceHead).toLowerCase();
    const qualificationState = text(record.qualificationState);
    const localProblems = [];

    if (text(record.evidenceClass) !== PROVIDER_ROUTE_EVIDENCE_CLASS) localProblems.push('evidence-class-invalid');
    if (record.verified !== true) localProblems.push('verified-proof-required');
    if (!routeId) localProblems.push('route-id-missing');
    if (!provider) localProblems.push('provider-missing');
    if (!capabilityClass) localProblems.push('capability-class-missing');
    if (!VALID_QUALIFICATION_STATES.has(qualificationState)) localProblems.push('qualification-state-invalid');
    if (!evidenceObservedAtUtc) localProblems.push('evidence-observed-at-invalid');
    if (!freshUntilUtc) localProblems.push('fresh-until-invalid');
    if (!isFullSha(evidenceSourceHead)) localProblems.push('source-head-invalid');
    if (evidenceSourceHead && evidenceSourceHead !== sourceHead) localProblems.push('source-head-not-current');
    if (evidenceObservedAtUtc && Date.parse(evidenceObservedAtUtc) > Date.parse(observedAtUtc)) localProblems.push('evidence-from-future');
    for (const field of ['active', 'sourceReady', 'liveProof', 'portableCheckpoint', 'receiptParity', 'proofParity', 'operatorApprovalParity']) {
      if (typeof record[field] !== 'boolean') localProblems.push(`${field}-missing`);
    }
    const proofRefs = uniqueSorted(record.proofRefs);
    if (!proofRefs.length) localProblems.push('proof-refs-missing');

    if (localProblems.length) {
      problems.push(...localProblems.map((problem) => `provider-evidence-invalid:${routeId || index}:${problem}`));
      return;
    }

    const normalized = Object.freeze({
      routeId,
      provider,
      capabilityClass,
      active: record.active,
      qualificationState,
      sourceReady: record.sourceReady,
      liveProof: record.liveProof,
      sourceHead: evidenceSourceHead,
      observedAtUtc: evidenceObservedAtUtc,
      freshUntilUtc,
      proofFreshness: Date.parse(freshUntilUtc) >= Date.parse(observedAtUtc) ? 'FRESH' : 'STALE',
      portableCheckpoint: record.portableCheckpoint,
      receiptParity: record.receiptParity,
      proofParity: record.proofParity,
      operatorApprovalParity: record.operatorApprovalParity,
      proofRefs,
    });

    const key = `${routeId}|${capabilityClass}`;
    const group = groups.get(key) || [];
    group.push(normalized);
    groups.set(key, group);
  });

  const evidence = new Map();
  for (const [key, group] of groups.entries()) {
    const contracts = uniqueSorted(group.map(routeEvidenceContract));
    if (contracts.length !== 1) {
      problems.push(`provider-evidence-conflict:${key}`);
      continue;
    }
    const newest = [...group].sort((a, b) => Date.parse(b.observedAtUtc) - Date.parse(a.observedAtUtc))[0];
    evidence.set(key, Object.freeze({
      ...newest,
      proofRefs: uniqueSorted(group.flatMap((entry) => entry.proofRefs)),
    }));
  }

  return { evidence, problems: uniqueSorted(problems) };
}

function normalizeBoundaryEvidence(records = [], { sourceHead, observedAtUtc }) {
  const evidence = new Map();
  const problems = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = dataOnly(records[index], `boundaryEvidence[${index}]`);
    const touchpointId = text(record.touchpointId);
    const evidenceSourceHead = text(record.sourceHead).toLowerCase();
    const evidenceObservedAtUtc = validTimestamp(record.observedAtUtc);
    const freshUntilUtc = validTimestamp(record.freshUntilUtc);
    const proofRefs = uniqueSorted(record.proofRefs);
    const localProblems = [];
    if (text(record.evidenceClass) !== HARD_BOUNDARY_EVIDENCE_CLASS) localProblems.push('evidence-class-invalid');
    if (record.verified !== true) localProblems.push('verified-proof-required');
    if (!touchpointId) localProblems.push('touchpoint-id-missing');
    if (!isFullSha(evidenceSourceHead)) localProblems.push('source-head-invalid');
    if (evidenceSourceHead && evidenceSourceHead !== sourceHead) localProblems.push('source-head-not-current');
    if (!evidenceObservedAtUtc) localProblems.push('evidence-observed-at-invalid');
    if (!freshUntilUtc) localProblems.push('fresh-until-invalid');
    if (evidenceObservedAtUtc && Date.parse(evidenceObservedAtUtc) > Date.parse(observedAtUtc)) localProblems.push('evidence-from-future');
    if (freshUntilUtc && Date.parse(freshUntilUtc) < Date.parse(observedAtUtc)) localProblems.push('hard-boundary-proof-stale');
    if (record.hardExternalBoundary !== true) localProblems.push('hard-external-boundary-proof-required');
    if (record.unrelatedWorkIsolation !== true) localProblems.push('unrelated-work-isolation-proof-required');
    if (!proofRefs.length) localProblems.push('proof-refs-missing');
    if (localProblems.length) {
      problems.push(...localProblems.map((problem) => `boundary-evidence-invalid:${touchpointId || index}:${problem}`));
      continue;
    }
    const prior = evidence.get(touchpointId);
    if (prior) {
      evidence.set(touchpointId, Object.freeze({
        ...prior,
        proofRefs: uniqueSorted([...prior.proofRefs, ...proofRefs]),
        observedAtUtc: Date.parse(evidenceObservedAtUtc) > Date.parse(prior.observedAtUtc) ? evidenceObservedAtUtc : prior.observedAtUtc,
      }));
      continue;
    }
    evidence.set(touchpointId, Object.freeze({
      touchpointId,
      sourceHead: evidenceSourceHead,
      observedAtUtc: evidenceObservedAtUtc,
      freshUntilUtc,
      hardExternalBoundary: true,
      unrelatedWorkIsolation: true,
      proofRefs,
    }));
  }
  return { evidence, problems: uniqueSorted(problems) };
}

function downgradeRouteWithoutEvidence(route = {}) {
  const sourceReady = route.sourceReady === true;
  return Object.freeze({
    routeId: text(route.routeId),
    provider: text(route.provider),
    capabilityClass: text(route.capabilityClass),
    active: route.active !== false,
    qualificationState: sourceReady ? ROUTE_QUALIFICATION_STATE.SOURCE_READY : ROUTE_QUALIFICATION_STATE.DISCOVERED,
    sourceReady,
    liveProof: false,
    proofFreshness: 'UNKNOWN',
    portableCheckpoint: route.portableCheckpoint === true,
    receiptParity: route.receiptParity === true,
    proofParity: route.proofParity === true,
    operatorApprovalParity: route.operatorApprovalParity === true,
    proofRefs: uniqueSorted(route.proofRefs),
  });
}

function correlateCandidate(rawCandidate, providerEvidence, gapOwners, boundaryEvidence, problems) {
  const candidate = dataOnly(rawCandidate, 'candidate');
  const touchpointId = text(candidate.touchpointId);
  const currentGapOwner = text(candidate.missingGapOwner);
  const observedGapOwner = gapOwners.get(touchpointId) || '';
  if (currentGapOwner && observedGapOwner && currentGapOwner !== observedGapOwner) {
    problems.push(`gap-owner-conflict:${touchpointId}`);
  }

  const routes = (Array.isArray(candidate.nonCodexRoutes) ? candidate.nonCodexRoutes : []).map((route) => {
    const routeId = text(route.routeId);
    const capabilityClass = text(route.capabilityClass) || text(candidate.capabilityClass);
    const key = `${routeId}|${capabilityClass}`;
    const evidence = providerEvidence.get(key);
    if (!evidence) return downgradeRouteWithoutEvidence(route);
    if (text(route.provider) && text(route.provider) !== evidence.provider) {
      problems.push(`provider-route-mismatch:${routeId}`);
      return downgradeRouteWithoutEvidence(route);
    }
    return Object.freeze({
      routeId,
      provider: evidence.provider,
      capabilityClass,
      active: evidence.active,
      qualificationState: evidence.qualificationState,
      sourceReady: evidence.sourceReady,
      liveProof: evidence.liveProof,
      proofFreshness: evidence.proofFreshness,
      portableCheckpoint: evidence.portableCheckpoint,
      receiptParity: evidence.receiptParity,
      proofParity: evidence.proofParity,
      operatorApprovalParity: evidence.operatorApprovalParity,
      proofRefs: evidence.proofRefs,
    });
  });

  const hardBoundaryEvidence = boundaryEvidence.get(touchpointId);
  const hardExternalBoundary = candidate.hardExternalBoundary === true && Boolean(hardBoundaryEvidence);
  const unrelatedWorkIsolation = hardExternalBoundary && hardBoundaryEvidence.unrelatedWorkIsolation === true;

  return Object.freeze({
    ...candidate,
    nonCodexRoutes: Object.freeze(routes),
    hardExternalBoundary,
    unrelatedWorkIsolation,
    proofRefs: uniqueSorted([
      ...(Array.isArray(candidate.proofRefs) ? candidate.proofRefs : []),
      ...(hardBoundaryEvidence?.proofRefs || []),
    ]),
    missingGapOwner: currentGapOwner || observedGapOwner,
  });
}

function normalizeGoalCandidates(records = []) {
  return records.map((raw, index) => {
    const candidate = dataOnly(raw, `goalCandidates[${index}]`);
    if (!text(candidate.touchpointId)) throw new Error(`goalCandidates[${index}] touchpointId is required`);
    if (!text(candidate.pathOrGoalRef)) throw new Error(`goalCandidates[${index}] pathOrGoalRef is required`);
    if (!VALID_CODEX_USE_CLASSES.has(text(candidate.codexUseClass))) {
      throw new Error(`goalCandidates[${index}] codexUseClass is invalid`);
    }
    return candidate;
  });
}

export function buildCodexDependencyCurrentTruthReportV1(input = {}) {
  const envelope = dataOnly(input, 'input');
  const observedAtUtc = validTimestamp(envelope.observedAtUtc);
  const repository = text(envelope.repository);
  const sourceBranch = text(envelope.sourceBranch);
  const sourceHead = text(envelope.sourceHead).toLowerCase();
  const coverageRefs = uniqueSorted(envelope.coverageRefs);

  if (!observedAtUtc) throw new Error('observedAtUtc must be a valid timestamp');
  if (repository !== CANONICAL_STEPHANOS_REPOSITORY) throw new Error('canonical Stephanos repository is required');
  if (sourceBranch !== 'main') throw new Error('current-truth report must be bound to main');
  if (!isFullSha(sourceHead)) throw new Error('exact 40-character current main sourceHead is required');

  const repositoryEntries = Array.isArray(envelope.repositoryEntries) ? envelope.repositoryEntries : [];
  const goalCandidateRecords = Array.isArray(envelope.goalCandidates) ? envelope.goalCandidates : [];
  const observationProblems = [];
  if (envelope.observationComplete !== true) observationProblems.push('observation-not-complete');
  if (!coverageRefs.length) observationProblems.push('coverage-refs-missing');
  if (repositoryEntries.length + goalCandidateRecords.length === 0) observationProblems.push('observed-estate-empty');

  const discovery = discoverCodexDependencyRepositoryCandidatesV1({ observedAtUtc, entries: repositoryEntries });
  if (discovery.schema !== CODEX_DEPENDENCY_DISCOVERY_SCHEMA) throw new Error('canonical discovery result required');

  const goalCandidates = normalizeGoalCandidates(goalCandidateRecords);
  const gapOwnerResult = normalizeGapOwners(Array.isArray(envelope.gapOwners) ? envelope.gapOwners : []);
  const providerEvidenceResult = normalizeProviderEvidence(
    Array.isArray(envelope.providerEvidence) ? envelope.providerEvidence : [],
    { sourceHead, observedAtUtc },
  );
  const boundaryEvidenceResult = normalizeBoundaryEvidence(
    Array.isArray(envelope.boundaryEvidence) ? envelope.boundaryEvidence : [],
    { sourceHead, observedAtUtc },
  );
  const correlationProblems = [
    ...gapOwnerResult.problems,
    ...providerEvidenceResult.problems,
    ...boundaryEvidenceResult.problems,
  ];
  const candidates = [...discovery.candidates, ...goalCandidates]
    .map((candidate) => correlateCandidate(
      candidate,
      providerEvidenceResult.evidence,
      gapOwnerResult.owners,
      boundaryEvidenceResult.evidence,
      correlationProblems,
    ));

  const matrix = buildCodexDependencyParityMatrixV1({ observedAtUtc, candidates });
  const uniqueProblems = uniqueSorted(correlationProblems);
  const uniqueObservationProblems = uniqueSorted(observationProblems);
  let reportState;
  if (uniqueProblems.length) {
    reportState = CURRENT_TRUTH_REPORT_STATE.BLOCKED_EVIDENCE_CONFLICT;
  } else if (uniqueObservationProblems.length) {
    reportState = CURRENT_TRUTH_REPORT_STATE.BLOCKED_OBSERVATION_INCOMPLETE;
  } else if (!discovery.semanticClassificationComplete) {
    reportState = CURRENT_TRUTH_REPORT_STATE.BLOCKED_SEMANTIC_CLASSIFICATION;
  } else if (!matrix.admissionReady) {
    reportState = CURRENT_TRUTH_REPORT_STATE.CURRENT_PARITY_GAPS;
  } else {
    reportState = CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT;
  }

  return Object.freeze({
    schema: CODEX_DEPENDENCY_CURRENT_TRUTH_REPORT_SCHEMA,
    repository,
    sourceBranch,
    sourceHead,
    observedAtUtc,
    observationComplete: envelope.observationComplete === true,
    coverageRefs,
    observationProblems: uniqueObservationProblems,
    observedRecordCount: repositoryEntries.length + goalCandidates.length,
    reportState,
    admissionReady: reportState === CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT,
    repositoryDiscovery: discovery,
    goalCandidateCount: goalCandidates.length,
    providerEvidenceCount: providerEvidenceResult.evidence.size,
    boundaryEvidenceCount: boundaryEvidenceResult.evidence.size,
    gapOwnerCount: gapOwnerResult.owners.size,
    correlationProblems: uniqueProblems,
    parityMatrix: matrix,
    criticalGapCount: matrix.criticalGapCount,
    unownedCriticalGapCount: matrix.unownedCriticalGapCount,
    unclassifiedReferenceCount: discovery.unclassifiedReferenceCount,
    incompleteSemanticCount: discovery.incompleteSemanticCount,
    authority: authorityProjection(),
  });
}

export function currentTruthReportHasProvenParity(report = {}) {
  return report.schema === CODEX_DEPENDENCY_CURRENT_TRUTH_REPORT_SCHEMA
    && report.reportState === CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT
    && report.admissionReady === true
    && report.observationComplete === true
    && Array.isArray(report.coverageRefs)
    && report.coverageRefs.length > 0
    && report.parityMatrix?.admissionReady === true
    && report.parityMatrix?.touchpoints?.every((touchpoint) => (
      !touchpoint.active
      || !touchpoint.criticalPath
      || [COVERAGE_VERDICT.PARITY_PROVEN, COVERAGE_VERDICT.HARD_EXTERNAL_BOUNDARY_ISOLATED]
        .includes(touchpoint.coverageVerdict)
    )) === true;
}
