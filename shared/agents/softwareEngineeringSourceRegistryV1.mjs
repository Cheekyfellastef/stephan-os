import { createHash } from 'node:crypto';

export const SOFTWARE_ENGINEERING_SOURCE_RECORD_SCHEMA_V1 = 'stephanos.software-engineering-source-record.v1';
export const SOFTWARE_ENGINEERING_TECHNIQUE_CANDIDATE_SCHEMA_V1 = 'stephanos.software-engineering-technique-candidate.v1';

export const SOFTWARE_ENGINEERING_SOURCE_CLASSES_V1 = Object.freeze([
  'OFFICIAL_DOCUMENTATION',
  'OFFICIAL_SPECIFICATION',
  'CANONICAL_UPSTREAM_REPOSITORY',
  'OFFICIAL_RELEASE_NOTES',
  'SECURITY_ADVISORY',
  'LICENCE_COMPATIBLE_REFERENCE_IMPLEMENTATION',
  'VERIFIED_INTERNAL_IMPLEMENTATION',
  'OPERATOR_AUTHORISED_LOCAL_SOURCE_EVIDENCE',
  'SECONDARY_REFERENCE_ONLY',
  'REJECTED_OR_UNSAFE_SOURCE',
]);

export const SOFTWARE_ENGINEERING_REUSE_ROUTES_V1 = Object.freeze([
  'DIRECT_REUSE_ALLOWED',
  'REUSE_WITH_ATTRIBUTION_OR_CONDITIONS',
  'ADAPTATION_ALLOWED',
  'ANALYSIS_ONLY_REIMPLEMENT_ORIGINAL',
  'REFERENCE_ONLY',
  'RESEARCH_FURTHER',
  'REJECT_RIGHTS_BOUNDARY',
  'REJECT_STALE_OR_INCOMPATIBLE',
]);

export const SOFTWARE_ENGINEERING_SOURCE_AUTHORITY_V1 = Object.freeze({
  researchDispatchAllowed: false,
  sourceMutationAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  accountAccessAllowed: false,
  spendingAllowed: false,
  providerQualificationAllowed: false,
  arbitraryCommandAllowed: false,
});

