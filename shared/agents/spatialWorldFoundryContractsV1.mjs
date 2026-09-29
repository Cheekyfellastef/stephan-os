export const SPATIAL_WORLD_FOUNDRY_CONTRACT_VERSION = 'stephanos.spatial-world-foundry.contracts.v1';
export const SPATIAL_BUILD_ORDER_SCHEMA_VERSION = 'stephanos.spatial-build-order.v1';
export const SPATIAL_ASSET_RECORD_SCHEMA_VERSION = 'stephanos.spatial-asset-registry-record.v1';
export const SPATIAL_PROVENANCE_SCHEMA_VERSION = 'stephanos.spatial-provenance.v1';
export const SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION = 'stephanos.spatial-world-snapshot.v1';

export const SPATIAL_BUILD_ORDER_STATES = Object.freeze([
  'DRAFT',
  'ADMITTED',
  'BUILDING',
  'READY_FOR_INTEGRATION',
  'BLOCKED',
  'FAILED',
  'SUPERSEDED',
  'CANCELLED',
]);

export const SPATIAL_PROMOTION_STATES = Object.freeze([
  'DRAFT',
  'AGENT_TESTED',
  'READY_FOR_INTEGRATION',
  'INTEGRATED_CANDIDATE',
  'SIMULATION_TESTED',
  'PLAYTEST_CANDIDATE',
  'OPERATOR_OR_POLICY_APPROVED',
  'MAIN_ACCEPTED',
  'LIVE_STAGED',
  'LIVE_PROVEN',
  'REJECTED',
  'ROLLED_BACK',
]);

export const SPATIAL_ROLLBACK_SCOPES = Object.freeze([
  'ASSET',
  'OBJECT',
  'FEATURE',
  'REGION',
  'PLANET',
  'WORLD_STATE',
]);

export const SPATIAL_APPROVAL_REQUIREMENTS = Object.freeze([
  'NONE',
  'POLICY_GATED',
  'OPERATOR_REQUIRED',
]);

export const SPATIAL_PREVIEW_REQUIREMENTS = Object.freeze([
  'REQUIRED',
  'OPTIONAL',
  'NOT_APPLICABLE',
]);

