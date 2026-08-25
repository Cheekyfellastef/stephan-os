import { CODEX_AVAILABILITY } from './codexCapacityGovernorV1.mjs';
import {
  validateBuildLaneCapacityAuthorityChain,
  validateBuildLaneCapacityReceipt,
} from './missionControllerCapacityRouterV1.mjs';
import { adjudicateForgeSidecarCapacity } from './stallSentinelReviewPipelineV1.mjs';

export const SOVEREIGNTY_WORKSPACE_SCHEMA_VERSION = 'stephanos.sovereignty-workspace-projection.v1';
export const SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION = 'stephanos.sovereignty-system-observation.v1';
export const SOVEREIGNTY_CAPABILITY_SCHEMA_VERSION = 'stephanos.sovereignty-capability-dependency.v1';

export const SOVEREIGNTY_TRUTH_STATES = Object.freeze(['CURRENT', 'STALE', 'UNKNOWN', 'CONFLICTING']);
export const SOVEREIGNTY_CAPACITY_STATES = Object.freeze(['AVAILABLE_NOW', 'CONSTRAINED', 'UNAVAILABLE', 'UNKNOWN']);
export const SOVEREIGNTY_CAPABILITY_POSTURES = Object.freeze(['DIVERSIFIED', 'CONCENTRATED', 'SINGLE_POINT', 'UNKNOWN']);
export const SOVEREIGNTY_CRITICALITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
const DEFAULT_REPOSITORY = 'Cheekyfellastef/stephan-os';
const DEFAULT_BUILD_TASK_CLASS = 'FOCUSED_REPAIR';
const CRITICALITY_WEIGHT = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });
const AUTHORITY_KEYS = Object.freeze([
  'installAllowed',
  'purchaseAllowed',
  'subscriptionAllowed',
  'credentialChangeAllowed',
  'providerAccountMutationAllowed',
  'sourceMutationAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'spendAllowed',
  'routingMutationAllowed',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function canonicalProviderId(value) {
  const normalized = text(value).toLowerCase();
  return SAFE_ID.test(normalized) ? normalized : '';
}

function timestampMs(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function proofRefs(value) {
  if (!denseArray(value)) return null;
  const normalized = value.map(text);
  if (normalized.some((ref) => !SAFE_PROOF_REF.test(ref) || ref.includes('..'))) return null;
  return normalized.length === new Set(normalized).size ? normalized : null;
}

function boundedNumber(value, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= minimum && normalized <= maximum ? normalized : undefined;
}

function authorityBoundary() {
  return Object.freeze({
    installAllowed: false,
    purchaseAllowed: false,
    subscriptionAllowed: false,
    credentialChangeAllowed: false,
    providerAccountMutationAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    spendAllowed: false,
    routingMutationAllowed: false,
    authoritySource: 'EXISTING_GOVERNED_OPERATOR_AND_CONTROLLER_CONTRACTS_ONLY',
  });
}

function normalizeMetrics(metrics = {}, errors, prefix) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    errors.push(`${prefix}metrics-must-be-object`);
    return null;
  }
  const allowed = new Set([
    'remainingPercent', 'queueDepth', 'p95StartLatencySeconds', 'throughputPerHour',
    'failureRatePercent', 'costPerUsefulResult', 'criticalPathSharePercent',
  ]);
  for (const key of Object.keys(metrics)) if (!allowed.has(key)) errors.push(`${prefix}metrics-unknown-field:${key}`);
  const normalized = {
    remainingPercent: boundedNumber(metrics.remainingPercent, 0, 100),
    queueDepth: boundedNumber(metrics.queueDepth, 0, 100000),
    p95StartLatencySeconds: boundedNumber(metrics.p95StartLatencySeconds, 0, 7 * 24 * 60 * 60),
    throughputPerHour: boundedNumber(metrics.throughputPerHour, 0, 1000000),
    failureRatePercent: boundedNumber(metrics.failureRatePercent, 0, 100),
    costPerUsefulResult: boundedNumber(metrics.costPerUsefulResult, 0, 1000000000),
    criticalPathSharePercent: boundedNumber(metrics.criticalPathSharePercent, 0, 100),
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) errors.push(`${prefix}metrics-${key}-invalid`);
  }
  return Object.freeze(Object.fromEntries(Object.entries(normalized).map(([key, value]) => [key, value ?? null])));
}

