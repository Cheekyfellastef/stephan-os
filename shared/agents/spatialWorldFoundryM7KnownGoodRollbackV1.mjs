import { createHash } from 'node:crypto';

import {
  SPATIAL_ROLLBACK_SCOPES,
  SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION,
  validateSpatialWorldSnapshot,
} from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_M7_KNOWN_GOOD_SCHEMA = 'stephanos.spatial-world-foundry.m7-known-good-snapshot.v1';
export const SPATIAL_M7_ROLLBACK_PLAN_SCHEMA = 'stephanos.spatial-world-foundry.m7-rollback-plan.v1';

export const SPATIAL_M7_STATUS = Object.freeze({
  SNAPSHOT_READY: 'SPATIAL_M7_KNOWN_GOOD_SNAPSHOT_READY',
  ROLLBACK_READY: 'SPATIAL_M7_ROLLBACK_PLAN_READY',
  BLOCKED_INVALID_INPUT: 'SPATIAL_M7_BLOCKED_INVALID_INPUT',
  BLOCKED_NOT_KNOWN_GOOD: 'SPATIAL_M7_BLOCKED_TARGET_NOT_KNOWN_GOOD',
  BLOCKED_TARGET_MISMATCH: 'SPATIAL_M7_BLOCKED_TARGET_MISMATCH',
});

const SUPPORTED_ROLLBACK_SCOPES = new Set(['ASSET', 'REGION', 'WORLD_STATE']);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SNAPSHOT_INPUT_KEYS = [
  'planetId', 'scope', 'scopeId', 'worldStateVersion', 'sourceHead', 'worldManifestHash',
  'assetVersions', 'runtimeCompatibility', 'rollbackParentSnapshotId', 'proofRefs', 'createdAtUtc',
];
const ROLLBACK_INPUT_KEYS = ['currentSnapshot', 'targetSnapshot', 'scope', 'targetId', 'requestedAtUtc'];

