import { createHash } from 'node:crypto';

import {
  SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
  validateSpatialAssetRecord,
} from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_ASSET_REGISTRY_SCHEMA_VERSION = 'stephanos.spatial-asset-registry.v1';
export const SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION = 'stephanos.spatial-asset-registration-plan.v1';

export const SPATIAL_ASSET_REGISTRATION_ACTION = Object.freeze({
  REGISTER: 'REGISTER',
  NOOP_ALREADY_REGISTERED: 'NOOP_ALREADY_REGISTERED',
  BLOCKED_INVALID_REGISTRY: 'BLOCKED_INVALID_REGISTRY',
  BLOCKED_INVALID_ASSET: 'BLOCKED_INVALID_ASSET',
  BLOCKED_PLANET_MISMATCH: 'BLOCKED_PLANET_MISMATCH',
  BLOCKED_IDENTITY_CONFLICT: 'BLOCKED_IDENTITY_CONFLICT',
  BLOCKED_MISSING_PARENT: 'BLOCKED_MISSING_PARENT',
  BLOCKED_MISSING_DEPENDENCY: 'BLOCKED_MISSING_DEPENDENCY',
  BLOCKED_DEPENDENCY_CYCLE: 'BLOCKED_DEPENDENCY_CYCLE',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const EXACT_SOURCE_HEAD = /^[0-9a-f]{40}$/i;
const CONTENT_HASH = /^sha256:([0-9a-f]{64})$/i;
const REGISTRY_KEYS = Object.freeze([
  'schemaVersion',
  'registryId',
  'planetId',
  'sourceHead',
  'generation',
  'entries',
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
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function exactShape(record, keys, errors) {
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
  for (const key of actual) if (!expected.has(key)) errors.push(`unknown-field:${key}`);
  for (const key of keys) if (!Object.hasOwn(record, key)) errors.push(`missing-field:${key}`);
  return errors.length === 0;
}

function result(errors, extra = {}) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    refusalReason: errors[0] || '',
    ...extra,
  });
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function spatialAssetVersionIdentity(assetRecord = {}) {
  return `${text(assetRecord.assetId)}@${text(assetRecord.version)}`;
}

export function canonicalSpatialAssetContentAddress(assetRecord = {}) {
  const validation = validateSpatialAssetRecord(assetRecord);
  if (!validation.valid) return null;
  const match = text(assetRecord.contentHash).match(CONTENT_HASH);
  if (!match) return null;
  return `cas://sha256/${match[1].toLowerCase()}`;
}

function registryAssetIds(entries) {
  return new Set(entries.map((entry) => entry.assetId));
}

function dependencyCycle(entries) {
  const assetIds = registryAssetIds(entries);
  const graph = new Map();
  for (const assetId of assetIds) graph.set(assetId, new Set());
  for (const entry of entries) {
    const edges = graph.get(entry.assetId);
    for (const dependency of entry.dependencies) {
      if (assetIds.has(dependency)) edges.add(dependency);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function visit(assetId) {
    if (visiting.has(assetId)) {
      const start = path.indexOf(assetId);
      return [...path.slice(start), assetId];
    }
    if (visited.has(assetId)) return null;
    visiting.add(assetId);
    path.push(assetId);
    for (const dependency of graph.get(assetId) || []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(assetId);
    visited.add(assetId);
    return null;
  }

  for (const assetId of graph.keys()) {
    const cycle = visit(assetId);
    if (cycle) return cycle;
  }
  return null;
}

export function validateSpatialAssetRegistry(registry = {}) {
  const errors = [];
  if (!exactShape(registry, REGISTRY_KEYS, errors)) return result(errors);
  if (registry.schemaVersion !== SPATIAL_ASSET_REGISTRY_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (!safeId(registry.registryId)) errors.push('registryId-invalid');
  if (!safeId(registry.planetId)) errors.push('planetId-invalid');
  if (!EXACT_SOURCE_HEAD.test(text(registry.sourceHead))) errors.push('sourceHead-invalid');
  if (!Number.isSafeInteger(registry.generation) || registry.generation < 1) errors.push('generation-invalid');
  if (!timestamp(registry.createdAtUtc)) errors.push('createdAtUtc-invalid');
  if (!denseArray(registry.entries)) {
    errors.push('entries-must-be-dense-array');
    return result(errors);
  }

  const identities = new Set();
  const hashByIdentity = new Map();
  const entryByIdentity = new Map();
  const entriesByAssetId = new Map();

  for (let index = 0; index < registry.entries.length; index += 1) {
    const entry = registry.entries[index];
    const validation = validateSpatialAssetRecord(entry);
    for (const error of validation.errors) errors.push(`entry-${index + 1}:${error}`);
    if (!validation.valid) continue;
    if (entry.schemaVersion !== SPATIAL_ASSET_RECORD_SCHEMA_VERSION) errors.push(`entry-${index + 1}:asset-schema-version-mismatch`);
    if (entry.planetId !== registry.planetId) errors.push(`entry-${index + 1}:planetId-mismatch`);
    const identity = spatialAssetVersionIdentity(entry);
    if (identities.has(identity)) errors.push(`entry-${index + 1}:duplicate-version-identity:${identity}`);
    identities.add(identity);
    hashByIdentity.set(identity, entry.contentHash);
    entryByIdentity.set(identity, entry);
    const versions = entriesByAssetId.get(entry.assetId) || [];
    versions.push(entry);
    entriesByAssetId.set(entry.assetId, versions);
    if (!canonicalSpatialAssetContentAddress(entry)) errors.push(`entry-${index + 1}:content-address-invalid`);
  }

  const knownAssetIds = new Set(entriesByAssetId.keys());
  for (const entry of entryByIdentity.values()) {
    if (entry.parentVersion !== null) {
      const parentIdentity = `${entry.assetId}@${entry.parentVersion}`;
      if (!entryByIdentity.has(parentIdentity)) errors.push(`missing-parent:${spatialAssetVersionIdentity(entry)}->${parentIdentity}`);
    }
    for (const dependency of entry.dependencies) {
      if (dependency === entry.assetId) errors.push(`self-dependency:${entry.assetId}`);
      else if (!knownAssetIds.has(dependency)) errors.push(`missing-dependency:${spatialAssetVersionIdentity(entry)}->${dependency}`);
    }
  }

  const cycle = dependencyCycle([...entryByIdentity.values()]);
  if (cycle) errors.push(`dependency-cycle:${cycle.join('>')}`);

  return result(errors, {
    entryCount: registry.entries.length,
    uniqueVersionCount: identities.size,
    uniqueAssetCount: knownAssetIds.size,
  });
}

export function createSpatialAssetRegistry(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries.map((entry) => Object.freeze({ ...entry })) : [];
  const registry = Object.freeze({
    schemaVersion: SPATIAL_ASSET_REGISTRY_SCHEMA_VERSION,
    registryId: text(input.registryId),
    planetId: text(input.planetId),
    sourceHead: text(input.sourceHead),
    generation: input.generation ?? 1,
    entries: Object.freeze(entries),
    createdAtUtc: text(input.createdAtUtc),
  });
  const validation = validateSpatialAssetRegistry(registry);
  return Object.freeze({ valid: validation.valid, registry: validation.valid ? registry : null, validation });
}

export function buildSpatialAssetContentAddressIndex(registry = {}) {
  const validation = validateSpatialAssetRegistry(registry);
  if (!validation.valid) return Object.freeze({ valid: false, index: null, errors: validation.errors });
  const index = {};
  for (const entry of registry.entries) {
    const address = canonicalSpatialAssetContentAddress(entry);
    const identities = index[address] || [];
    identities.push(spatialAssetVersionIdentity(entry));
    index[address] = identities.sort();
  }
  return Object.freeze({
    valid: true,
    index: Object.freeze(Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)).map(([address, identities]) => [address, Object.freeze(identities)]))),
    errors: Object.freeze([]),
  });
}

export function planSpatialAssetRegistration(registry = {}, assetRecord = {}) {
  const authority = Object.freeze({
    storageWriteAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
  const registryValidation = validateSpatialAssetRegistry(registry);
  if (!registryValidation.valid) {
    return Object.freeze({ schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION, action: SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_INVALID_REGISTRY, errors: registryValidation.errors, authority });
  }
  const assetValidation = validateSpatialAssetRecord(assetRecord);
  if (!assetValidation.valid) {
    return Object.freeze({ schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION, action: SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_INVALID_ASSET, errors: assetValidation.errors, authority });
  }
  if (assetRecord.planetId !== registry.planetId) {
    return Object.freeze({ schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION, action: SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_PLANET_MISMATCH, errors: Object.freeze(['planetId-mismatch']), authority });
  }

  const identity = spatialAssetVersionIdentity(assetRecord);
  const contentAddress = canonicalSpatialAssetContentAddress(assetRecord);
  const existing = registry.entries.find((entry) => spatialAssetVersionIdentity(entry) === identity);
  if (existing) {
    const same = stableHash(existing) === stableHash(assetRecord);
    return Object.freeze({
      schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION,
      action: same ? SPATIAL_ASSET_REGISTRATION_ACTION.NOOP_ALREADY_REGISTERED : SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_IDENTITY_CONFLICT,
      assetIdentity: identity,
      contentAddress,
      nextGeneration: registry.generation,
      errors: Object.freeze(same ? [] : ['asset-version-identity-already-exists-with-different-record']),
      authority,
    });
  }

  if (assetRecord.parentVersion !== null) {
    const parentIdentity = `${assetRecord.assetId}@${assetRecord.parentVersion}`;
    if (!registry.entries.some((entry) => spatialAssetVersionIdentity(entry) === parentIdentity)) {
      return Object.freeze({ schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION, action: SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_MISSING_PARENT, assetIdentity: identity, contentAddress, parentIdentity, errors: Object.freeze(['parent-version-not-registered']), authority });
    }
  }

  const knownAssetIds = registryAssetIds(registry.entries);
  const missingDependencies = assetRecord.dependencies.filter((dependency) => !knownAssetIds.has(dependency));
  if (missingDependencies.length > 0) {
    return Object.freeze({ schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION, action: SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_MISSING_DEPENDENCY, assetIdentity: identity, contentAddress, missingDependencies: Object.freeze([...missingDependencies].sort()), errors: Object.freeze(['asset-dependency-not-registered']), authority });
  }

  const candidate = Object.freeze({
    ...registry,
    generation: registry.generation + 1,
    entries: Object.freeze([...registry.entries, Object.freeze({ ...assetRecord })]),
  });
  const candidateValidation = validateSpatialAssetRegistry(candidate);
  if (!candidateValidation.valid) {
    const cycle = candidateValidation.errors.find((error) => error.startsWith('dependency-cycle:'));
    return Object.freeze({
      schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION,
      action: cycle ? SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_DEPENDENCY_CYCLE : SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_INVALID_REGISTRY,
      assetIdentity: identity,
      contentAddress,
      errors: candidateValidation.errors,
      authority,
    });
  }

  return Object.freeze({
    schemaVersion: SPATIAL_ASSET_REGISTRATION_PLAN_SCHEMA_VERSION,
    action: SPATIAL_ASSET_REGISTRATION_ACTION.REGISTER,
    assetIdentity: identity,
    contentHash: assetRecord.contentHash,
    contentAddress,
    currentGeneration: registry.generation,
    nextGeneration: registry.generation + 1,
    candidateRegistryHash: `sha256:${stableHash(candidate)}`,
    errors: Object.freeze([]),
    authority,
  });
}