export function validateSovereigntySystemObservationV1(observation = {}, options = {}) {
  const errors = [];
  if (observation.schemaVersion !== SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['systemId', 'systemClass', 'sourceKind']) if (!safeId(observation[field])) errors.push(`${field}-invalid`);
  const providerId = canonicalProviderId(observation.providerId);
  if (!providerId) errors.push('providerId-invalid');
  const observedAtMs = timestampMs(observation.observedAtUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');
  const declaredTruth = text(observation.truthState).toUpperCase();
  if (!SOVEREIGNTY_TRUTH_STATES.includes(declaredTruth)) errors.push('truthState-invalid');
  const declaredCapacity = text(observation.capacityState).toUpperCase();
  if (!SOVEREIGNTY_CAPACITY_STATES.includes(declaredCapacity)) errors.push('capacityState-invalid');
  const refs = proofRefs(observation.evidenceRefs);
  if (refs === null) errors.push('evidenceRefs-invalid');
  if (declaredTruth === 'CURRENT' && refs?.length === 0) errors.push('current-observation-requires-evidence');
  const metrics = normalizeMetrics(observation.metrics || {}, errors, '');
  for (const key of AUTHORITY_KEYS) if (observation[key] === true) errors.push(`authority-widening-forbidden:${key}`);

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(options.staleAfterMs) && options.staleAfterMs >= 0 ? options.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  let effectiveTruthState = declaredTruth;
  if (observedAtMs !== null && observedAtMs > nowMs) effectiveTruthState = 'UNKNOWN';
  else if (declaredTruth === 'CURRENT' && observedAtMs !== null && nowMs - observedAtMs > staleAfterMs) effectiveTruthState = 'STALE';

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    normalized: errors.length === 0 ? Object.freeze({
      schemaVersion: SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION,
      systemId: text(observation.systemId),
      providerId,
      systemClass: text(observation.systemClass),
      sourceKind: text(observation.sourceKind),
      observedAtUtc: text(observation.observedAtUtc),
      declaredTruthState: declaredTruth,
      truthState: effectiveTruthState,
      capacityState: effectiveTruthState === 'CURRENT' ? declaredCapacity : 'UNKNOWN',
      evidenceRefs: Object.freeze(refs || []),
      metrics,
      explanation: text(observation.explanation),
      authority: authorityBoundary(),
    }) : null,
  });
}

export function validateSovereigntyCapabilityV1(capability = {}) {
  const errors = [];
  if (capability.schemaVersion !== SOVEREIGNTY_CAPABILITY_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (!safeId(capability.capabilityId)) errors.push('capabilityId-invalid');
  if (!safeId(capability.primarySystemId)) errors.push('primarySystemId-invalid');
  const alternatives = denseArray(capability.alternativeSystemIds) ? capability.alternativeSystemIds.map(text) : null;
  if (!alternatives) errors.push('alternativeSystemIds-must-be-dense-array');
  else {
    if (alternatives.some((id) => !safeId(id))) errors.push('alternativeSystemIds-contains-invalid-id');
    if (new Set(alternatives).size !== alternatives.length) errors.push('alternativeSystemIds-contains-duplicate');
    if (alternatives.includes(text(capability.primarySystemId))) errors.push('alternativeSystemIds-contains-primary');
  }
  for (const field of ['localFallbackSystemId', 'nativeOptionSystemId']) {
    if (capability[field] !== null && !safeId(capability[field])) errors.push(`${field}-invalid`);
  }
  const criticality = text(capability.criticality).toUpperCase();
  if (!SOVEREIGNTY_CRITICALITIES.includes(criticality)) errors.push('criticality-invalid');
  const refs = proofRefs(capability.evidenceRefs);
  if (refs === null || refs.length === 0) errors.push('capability-evidence-required');
  for (const key of AUTHORITY_KEYS) if (capability[key] === true) errors.push(`authority-widening-forbidden:${key}`);
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    normalized: errors.length === 0 ? Object.freeze({
      schemaVersion: SOVEREIGNTY_CAPABILITY_SCHEMA_VERSION,
      capabilityId: text(capability.capabilityId),
      primarySystemId: text(capability.primarySystemId),
      alternativeSystemIds: Object.freeze(alternatives),
      localFallbackSystemId: capability.localFallbackSystemId === null ? null : text(capability.localFallbackSystemId),
      nativeOptionSystemId: capability.nativeOptionSystemId === null ? null : text(capability.nativeOptionSystemId),
      criticality,
      evidenceRefs: Object.freeze(refs),
      authority: authorityBoundary(),
    }) : null,
  });
}

function referencedSystemIds(capability) {
  return [...new Set([
    capability.primarySystemId,
    ...capability.alternativeSystemIds,
    capability.localFallbackSystemId,
    capability.nativeOptionSystemId,
  ].filter(Boolean))];
}