export const SPATIAL_LICENCE_STATES = Object.freeze([
  'GENERATED_WITH_PROVENANCE',
  'PERMISSIVE',
  'ATTRIBUTION_REQUIRED',
  'COPYLEFT',
  'ANALYSIS_ONLY',
  'RESTRICTED',
  'UNKNOWN',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_SCOPE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/;
const SAFE_BUDGET_DATA_KEY = /^[a-z][A-Za-z0-9]{0,63}$/;
const EXACT_SOURCE_HEAD = /^[0-9a-f]{40}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const ABSOLUTE_OR_UNSAFE_PATH = /^(?:[a-z]:[\\/]|[\\/]{1,2}|\.{2}(?:[\\/]|$))/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SAFE_ALLOWED_OPERATIONS = new Set([
  'GENERATE_ASSET',
  'WRITE_SANDBOX',
  'RUN_VALIDATION',
]);
const BOUND_BUILD_ORDER_SCOPE_TYPES = new Set(['planet', 'region', 'object']);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INVALID = Symbol('invalid-data-only-contract');
const LIMITS = Object.freeze({
  arrayLength: 512,
  objectKeys: 96,
  depth: 14,
  nodes: 4096,
  stringLength: 16_384,
});

const BUILD_ORDER_KEYS = Object.freeze([
  'schemaVersion',
  'spatialBuildOrderId',
  'intentId',
  'missionId',
  'planetId',
  'regionId',
  'objectIds',
  'operatorRequest',
  'interpretationSummary',
  'designGenomeVersion',
  'researchRefs',
  'requiredOutcome',
  'assetClasses',
  'codeClasses',
  'dependencies',
  'ownedResourceScopes',
  'allowedOperations',
  'forbiddenOperations',
  'requiredAgents',
  'performanceBudget',
  'comfortBudget',
  'licenceAndProvenanceRequirements',
  'previewRequirement',
  'verificationContract',
  'approvalRequirement',
  'rollbackTarget',
  'status',
  'createdAtUtc',
]);

const ASSET_KEYS = Object.freeze([
  'schemaVersion',
  'assetId',
  'assetType',
  'version',
  'contentHash',
  'sourceLocation',
  'largeAssetLocation',
  'creatorAgentId',
  'creatingBuildOrderId',
  'planetId',
  'regionId',
  'parentVersion',
  'sourceAndInfluenceRefs',
  'licenceAndRightsState',
  'dependencies',
  'dependents',
  'engineOrRuntimeCompatibility',
  'performanceClass',
  'validationState',
  'integrationState',
  'liveState',
  'rollbackRefs',
  'createdAtUtc',
]);

const PROVENANCE_KEYS = Object.freeze([
  'schemaVersion',
  'provenanceId',
  'assetId',
  'assetVersion',
  'buildOrderId',
  'creatorAgentId',
  'operatorIntentRef',
  'designGenomeVersion',
  'researchRefs',
  'sourceAndInfluenceRefs',
  'licenceAndRightsState',
  'evidenceRefs',
  'createdAtUtc',
]);

const SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'snapshotId',
  'planetId',
  'scope',
  'scopeId',
  'worldStateVersion',
  'sourceHead',
  'worldManifestHash',
  'assetVersions',
  'runtimeCompatibility',
  'knownGood',
  'rollbackParentSnapshotId',
  'proofRefs',
  'createdAtUtc',
]);

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalDataOnly(value, state = null, depth = 0) {
  const traversal = state || { seen: new Set(), nodes: 0 };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length <= LIMITS.stringLength ? value : INVALID;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
  if (!value || typeof value !== 'object' || depth > LIMITS.depth) return INVALID;

  traversal.nodes += 1;
  if (traversal.nodes > LIMITS.nodes || traversal.seen.has(value)) return INVALID;

  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => typeof key !== 'string')) return INVALID;

    traversal.seen.add(value);
    try {
      if (isArray) {
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor?.value;
        if (!lengthDescriptor
          || lengthDescriptor.get
          || lengthDescriptor.set
          || !Number.isSafeInteger(length)
          || length < 0
          || length > LIMITS.arrayLength) return INVALID;
        const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
        if (descriptorKeys.some((key) => !expectedKeys.has(key))) return INVALID;
        const output = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor
            || !descriptor.enumerable
            || !Object.hasOwn(descriptor, 'value')
            || descriptor.get
            || descriptor.set) return INVALID;
          const normalized = canonicalDataOnly(descriptor.value, traversal, depth + 1);
          if (normalized === INVALID) return INVALID;
          output.push(normalized);
        }
        return Object.freeze(output);
      }

      if (descriptorKeys.length > LIMITS.objectKeys) return INVALID;
      const output = Object.create(null);
      for (const key of descriptorKeys.sort(compareCodePoints)) {
        if (RESERVED_KEYS.has(key)) return INVALID;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.get
          || descriptor.set) return INVALID;
        const normalized = canonicalDataOnly(descriptor.value, traversal, depth + 1);
        if (normalized === INVALID) return INVALID;
        Object.defineProperty(output, key, {
          value: normalized,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      return Object.freeze(output);
    } finally {
      traversal.seen.delete(value);
    }
  } catch {
    return INVALID;
  }
}

function dataRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function denseArray(value) {
  return Array.isArray(value) && value.every((_, index) => Object.hasOwn(value, index));
}

function canonicalText(value, maximum = 4096, allowEmpty = false) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length > maximum
    || CONTROL_CHARACTERS.test(value)) return '';
  return allowEmpty || value.length > 0 ? value : '';
}

function safeId(value) {
  return typeof value === 'string' && value === value.trim() && SAFE_ID.test(value);
}

