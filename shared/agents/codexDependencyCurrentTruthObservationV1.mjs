import { createHash } from 'node:crypto';

import { isFullSha } from './codexDependencyParityMatrixV1.mjs';
import {
  CANONICAL_STEPHANOS_REPOSITORY,
  CURRENT_TRUTH_REPORT_STATE,
  buildCodexDependencyCurrentTruthReportV1,
  currentTruthReportHasProvenParity,
} from './codexDependencyCurrentTruthReportV1.mjs';

export const CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA = 'stephanos.codex-dependency-current-truth-observation.v1';
export const CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA = 'stephanos.codex-dependency-current-truth-observation-record.v1';
export const PROVIDER_INDEPENDENCE_OBSERVER_EVIDENCE_CLASS = 'CANONICAL_PROVIDER_INDEPENDENCE_OBSERVER_PROOF';
export const PROVIDER_INDEPENDENCE_OBSERVATION_MAX_AGE_MS = 15 * 60 * 1000;

export const OBSERVATION_COVERAGE_CLASS = Object.freeze({
  REPOSITORY_SOURCE: 'REPOSITORY_SOURCE',
  GOAL_STATE: 'GOAL_STATE',
  PROVIDER_ROUTE_PROOF: 'PROVIDER_ROUTE_PROOF',
  GAP_OWNERSHIP: 'GAP_OWNERSHIP',
  HARD_BOUNDARY_PROOF: 'HARD_BOUNDARY_PROOF',
});

const REQUIRED_COVERAGE_CLASSES = Object.freeze(Object.values(OBSERVATION_COVERAGE_CLASS));
const VALID_COVERAGE_CLASSES = new Set(REQUIRED_COVERAGE_CLASSES);
const HEX64 = /^[0-9a-f]{64}$/;

function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function uniqueSorted(values) {
  return Object.freeze([...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b)));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
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
  if (depth > 12) throw new Error(`${path} exceeds maximum depth`);
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

function collectionLengths(envelope) {
  return new Map([
    [OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE, Array.isArray(envelope.repositoryEntries) ? envelope.repositoryEntries.length : 0],
    [OBSERVATION_COVERAGE_CLASS.GOAL_STATE, Array.isArray(envelope.goalCandidates) ? envelope.goalCandidates.length : 0],
    [OBSERVATION_COVERAGE_CLASS.PROVIDER_ROUTE_PROOF, Array.isArray(envelope.providerEvidence) ? envelope.providerEvidence.length : 0],
    [OBSERVATION_COVERAGE_CLASS.GAP_OWNERSHIP, Array.isArray(envelope.gapOwners) ? envelope.gapOwners.length : 0],
    [OBSERVATION_COVERAGE_CLASS.HARD_BOUNDARY_PROOF, Array.isArray(envelope.boundaryEvidence) ? envelope.boundaryEvidence.length : 0],
  ]);
}

function boundedFreshUntil(observedAtUtc, rawFreshUntilUtc) {
  if (!observedAtUtc) return { freshUntilUtc: '', problems: [] };
  const observedAtMs = Date.parse(observedAtUtc);
  const maximumFreshUntilMs = observedAtMs + PROVIDER_INDEPENDENCE_OBSERVATION_MAX_AGE_MS;
  const raw = text(rawFreshUntilUtc);
  const declaredFreshUntilUtc = validTimestamp(raw);
  const problems = [];

  if (raw && !declaredFreshUntilUtc) problems.push('fresh-until-invalid');
  if (declaredFreshUntilUtc && Date.parse(declaredFreshUntilUtc) < observedAtMs) problems.push('freshness-window-invalid');
  if (declaredFreshUntilUtc && Date.parse(declaredFreshUntilUtc) > maximumFreshUntilMs) problems.push('freshness-window-too-wide');

  return {
    freshUntilUtc: declaredFreshUntilUtc || new Date(maximumFreshUntilMs).toISOString(),
    problems,
  };
}

