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

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/i;
const EXACT_SOURCE_HEAD = /^[0-9a-f]{40}$/i;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/i;
const SAFE_RESOURCE_SCOPE = /^(?:planet|region|object|world-system|asset):[a-z0-9][a-z0-9._:/-]{0,255}$/i;
const ABSOLUTE_OR_UNSAFE_PATH = /^(?:[a-z]:[\\/]|[\\/]{1,2}|\.{2}(?:[\\/]|$))/i;
const FORBIDDEN_ALLOWED_OPERATIONS = new Set([
  'APPROVE',
  'ARBITRARY_SHELL',
  'DEPLOY',
  'LEASE_SEIZE',
  'MERGE',
  'RUNTIME_MUTATE',
  'SELF_PROMOTE',
  'VOICE_EXECUTE',
]);

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

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function plainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function timestamp(value) {
  const candidate = text(value);
  if (!candidate) return false;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate;
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function safeVersion(value) {
  return SAFE_VERSION.test(text(value));
}

function exactRecordShape(record, keys, errors) {
  if (!plainRecord(record)) {
    errors.push('record-must-be-plain-object');
    return false;
  }
  const actual = Reflect.ownKeys(record);
  if (actual.some((key) => typeof key !== 'string')) {
    errors.push('symbol-keys-forbidden');
    return false;
  }
  const expected = new Set(keys);
  for (const key of actual) {
    if (!expected.has(key)) errors.push(`unknown-field:${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) errors.push(`missing-field:${key}`);
  }
  return errors.length === 0;
}

function stringList(value, field, errors, options = {}) {
  if (!denseArray(value)) {
    errors.push(`${field}-must-be-dense-array`);
    return [];
  }
  const normalized = value.map(text);
  if (normalized.some((item) => !item)) errors.push(`${field}-contains-empty-value`);
  if (options.safeIds && normalized.some((item) => !SAFE_ID.test(item))) errors.push(`${field}-contains-unsafe-id`);
  if (options.resourceScopes && normalized.some((item) => !SAFE_RESOURCE_SCOPE.test(item))) {
    errors.push(`${field}-contains-invalid-resource-scope`);
  }
  if (new Set(normalized).size !== normalized.length) errors.push(`${field}-contains-duplicate`);
  if (options.minimum && normalized.length < options.minimum) errors.push(`${field}-requires-${options.minimum}`);
  return normalized;
}

function boundedText(value, field, errors, maximum = 4096) {
  const normalized = text(value);
  if (!normalized) errors.push(`${field}-required`);
  if (normalized.length > maximum) errors.push(`${field}-too-long`);
  return normalized;
}

function validationResult(errors) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    refusalReason: errors[0] || '',
  });
}

function validateBudget(value, field, errors) {
  if (!plainRecord(value)) {
    errors.push(`${field}-must-be-plain-object`);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) errors.push(`${field}-must-not-be-empty`);
  if (keys.length > 16) errors.push(`${field}-too-many-entries`);
  for (const [key, entry] of Object.entries(value)) {
    if (!safeId(key)) errors.push(`${field}-unsafe-key`);
    const type = typeof entry;
    if (!['string', 'number', 'boolean'].includes(type)) errors.push(`${field}-unsupported-value`);
    if (type === 'number' && !Number.isFinite(entry)) errors.push(`${field}-non-finite-number`);
    if (type === 'string' && (!text(entry) || entry.length > 256)) errors.push(`${field}-invalid-string-value`);
  }
}

function validateRollbackTarget(value, errors) {
  if (!plainRecord(value)) {
    errors.push('rollbackTarget-must-be-plain-object');
    return;
  }
  const keys = Object.keys(value).sort();
  const expected = ['scope', 'snapshotId', 'targetId'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) errors.push('rollbackTarget-shape-invalid');
  if (!SPATIAL_ROLLBACK_SCOPES.includes(text(value.scope).toUpperCase())) errors.push('rollbackTarget-scope-invalid');
  if (!safeId(value.targetId)) errors.push('rollbackTarget-targetId-invalid');
  if (value.snapshotId !== null && !safeId(value.snapshotId)) errors.push('rollbackTarget-snapshotId-invalid');
}

function safeStorageLocation(value) {
  if (value === null) return true;
  const candidate = text(value);
  if (!candidate || candidate.length > 1024 || ABSOLUTE_OR_UNSAFE_PATH.test(candidate)) return false;
  return /^(?:cas|lfs|object):\/\//i.test(candidate) || /^[a-z0-9._/-]+$/i.test(candidate);
}

function safeReference(value) {
  const candidate = text(value);
  return Boolean(candidate && candidate.length <= 1024 && !ABSOLUTE_OR_UNSAFE_PATH.test(candidate));
}

export function validateSpatialBuildOrder(record) {
  const errors = [];
  if (!exactRecordShape(record, BUILD_ORDER_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_BUILD_ORDER_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['spatialBuildOrderId', 'intentId', 'missionId', 'planetId', 'regionId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid`);
  }
  stringList(record.objectIds, 'objectIds', errors, { safeIds:true });
  boundedText(record.operatorRequest, 'operatorRequest', errors, 8192);
  boundedText(record.interpretationSummary, 'interpretationSummary', errors);
  if (!safeVersion(record.designGenomeVersion)) errors.push('designGenomeVersion-invalid');
  stringList(record.researchRefs, 'researchRefs', errors);
  boundedText(record.requiredOutcome, 'requiredOutcome', errors);
  stringList(record.assetClasses, 'assetClasses', errors, { safeIds:true });
  stringList(record.codeClasses, 'codeClasses', errors, { safeIds:true });
  stringList(record.dependencies, 'dependencies', errors, { safeIds:true });
  stringList(record.ownedResourceScopes, 'ownedResourceScopes', errors, { resourceScopes:true, minimum:1 });
  const allowed = stringList(record.allowedOperations, 'allowedOperations', errors).map((value) => value.toUpperCase());
  stringList(record.forbiddenOperations, 'forbiddenOperations', errors);
  if (allowed.some((operation) => FORBIDDEN_ALLOWED_OPERATIONS.has(operation))) {
    errors.push('allowedOperations-contains-authority-bypass');
  }
  stringList(record.requiredAgents, 'requiredAgents', errors, { safeIds:true, minimum:1 });
  validateBudget(record.performanceBudget, 'performanceBudget', errors);
  validateBudget(record.comfortBudget, 'comfortBudget', errors);
  boundedText(record.licenceAndProvenanceRequirements, 'licenceAndProvenanceRequirements', errors);
  if (!SPATIAL_PREVIEW_REQUIREMENTS.includes(text(record.previewRequirement).toUpperCase())) {
    errors.push('previewRequirement-invalid');
  }
  boundedText(record.verificationContract, 'verificationContract', errors);
  if (!SPATIAL_APPROVAL_REQUIREMENTS.includes(text(record.approvalRequirement).toUpperCase())) {
    errors.push('approvalRequirement-invalid');
  }
  validateRollbackTarget(record.rollbackTarget, errors);
  if (!SPATIAL_BUILD_ORDER_STATES.includes(text(record.status).toUpperCase())) errors.push('status-invalid');
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

export function validateSpatialAssetRecord(record) {
  const errors = [];
  if (!exactRecordShape(record, ASSET_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_ASSET_RECORD_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['assetId', 'assetType', 'creatorAgentId', 'creatingBuildOrderId', 'planetId', 'regionId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid`);
  }
  if (!safeVersion(record.version)) errors.push('version-invalid');
  if (!CONTENT_HASH.test(text(record.contentHash))) errors.push('contentHash-invalid');
  if (!safeStorageLocation(record.sourceLocation)) errors.push('sourceLocation-invalid');
  if (!safeStorageLocation(record.largeAssetLocation)) errors.push('largeAssetLocation-invalid');
  if (record.parentVersion !== null && !safeVersion(record.parentVersion)) errors.push('parentVersion-invalid');
  stringList(record.sourceAndInfluenceRefs, 'sourceAndInfluenceRefs', errors);
  if (!SPATIAL_LICENCE_STATES.includes(text(record.licenceAndRightsState).toUpperCase())) {
    errors.push('licenceAndRightsState-invalid');
  }
  stringList(record.dependencies, 'dependencies', errors, { safeIds:true });
  stringList(record.dependents, 'dependents', errors, { safeIds:true });
  stringList(record.engineOrRuntimeCompatibility, 'engineOrRuntimeCompatibility', errors, { minimum:1 });
  if (!safeId(record.performanceClass)) errors.push('performanceClass-invalid');
  if (!safeId(record.validationState)) errors.push('validationState-invalid');
  if (!SPATIAL_PROMOTION_STATES.includes(text(record.integrationState).toUpperCase())) errors.push('integrationState-invalid');
  if (!['NOT_LIVE', 'LIVE_STAGED', 'LIVE_PROVEN', 'ROLLED_BACK'].includes(text(record.liveState).toUpperCase())) {
    errors.push('liveState-invalid');
  }
  stringList(record.rollbackRefs, 'rollbackRefs', errors);
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

export function validateSpatialProvenanceRecord(record) {
  const errors = [];
  if (!exactRecordShape(record, PROVENANCE_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_PROVENANCE_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['provenanceId', 'assetId', 'buildOrderId', 'creatorAgentId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid`);
  }
  if (!safeVersion(record.assetVersion)) errors.push('assetVersion-invalid');
  if (!safeReference(record.operatorIntentRef)) errors.push('operatorIntentRef-invalid');
  if (!safeVersion(record.designGenomeVersion)) errors.push('designGenomeVersion-invalid');
  stringList(record.researchRefs, 'researchRefs', errors);
  stringList(record.sourceAndInfluenceRefs, 'sourceAndInfluenceRefs', errors);
  if (!SPATIAL_LICENCE_STATES.includes(text(record.licenceAndRightsState).toUpperCase())) {
    errors.push('licenceAndRightsState-invalid');
  }
  stringList(record.evidenceRefs, 'evidenceRefs', errors, { minimum:1 });
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
    if (!plainRecord(entry)) {
      errors.push('assetVersions-entry-must-be-plain-object');
      continue;
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['assetId', 'contentHash', 'version'])) {
      errors.push('assetVersions-entry-shape-invalid');
      continue;
    }
    if (!safeId(entry.assetId)) errors.push('assetVersions-assetId-invalid');
    if (!safeVersion(entry.version)) errors.push('assetVersions-version-invalid');
    if (!CONTENT_HASH.test(text(entry.contentHash))) errors.push('assetVersions-contentHash-invalid');
    if (seen.has(entry.assetId)) errors.push('assetVersions-duplicate-asset');
    seen.add(entry.assetId);
  }
}

export function validateSpatialWorldSnapshot(record) {
  const errors = [];
  if (!exactRecordShape(record, SNAPSHOT_KEYS, errors)) return validationResult(errors);
  if (record.schemaVersion !== SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['snapshotId', 'planetId', 'scopeId']) {
    if (!safeId(record[field])) errors.push(`${field}-invalid`);
  }
  if (!SPATIAL_ROLLBACK_SCOPES.includes(text(record.scope).toUpperCase())) errors.push('scope-invalid');
  if (!safeVersion(record.worldStateVersion)) errors.push('worldStateVersion-invalid');
  if (!EXACT_SOURCE_HEAD.test(text(record.sourceHead))) errors.push('sourceHead-invalid');
  if (!CONTENT_HASH.test(text(record.worldManifestHash))) errors.push('worldManifestHash-invalid');
  validateSnapshotAssetVersions(record.assetVersions, errors);
  stringList(record.runtimeCompatibility, 'runtimeCompatibility', errors, { minimum:1 });
  if (typeof record.knownGood !== 'boolean') errors.push('knownGood-must-be-boolean');
  if (record.rollbackParentSnapshotId !== null && !safeId(record.rollbackParentSnapshotId)) {
    errors.push('rollbackParentSnapshotId-invalid');
  }
  stringList(record.proofRefs, 'proofRefs', errors, { minimum:1 });
  if (!timestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return validationResult(errors);
}

export function validateSpatialWorldFoundryBundle(bundle = {}) {
  const errors = [];
  if (!plainRecord(bundle)) return validationResult(['bundle-must-be-plain-object']);
  const keys = Object.keys(bundle).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['asset', 'buildOrder', 'provenance', 'snapshot'])) {
    errors.push('bundle-shape-invalid');
    return validationResult(errors);
  }
  const buildOrder = validateSpatialBuildOrder(bundle.buildOrder);
  const asset = validateSpatialAssetRecord(bundle.asset);
  const provenance = validateSpatialProvenanceRecord(bundle.provenance);
  const snapshot = validateSpatialWorldSnapshot(bundle.snapshot);
  for (const [prefix, result] of [['buildOrder', buildOrder], ['asset', asset], ['provenance', provenance], ['snapshot', snapshot]]) {
    for (const error of result.errors) errors.push(`${prefix}:${error}`);
  }
  if (buildOrder.valid && asset.valid && provenance.valid && snapshot.valid) {
    if (bundle.asset.creatingBuildOrderId !== bundle.buildOrder.spatialBuildOrderId) errors.push('lineage-build-order-mismatch');
    if (bundle.provenance.buildOrderId !== bundle.buildOrder.spatialBuildOrderId) errors.push('lineage-provenance-build-order-mismatch');
    if (bundle.provenance.assetId !== bundle.asset.assetId) errors.push('lineage-provenance-asset-mismatch');
    if (bundle.provenance.assetVersion !== bundle.asset.version) errors.push('lineage-provenance-version-mismatch');
    if (bundle.asset.planetId !== bundle.buildOrder.planetId || bundle.snapshot.planetId !== bundle.buildOrder.planetId) {
      errors.push('lineage-planet-mismatch');
    }
    const snapshotAsset = bundle.snapshot.assetVersions.find((entry) => entry.assetId === bundle.asset.assetId);
    if (!snapshotAsset) errors.push('snapshot-missing-asset');
    else if (snapshotAsset.version !== bundle.asset.version || snapshotAsset.contentHash !== bundle.asset.contentHash) {
      errors.push('snapshot-asset-identity-mismatch');
    }
  }
  return validationResult(errors);
}
