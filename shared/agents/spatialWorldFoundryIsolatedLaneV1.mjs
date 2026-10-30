import { createHash } from 'node:crypto';

import { evaluateConstructionLaneAdmission } from './boundedParallelConstructionLanesV1.mjs';
import { validateSpatialBuildOrder } from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_ISOLATED_LANE_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.isolated-lane.v1';
export const SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.isolated-lane-plan.v1';

export const SPATIAL_ISOLATED_LANE_STATUSES = Object.freeze([
  'ADMITTED_TO_CANONICAL_LEASE_AUTHORITY',
  'WAITING_FOR_RESOURCE_LEASE',
  'BLOCKED_INVALID_BUILD_ORDER',
  'BLOCKED_INVALID_SOURCE_IDENTITY',
  'BLOCKED_INVALID_LANE_IDENTITY',
  'BLOCKED_CONSTRUCTION_INVENTORY',
]);

const SHA = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const FORBIDDEN_PRODUCT_CAPABILITIES = new Set(['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function sourceIdentity(input = {}) {
  const baseSha = text(input.baseSha).toLowerCase();
  const headSha = text(input.headSha).toLowerCase();
  return {
    valid: SHA.test(baseSha) && SHA.test(headSha),
    baseSha,
    headSha,
  };
}

function logicalResourceContracts(buildOrder = {}) {
  return [...new Set(list(buildOrder.ownedResourceScopes).map((scope) => `spatial-resource:${scope.toLowerCase()}`))].sort();
}

export function createSpatialIsolatedLaneCandidate(buildOrder = {}, input = {}) {
  const buildOrderValidation = validateSpatialBuildOrder(buildOrder);
  if (!buildOrderValidation.valid) {
    return freeze({
      valid:false,
      status:'BLOCKED_INVALID_BUILD_ORDER',
      errors:buildOrderValidation.errors,
      candidate:null,
    });
  }

  const identity = sourceIdentity(input);
  if (!identity.valid) {
    return freeze({ valid:false, status:'BLOCKED_INVALID_SOURCE_IDENTITY', errors:['exact-base-and-head-required'], candidate:null });
  }

  const branch = text(input.branch);
  if (!SAFE_BRANCH.test(branch) || branch.includes('..')) {
    return freeze({ valid:false, status:'BLOCKED_INVALID_LANE_IDENTITY', errors:['branch-invalid'], candidate:null });
  }

  const fingerprint = stableHash({
    spatialBuildOrderId:buildOrder.spatialBuildOrderId,
    planetId:buildOrder.planetId,
    regionId:buildOrder.regionId,
    resourceScopes:logicalResourceContracts(buildOrder),
    baseSha:identity.baseSha,
    branch,
  });
  const laneId = `spatial-${fingerprint.slice(0, 20)}`;
  const goalId = `spatial-goal-${fingerprint.slice(0, 16)}`;
  const sandboxId = `spatial-sandbox-${fingerprint.slice(0, 20)}`;
  if (!SAFE_ID.test(laneId) || !SAFE_ID.test(goalId) || !SAFE_ID.test(sandboxId)) {
    return freeze({ valid:false, status:'BLOCKED_INVALID_LANE_IDENTITY', errors:['derived-lane-identity-invalid'], candidate:null });
  }

  const requestedCapabilities = list(input.capabilities).length > 0
    ? list(input.capabilities).map((value) => value.toUpperCase())
    : ['SPATIAL_SANDBOX_WRITE', 'ASSET_GENERATE', 'RUN_VALIDATION'];
  if (requestedCapabilities.some((capability) => FORBIDDEN_PRODUCT_CAPABILITIES.has(capability))) {
    return freeze({ valid:false, status:'BLOCKED_INVALID_LANE_IDENTITY', errors:['authority-bearing-capability-forbidden'], candidate:null });
  }

  const candidate = freeze({
    id:laneId,
    goalId,
    branch,
    baseSha:identity.baseSha,
    headSha:identity.headSha,
    state:'ADMITTED',
    ownership:{
      paths:[],
      contracts:logicalResourceContracts(buildOrder),
    },
    capabilities:[...new Set(requestedCapabilities)].sort(),
    dependencies:[...new Set(list(input.laneDependencies))].sort(),
    heartbeatAt:text(input.heartbeatAt),
  });

  return freeze({
    valid:true,
    status:'WAITING_FOR_RESOURCE_LEASE',
    errors:[],
    sandboxId,
    canonicalGoal:'#1760',
    spatialBuildOrderId:buildOrder.spatialBuildOrderId,
    resourceScopes:logicalResourceContracts(buildOrder),
    candidate,
  });
}

export function planSpatialIsolatedLaneAdmission(buildOrder = {}, input = {}) {
  const prepared = createSpatialIsolatedLaneCandidate(buildOrder, input);
  const authority = freeze({
    directWorkspaceWriteAllowed:false,
    sourceMutationAllowed:false,
    leaseIssueAllowed:false,
    leaseSeizureAllowed:false,
    mergeAllowed:false,
    deploymentAllowed:false,
    runtimeMutationAllowed:false,
    voiceExecutionAllowed:false,
  });
  if (!prepared.valid) {
    return freeze({
      schemaVersion:SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION,
      status:prepared.status,
      spatialBuildOrderId:text(buildOrder.spatialBuildOrderId),
      errors:prepared.errors,
      authority,
    });
  }

  const inventorySnapshot = input.inventorySnapshot;
  if (!inventorySnapshot || typeof inventorySnapshot !== 'object' || Array.isArray(inventorySnapshot)) {
    return freeze({
      schemaVersion:SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION,
      status:'BLOCKED_CONSTRUCTION_INVENTORY',
      spatialBuildOrderId:buildOrder.spatialBuildOrderId,
      sandboxId:prepared.sandboxId,
      resourceScopes:prepared.resourceScopes,
      errors:['canonical-construction-inventory-required'],
      authority,
    });
  }

  const admission = evaluateConstructionLaneAdmission(
    prepared.candidate,
    inventorySnapshot,
    Number.isSafeInteger(input.maxLanes) ? { maxLanes:input.maxLanes } : {},
  );
  const admitted = admission.status === 'ADMITTED';
  return freeze({
    schemaVersion:SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION,
    status:admitted ? 'ADMITTED_TO_CANONICAL_LEASE_AUTHORITY' : 'WAITING_FOR_RESOURCE_LEASE',
    spatialBuildOrderId:buildOrder.spatialBuildOrderId,
    sandboxId:prepared.sandboxId,
    canonicalGoal:'#1760',
    laneId:prepared.candidate.id,
    branch:prepared.candidate.branch,
    baseSha:prepared.candidate.baseSha,
    headSha:prepared.candidate.headSha,
    resourceScopes:prepared.resourceScopes,
    canonicalAdmission:admission,
    leaseIssueRequired:true,
    requiredLeaseSchema:'Stephanos Bounded Construction Lease V1',
    mayBeginAgentWrites:false,
    errors:admission.reasonCodes,
    authority,
  });
}

export function assertSpatialAgentWriteMayBegin(plan = {}, lease = {}, options = {}) {
  if (plan?.schemaVersion !== SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION
    || plan.status !== 'ADMITTED_TO_CANONICAL_LEASE_AUTHORITY'
    || plan.leaseIssueRequired !== true
    || plan.mayBeginAgentWrites !== false) {
    throw new TypeError('spatial lane must first be admitted to the canonical lease authority');
  }
  const expiresAtMs = Date.parse(text(lease?.expiresAt));
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (lease?.schema !== 'Stephanos Bounded Construction Lease V1'
    || lease.laneId !== plan.laneId
    || lease.branch !== plan.branch
    || String(lease.baseSha || '').toLowerCase() !== plan.baseSha
    || String(lease.headSha || '').toLowerCase() !== plan.headSha
    || lease.mergeAuthority !== false
    || lease.deploymentAuthority !== false
    || lease.approvalAuthority !== false
    || lease.leaseSeizureAllowed !== false
    || lease.runtimeMutationAllowed !== false
    || !Array.isArray(lease.ownedContracts)
    || JSON.stringify([...lease.ownedContracts].sort()) !== JSON.stringify([...plan.resourceScopes].sort())
    || !text(lease.reservationId)
    || !Number.isFinite(expiresAtMs)
    || !Number.isFinite(nowMs)
    || expiresAtMs <= nowMs) {
    throw new TypeError('exact active canonical construction lease required before spatial agent writes');
  }
  return freeze({
    allowed:true,
    verdict:'SPATIAL_AGENT_WRITE_LEASE_BOUND',
    spatialBuildOrderId:plan.spatialBuildOrderId,
    sandboxId:plan.sandboxId,
    laneId:plan.laneId,
    reservationId:lease.reservationId,
    expiresAt:lease.expiresAt,
    resourceScopes:plan.resourceScopes,
    mergeAuthority:false,
    deploymentAuthority:false,
    runtimeMutationAllowed:false,
  });
}