function normalizeObserver(rawObserver, { sourceHead, observedAtUtc }) {
  const observer = dataOnly(rawObserver || {}, 'observer');
  const problems = [];
  const evidenceClass = text(observer.evidenceClass);
  const observerId = text(observer.observerId);
  const executionId = text(observer.executionId);
  const observerSourceHead = text(observer.sourceHead).toLowerCase();
  const evidenceObservedAtUtc = validTimestamp(observer.observedAtUtc);
  const freshness = boundedFreshUntil(evidenceObservedAtUtc, observer.freshUntilUtc);
  const proofRefs = uniqueSorted(observer.proofRefs);

  if (evidenceClass !== PROVIDER_INDEPENDENCE_OBSERVER_EVIDENCE_CLASS) problems.push('observer-evidence-class-invalid');
  if (observer.verified !== true) problems.push('observer-proof-not-verified');
  if (!observerId) problems.push('observer-id-missing');
  if (!executionId) problems.push('observer-execution-id-missing');
  if (!isFullSha(observerSourceHead)) problems.push('observer-source-head-invalid');
  if (observerSourceHead && observerSourceHead !== sourceHead) problems.push('observer-source-head-not-current');
  if (!evidenceObservedAtUtc) problems.push('observer-observed-at-invalid');
  if (evidenceObservedAtUtc && Date.parse(evidenceObservedAtUtc) > Date.parse(observedAtUtc)) problems.push('observer-proof-from-future');
  problems.push(...freshness.problems.map((problem) => `observer-${problem}`));
  if (freshness.freshUntilUtc && Date.parse(freshness.freshUntilUtc) < Date.parse(observedAtUtc)) problems.push('observer-proof-stale');
  if (!proofRefs.length) problems.push('observer-proof-refs-missing');

  return {
    observer: Object.freeze({
      evidenceClass,
      verified: observer.verified === true,
      observerId,
      executionId,
      sourceHead: observerSourceHead,
      observedAtUtc: evidenceObservedAtUtc,
      freshUntilUtc: freshness.freshUntilUtc,
      proofRefs,
    }),
    problems,
  };
}

function normalizeCoverage(rawCoverage, { envelope, sourceHead, observedAtUtc }) {
  const records = Array.isArray(rawCoverage) ? rawCoverage : [];
  const expectedLengths = collectionLengths(envelope);
  const byClass = new Map();
  const problems = [];

  records.forEach((raw, index) => {
    const record = dataOnly(raw, `coverage[${index}]`);
    const coverageClass = text(record.coverageClass);
    const coverageSourceHead = text(record.sourceHead).toLowerCase();
    const coverageObservedAtUtc = validTimestamp(record.observedAtUtc);
    const freshness = boundedFreshUntil(coverageObservedAtUtc, record.freshUntilUtc);
    const examinedCount = nonNegativeInteger(record.examinedCount);
    const emittedCount = nonNegativeInteger(record.emittedCount);
    const proofRefs = uniqueSorted(record.proofRefs);
    const localProblems = [];

    if (!VALID_COVERAGE_CLASSES.has(coverageClass)) localProblems.push('coverage-class-invalid');
    if (coverageClass && byClass.has(coverageClass)) localProblems.push('coverage-class-duplicate');
    if (record.complete !== true) localProblems.push('coverage-not-complete');
    if (!isFullSha(coverageSourceHead)) localProblems.push('coverage-source-head-invalid');
    if (coverageSourceHead && coverageSourceHead !== sourceHead) localProblems.push('coverage-source-head-not-current');
    if (!coverageObservedAtUtc) localProblems.push('coverage-observed-at-invalid');
    if (coverageObservedAtUtc && Date.parse(coverageObservedAtUtc) > Date.parse(observedAtUtc)) localProblems.push('coverage-from-future');
    localProblems.push(...freshness.problems.map((problem) => `coverage-${problem}`));
    if (freshness.freshUntilUtc && Date.parse(freshness.freshUntilUtc) < Date.parse(observedAtUtc)) localProblems.push('coverage-proof-stale');
    if (examinedCount === null) localProblems.push('examined-count-invalid');
    if (emittedCount === null) localProblems.push('emitted-count-invalid');
    if (examinedCount !== null && emittedCount !== null && examinedCount < emittedCount) localProblems.push('examined-count-below-emitted-count');
    if (!proofRefs.length) localProblems.push('coverage-proof-refs-missing');

    const expectedLength = expectedLengths.get(coverageClass);
    if (expectedLength !== undefined && emittedCount !== null && emittedCount !== expectedLength) {
      localProblems.push(`emitted-count-mismatch:expected-${expectedLength}`);
    }
    if (coverageClass === OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE && examinedCount === 0) {
      localProblems.push('repository-estate-not-examined');
    }

    const normalized = Object.freeze({
      coverageClass,
      complete: record.complete === true,
      sourceHead: coverageSourceHead,
      observedAtUtc: coverageObservedAtUtc,
      freshUntilUtc: freshness.freshUntilUtc,
      examinedCount: examinedCount ?? -1,
      emittedCount: emittedCount ?? -1,
      scopeRef: text(record.scopeRef),
      proofRefs,
    });

    if (coverageClass && !byClass.has(coverageClass)) byClass.set(coverageClass, normalized);
    problems.push(...localProblems.map((problem) => `coverage-invalid:${coverageClass || index}:${problem}`));
  });

  for (const coverageClass of REQUIRED_COVERAGE_CLASSES) {
    if (!byClass.has(coverageClass)) problems.push(`coverage-missing:${coverageClass}`);
  }

  const coverage = Object.freeze([...byClass.values()].sort((a, b) => a.coverageClass.localeCompare(b.coverageClass)));
  return { coverage, problems };
}

