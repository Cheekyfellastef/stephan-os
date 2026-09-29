export const STEPHANOS_MEMORY_ADEQUACY_SCHEMA_VERSION = 'stephanos.memory-adequacy.v1';

export const STEPHANOS_MEMORY_AUTHORITY_CLASS = Object.freeze({
  SHARED_AUTHORITY: 'SHARED_AUTHORITY',
  LOCAL_MIRROR: 'LOCAL_MIRROR',
  PENDING_LOCAL_INTENT: 'PENDING_LOCAL_INTENT',
  STALE_EVIDENCE: 'STALE_EVIDENCE',
  INFERRED: 'INFERRED',
  UNKNOWN: 'UNKNOWN',
});

export const STEPHANOS_MEMORY_CONNECTION_STATE = Object.freeze({
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  UNKNOWN: 'UNKNOWN',
});

export const STEPHANOS_MEMORY_DOMAINS = Object.freeze([
  Object.freeze({ id: 'session-memory', label: 'Session memory', durableRequired: false, reconstructionRequired: false, maxAgeMinutes: 120 }),
  Object.freeze({ id: 'operator-memory', label: 'Operator memory', durableRequired: true, reconstructionRequired: false, maxAgeMinutes: 24 * 60 }),
  Object.freeze({ id: 'project-architecture-memory', label: 'Project and architecture memory', durableRequired: true, reconstructionRequired: true, maxAgeMinutes: 24 * 60 }),
  Object.freeze({ id: 'goal-decision-memory', label: 'Goal and decision memory', durableRequired: true, reconstructionRequired: true, maxAgeMinutes: 24 * 60 }),
  Object.freeze({ id: 'lessons-incident-memory', label: 'Lessons and incident memory', durableRequired: true, reconstructionRequired: true, maxAgeMinutes: 7 * 24 * 60 }),
  Object.freeze({ id: 'runtime-proof-memory', label: 'Runtime and proof memory', durableRequired: true, reconstructionRequired: true, maxAgeMinutes: 60 }),
  Object.freeze({ id: 'ephemeral-working-context', label: 'Ephemeral working context', durableRequired: false, reconstructionRequired: false, maxAgeMinutes: 30 }),
]);