function usableSystem(system) {
  return system?.truthState === 'CURRENT'
    && ['AVAILABLE_NOW', 'CONSTRAINED'].includes(system.capacityState);
}

function capabilityPosture(capability, systemsById) {
  const ids = referencedSystemIds(capability);
  const observed = ids.map((id) => systemsById.get(id)).filter(Boolean);
  const viable = observed.filter(usableSystem);
  const viableProviderIds = [...new Set(viable.map((system) => system.providerId))];
  const declaredProviderIds = [...new Set(observed.map((system) => system.providerId))];
  const missing = ids.filter((id) => !systemsById.has(id));
  const primary = systemsById.get(capability.primarySystemId);
  let posture = 'UNKNOWN';
  if (usableSystem(primary)) {
    if (ids.length === 1) posture = 'SINGLE_POINT';
    else if (viableProviderIds.length >= 2) posture = 'DIVERSIFIED';
    else posture = 'CONCENTRATED';
  }
  return Object.freeze({
    capabilityId: capability.capabilityId,
    criticality: capability.criticality,
    posture,
    primarySystemId: capability.primarySystemId,
    declaredSystemCount: ids.length,
    currentViableSystemCount: viable.length,
    currentViableProviderCount: viableProviderIds.length,
    declaredProviderCount: declaredProviderIds.length,
    missingObservationSystemIds: Object.freeze(missing),
    currentViableSystemIds: Object.freeze(viable.map((system) => system.systemId)),
    explanation: posture === 'DIVERSIFIED'
      ? `${capability.capabilityId} has at least two independently declared systems with current usable evidence.`
      : posture === 'SINGLE_POINT'
        ? `${capability.capabilityId} declares only one system, so that system is a visible single point of failure.`
        : posture === 'CONCENTRATED'
          ? `${capability.capabilityId} declares alternatives, but fewer than two currently have usable evidence.`
          : `${capability.capabilityId} cannot be scored because the primary system lacks current usable capacity evidence.`,
  });
}

export function buildSovereigntyWorkspaceProjectionV1(input = {}, options = {}) {
  const errors = [];
  const rawSystems = denseArray(input.systemObservations) ? input.systemObservations : [];
  const rawCapabilities = denseArray(input.capabilities) ? input.capabilities : [];
  if (!denseArray(input.systemObservations)) errors.push('systemObservations-must-be-dense-array');
  if (!denseArray(input.capabilities) || rawCapabilities.length === 0) errors.push('capabilities-must-be-non-empty-dense-array');
  const systems = [];
  for (let index = 0; index < rawSystems.length; index += 1) {
    const validation = validateSovereigntySystemObservationV1(rawSystems[index], options);
    errors.push(...validation.errors.map((error) => `system-${index + 1}:${error}`));
    if (validation.valid) systems.push(validation.normalized);
  }
  const capabilities = [];
  for (let index = 0; index < rawCapabilities.length; index += 1) {
    const validation = validateSovereigntyCapabilityV1(rawCapabilities[index]);
    errors.push(...validation.errors.map((error) => `capability-${index + 1}:${error}`));
    if (validation.valid) capabilities.push(validation.normalized);
  }
  const systemIds = systems.map((system) => system.systemId);
  const capabilityIds = capabilities.map((capability) => capability.capabilityId);
  if (new Set(systemIds).size !== systemIds.length) errors.push('systemObservations-duplicate-systemId');
  if (new Set(capabilityIds).size !== capabilityIds.length) errors.push('capabilities-duplicate-capabilityId');
  const systemsById = new Map(systems.map((system) => [system.systemId, system]));
  for (const capability of capabilities) {
    if (!systemsById.has(capability.primarySystemId)) errors.push(`capability-primary-system-unobserved:${capability.capabilityId}`);
  }
  for (const key of AUTHORITY_KEYS) if (input[key] === true) errors.push(`authority-widening-forbidden:${key}`);

  if (errors.length > 0) {
    return Object.freeze({
      schemaVersion: SOVEREIGNTY_WORKSPACE_SCHEMA_VERSION,
      status: 'UNKNOWN',
      reason: errors[0],
      errors: Object.freeze(errors),
      authority: authorityBoundary(),
    });
  }

  const capabilityPostures = Object.freeze(capabilities.map((capability) => capabilityPosture(capability, systemsById)));
  const knownPostures = capabilityPostures.filter((item) => item.posture !== 'UNKNOWN');
  const totalWeight = capabilities.reduce((sum, capability) => sum + CRITICALITY_WEIGHT[capability.criticality], 0);
  const knownWeight = knownPostures.reduce((sum, posture) => sum + CRITICALITY_WEIGHT[posture.criticality], 0);
  const diversifiedWeight = knownPostures.filter((item) => item.posture === 'DIVERSIFIED')
    .reduce((sum, posture) => sum + CRITICALITY_WEIGHT[posture.criticality], 0);
  const evidenceCoveragePercent = totalWeight === 0 ? null : Math.round((knownWeight / totalWeight) * 10000) / 100;
  const diversificationCoveragePercent = knownWeight === 0 ? null : Math.round((diversifiedWeight / knownWeight) * 10000) / 100;
  const posture = capabilityPostures.some((item) => item.posture === 'UNKNOWN')
    ? 'UNKNOWN'
    : capabilityPostures.some((item) => item.posture === 'SINGLE_POINT')
      ? 'SINGLE_POINT'
      : capabilityPostures.some((item) => item.posture === 'CONCENTRATED')
        ? 'CONCENTRATED'
        : 'DIVERSIFIED';

  return Object.freeze({
    schemaVersion: SOVEREIGNTY_WORKSPACE_SCHEMA_VERSION,
    status: 'CURRENT',
    reason: 'SOVEREIGNTY_TRUTH_MODEL_PROJECTED',
    posture,
    evidenceCoveragePercent,
    diversificationCoveragePercent,
    scoreExplanation: diversificationCoveragePercent === null
      ? 'Diversification coverage is withheld because no capability has current usable primary-system capacity evidence.'
      : `Diversification coverage is ${diversificationCoveragePercent}% of criticality weight among capabilities with current usable primary-system capacity evidence; evidence coverage is ${evidenceCoveragePercent}% of total declared criticality weight.`,
    systems: Object.freeze(systems),
    capabilities: Object.freeze(capabilities),
    capabilityPostures,
    currentBottlenecks: Object.freeze(capabilityPostures.filter((item) => ['SINGLE_POINT', 'CONCENTRATED', 'UNKNOWN'].includes(item.posture))),
    operatorNeeded: false,
    operatorAction: 'NO_OPERATOR_ACTION_REQUIRED',
    authority: authorityBoundary(),
  });
}