const SOURCE_CLASSES = new Set(SOFTWARE_ENGINEERING_SOURCE_CLASSES_V1);
const REUSE_ROUTES = new Set(SOFTWARE_ENGINEERING_REUSE_ROUTES_V1);
const EVIDENCE_PLANES = new Set([
  'NORMATIVE_SPECIFICATION',
  'OFFICIAL_TECHNICAL_EVIDENCE',
  'DIRECT_PUBLIC_SOURCE',
  'OFFICIAL_RELEASE_OR_SECURITY_NOTICE',
  'VERIFIED_INTERNAL_SOURCE',
  'AUTHORISED_LOCAL_EVIDENCE',
  'SECONDARY_REFERENCE',
  'STEPHANOS_INFERENCE',
]);
const FRESHNESS_STATES = new Set(['FRESH', 'STALE', 'UNKNOWN', 'CONFLICTING']);
const AVAILABILITY_STATES = new Set(['AVAILABLE', 'WITHDRAWN', 'ACCESS_RESTRICTED', 'UNKNOWN']);
const STATUS_STATES = new Set(['ADMITTED', 'REFERENCE_ONLY', 'CONFLICTING', 'REJECTED']);
const DIRECT_OR_ADAPTABLE = new Set([
  'DIRECT_REUSE_ALLOWED',
  'REUSE_WITH_ATTRIBUTION_OR_CONDITIONS',
  'ADAPTATION_ALLOWED',
]);
const DIRECT_REUSE_ROUTES = new Set([
  'DIRECT_REUSE_ALLOWED',
  'REUSE_WITH_ATTRIBUTION_OR_CONDITIONS',
]);
const REJECT_ROUTES = new Set(['REJECT_RIGHTS_BOUNDARY', 'REJECT_STALE_OR_INCOMPATIBLE']);
const VERSIONED_CLASSES = new Set([
  'OFFICIAL_SPECIFICATION',
  'CANONICAL_UPSTREAM_REPOSITORY',
  'OFFICIAL_RELEASE_NOTES',
  'SECURITY_ADVISORY',
  'LICENCE_COMPATIBLE_REFERENCE_IMPLEMENTATION',
  'VERIFIED_INTERNAL_IMPLEMENTATION',
  'OPERATOR_AUTHORISED_LOCAL_SOURCE_EVIDENCE',
]);
const HASH_PINNED_CLASSES = new Set([
  'CANONICAL_UPSTREAM_REPOSITORY',
  'LICENCE_COMPATIBLE_REFERENCE_IMPLEMENTATION',
  'VERIFIED_INTERNAL_IMPLEMENTATION',
  'OPERATOR_AUTHORISED_LOCAL_SOURCE_EVIDENCE',
]);
const PRIMARY_CLASSES = new Set([
  'OFFICIAL_DOCUMENTATION',
  'OFFICIAL_SPECIFICATION',
  'OFFICIAL_RELEASE_NOTES',
  'SECURITY_ADVISORY',
  'CANONICAL_UPSTREAM_REPOSITORY',
]);
const REFERENCE_ONLY_CLASSES = new Set(['SECONDARY_REFERENCE_ONLY']);
const REFERENCE_ONLY_EVIDENCE_PLANES = new Set(['SECONDARY_REFERENCE', 'STEPHANOS_INFERENCE']);
const SOURCE_PRIORITY = Object.freeze({
  OFFICIAL_SPECIFICATION: 100,
  SECURITY_ADVISORY: 95,
  OFFICIAL_DOCUMENTATION: 90,
  OFFICIAL_RELEASE_NOTES: 85,
  CANONICAL_UPSTREAM_REPOSITORY: 80,
  VERIFIED_INTERNAL_IMPLEMENTATION: 75,
  LICENCE_COMPATIBLE_REFERENCE_IMPLEMENTATION: 70,
  OPERATOR_AUTHORISED_LOCAL_SOURCE_EVIDENCE: 65,
  SECONDARY_REFERENCE_ONLY: 20,
  REJECTED_OR_UNSAFE_SOURCE: 0,
});
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const SAFE_REF = /^[a-z0-9][a-z0-9._:/#@+-]{0,239}$/i;
const CANONICAL_ISSUE_OWNER_REF = /^#[1-9][0-9]{0,9}$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const IMMUTABLE_HASH = /^(?:[0-9a-f]{40}|sha256:[0-9a-f]{64})$/i;
const MUTABLE_REVISION_ALIAS = /^(?:main|master|head|latest|current|stable|trunk|default|tip|nightly|next|dev|develop)$/i;
const MUTABLE_BRANCH_REF = /^(?:refs\/heads\/|heads\/|branch:)/i;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  for (const key of Object.keys(value)) value[key] = deepFreeze(value[key]);
  return Object.freeze(value);
}

function timestamp(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TIMEZONE.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : null;
}

function safeRef(value) {
  const normalized = text(value);
  return SAFE_REF.test(normalized) ? normalized : null;
}

function safeOwnerRef(value) {
  const normalized = text(value);
  return CANONICAL_ISSUE_OWNER_REF.test(normalized) || SAFE_REF.test(normalized) ? normalized : null;
}