function safeBudgetDataKey(value) {
  return typeof value === 'string'
    && value === value.trim()
    && !RESERVED_KEYS.has(value)
    && SAFE_BUDGET_DATA_KEY.test(value);
}

function safeVersion(value) {
  return typeof value === 'string' && value === value.trim() && SAFE_VERSION.test(value);
}

function canonicalEnum(value, inventory) {
  return typeof value === 'string' && value === value.trim() && inventory.includes(value);
}

function timestamp(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseResourceScope(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  const separator = value.indexOf(':');
  if (separator <= 0 || value.indexOf(':', separator + 1) !== -1) return null;
  const type = value.slice(0, separator);
  const identity = value.slice(separator + 1);
  if (type === 'region') {
    const segments = identity.split('/');
    if (segments.length !== 2 || !segments.every((segment) => SAFE_SCOPE_SEGMENT.test(segment))) return null;
    return Object.freeze({ type, planetId: segments[0], regionId: segments[1], identity });
  }
  if (!['planet', 'object', 'world-system', 'asset'].includes(type) || !SAFE_SCOPE_SEGMENT.test(identity)) return null;
  return Object.freeze({ type, identity });
}

function exactRecordShape(record, keys, errors) {
  if (!dataRecord(record)) {
    errors.push('record-must-be-data-only-object');
    return false;
  }
  const actual = Object.keys(record).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    for (const key of actual) if (!expected.includes(key)) errors.push(`unknown-field:${key}`);
    for (const key of expected) if (!actual.includes(key)) errors.push(`missing-field:${key}`);
  }
  return errors.length === 0;
}

function stringList(value, field, errors, options = {}) {
  if (!denseArray(value)) {
    errors.push(`${field}-must-be-dense-array`);
    return [];
  }
  const entries = [];
  for (const item of value) {
    const canonical = canonicalText(item, options.maximum || 1024);
    if (!canonical) {
      errors.push(`${field}-contains-noncanonical-value`);
      continue;
    }
    if (options.safeIds && !safeId(canonical)) errors.push(`${field}-contains-unsafe-id`);
    if (options.resourceScopes && !parseResourceScope(canonical)) errors.push(`${field}-contains-invalid-resource-scope`);
    entries.push(canonical);
  }
  if (new Set(entries).size !== entries.length) errors.push(`${field}-contains-duplicate`);
  if (options.minimum && entries.length < options.minimum) errors.push(`${field}-requires-${options.minimum}`);
  return entries;
}

function boundedText(value, field, errors, maximum = 4096) {
  const canonical = canonicalText(value, maximum);
  if (!canonical) errors.push(`${field}-invalid-or-noncanonical`);
  return canonical;
}

function validationResult(errors) {
  const unique = [...new Set(errors)];
  return Object.freeze({
    valid: unique.length === 0,
    errors: Object.freeze(unique),
    refusalReason: unique[0] || '',
  });
}

function validateBudget(value, field, errors) {
  if (!dataRecord(value)) {
    errors.push(`${field}-must-be-data-only-object`);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) errors.push(`${field}-must-not-be-empty`);
  if (keys.length > 16) errors.push(`${field}-too-many-entries`);
  for (const key of keys) {
    const entry = value[key];
    if (!safeBudgetDataKey(key)) errors.push(`${field}-unsafe-key`);
    const type = typeof entry;
    if (!['string', 'number', 'boolean'].includes(type)) errors.push(`${field}-unsupported-value`);
    if (type === 'number' && !Number.isFinite(entry)) errors.push(`${field}-non-finite-number`);
    if (type === 'string' && !canonicalText(entry, 256)) errors.push(`${field}-invalid-string-value`);
  }
}

function validateRollbackTarget(value, errors) {
  if (!dataRecord(value)) {
    errors.push('rollbackTarget-must-be-data-only-object');
    return;
  }
  const keys = Object.keys(value).sort(compareCodePoints);
  const expected = ['scope', 'snapshotId', 'targetId'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) errors.push('rollbackTarget-shape-invalid');
  if (!canonicalEnum(value.scope, SPATIAL_ROLLBACK_SCOPES)) errors.push('rollbackTarget-scope-invalid');
  if (!safeId(value.targetId)) errors.push('rollbackTarget-targetId-invalid');
  if (value.snapshotId !== null && !safeId(value.snapshotId)) errors.push('rollbackTarget-snapshotId-invalid');
}