function unknownBuildLaneMetrics() {
  return {
    remainingPercent: null,
    queueDepth: null,
    p95StartLatencySeconds: null,
    throughputPerHour: null,
    failureRatePercent: null,
    costPerUsefulResult: null,
    criticalPathSharePercent: null,
  };
}

function forgeAuthorityBound(receipt, expectedRoute, authority) {
  if (expectedRoute === 'CHATGPT_GITHUB') return authority?.valid === true;
  if (expectedRoute !== 'FOUNDRY_FORGE') return false;
  return authority?.canCarryRealWork === true
    && text(authority.m2ReceiptId) !== ''
    && text(authority.m3RuntimeReceiptId) !== ''
    && denseArray(receipt?.authorityReceiptIds)
    && receipt.authorityReceiptIds.includes(authority.m2ReceiptId)
    && receipt.authorityReceiptIds.includes(authority.m3RuntimeReceiptId);
}

function normalizeBuildLaneStatus(status, expectedStatusId, expectedRoute, systemId, providerId, systemClass, nowMs, authority = null) {
  const receipt = status?.capacityReceipt;
  const nowUtc = new Date(nowMs).toISOString();
  const validation = validateBuildLaneCapacityReceipt(receipt, {
    repository: DEFAULT_REPOSITORY,
    taskClass: DEFAULT_BUILD_TASK_CLASS,
    nowUtc,
  });
  const observedAtMs = timestampMs(receipt?.observedAtUtc);
  const authorityBound = forgeAuthorityBound(receipt, expectedRoute, authority);
  const current = status?.schemaVersion === 'shared-agent-workspace-record.v1'
    && status?.statusId === expectedStatusId
    && observedAtMs !== null
    && observedAtMs <= nowMs
    && validation.valid
    && validation.route === expectedRoute
    && authorityBound;
  const refs = current ? proofRefs(receipt.proofRefs) || [] : [];
  const explanation = current
    ? `${systemId} has a canonical fresh bounded focused-repair capacity receipt.`
    : expectedRoute === 'FOUNDRY_FORGE' && !authorityBound
      ? `${systemId} capacity is UNKNOWN because Forge M2 and M3 runtime authority is unproven or not bound into the lane receipt.`
      : `${systemId} capacity is UNKNOWN because the canonical build-lane receipt did not validate.`;
  return {
    schemaVersion: SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION,
    systemId,
    providerId: canonicalProviderId(providerId),
    systemClass,
    sourceKind: 'BUILD_LANE_CAPACITY_RECEIPT',
    observedAtUtc: current ? receipt.observedAtUtc : new Date(0).toISOString(),
    truthState: current ? 'CURRENT' : 'UNKNOWN',
    capacityState: current ? (receipt.queueDepth === 0 && receipt.p95StartLatencySeconds <= 60 ? 'AVAILABLE_NOW' : 'CONSTRAINED') : 'UNKNOWN',
    evidenceRefs: refs,
    metrics: current ? {
      ...unknownBuildLaneMetrics(),
      queueDepth: receipt.queueDepth,
      p95StartLatencySeconds: receipt.p95StartLatencySeconds,
    } : unknownBuildLaneMetrics(),
    explanation,
  };
}