function safeLocation(value) {
  const normalized = text(value);
  if (/^evidence:[a-z0-9][a-z0-9._:/#@+-]{0,239}$/i.test(normalized)) return normalized;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function immutableRevision(sourceClass, value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 160 || !safeRef(normalized)) return null;
  if (MUTABLE_REVISION_ALIAS.test(normalized) || MUTABLE_BRANCH_REF.test(normalized)) return null;
  if (HASH_PINNED_CLASSES.has(sourceClass) && !IMMUTABLE_HASH.test(normalized)) return null;
  return IMMUTABLE_HASH.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizedList(value, { field, blockers, min = 0, max = 32, normalize = safeRef } = {}) {
  if (!Array.isArray(value)) {
    blockers.push(`${field}-must-be-array`);
    return [];
  }
  if (value.length < min) blockers.push(`${field}-too-short`);
  if (value.length > max) blockers.push(`${field}-too-long`);
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = normalize(item);
    if (!normalized) {
      blockers.push(`${field}-item-invalid`);
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      blockers.push(`${field}-duplicate`);
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result.sort(compareText);
}

function authorityIsZero(authority) {
  if (authority === null || authority === undefined) return true;
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) return false;
  return Object.values(authority).every((value) => value === false || value === null || value === undefined);
}

function expectedStatus({ reuseRoute, freshness, conflicts }) {
  if (REJECT_ROUTES.has(reuseRoute)) return 'REJECTED';
  if (freshness === 'CONFLICTING' || conflicts.length) return 'CONFLICTING';
  if (reuseRoute === 'REFERENCE_ONLY' || reuseRoute === 'RESEARCH_FURTHER') return 'REFERENCE_ONLY';
  return 'ADMITTED';
}

function reuseRouteCompatibleWithEvidence(sourceClass, evidencePlane, reuseRoute) {
  if ((REFERENCE_ONLY_CLASSES.has(sourceClass) || REFERENCE_ONLY_EVIDENCE_PLANES.has(evidencePlane))
    && DIRECT_OR_ADAPTABLE.has(reuseRoute)) return false;
  if (sourceClass === 'REJECTED_OR_UNSAFE_SOURCE' && !REJECT_ROUTES.has(reuseRoute)) return false;
  return true;
}

export function validateSoftwareEngineeringSourceRecordInputV1(input = {}, { asOfUtc = new Date().toISOString() } = {}) {
  const blockers = [];
  const sourceId = safeId(input.sourceId);
  if (!sourceId) blockers.push('source-id-invalid');

  const sourceClass = text(input.sourceClass).toUpperCase();
  if (!SOURCE_CLASSES.has(sourceClass)) blockers.push('source-class-invalid');

  const canonicalLocation = safeLocation(input.canonicalLocation);
  if (!canonicalLocation) blockers.push('canonical-location-invalid');

  const publisherOrOwner = safeRef(input.publisherOrOwner);
  if (!publisherOrOwner) blockers.push('publisher-or-owner-invalid');

  const suppliedRevisionOrVersion = text(input.revisionOrVersion);
  let revisionOrVersion = suppliedRevisionOrVersion || null;
  if (suppliedRevisionOrVersion && (!safeRef(suppliedRevisionOrVersion) || suppliedRevisionOrVersion.length > 160)) {
    blockers.push('revision-or-version-invalid');
  }
  if (VERSIONED_CLASSES.has(sourceClass)) {
    const immutable = immutableRevision(sourceClass, suppliedRevisionOrVersion);
    if (!suppliedRevisionOrVersion) blockers.push('revision-or-version-required');
    else if (!immutable) blockers.push('immutable-revision-or-version-required');
    else revisionOrVersion = immutable;
  }

  const retrievedAtUtc = timestamp(input.retrievedAtUtc);
  if (!retrievedAtUtc) blockers.push('retrieved-at-invalid');
  const evaluatedAtUtc = timestamp(asOfUtc);
  if (!evaluatedAtUtc) blockers.push('evaluation-as-of-invalid');
  if (retrievedAtUtc && evaluatedAtUtc
    && Date.parse(retrievedAtUtc) > Date.parse(evaluatedAtUtc) + MAX_FUTURE_CLOCK_SKEW_MS) {
    blockers.push('retrieved-at-in-future');
  }

  const freshnessRequirement = safeRef(input.freshnessRequirement);
  if (!freshnessRequirement) blockers.push('freshness-requirement-invalid');

  const licence = text(input.licence);
  const rightsEvidence = normalizedList(input.rightsEvidence ?? [], {
    field: 'rights-evidence',
    blockers,
    min: DIRECT_OR_ADAPTABLE.has(text(input.reuseRoute).toUpperCase()) ? 1 : 0,
    max: 24,
  });

  const reuseRoute = text(input.reuseRoute).toUpperCase();
  if (!REUSE_ROUTES.has(reuseRoute)) blockers.push('reuse-route-invalid');
  if (DIRECT_OR_ADAPTABLE.has(reuseRoute) && (!licence || licence.toUpperCase() === 'UNKNOWN')) {
    blockers.push('licence-required-for-reuse');
  }

  const applicableLanguagesPlatformsAndComponents = normalizedList(input.applicableLanguagesPlatformsAndComponents, {
    field: 'applicable-languages-platforms-components',
    blockers,
    min: 1,
    max: 48,
  });

  const evidencePlane = text(input.evidencePlane).toUpperCase();
  if (!EVIDENCE_PLANES.has(evidencePlane)) blockers.push('evidence-plane-invalid');
  if (SOURCE_CLASSES.has(sourceClass) && EVIDENCE_PLANES.has(evidencePlane) && REUSE_ROUTES.has(reuseRoute)
    && !reuseRouteCompatibleWithEvidence(sourceClass, evidencePlane, reuseRoute)) {
    blockers.push('reuse-route-incompatible-with-source-evidence');
  }

  const claimsSupported = normalizedList(input.claimsSupported, {
    field: 'claims-supported',
    blockers,
    min: 1,
    max: 48,
  });
  const conflicts = normalizedList(input.conflicts ?? [], {
    field: 'conflicts',
    blockers,
    max: 32,
  });

  const availability = text(input.availability).toUpperCase();
  if (!AVAILABILITY_STATES.has(availability)) blockers.push('availability-invalid');

  const refreshOwner = safeOwnerRef(input.refreshOwner);
  const extractionOwner = safeOwnerRef(input.extractionOwner);
  if (!refreshOwner) blockers.push('refresh-owner-invalid');
  if (!extractionOwner) blockers.push('extraction-owner-invalid');

  const freshness = text(input.freshness).toUpperCase();
  if (!FRESHNESS_STATES.has(freshness)) blockers.push('freshness-invalid');

  const status = text(input.status).toUpperCase();
  if (!STATUS_STATES.has(status)) blockers.push('status-invalid');
  const requiredStatus = expectedStatus({ reuseRoute, freshness, conflicts });
  if (status && status !== requiredStatus) blockers.push('status-does-not-match-evidence-state');

  if (sourceClass === 'REJECTED_OR_UNSAFE_SOURCE' && status !== 'REJECTED') blockers.push('unsafe-source-must-be-rejected');
  if (availability !== 'AVAILABLE' && status === 'ADMITTED') blockers.push('unavailable-source-cannot-be-admitted');
  if (freshness === 'STALE' && status === 'ADMITTED') blockers.push('stale-source-cannot-be-current-implementation-evidence');
  if (!authorityIsZero(input.authority)) blockers.push('authority-widening-rejected');

  const candidate = {
    schemaVersion: SOFTWARE_ENGINEERING_SOURCE_RECORD_SCHEMA_V1,
    sourceId,
    sourceClass,
    canonicalLocation,
    publisherOrOwner,
    revisionOrVersion,
    retrievedAtUtc,
    freshnessRequirement,
    licence: licence || 'UNKNOWN',
    rightsEvidence,
    reuseRoute,
    applicableLanguagesPlatformsAndComponents,
    evidencePlane,
    claimsSupported,
    conflicts,
    availability,
    refreshOwner,
    extractionOwner,
    freshness,
    status,
    primarySource: PRIMARY_CLASSES.has(sourceClass),
    authority: SOFTWARE_ENGINEERING_SOURCE_AUTHORITY_V1,
  };

  if (blockers.length) return deepFreeze({ valid: false, blockers: [...new Set(blockers)].sort(), record: null });
  const recordId = `software-engineering-source-${sha256(canonicalJson(candidate)).slice(0, 24)}`;
  return deepFreeze({ valid: true, blockers: [], record: deepFreeze({ ...candidate, recordId }) });
}

export function buildSoftwareEngineeringSourceRecordV1(input = {}, options = {}) {
  const validation = validateSoftwareEngineeringSourceRecordInputV1(input, options);
  if (!validation.valid) throw new Error(`software engineering source rejected: ${validation.blockers.join(', ')}`);
  return validation.record;
}

function revalidateSoftwareEngineeringSourceRecordV1(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const validation = validateSoftwareEngineeringSourceRecordInputV1(source);
  if (!validation.valid || !validation.record) return null;
  if (canonicalJson(validation.record) !== canonicalJson(source)) return null;
  return validation.record;
}

export function buildSoftwareEngineeringTechniqueCandidateV1(input = {}) {
  const source = revalidateSoftwareEngineeringSourceRecordV1(input.sourceRecord);
  if (!source) {
    throw new Error('technique candidate requires one exact revalidated software engineering source record');
  }
  if (!['ADMITTED', 'REFERENCE_ONLY'].includes(source.status) || source.freshness !== 'FRESH' || source.availability !== 'AVAILABLE') {
    throw new Error('technique candidate source is not fresh and available');
  }
  if (REJECT_ROUTES.has(source.reuseRoute)) throw new Error('rejected source cannot produce a technique candidate');

  const techniqueId = safeId(input.techniqueId);
  const name = safeRef(input.name);
  const problemSolved = safeRef(input.problemSolved);
  const method = safeRef(input.method);
  if (!techniqueId || !name || !problemSolved || !method) throw new Error('technique identity, problem and method are required');

  const blockers = [];
  const evidenceRefs = normalizedList(input.evidenceRefs, {
    field: 'evidence-refs',
    blockers,
    min: 1,
    max: 32,
  });
  const applicableDomains = normalizedList(input.applicableDomains, {
    field: 'applicable-domains',
    blockers,
    min: 1,
    max: 24,
  });
  const failureModes = normalizedList(input.failureModes ?? [], {
    field: 'failure-modes',
    blockers,
    max: 24,
  });
  if (blockers.length) throw new Error(`technique candidate rejected: ${[...new Set(blockers)].sort().join(', ')}`);
  if (!authorityIsZero(input.authority)) throw new Error('technique candidate authority widening rejected');

  const candidate = {
    schemaVersion: SOFTWARE_ENGINEERING_TECHNIQUE_CANDIDATE_SCHEMA_V1,
    techniqueId,
    name,
    problemSolved,
    method,
    sourceRecordId: source.recordId,
    sourceId: source.sourceId,
    sourceRevisionOrVersion: source.revisionOrVersion,
    sourceEvidencePlane: source.evidencePlane,
    sourceLicence: source.licence,
    evidenceRefs,
    applicableDomains,
    failureModes,
    reuseRoute: source.reuseRoute,
    directCodeReuseAllowed: DIRECT_REUSE_ROUTES.has(source.reuseRoute),
    implementationContextAllowed: source.reuseRoute !== 'REFERENCE_ONLY',
    status: 'METHOD_CANDIDATE',
    authority: SOFTWARE_ENGINEERING_SOURCE_AUTHORITY_V1,
  };
  return deepFreeze({
    ...candidate,
    candidateId: `software-engineering-technique-${sha256(canonicalJson(candidate)).slice(0, 24)}`,
  });
}

export function selectPreferredSoftwareEngineeringSourceV1(records, { claim } = {}) {
  const normalizedClaim = safeRef(claim);
  if (!normalizedClaim) throw new Error('claim identity is required');
  const validatedRecords = (Array.isArray(records) ? records : [])
    .map(revalidateSoftwareEngineeringSourceRecordV1)
    .filter(Boolean);
  const candidates = validatedRecords.filter((record) => (
    record.claimsSupported.includes(normalizedClaim)
    && record.availability === 'AVAILABLE'
    && record.status !== 'REJECTED'
    && record.freshness !== 'STALE'
  ));
  const conflictingPrimary = candidates.filter((record) => record.primarySource && (
    record.status === 'CONFLICTING' || record.freshness === 'CONFLICTING' || record.conflicts.length > 0
  ));
  if (conflictingPrimary.length) {
    return deepFreeze({
      decision: 'CONFLICTING_PRIMARY_SOURCES',
      source: null,
      conflictingSourceRecordIds: conflictingPrimary.map((record) => record.recordId).sort(compareText),
    });
  }
  const eligible = candidates.filter((record) => (
    record.freshness === 'FRESH'
    && ['ADMITTED', 'REFERENCE_ONLY'].includes(record.status)
  )).sort((left, right) => (
    (SOURCE_PRIORITY[right.sourceClass] ?? 0) - (SOURCE_PRIORITY[left.sourceClass] ?? 0)
    || compareText(left.recordId, right.recordId)
  ));
  if (!eligible.length) return deepFreeze({ decision: 'NO_FRESH_SOURCE', source: null, conflictingSourceRecordIds: [] });
  return deepFreeze({ decision: 'SOURCE_SELECTED', source: eligible[0], conflictingSourceRecordIds: [] });
}
