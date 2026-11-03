export const WORKSPACE_INTEGRITY_MESH_SCHEMA_V1 = 'stephanos.workspace-integrity-mesh.v1';
export const WORKSPACE_BINDING_PROVENANCE_SCHEMA_V1 = 'stephanos.workspace-binding-provenance.v1';

function text(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function bool(value) {
  return value === true;
}

function time(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function sameValue(a, b) {
  if (a === undefined || b === undefined) return null;
  if (a === null || b === null) return Object.is(a, b);
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

function normalizeState(value) {
  const state = text(value, 'UNKNOWN').toUpperCase();
  if (['READY', 'CURRENT', 'PASS', 'VERIFIED', 'GREEN'].includes(state)) return 'CURRENT';
  if (['STALE', 'DEGRADED', 'PARTIAL', 'AMBER'].includes(state)) return 'STALE';
  if (['FAILED', 'FAIL', 'BLOCKED', 'BROKEN', 'UNAVAILABLE', 'RED'].includes(state)) return 'BROKEN';
  return 'UNKNOWN';
}

export function buildWorkspaceDatasetProvenanceV1({
  workspaceId,
  datasetId,
  payload,
  state,
  expectedSchemaVersion = '',
  transportRoute = '/api/shared-workspace/hydrate',
  observedAtUtc = '',
} = {}) {
  return Object.freeze({
    schemaVersion: WORKSPACE_BINDING_PROVENANCE_SCHEMA_V1,
    workspaceId: text(workspaceId),
    componentId: `dataset:${text(datasetId, 'unknown')}`,
    componentKind: 'workspace-dataset',
    sourceId: text(datasetId),
    sourceSchemaVersion: text(payload?.schemaVersion),
    expectedSchemaVersion: text(expectedSchemaVersion),
    transportId: text(transportRoute),
    transformationId: 'workspace-hydration-bundle',
    consumerId: text(workspaceId),
    sourceState: normalizeState(state || payload?.state),
    sourceGeneratedAtUtc: text(
      payload?.generatedAtUtc
        || payload?.observedAtUtc
        || payload?.hydratedAtUtc
        || payload?.timestampUtc,
    ),
    observedAtUtc: text(observedAtUtc),
    sourceValuePresent: payload !== null && payload !== undefined,
    consumerRegistered: Boolean(text(workspaceId)),
    renderedValueObserved: false,
    syntheticProofCurrent: false,
    proofLevel: 'TRANSPORT_PROVEN_RENDER_PENDING',
  });
}

export function assessWorkspaceBindingV1(binding = {}, {
  nowMs = Date.now(),
  staleAfterMs = 5 * 60 * 1000,
} = {}) {
  const workspaceId = text(binding.workspaceId);
  const componentId = text(binding.componentId);
  const sourceId = text(binding.sourceId);
  const transportId = text(binding.transportId);
  const transformationId = text(binding.transformationId);
  const consumerId = text(binding.consumerId);
  const sourceSchemaVersion = text(binding.sourceSchemaVersion);
  const expectedSchemaVersion = text(binding.expectedSchemaVersion);
  const sourceUnit = text(binding.sourceUnit);
  const expectedUnit = text(binding.expectedUnit);
  const observedAt = time(binding.observedAtUtc || binding.sourceObservedAtUtc || binding.sourceGeneratedAtUtc);
  const ageMs = observedAt === null ? null : Math.max(0, nowMs - observedAt);
  const stale = ageMs === null || ageMs > staleAfterMs;
  const schemaMismatch = Boolean(sourceSchemaVersion && expectedSchemaVersion && sourceSchemaVersion !== expectedSchemaVersion);
  const unitMismatch = Boolean(sourceUnit && expectedUnit && sourceUnit !== expectedUnit);
  const reconciled = sameValue(binding.sourceValue, binding.renderedValue);
  const sourceState = normalizeState(binding.sourceState);
  const renderedValueObserved = bool(binding.renderedValueObserved) || binding.renderedValue !== undefined;
  const syntheticProofCurrent = bool(binding.syntheticProofCurrent);
  const consumerRegistered = binding.consumerRegistered !== false && Boolean(consumerId);
  const missingIdentity = !workspaceId || !componentId;
  const missingPath = !sourceId || !transportId || !transformationId || !consumerId;

  const hardFaults = [];
  if (missingIdentity) hardFaults.push('MISSING_STABLE_IDENTITY');
  if (missingPath) hardFaults.push('INCOMPLETE_PROVENANCE_PATH');
  if (!consumerRegistered) hardFaults.push('ORPHAN_CONSUMER');
  if (schemaMismatch) hardFaults.push('SCHEMA_MISMATCH');
  if (unitMismatch) hardFaults.push('UNIT_MISMATCH');
  if (sourceState === 'BROKEN') hardFaults.push('SOURCE_BROKEN');
  if (reconciled === false) hardFaults.push('SOURCE_RENDER_MISMATCH');

  const unknowns = [];
  if (!sourceSchemaVersion) unknowns.push('SOURCE_SCHEMA_UNKNOWN');
  if (!renderedValueObserved) unknowns.push('RENDERED_VALUE_UNOBSERVED');
  if (reconciled === null) unknowns.push('SOURCE_RENDER_RECONCILIATION_UNKNOWN');
  if (stale) unknowns.push(ageMs === null ? 'FRESHNESS_UNKNOWN' : 'EVIDENCE_STALE');
  if (!syntheticProofCurrent) unknowns.push('SYNTHETIC_PROOF_MISSING');
  if (sourceState === 'UNKNOWN') unknowns.push('SOURCE_STATE_UNKNOWN');

  const trafficLight = hardFaults.length ? 'RED' : unknowns.length ? 'AMBER' : 'GREEN';
  return Object.freeze({
    schemaVersion: WORKSPACE_BINDING_PROVENANCE_SCHEMA_V1,
    workspaceId,
    componentId,
    componentKind: text(binding.componentKind, 'visual-component'),
    sourceId,
    transportId,
    transformationId,
    consumerId,
    sourceSchemaVersion,
    expectedSchemaVersion,
    sourceUnit,
    expectedUnit,
    sourceState,
    observedAtUtc: text(binding.observedAtUtc || binding.sourceObservedAtUtc || binding.sourceGeneratedAtUtc),
    ageMs,
    fresh: !stale,
    renderedValueObserved,
    reconciled,
    syntheticProofCurrent,
    consumerRegistered,
    trafficLight,
    hardFaults: Object.freeze(hardFaults),
    unknowns: Object.freeze(unknowns),
    provenEndToEnd: trafficLight === 'GREEN',
    exactNextAction: hardFaults[0]
      ? `Repair ${hardFaults[0]} for ${workspaceId || 'unknown-workspace'}/${componentId || 'unknown-component'} through the existing canonical owner.`
      : unknowns[0]
        ? `Collect ${unknowns[0]} proof for ${workspaceId || 'unknown-workspace'}/${componentId || 'unknown-component'}; do not claim green yet.`
        : 'Keep the binding under continuous proof and regression monitoring.',
  });
}

export function buildWorkspaceIntegrityMeshV1({
  bindings = [],
  importantSources = [],
  nowMs = Date.now(),
  staleAfterMs = 5 * 60 * 1000,
} = {}) {
  const assessed = (Array.isArray(bindings) ? bindings : [])
    .map((binding) => assessWorkspaceBindingV1(binding, { nowMs, staleAfterMs }));
  const consumedSources = new Set(assessed.map((entry) => entry.sourceId).filter(Boolean));
  const unconsumedImportantSources = (Array.isArray(importantSources) ? importantSources : [])
    .map((source) => typeof source === 'string' ? source : source?.sourceId)
    .map((sourceId) => text(sourceId))
    .filter((sourceId) => sourceId && !consumedSources.has(sourceId));
  const green = assessed.filter((entry) => entry.trafficLight === 'GREEN').length;
  const amber = assessed.filter((entry) => entry.trafficLight === 'AMBER').length;
  const red = assessed.filter((entry) => entry.trafficLight === 'RED').length;
  const orphaned = assessed.filter((entry) => entry.hardFaults.includes('ORPHAN_CONSUMER')).length;
  const total = assessed.length;
  return Object.freeze({
    schemaVersion: WORKSPACE_INTEGRITY_MESH_SCHEMA_V1,
    readOnly: true,
    observedBindingCount: total,
    green,
    amber,
    red,
    orphaned,
    unknown: amber,
    unconsumedImportantSources: Object.freeze(unconsumedImportantSources),
    integrityPercent: total ? Math.round((green / total) * 100) : 0,
    bindings: Object.freeze(assessed),
    finalVerdict: red || unconsumedImportantSources.length
      ? 'WORKSPACE_INTEGRITY_BROKEN'
      : amber
        ? 'WORKSPACE_INTEGRITY_PROOF_INCOMPLETE'
        : total
          ? 'WORKSPACE_INTEGRITY_PROVEN'
          : 'WORKSPACE_INTEGRITY_UNKNOWN',
    exactNextAction: assessed.find((entry) => entry.trafficLight === 'RED')?.exactNextAction
      || (unconsumedImportantSources[0]
        ? `Bind important source ${unconsumedImportantSources[0]} to its intended workspace consumer or explicitly retire it.`
        : assessed.find((entry) => entry.trafficLight === 'AMBER')?.exactNextAction
          || 'Keep all bindings under continuous proof and regression monitoring.'),
  });
}