function text(value, max = 1024) {
  return typeof value === 'string' && value === value.trim() && value.length > 0
    && value.length <= max && !CONTROL.test(value) ? value : '';
}
function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function exactKeys(value, expected) {
  if (!plain(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  const out = {};
  for (const [key, entry] of Object.entries(value)) out[key] = freeze(entry);
  return Object.freeze(out);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function timestamp(value) {
  const candidate = text(value, 64);
  const parsed = Date.parse(candidate);
  return candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate ? candidate : '';
}
function authority() {
  return freeze({
    snapshotWriteAllowed: false,
    rollbackExecutionAllowed: false,
    sourceMutationAllowed: false,
    assetMutationAllowed: false,
    registryMutationAllowed: false,
    promotionAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    worldMutationAllowed: false,
    headsetActionAllowed: false,
    arbitraryCommandAllowed: false,
    planOnly: true,
  });
}
function blocked(status, reasons) {
  return freeze({ schemaVersion: SPATIAL_M7_ROLLBACK_PLAN_SCHEMA, status, reasons: [...new Set(reasons)], authority: authority() });
}
function normalizeStrings(value) {
  if (!dense(value) || value.length === 0 || value.length > 128) return null;
  const entries = value.map((entry) => text(entry, 1024));
  if (entries.some((entry) => !entry) || new Set(entries).size !== entries.length) return null;
  return [...entries].sort();
}
function normalizeAssets(value) {
  if (!dense(value) || value.length === 0 || value.length > 512) return null;
  const result = [];
  const identities = new Set();
  for (const entry of value) {
    if (!exactKeys(entry, ['assetId', 'version', 'contentHash'])) return null;
    const assetId = text(entry.assetId, 128);
    const version = text(entry.version, 128);
    const contentHash = text(entry.contentHash, 71).toLowerCase();
    if (!SAFE_ID.test(assetId) || !SAFE_ID.test(version) || !HASH.test(contentHash) || identities.has(assetId)) return null;
    identities.add(assetId);
    result.push({ assetId, version, contentHash });
  }
  return result.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.version.localeCompare(b.version));
}

export function buildSpatialKnownGoodSnapshotV1(input = {}) {
  if (!exactKeys(input, SNAPSHOT_INPUT_KEYS)) {
    return freeze({ schemaVersion: SPATIAL_M7_KNOWN_GOOD_SCHEMA, status: SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT,
      reasons: ['snapshot-input-shape-invalid'], snapshot: null, authority: authority() });
  }
  const planetId = text(input.planetId, 128);
  const scopeId = text(input.scopeId, 128);
  const worldStateVersion = text(input.worldStateVersion, 128);
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  const worldManifestHash = text(input.worldManifestHash, 71).toLowerCase();
  const createdAtUtc = timestamp(input.createdAtUtc);
  const assetVersions = normalizeAssets(input.assetVersions);
  const runtimeCompatibility = normalizeStrings(input.runtimeCompatibility);
  const proofRefs = normalizeStrings(input.proofRefs);
  const parent = input.rollbackParentSnapshotId === null ? null : text(input.rollbackParentSnapshotId, 128);
  const reasons = [];

  if (!SAFE_ID.test(planetId) || !SAFE_ID.test(scopeId) || !SAFE_ID.test(worldStateVersion)) reasons.push('snapshot-identity-invalid');
  if (!SPATIAL_ROLLBACK_SCOPES.includes(input.scope)) reasons.push('snapshot-scope-invalid');
  if (input.scope === 'WORLD_STATE' && scopeId !== worldStateVersion) reasons.push('world-state-scope-id-must-match-version');
  if (!SHA.test(sourceHead)) reasons.push('snapshot-source-head-invalid');
  if (!HASH.test(worldManifestHash)) reasons.push('snapshot-world-manifest-hash-invalid');
  if (!assetVersions) reasons.push('snapshot-asset-versions-invalid');
  if (!runtimeCompatibility) reasons.push('snapshot-runtime-compatibility-invalid');
  if (!proofRefs) reasons.push('snapshot-proof-refs-invalid');
  if (!createdAtUtc) reasons.push('snapshot-created-at-invalid');
  if (input.rollbackParentSnapshotId !== null && !SAFE_ID.test(parent)) reasons.push('snapshot-parent-invalid');
  if (reasons.length) {
    return freeze({ schemaVersion: SPATIAL_M7_KNOWN_GOOD_SCHEMA, status: SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT,
      reasons, snapshot: null, authority: authority() });
  }

  const identityPayload = {
    planetId, scope: input.scope, scopeId, worldStateVersion, sourceHead, worldManifestHash,
    assetVersions, runtimeCompatibility, rollbackParentSnapshotId: parent, proofRefs, createdAtUtc,
  };
  const snapshotId = `snapshot.m7.${sha256(identityPayload).slice(0, 32)}`;
  const snapshot = {
    schemaVersion: SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION,
    snapshotId,
    planetId,
    scope: input.scope,
    scopeId,
    worldStateVersion,
    sourceHead,
    worldManifestHash,
    assetVersions,
    runtimeCompatibility,
    knownGood: true,
    rollbackParentSnapshotId: parent,
    proofRefs,
    createdAtUtc,
  };
  const validation = validateSpatialWorldSnapshot(snapshot);
  if (!validation.valid) {
    return freeze({ schemaVersion: SPATIAL_M7_KNOWN_GOOD_SCHEMA, status: SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT,
      reasons: validation.errors.map((entry) => `snapshot-contract:${entry}`), snapshot: null, authority: authority() });
  }
  return freeze({ schemaVersion: SPATIAL_M7_KNOWN_GOOD_SCHEMA, status: SPATIAL_M7_STATUS.SNAPSHOT_READY,
    reasons: [], snapshot, snapshotDigest: `sha256:${sha256(snapshot)}`, authority: authority() });
}

export function planSpatialRollbackV1(input = {}) {
  if (!exactKeys(input, ROLLBACK_INPUT_KEYS)) return blocked(SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT, ['rollback-input-shape-invalid']);
  const currentValidation = validateSpatialWorldSnapshot(input.currentSnapshot);
  const targetValidation = validateSpatialWorldSnapshot(input.targetSnapshot);
  const requestedAtUtc = timestamp(input.requestedAtUtc);
  const targetId = text(input.targetId, 128);
  if (!currentValidation.valid || !targetValidation.valid || !requestedAtUtc
    || !SUPPORTED_ROLLBACK_SCOPES.has(input.scope) || !SAFE_ID.test(targetId)) {
    return blocked(SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT, [
      ...currentValidation.errors.map((entry) => `current:${entry}`),
      ...targetValidation.errors.map((entry) => `target:${entry}`),
      ...(!requestedAtUtc ? ['requested-at-invalid'] : []),
      ...(!SUPPORTED_ROLLBACK_SCOPES.has(input.scope) ? ['rollback-scope-not-supported-in-m7-v1'] : []),
      ...(!SAFE_ID.test(targetId) ? ['rollback-target-id-invalid'] : []),
    ]);
  }

  const current = input.currentSnapshot;
  const target = input.targetSnapshot;
  if (target.knownGood !== true) return blocked(SPATIAL_M7_STATUS.BLOCKED_NOT_KNOWN_GOOD, ['target-snapshot-not-known-good']);
  if (current.planetId !== target.planetId || current.snapshotId === target.snapshotId) {
    return blocked(SPATIAL_M7_STATUS.BLOCKED_TARGET_MISMATCH, ['rollback-snapshot-lineage-or-planet-invalid']);
  }

  const reasons = [];
  let restoreAssetVersions = [];
  if (input.scope === 'ASSET') {
    const asset = target.assetVersions.find((entry) => entry.assetId === targetId);
    if (!asset) reasons.push('target-asset-not-present-in-known-good-snapshot');
    else restoreAssetVersions = [asset];
  } else if (input.scope === 'REGION') {
    if (target.scope !== 'REGION' || target.scopeId !== targetId) reasons.push('target-region-snapshot-mismatch');
    restoreAssetVersions = [...target.assetVersions];
  } else if (input.scope === 'WORLD_STATE') {
    if (target.scope !== 'WORLD_STATE' || target.scopeId !== targetId || target.worldStateVersion !== targetId) reasons.push('target-world-state-snapshot-mismatch');
    restoreAssetVersions = [...target.assetVersions];
  }
  if (reasons.length) return blocked(SPATIAL_M7_STATUS.BLOCKED_TARGET_MISMATCH, reasons);

  const core = {
    scope: input.scope,
    targetId,
    planetId: target.planetId,
    currentSnapshotId: current.snapshotId,
    targetSnapshotId: target.snapshotId,
    targetSourceHead: target.sourceHead,
    targetWorldStateVersion: target.worldStateVersion,
    targetWorldManifestHash: target.worldManifestHash,
    restoreAssetVersions: restoreAssetVersions.map((entry) => ({ ...entry })),
    runtimeCompatibility: [...target.runtimeCompatibility],
    proofRefs: [...target.proofRefs],
    requestedAtUtc,
  };
  const planId = `rollback.m7.${sha256(core).slice(0, 32)}`;
  return freeze({ schemaVersion: SPATIAL_M7_ROLLBACK_PLAN_SCHEMA, status: SPATIAL_M7_STATUS.ROLLBACK_READY,
    reasons: [], planId, ...core, authority: authority() });
}