const DOMAIN_BY_ID = new Map(STEPHANOS_MEMORY_DOMAINS.map((domain) => [domain.id, domain]));
const MAX_OBSERVATIONS = 5_000;
const MAX_RECORDS_PER_OBSERVATION = 1_000_000;
const MAX_BYTES_PER_OBSERVATION = 512 * 1024 * 1024;
const DEFAULT_STORE_CAPACITY_BYTES = 1024 * 1024 * 1024;
const MAX_PROOF_REFS = 32;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipt|receipts|evidence|github|shared-workspace|runtime|memory)\/[a-z0-9._/#:-]+$/i;
const RETENTION_STATES = new Set(['ENFORCED', 'DECLARED', 'ABSENT', 'UNKNOWN']);
const DELETION_STATES = new Set(['PROVEN', 'PARTIAL', 'BLOCKED', 'UNKNOWN']);
const CONFLICT_STATES = new Set(['CONVERGED', 'PENDING', 'BLOCKED', 'UNKNOWN']);
const BACKUP_STATES = new Set(['PROVEN', 'PARTIAL', 'BLOCKED', 'UNKNOWN']);
const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const CONNECTION_STATES = new Set(Object.values(STEPHANOS_MEMORY_CONNECTION_STATE));

function text(value, maximum = 240) {
  return String(value ?? '').trim().slice(0, maximum);
}

function validTime(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedRatio(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeProofRefs(value, blockers, prefix) {
  if (!Array.isArray(value)) {
    blockers.push(`${prefix}:proof-refs-not-array`);
    return Object.freeze([]);
  }
  if (value.length > MAX_PROOF_REFS) blockers.push(`${prefix}:proof-refs-too-large`);
  const normalized = value.slice(0, MAX_PROOF_REFS).map((item) => text(item)).filter(Boolean);
  if (normalized.some((item) => !SAFE_PROOF_REF.test(item) || item.includes('..'))) {
    blockers.push(`${prefix}:unsafe-proof-ref`);
  }
  return Object.freeze(normalized);
}

function normalizeObservation(value, index, nowMs, blockers) {
  const prefix = `observation-${index}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    blockers.push(`${prefix}:not-object`);
    return null;
  }
  const domain = DOMAIN_BY_ID.get(text(value.domain, 80));
  if (!domain) blockers.push(`${prefix}:unknown-domain`);
  const authorityClass = text(value.authorityClass, 80).toUpperCase();
  if (!AUTHORITY_CLASSES.has(authorityClass)) blockers.push(`${prefix}:invalid-authority-class`);
  const recordCount = nonNegativeInteger(value.recordCount);
  if (recordCount === null || recordCount > MAX_RECORDS_PER_OBSERVATION) blockers.push(`${prefix}:invalid-record-count`);
  const approximateBytes = nonNegativeInteger(value.approximateBytes);
  if (approximateBytes === null || approximateBytes > MAX_BYTES_PER_OBSERVATION) blockers.push(`${prefix}:invalid-byte-count`);
  const observedAtMs = validTime(value.observedAtUtc);
  if (observedAtMs === null || observedAtMs > nowMs + 60_000) blockers.push(`${prefix}:invalid-observed-time`);
  const source = text(value.source, 160);
  if (!source) blockers.push(`${prefix}:source-required`);
  const retrievalCoverage = boundedRatio(value.retrievalCoverage);
  if (retrievalCoverage === null) blockers.push(`${prefix}:invalid-retrieval-coverage`);
  const retentionPolicy = text(value.retentionPolicy, 40).toUpperCase();
  if (!RETENTION_STATES.has(retentionPolicy)) blockers.push(`${prefix}:invalid-retention-policy`);
  const deletionState = text(value.deletionState, 40).toUpperCase();
  if (!DELETION_STATES.has(deletionState)) blockers.push(`${prefix}:invalid-deletion-state`);
  const conflictState = text(value.conflictState, 40).toUpperCase();
  if (!CONFLICT_STATES.has(conflictState)) blockers.push(`${prefix}:invalid-conflict-state`);
  const backupState = text(value.backupState, 40).toUpperCase();
  if (!BACKUP_STATES.has(backupState)) blockers.push(`${prefix}:invalid-backup-state`);
  const proofRefs = normalizeProofRefs(value.proofRefs, blockers, prefix);
  if (!domain || !AUTHORITY_CLASSES.has(authorityClass) || recordCount === null
      || approximateBytes === null || observedAtMs === null || retrievalCoverage === null
      || !RETENTION_STATES.has(retentionPolicy) || !DELETION_STATES.has(deletionState)
      || !CONFLICT_STATES.has(conflictState) || !BACKUP_STATES.has(backupState)) return null;
  const ageMinutes = Math.max(0, (nowMs - observedAtMs) / 60_000);
  const stale = ageMinutes > domain.maxAgeMinutes || authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE;
  return Object.freeze({
    domain: domain.id,
    authorityClass: stale ? STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE : authorityClass,
    originallyClaimedAuthorityClass: authorityClass,
    recordCount,
    approximateBytes,
    observedAtUtc: new Date(observedAtMs).toISOString(),
    ageMinutes: Math.round(ageMinutes * 100) / 100,
    stale,
    source,
    retrievalCoverage,
    retentionPolicy,
    deletionState,
    conflictState,
    backupState,
    proofRefs,
  });
}

function strongestAuthority(observations) {
  const order = [
    STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY,
    STEPHANOS_MEMORY_AUTHORITY_CLASS.PENDING_LOCAL_INTENT,
    STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR,
    STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE,
    STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED,
  ];
  return order.find((authorityClass) => observations.some((item) => item.authorityClass === authorityClass))
    || STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
}

function minimumCoverage(observations) {
  if (!observations.length) return null;
  return observations.reduce((minimum, item) => Math.min(minimum, item.retrievalCoverage), 1);
}

function allHave(observations, key, expected) {
  return observations.length > 0 && observations.every((item) => item[key] === expected);
}

function domainProjection(domain, observations) {
  const shared = observations.filter((item) => item.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY);
  const local = observations.filter((item) => item.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR);
  const pending = observations.filter((item) => item.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.PENDING_LOCAL_INTENT);
  const stale = observations.filter((item) => item.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE);
  const inferred = observations.filter((item) => item.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED);
  const authoritativeRecordCount = shared.reduce((total, item) => total + item.recordCount, 0);
  const approximateBytes = observations.reduce((total, item) => total + item.approximateBytes, 0);
  const retrievalCoverage = minimumCoverage(shared.length ? shared : observations);
  const gaps = [];
  if (domain.durableRequired && shared.length === 0) gaps.push('shared-authority-not-proven');
  if (domain.durableRequired && authoritativeRecordCount === 0) gaps.push('authoritative-record-evidence-empty');
  if (domain.durableRequired && !allHave(shared, 'retentionPolicy', 'ENFORCED')) gaps.push('retention-not-enforced');
  if (domain.durableRequired && (retrievalCoverage === null || retrievalCoverage < 0.8)) gaps.push('retrieval-coverage-below-80-percent');
  if (domain.durableRequired && !allHave(shared, 'deletionState', 'PROVEN')) gaps.push('deletion-not-proven');
  if (domain.durableRequired && !allHave(shared, 'conflictState', 'CONVERGED')) gaps.push('conflict-convergence-not-proven');
  if (domain.durableRequired && !allHave(shared, 'backupState', 'PROVEN')) gaps.push('backup-or-export-not-proven');
  if (pending.length) gaps.push('pending-local-intent-present');
  if (stale.length) gaps.push('stale-evidence-present');
  return Object.freeze({
    domain: domain.id,
    label: domain.label,
    durableRequired: domain.durableRequired,
    reconstructionRequired: domain.reconstructionRequired,
    authorityState: strongestAuthority(observations),
    observationCount: observations.length,
    authoritativeObservationCount: shared.length,
    authoritativeRecordCount,
    localMirrorRecordCount: local.reduce((total, item) => total + item.recordCount, 0),
    pendingLocalIntentRecordCount: pending.reduce((total, item) => total + item.recordCount, 0),
    staleRecordCount: stale.reduce((total, item) => total + item.recordCount, 0),
    inferredRecordCount: inferred.reduce((total, item) => total + item.recordCount, 0),
    approximateBytes,
    retrievalCoverage,
    sources: Object.freeze(unique(observations.map((item) => item.source))),
    proofRefs: Object.freeze(unique(observations.flatMap((item) => item.proofRefs))),
    gaps: Object.freeze(unique(gaps)),
    adequate: domain.durableRequired ? gaps.length === 0 : observations.length > 0,
  });
}

function normalizeConnection(value, nowMs, blockers) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({
      state: STEPHANOS_MEMORY_CONNECTION_STATE.UNKNOWN,
      observed: false,
      fresh: false,
      observedAtUtc: '',
      ageMinutes: null,
      source: '',
      proofRefs: Object.freeze([]),
    });
  }
  const state = text(value.state, 40).toUpperCase();
  if (!CONNECTION_STATES.has(state)) blockers.push('shared-workspace:invalid-state');
  const observed = value.observed === true;
  const observedAtMs = validTime(value.observedAtUtc);
  if (observed && (observedAtMs === null || observedAtMs > nowMs + 60_000)) blockers.push('shared-workspace:invalid-observed-time');
  const source = text(value.source, 160);
  if (observed && !source) blockers.push('shared-workspace:source-required');
  const proofRefs = normalizeProofRefs(value.proofRefs ?? [], blockers, 'shared-workspace');
  const ageMinutes = observedAtMs === null ? null : Math.max(0, (nowMs - observedAtMs) / 60_000);
  const fresh = observed && ageMinutes !== null && ageMinutes <= 15;
  return Object.freeze({
    state: CONNECTION_STATES.has(state) ? state : STEPHANOS_MEMORY_CONNECTION_STATE.UNKNOWN,
    observed,
    fresh,
    observedAtUtc: observedAtMs === null ? '' : new Date(observedAtMs).toISOString(),
    ageMinutes: ageMinutes === null ? null : Math.round(ageMinutes * 100) / 100,
    source,
    proofRefs,
  });
}

export function buildStephanosMemoryAdequacyAudit(input = {}) {
  const blockers = [];
  const nowMs = validTime(input.nowUtc ?? new Date().toISOString());
  if (nowMs === null) blockers.push('invalid-audit-time');
  const observationsInput = Array.isArray(input.observations) ? input.observations : [];
  if (!Array.isArray(input.observations)) blockers.push('observations-not-array');
  if (observationsInput.length > MAX_OBSERVATIONS) blockers.push('observation-count-exceeds-bound');
  const safeNowMs = nowMs ?? Date.now();
  const observations = observationsInput.slice(0, MAX_OBSERVATIONS)
    .map((value, index) => normalizeObservation(value, index, safeNowMs, blockers))
    .filter(Boolean);
  const domains = STEPHANOS_MEMORY_DOMAINS.map((domain) => domainProjection(
    domain,
    observations.filter((item) => item.domain === domain.id),
  ));
  const connection = normalizeConnection(input.sharedWorkspaceConnection, safeNowMs, blockers);
  const capacityBytes = nonNegativeInteger(input.capacityBytes) ?? DEFAULT_STORE_CAPACITY_BYTES;
  if (capacityBytes <= 0) blockers.push('invalid-capacity-bytes');
  const totalApproximateBytes = observations.reduce((total, item) => total + item.approximateBytes, 0);
  const capacityUsedPercent = capacityBytes > 0 ? (totalApproximateBytes / capacityBytes) * 100 : null;
  if (capacityUsedPercent !== null && capacityUsedPercent > 100) blockers.push('memory-capacity-exceeded');
  const durableDomains = domains.filter((domain) => domain.durableRequired);
  const reconstructionDomains = domains.filter((domain) => domain.reconstructionRequired);
  const gapCount = domains.reduce((total, domain) => total + domain.gaps.length, 0);
  const sharedWorkspaceConnected = connection.state === STEPHANOS_MEMORY_CONNECTION_STATE.CONNECTED
    && connection.observed && connection.fresh;
  const memoryAdequate = blockers.length === 0
    && sharedWorkspaceConnected
    && durableDomains.every((domain) => domain.adequate);
  const freshObserverReconstructionReady = blockers.length === 0
    && sharedWorkspaceConnected
    && reconstructionDomains.every((domain) => domain.adequate);
  const firstGap = domains.find((domain) => domain.gaps.length)?.gaps[0] || '';
  const exactNextAction = blockers.length
    ? `Repair audit input blocker: ${blockers[0]}.`
    : (!sharedWorkspaceConnected
      ? 'Obtain a fresh authority-bearing Shared Workspace connection receipt before claiming shared memory.'
      : (firstGap
        ? `Repair ${domains.find((domain) => domain.gaps.includes(firstGap))?.domain}: ${firstGap}.`
        : 'Run live cross-device write, read, correction, deletion and reconstruction acceptance.'));
  return Object.freeze({
    schemaVersion: STEPHANOS_MEMORY_ADEQUACY_SCHEMA_VERSION,
    kind: 'stephanos.memory_adequacy.audit',
    readOnly: true,
    mutationAuthority: false,
    observedAtUtc: new Date(safeNowMs).toISOString(),
    sharedWorkspaceConnection: connection,
    sharedWorkspaceConnected,
    observations: Object.freeze(observations),
    domains: Object.freeze(domains),
    totals: Object.freeze({
      observationCount: observations.length,
      recordCount: observations.reduce((total, item) => total + item.recordCount, 0),
      totalApproximateBytes,
      capacityBytes,
      capacityUsedPercent: capacityUsedPercent === null ? null : Math.round(capacityUsedPercent * 100) / 100,
      capacityPressure: capacityUsedPercent !== null && capacityUsedPercent >= 80,
      gapCount,
    }),
    memoryAdequate,
    freshObserverReconstructionReady,
    blockers: Object.freeze(unique(blockers)),
    exactNextAction,
    finalVerdict: blockers.length
      ? 'STEPHANOS_MEMORY_ADEQUACY_AUDIT_BLOCKED'
      : (memoryAdequate
        ? 'STEPHANOS_MEMORY_ADEQUACY_PROVEN'
        : 'STEPHANOS_MEMORY_ADEQUACY_GAPS_FOUND'),
  });
}