function hasTraversalSegment(value) {
  return value.split(/[\\/]/).some((segment) => segment === '.' || segment === '..');
}

function safeGovernedStorageLocation(value) {
  if (value === null) return true;
  const candidate = canonicalText(value, 1024);
  if (!candidate || hasTraversalSegment(candidate)) return false;
  return /^(?:cas|lfs|object):\/\/[a-z0-9][a-z0-9._~:/+-]{0,1000}$/.test(candidate);
}

function safeSourceLocation(value) {
  if (value === null) return true;
  const candidate = canonicalText(value, 1024);
  if (!candidate || ABSOLUTE_OR_UNSAFE_PATH.test(candidate) || hasTraversalSegment(candidate)) return false;
  return safeGovernedStorageLocation(candidate) || /^[a-z0-9._/-]+$/.test(candidate);
}

function safeReference(value) {
  const candidate = canonicalText(value, 1024);
  return Boolean(candidate && !ABSOLUTE_OR_UNSAFE_PATH.test(candidate) && !hasTraversalSegment(candidate));
}

function validateOwnedScopes(scopes, buildOrder, errors) {
  const objectIds = new Set(buildOrder.objectIds);
  for (const scope of scopes) {
    const parsed = parseResourceScope(scope);
    if (!parsed) continue;
    if (!BOUND_BUILD_ORDER_SCOPE_TYPES.has(parsed.type)) {
      errors.push(`ownedResourceScopes-unbound-scope-type:${parsed.type}`);
    } else if (parsed.type === 'planet' && parsed.identity !== buildOrder.planetId) {
      errors.push('ownedResourceScopes-planet-mismatch');
    } else if (parsed.type === 'region'
      && (parsed.planetId !== buildOrder.planetId || parsed.regionId !== buildOrder.regionId)) {
      errors.push('ownedResourceScopes-region-mismatch');
    } else if (parsed.type === 'object' && !objectIds.has(parsed.identity)) {
      errors.push('ownedResourceScopes-object-mismatch');
    }
  }
}