export function createSovereigntyCapacityObservationsV1(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nowUtc = new Date(nowMs).toISOString();
  const codex = input.codexStatus || {};
  const codexRefs = proofRefs(codex.proofRefs) || [];
  const codexObservedMs = timestampMs(codex.observedAtUtc);
  const remaining = boundedNumber(codex.remainingPercent, 0, 100);
  const availability = text(codex.availability).toUpperCase();
  const availabilityValid = Object.values(CODEX_AVAILABILITY).includes(availability);
  const codexCurrent = codex.schemaVersion === 'shared-agent-workspace-record.v1'
    && codex.statusId === 'codex-capacity-current'
    && codex.truthState === 'CURRENT'
    && codex.meterTruthUsable === true
    && codexObservedMs !== null
    && codexObservedMs <= nowMs
    && nowMs - codexObservedMs <= 15 * 60 * 1000
    && codexRefs.length > 0
    && remaining !== undefined
    && remaining !== null
    && availabilityValid;
  const codexCapacityState = !codexCurrent
    ? 'UNKNOWN'
    : availability === CODEX_AVAILABILITY.AVAILABLE && remaining > 5
      ? 'AVAILABLE_NOW'
      : [CODEX_AVAILABILITY.AVAILABLE, CODEX_AVAILABILITY.BUSY, CODEX_AVAILABILITY.DEGRADED].includes(availability)
        ? 'CONSTRAINED'
        : [CODEX_AVAILABILITY.UNAVAILABLE, CODEX_AVAILABILITY.METER_STALLED].includes(availability)
          ? 'UNAVAILABLE'
          : 'UNKNOWN';
  const forgeAuthority = adjudicateForgeSidecarCapacity(input.forgeSidecar, { nowUtc });
  const githubAuthority = validateBuildLaneCapacityAuthorityChain(
    input.githubLaneStatus?.capacityReceipt,
    input.githubLaneAuthorityReceipts,
    {
      sourceHead: input.sourceHead,
      taskClass: DEFAULT_BUILD_TASK_CLASS,
      nowUtc,
    },
  );
  return Object.freeze([
    Object.freeze({
      schemaVersion: SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION,
      systemId: 'openai-codex',
      providerId: 'openai',
      systemClass: 'EXTERNAL_AGENTIC_CAPACITY',
      sourceKind: 'CODEX_CAPACITY_STATUS',
      observedAtUtc: text(codex.observedAtUtc) || new Date(0).toISOString(),
      truthState: codexCurrent ? 'CURRENT' : 'UNKNOWN',
      capacityState: codexCapacityState,
      evidenceRefs: Object.freeze(codexCurrent ? codexRefs : []),
      metrics: Object.freeze({
        remainingPercent: codexCurrent ? remaining : null,
        queueDepth: null,
        p95StartLatencySeconds: null,
        throughputPerHour: null,
        failureRatePercent: null,
        costPerUsefulResult: null,
        criticalPathSharePercent: null,
      }),
      explanation: codexCurrent ? 'Codex capacity is derived from the canonical authenticated meter publication.' : 'Codex capacity is UNKNOWN because canonical fresh well-formed meter evidence is unavailable.',
    }),
    Object.freeze(normalizeBuildLaneStatus(input.githubLaneStatus, 'chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', 'chatgpt-github', 'github', 'HOSTED_BUILD_LANE', nowMs, githubAuthority)),
    Object.freeze(normalizeBuildLaneStatus(input.forgeLaneStatus, 'foundry-forge-build-capacity-current', 'FOUNDRY_FORGE', 'foundry-forge', 'stephanos-local', 'LOCAL_OR_SELF_HOSTED_BUILD_LANE', nowMs, forgeAuthority)),
  ]);
}