function reportCoverageRefs(observer, coverage) {
  return uniqueSorted([
    ...observer.proofRefs,
    ...coverage.flatMap((record) => record.proofRefs),
    ...coverage.map((record) => record.scopeRef),
  ]);
}

function observationIdentity({ repository, sourceHead, observedAtUtc, observer, coverage, reportDigest }) {
  return sha256(JSON.stringify({
    schema: CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA,
    repository,
    sourceHead,
    observedAtUtc,
    observerId: observer.observerId,
    executionId: observer.executionId,
    observerFreshUntilUtc: observer.freshUntilUtc,
    coverage,
    reportDigest,
  }));
}

export function buildCodexDependencyCurrentTruthObservationV1(input = {}) {
  const envelope = dataOnly(input, 'input');
  const repository = text(envelope.repository);
  const sourceBranch = text(envelope.sourceBranch);
  const sourceHead = text(envelope.sourceHead).toLowerCase();
  const observedAtUtc = validTimestamp(envelope.observedAtUtc);

  if (repository !== CANONICAL_STEPHANOS_REPOSITORY) throw new Error('canonical Stephanos repository is required');
  if (sourceBranch !== 'main') throw new Error('observation must be bound to main');
  if (!isFullSha(sourceHead)) throw new Error('exact 40-character current main sourceHead is required');
  if (!observedAtUtc) throw new Error('observedAtUtc must be a valid timestamp');

  const observerResult = normalizeObserver(envelope.observer, { sourceHead, observedAtUtc });
  const coverageResult = normalizeCoverage(envelope.coverage, { envelope, sourceHead, observedAtUtc });
  const observationProblems = uniqueSorted([...observerResult.problems, ...coverageResult.problems]);
  const observationComplete = observationProblems.length === 0;
  const coverageRefs = reportCoverageRefs(observerResult.observer, coverageResult.coverage);

  const report = buildCodexDependencyCurrentTruthReportV1({
    repository,
    sourceBranch,
    sourceHead,
    observedAtUtc,
    observationComplete,
    coverageRefs,
    repositoryEntries: Array.isArray(envelope.repositoryEntries) ? envelope.repositoryEntries : [],
    goalCandidates: Array.isArray(envelope.goalCandidates) ? envelope.goalCandidates : [],
    providerEvidence: Array.isArray(envelope.providerEvidence) ? envelope.providerEvidence : [],
    boundaryEvidence: Array.isArray(envelope.boundaryEvidence) ? envelope.boundaryEvidence : [],
    gapOwners: Array.isArray(envelope.gapOwners) ? envelope.gapOwners : [],
  });

  const reportDigest = sha256(JSON.stringify(report));
  const observationId = observationIdentity({
    repository,
    sourceHead,
    observedAtUtc,
    observer: observerResult.observer,
    coverage: coverageResult.coverage,
    reportDigest,
  });
  const authority = authorityProjection();
  const record = Object.freeze({
    schema: CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA,
    observationId,
    reportDigest,
    repository,
    sourceBranch,
    sourceHead,
    observedAtUtc,
    observerId: observerResult.observer.observerId,
    observerExecutionId: observerResult.observer.executionId,
    observationComplete,
    coverageRefs,
    reportState: report.reportState,
    admissionReady: report.admissionReady === true,
    criticalGapCount: report.criticalGapCount,
    unownedCriticalGapCount: report.unownedCriticalGapCount,
    unclassifiedReferenceCount: report.unclassifiedReferenceCount,
    authority,
  });

  return Object.freeze({
    schema: CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA,
    repository,
    sourceBranch,
    sourceHead,
    observedAtUtc,
    observer: observerResult.observer,
    coverage: coverageResult.coverage,
    observationProblems,
    observationComplete,
    report,
    record,
    authority,
  });
}

export function currentTruthObservationHasProvenParityV1(observation = {}) {
  return observation.schema === CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA
    && observation.observationComplete === true
    && observation.report?.reportState === CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT
    && currentTruthReportHasProvenParity(observation.report) === true;
}

export function currentTruthObservationRecordIsPersistableV1(record = {}) {
  return record.schema === CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA
    && HEX64.test(text(record.observationId))
    && HEX64.test(text(record.reportDigest))
    && record.repository === CANONICAL_STEPHANOS_REPOSITORY
    && record.sourceBranch === 'main'
    && isFullSha(text(record.sourceHead))
    && Boolean(validTimestamp(record.observedAtUtc))
    && Array.isArray(record.coverageRefs)
    && record.coverageRefs.length > 0
    && record.authority?.sourceMutation === false
    && record.authority?.dispatch === false
    && record.authority?.providerQualification === false
    && record.authority?.merge === false
    && record.authority?.deployment === false
    && record.authority?.runtimeMutation === false
    && record.authority?.openClawMutation === false
    && record.authority?.spendingOrAccount === false
    && record.authority?.leaseSeizure === false;
}