function validateSpatialBuildOrderSnapshot(record) {
  const errors = [];
  if (!exactRecordShape(record, BUILD_ORDER_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_BUILD_ORDER_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['spatialBuildOrderId', 'intentId', 'missionId', 'planetId', 'regionId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid-or-noncanonical`);
  }
  const objectIds = stringList(record.objectIds, 'objectIds', errors, { safeIds: true });
  boundedText(record.operatorRequest, 'operatorRequest', errors, 8192);
  boundedText(record.interpretationSummary, 'interpretationSummary', errors);
  if (!safeVersion(record.designGenomeVersion)) errors.push('designGenomeVersion-invalid-or-noncanonical');
  stringList(record.researchRefs, 'researchRefs', errors);
  boundedText(record.requiredOutcome, 'requiredOutcome', errors);
  stringList(record.assetClasses, 'assetClasses', errors, { safeIds: true });
  stringList(record.codeClasses, 'codeClasses', errors, { safeIds: true });
  stringList(record.dependencies, 'dependencies', errors, { safeIds: true });
  const ownedScopes = stringList(record.ownedResourceScopes, 'ownedResourceScopes', errors, { resourceScopes: true, minimum: 1 });
  validateOwnedScopes(ownedScopes, { ...record, objectIds }, errors);
  const allowed = stringList(record.allowedOperations, 'allowedOperations', errors);
  stringList(record.forbiddenOperations, 'forbiddenOperations', errors);
  if (allowed.some((operation) => !SAFE_ALLOWED_OPERATIONS.has(operation))) {
    errors.push('allowedOperations-contains-unknown-operation');
  }
  stringList(record.requiredAgents, 'requiredAgents', errors, { safeIds: true, minimum: 1 });
  validateBudget(record.performanceBudget, 'performanceBudget', errors);
  validateBudget(record.comfortBudget, 'comfortBudget', errors);
  boundedText(record.licenceAndProvenanceRequirements, 'licenceAndProvenanceRequirements', errors);
  if (!canonicalEnum(record.previewRequirement, SPATIAL_PREVIEW_REQUIREMENTS)) errors.push('previewRequirement-invalid');
  boundedText(record.verificationContract, 'verificationContract', errors);
  if (!canonicalEnum(record.approvalRequirement, SPATIAL_APPROVAL_REQUIREMENTS)) errors.push('approvalRequirement-invalid');
  validateRollbackTarget(record.rollbackTarget, errors);
  if (!canonicalEnum(record.status, SPATIAL_BUILD_ORDER_STATES)) errors.push('status-invalid');
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

function validateSpatialAssetRecordSnapshot(record) {
  const errors = [];
  if (!exactRecordShape(record, ASSET_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_ASSET_RECORD_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['assetId', 'assetType', 'creatorAgentId', 'creatingBuildOrderId', 'planetId', 'regionId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid-or-noncanonical`);
  }
  if (!safeVersion(record.version)) errors.push('version-invalid-or-noncanonical');
  if (typeof record.contentHash !== 'string' || !CONTENT_HASH.test(record.contentHash)) errors.push('contentHash-invalid');
  if (!safeSourceLocation(record.sourceLocation)) errors.push('sourceLocation-invalid');
  if (!safeGovernedStorageLocation(record.largeAssetLocation)) errors.push('largeAssetLocation-invalid');
  if (record.parentVersion !== null && !safeVersion(record.parentVersion)) errors.push('parentVersion-invalid-or-noncanonical');
  stringList(record.sourceAndInfluenceRefs, 'sourceAndInfluenceRefs', errors);
  if (!canonicalEnum(record.licenceAndRightsState, SPATIAL_LICENCE_STATES)) errors.push('licenceAndRightsState-invalid');
  stringList(record.dependencies, 'dependencies', errors, { safeIds: true });
  stringList(record.dependents, 'dependents', errors, { safeIds: true });
  stringList(record.engineOrRuntimeCompatibility, 'engineOrRuntimeCompatibility', errors, { minimum: 1 });
  if (!safeId(record.performanceClass)) errors.push('performanceClass-invalid-or-noncanonical');
  if (!safeId(record.validationState)) errors.push('validationState-invalid-or-noncanonical');
  if (!canonicalEnum(record.integrationState, SPATIAL_PROMOTION_STATES)) errors.push('integrationState-invalid');
  if (!canonicalEnum(record.liveState, ['NOT_LIVE', 'LIVE_STAGED', 'LIVE_PROVEN', 'ROLLED_BACK'])) errors.push('liveState-invalid');
  stringList(record.rollbackRefs, 'rollbackRefs', errors);
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

function validateSpatialProvenanceRecordSnapshot(record) {
  const errors = [];
  if (!exactRecordShape(record, PROVENANCE_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_PROVENANCE_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['provenanceId', 'assetId', 'buildOrderId', 'creatorAgentId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid-or-noncanonical`);
  }
  if (!safeVersion(record.assetVersion)) errors.push('assetVersion-invalid-or-noncanonical');
  if (!safeReference(record.operatorIntentRef)) errors.push('operatorIntentRef-invalid');
  if (!safeVersion(record.designGenomeVersion)) errors.push('designGenomeVersion-invalid-or-noncanonical');
  stringList(record.researchRefs, 'researchRefs', errors);
  stringList(record.sourceAndInfluenceRefs, 'sourceAndInfluenceRefs', errors);
  if (!canonicalEnum(record.licenceAndRightsState, SPATIAL_LICENCE_STATES)) errors.push('licenceAndRightsState-invalid');
  stringList(record.evidenceRefs, 'evidenceRefs', errors, { minimum: 1 });
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

function validateSnapshotAssetVersions(value, errors) {
  if (!denseArray(value) || value.length === 0) {
    errors.push('assetVersions-must-be-non-empty-dense-array');
    return;
  }
  const seen = new Set();
  for (const entry of value) {
    if (!dataRecord(entry)) {
      errors.push('assetVersions-entry-must-be-data-only-object');
      continue;
    }
    const keys = Object.keys(entry).sort(compareCodePoints);
    if (JSON.stringify(keys) !== JSON.stringify(['assetId', 'contentHash', 'version'])) {
      errors.push('assetVersions-entry-shape-invalid');
      continue;
    }
    if (!safeId(entry.assetId)) errors.push('assetVersions-assetId-invalid-or-noncanonical');
    if (!safeVersion(entry.version)) errors.push('assetVersions-version-invalid-or-noncanonical');
    if (typeof entry.contentHash !== 'string' || !CONTENT_HASH.test(entry.contentHash)) errors.push('assetVersions-contentHash-invalid');
    if (seen.has(entry.assetId)) errors.push('assetVersions-duplicate-asset');
    seen.add(entry.assetId);
  }
}

function validateSpatialWorldSnapshotSnapshot(record) {
  const errors = [];
  if (!exactRecordShape(record, SNAPSHOT_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['snapshotId', 'planetId', 'scopeId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid-or-noncanonical`);
  }
  if (!canonicalEnum(record.scope, SPATIAL_ROLLBACK_SCOPES)) errors.push('scope-invalid');
  if (!safeVersion(record.worldStateVersion)) errors.push('worldStateVersion-invalid-or-noncanonical');
  if (typeof record.sourceHead !== 'string' || !EXACT_SOURCE_HEAD.test(record.sourceHead)) errors.push('sourceHead-invalid');
  if (typeof record.worldManifestHash !== 'string' || !CONTENT_HASH.test(record.worldManifestHash)) errors.push('worldManifestHash-invalid');
  validateSnapshotAssetVersions(record.assetVersions, errors);
  stringList(record.runtimeCompatibility, 'runtimeCompatibility', errors, { minimum: 1 });
  if (typeof record.knownGood !== 'boolean') errors.push('knownGood-must-be-boolean');
  if (record.rollbackParentSnapshotId !== null && !safeId(record.rollbackParentSnapshotId)) {
    errors.push('rollbackParentSnapshotId-invalid-or-noncanonical');
  }
  stringList(record.proofRefs, 'proofRefs', errors, { minimum: 1 });
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

function observeRecord(input, label) {
  const snapshot = canonicalDataOnly(input);
  if (snapshot === INVALID || !dataRecord(snapshot)) {
    return Object.freeze({ snapshot: null, verdict: validationResult([`${label}-must-be-data-only`]) });
  }
  return Object.freeze({ snapshot, verdict: null });
}

export function validateSpatialBuildOrder(input) {
  const observed = observeRecord(input, 'buildOrder');
  return observed.verdict || validateSpatialBuildOrderSnapshot(observed.snapshot);
}

export function validateSpatialAssetRecord(input) {
  const observed = observeRecord(input, 'asset');
  return observed.verdict || validateSpatialAssetRecordSnapshot(observed.snapshot);
}

export function validateSpatialProvenanceRecord(input) {
  const observed = observeRecord(input, 'provenance');
  return observed.verdict || validateSpatialProvenanceRecordSnapshot(observed.snapshot);
}

export function validateSpatialWorldSnapshot(input) {
  const observed = observeRecord(input, 'snapshot');
  return observed.verdict || validateSpatialWorldSnapshotSnapshot(observed.snapshot);
}

function validateSnapshotScopeLineage(snapshot, buildOrder, asset, errors) {
  if (snapshot.scope === 'ASSET' && snapshot.scopeId !== asset.assetId) {
    errors.push('lineage-snapshot-asset-scope-mismatch');
  } else if (['OBJECT', 'FEATURE'].includes(snapshot.scope) && !buildOrder.objectIds.includes(snapshot.scopeId)) {
    errors.push('lineage-snapshot-object-scope-mismatch');
  } else if (snapshot.scope === 'REGION' && snapshot.scopeId !== buildOrder.regionId) {
    errors.push('lineage-snapshot-region-mismatch');
  } else if (snapshot.scope === 'PLANET' && snapshot.scopeId !== buildOrder.planetId) {
    errors.push('lineage-snapshot-planet-scope-mismatch');
  } else if (snapshot.scope === 'WORLD_STATE' && snapshot.scopeId !== snapshot.worldStateVersion) {
    errors.push('lineage-snapshot-world-state-scope-mismatch');
  }
}

export function validateSpatialWorldFoundryBundle(input = {}) {
  const observed = observeRecord(input, 'bundle');
  if (observed.verdict) return observed.verdict;
  const bundle = observed.snapshot;
  const errors = [];
  const keys = Object.keys(bundle).sort(compareCodePoints);
  if (JSON.stringify(keys) !== JSON.stringify(['asset', 'buildOrder', 'provenance', 'snapshot'])) {
    errors.push('bundle-shape-invalid');
    return validationResult(errors);
  }

  const buildOrder = validateSpatialBuildOrderSnapshot(bundle.buildOrder);
  const asset = validateSpatialAssetRecordSnapshot(bundle.asset);
  const provenance = validateSpatialProvenanceRecordSnapshot(bundle.provenance);
  const snapshot = validateSpatialWorldSnapshotSnapshot(bundle.snapshot);
  for (const [prefix, result] of [['buildOrder', buildOrder], ['asset', asset], ['provenance', provenance], ['snapshot', snapshot]]) {
    for (const error of result.errors) errors.push(`${prefix}:${error}`);
  }

  if (buildOrder.valid && asset.valid && provenance.valid && snapshot.valid) {
    const expectedOperatorIntentRef = `shared-workspace/intents/${bundle.buildOrder.intentId}`;
    if (bundle.asset.creatingBuildOrderId !== bundle.buildOrder.spatialBuildOrderId) errors.push('lineage-build-order-mismatch');
    if (bundle.provenance.buildOrderId !== bundle.buildOrder.spatialBuildOrderId) errors.push('lineage-provenance-build-order-mismatch');
    if (bundle.provenance.assetId !== bundle.asset.assetId) errors.push('lineage-provenance-asset-mismatch');
    if (bundle.provenance.assetVersion !== bundle.asset.version) errors.push('lineage-provenance-version-mismatch');
    if (bundle.provenance.creatorAgentId !== bundle.asset.creatorAgentId) errors.push('lineage-provenance-creator-mismatch');
    if (bundle.provenance.operatorIntentRef !== expectedOperatorIntentRef) errors.push('lineage-provenance-intent-mismatch');
    if (bundle.provenance.designGenomeVersion !== bundle.buildOrder.designGenomeVersion) errors.push('lineage-provenance-design-genome-mismatch');
    if (bundle.asset.planetId !== bundle.buildOrder.planetId || bundle.snapshot.planetId !== bundle.buildOrder.planetId) {
      errors.push('lineage-planet-mismatch');
    }
    if (bundle.asset.regionId !== bundle.buildOrder.regionId) errors.push('lineage-region-mismatch');
    validateSnapshotScopeLineage(bundle.snapshot, bundle.buildOrder, bundle.asset, errors);
    const snapshotAsset = bundle.snapshot.assetVersions.find((entry) => entry.assetId === bundle.asset.assetId);
    if (!snapshotAsset) errors.push('snapshot-missing-asset');
    else if (snapshotAsset.version !== bundle.asset.version || snapshotAsset.contentHash !== bundle.asset.contentHash) {
      errors.push('snapshot-asset-identity-mismatch');
    }
  }
  return validationResult(errors);
}
