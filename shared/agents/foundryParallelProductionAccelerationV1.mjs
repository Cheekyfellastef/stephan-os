const SHA_RE = /^[a-f0-9]{40}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._:/-]{0,239}$/i;
const SAFE_REPOSITORY_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const EXPLICIT_TZ_RE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const SAFE_RECEIPT_PREFIXES = ['receipts/', 'evidence/receipts/', 'proofs/'];
const PROVIDER_STATES = new Set(['READY', 'BUSY', 'BLOCKED', 'UNKNOWN', 'QUARANTINED']);
const MAX_PROVIDERS = 16;
const MAX_CANDIDATES = 256;
const MAX_RESOURCES = 128;
const MAX_CAPABILITIES = 64;
const MAX_SLOTS = 32;
const MAX_DURATION_SECONDS = 30 * 24 * 60 * 60;

export const FOUNDRY_ACCELERATION_SCHEMA = 'stephanos.foundry-parallel-production-acceleration.v1';
export const FOUNDRY_CAPACITY_SCHEMA = 'stephanos.foundry-measured-capacity.v1';
export const FOUNDRY_M3_LIVE_SCHEMA = 'stephanos.forge-shadow-m3-live-capacity.v1';
export const PROVIDER_CAPACITY_SCHEMA = 'stephanos.provider-measured-capacity.v1';

export const FOUNDRY_ACCELERATION_DECISIONS = Object.freeze({
  BLOCKED: 'FOUNDRY_ACCELERATION_BLOCKED',
  IDLE: 'FOUNDRY_ACCELERATION_IDLE',
  WAITING_FOR_M3: 'FOUNDRY_ACCELERATION_WAITING_FOR_M3',
  NO_POSITIVE_GAIN: 'FOUNDRY_ACCELERATION_NO_POSITIVE_GAIN',
  READY: 'FOUNDRY_ACCELERATION_READY_MODEL_ONLY',
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function ratio(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function explicitInstant(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TZ_RE.test(normalized)) return Number.NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function normalizeSafeIds(value, maximum) {
  if (!denseArray(value) || value.length > maximum) return null;
  const normalized = value.map((entry) => text(entry).toLowerCase());
  if (normalized.some((entry) => !SAFE_ID_RE.test(entry))) return null;
  return [...new Set(normalized)].sort();
}

function safeReceiptRef(value) {
  const normalized = text(value).replaceAll('\\', '/');
  return Boolean(
    normalized
    && normalized.length <= 512
    && SAFE_RECEIPT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    && !normalized.startsWith('/')
    && !/^[a-z]:\//i.test(normalized)
    && normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  );
}

function authorityProjection() {
  return freeze({
    dispatch: false,
    sourceMutation: false,
    branchMutation: false,
    publication: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    credentialAccess: false,
    arbitraryCommand: false,
    recommendationOnly: true,
  });
}

function blockedResult(blockers = ['hostile-input-observation-failed']) {
  return freeze({
    schemaVersion: FOUNDRY_ACCELERATION_SCHEMA,
    valid: false,
    decision: FOUNDRY_ACCELERATION_DECISIONS.BLOCKED,
    blockers: [...new Set(blockers)],
    assignments: [],
    heldCandidates: [],
    providerStatus: [],
    foundryTelemetry: null,
    authority: authorityProjection(),
  });
}

function normalizeProvider(raw, canonicalMainHead, nowMs, freshnessSeconds) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const providerId = text(source.providerId).toLowerCase();
  const state = text(source.state).toUpperCase();
  const capabilities = normalizeSafeIds(source.capabilities, MAX_CAPABILITIES);
  const availableSlots = integer(source.availableSlots);
  const queueDepth = integer(source.queueDepth);
  const medianStartDelaySeconds = integer(source.medianStartDelaySeconds);
  const medianExecutionSeconds = integer(source.medianExecutionSeconds);
  const reviewIntegrationSeconds = integer(source.reviewIntegrationSeconds);
  const successRate = ratio(source.successRate);
  const reworkRate = ratio(source.reworkRate);
  const receipt = source.capacityReceipt && typeof source.capacityReceipt === 'object' && !Array.isArray(source.capacityReceipt)
    ? source.capacityReceipt
    : {};
  const observedAtMs = explicitInstant(receipt.observedAtUtc);
  const expectedCapacitySchema = providerId === 'foundry' ? FOUNDRY_CAPACITY_SCHEMA : PROVIDER_CAPACITY_SCHEMA;
  const blockers = [];

  if (!SAFE_ID_RE.test(providerId)) blockers.push('provider-id-invalid');
  if (!PROVIDER_STATES.has(state)) blockers.push('provider-state-invalid');
  if (!capabilities) blockers.push('provider-capabilities-invalid');
  if (availableSlots === null || availableSlots > MAX_SLOTS) blockers.push('provider-slots-invalid');
  if (queueDepth === null || queueDepth > 10000) blockers.push('provider-queue-depth-invalid');
  for (const [key, value] of [
    ['provider-start-delay-invalid', medianStartDelaySeconds],
    ['provider-execution-duration-invalid', medianExecutionSeconds],
    ['provider-integration-duration-invalid', reviewIntegrationSeconds],
  ]) if (value === null || value > MAX_DURATION_SECONDS) blockers.push(key);
  if (successRate === null) blockers.push('provider-success-rate-invalid');
  if (reworkRate === null) blockers.push('provider-rework-rate-invalid');
  if (text(receipt.schemaVersion) !== expectedCapacitySchema) blockers.push('provider-capacity-schema-invalid');
  if (text(receipt.providerId).toLowerCase() !== providerId) blockers.push('provider-capacity-identity-mismatch');
  if (text(receipt.exactMainHead).toLowerCase() !== canonicalMainHead) blockers.push('provider-capacity-head-mismatch');
  if (!safeReceiptRef(receipt.receiptRef)) blockers.push('provider-capacity-receipt-ref-invalid');
  if (!Number.isFinite(observedAtMs)) blockers.push('provider-capacity-observed-at-invalid');
  else if (observedAtMs > nowMs || nowMs - observedAtMs > freshnessSeconds * 1000) blockers.push('provider-capacity-stale');
  if (receipt.availableSlots !== availableSlots || receipt.queueDepth !== queueDepth) blockers.push('provider-capacity-measurement-mismatch');

  let m3Runtime = null;
  if (providerId === 'foundry') {
    const rawM3 = source.m3RuntimeReceipt && typeof source.m3RuntimeReceipt === 'object' && !Array.isArray(source.m3RuntimeReceipt)
      ? source.m3RuntimeReceipt
      : {};
    m3Runtime = freeze({
      schemaVersion: text(rawM3.schemaVersion),
      exactMainHead: text(rawM3.exactMainHead).toLowerCase(),
      observedAtUtc: text(rawM3.observedAtUtc),
      canCarryRealWork: rawM3.canCarryRealWork === true,
      teardownVerdict: text(rawM3.teardownVerdict),
      receiptRef: safeReceiptRef(rawM3.receiptRef) ? text(rawM3.receiptRef) : null,
    });
    const m3ObservedAtMs = explicitInstant(m3Runtime.observedAtUtc);
    if (m3Runtime.schemaVersion !== FOUNDRY_M3_LIVE_SCHEMA) blockers.push('foundry-m3-runtime-schema-invalid');
    if (m3Runtime.exactMainHead !== canonicalMainHead) blockers.push('foundry-m3-runtime-head-mismatch');
    if (!m3Runtime.canCarryRealWork) blockers.push('foundry-m3-not-routable');
    if (m3Runtime.teardownVerdict !== 'ZERO_RESIDUAL_AUTHORITY') blockers.push('foundry-m3-teardown-unproven');
    if (!m3Runtime.receiptRef) blockers.push('foundry-m3-runtime-receipt-ref-invalid');
    if (!Number.isFinite(m3ObservedAtMs)) blockers.push('foundry-m3-runtime-observed-at-invalid');
    else if (m3ObservedAtMs > nowMs || nowMs - m3ObservedAtMs > freshnessSeconds * 1000) blockers.push('foundry-m3-runtime-stale');
  }

  const predictedSeconds = blockers.length ? null : (
    medianStartDelaySeconds
    + medianExecutionSeconds
    + reviewIntegrationSeconds
    + Math.ceil(medianExecutionSeconds * reworkRate)
    + Math.ceil(medianExecutionSeconds * (1 - successRate))
  );
  const eligible = blockers.length === 0 && state === 'READY' && availableSlots > 0;
  return freeze({
    providerId,
    state,
    capabilities: capabilities ?? [],
    availableSlots,
    queueDepth,
    medianStartDelaySeconds,
    medianExecutionSeconds,
    reviewIntegrationSeconds,
    successRate,
    reworkRate,
    predictedSeconds,
    eligible,
    blockers,
    capacityReceiptRef: safeReceiptRef(receipt.receiptRef) ? text(receipt.receiptRef) : null,
    capacityObservedAtUtc: Number.isFinite(observedAtMs) ? new Date(observedAtMs).toISOString() : null,
    m3Runtime,
  });
}

function normalizeCandidate(raw, canonicalMainHead) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const candidateId = text(source.candidateId).toLowerCase();
  const goalId = text(source.goalId).toLowerCase();
  const baseHead = text(source.baseHead).toLowerCase();
  const resourceIds = normalizeSafeIds(source.resourceIds, MAX_RESOURCES);
  const requiredCapabilities = normalizeSafeIds(source.requiredCapabilities, MAX_CAPABILITIES);
  const criticalPathWeight = integer(source.criticalPathWeight);
  const blockers = [];
  if (!SAFE_ID_RE.test(candidateId)) blockers.push('candidate-id-invalid');
  if (!SAFE_ID_RE.test(goalId)) blockers.push('candidate-goal-invalid');
  if (!SHA_RE.test(baseHead) || baseHead !== canonicalMainHead) blockers.push('candidate-base-head-stale-or-invalid');
  if (!resourceIds || resourceIds.length === 0) blockers.push('candidate-resource-scope-invalid');
  if (!requiredCapabilities) blockers.push('candidate-capabilities-invalid');
  if (criticalPathWeight === null || criticalPathWeight > 1000) blockers.push('candidate-critical-path-weight-invalid');
  return freeze({
    candidateId,
    goalId,
    baseHead,
    resourceIds: resourceIds ?? [],
    requiredCapabilities: requiredCapabilities ?? [],
    criticalPathWeight,
    blockers,
  });
}

function providerSupports(provider, candidate) {
  const capabilities = new Set(provider.capabilities);
  return candidate.requiredCapabilities.every((capability) => capabilities.has(capability));
}

function foundryTelemetry(foundry, assignmentCount) {
  if (!foundry) return freeze({
    status: 'NOT_OBSERVED',
    queueDepth: null,
    availableSlots: null,
    activePackets: 0,
    lastCapacityReceipt: null,
    lastRuntimeReceipt: null,
    lastTeardownVerdict: null,
    successRate: null,
    reworkRate: null,
    medianStartDelaySeconds: null,
    medianExecutionSeconds: null,
    operatorRequired: true,
  });
  return freeze({
    status: foundry.eligible ? 'READY' : (foundry.state === 'QUARANTINED' ? 'QUARANTINED' : 'WAITING_FOR_M3_OR_CAPACITY_PROOF'),
    queueDepth: foundry.queueDepth,
    availableSlots: foundry.availableSlots,
    activePackets: assignmentCount,
    lastCapacityReceipt: foundry.capacityReceiptRef,
    lastRuntimeReceipt: foundry.m3Runtime?.receiptRef ?? null,
    lastTeardownVerdict: foundry.m3Runtime?.teardownVerdict ?? null,
    successRate: foundry.successRate,
    reworkRate: foundry.reworkRate,
    medianStartDelaySeconds: foundry.medianStartDelaySeconds,
    medianExecutionSeconds: foundry.medianExecutionSeconds,
    operatorRequired: !foundry.eligible,
  });
}

function plan(source = {}) {
  const repository = text(source.repository);
  const canonicalMainHead = text(source.canonicalMainHead).toLowerCase();
  const nowUtc = text(source.nowUtc);
  const nowMs = explicitInstant(nowUtc);
  const capacityFreshnessSeconds = integer(source.capacityFreshnessSeconds ?? 300);
  const minimumNetSavingsSeconds = integer(source.minimumNetSavingsSeconds ?? 60);
  const providersRaw = source.providers;
  const candidatesRaw = source.candidates;
  const activeResourceIds = normalizeSafeIds(source.activeResourceIds ?? [], MAX_RESOURCES);
  const blockers = [];

  if (!SAFE_REPOSITORY_RE.test(repository)) blockers.push('repository-invalid');
  if (!SHA_RE.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');
  if (capacityFreshnessSeconds === null || capacityFreshnessSeconds < 30 || capacityFreshnessSeconds > 3600) blockers.push('capacity-freshness-invalid');
  if (minimumNetSavingsSeconds === null || minimumNetSavingsSeconds > MAX_DURATION_SECONDS) blockers.push('minimum-net-savings-invalid');
  if (!denseArray(providersRaw) || providersRaw.length === 0 || providersRaw.length > MAX_PROVIDERS) blockers.push('providers-invalid-or-out-of-bound');
  if (!denseArray(candidatesRaw) || candidatesRaw.length > MAX_CANDIDATES) blockers.push('candidates-invalid-or-out-of-bound');
  if (!activeResourceIds) blockers.push('active-resource-inventory-invalid');
  if (blockers.length) return blockedResult(blockers);

  const providers = providersRaw.map((provider) => normalizeProvider(provider, canonicalMainHead, nowMs, capacityFreshnessSeconds));
  const providerIds = providers.map(({ providerId }) => providerId);
  if (new Set(providerIds).size !== providerIds.length) blockers.push('provider-id-duplicate');
  const candidates = candidatesRaw.map((candidate) => normalizeCandidate(candidate, canonicalMainHead));
  const candidateIds = candidates.map(({ candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) blockers.push('candidate-id-duplicate');
  for (const candidate of candidates) blockers.push(...candidate.blockers.map((blocker) => `${blocker}:${candidate.candidateId || 'unknown'}`));
  if (blockers.length) return blockedResult(blockers);

  const foundry = providers.find(({ providerId }) => providerId === 'foundry') ?? null;
  if (candidates.length === 0) return freeze({
    schemaVersion: FOUNDRY_ACCELERATION_SCHEMA,
    valid: true,
    repository,
    canonicalMainHead,
    decision: FOUNDRY_ACCELERATION_DECISIONS.IDLE,
    blockers: [],
    assignments: [],
    heldCandidates: [],
    providerStatus: providers,
    foundryTelemetry: foundryTelemetry(foundry, 0),
    totalCriticalPathSecondsSaved: 0,
    authority: authorityProjection(),
  });

  const baseline = providers.find(({ providerId }) => providerId === 'github');
  const heldCandidates = [];
  const assignments = [];
  const ownedResources = new Set(activeResourceIds);
  const slots = new Map(providers.map((provider) => [provider.providerId, provider.eligible ? provider.availableSlots : 0]));
  const orderedCandidates = [...candidates].sort((left, right) => (
    right.criticalPathWeight - left.criticalPathWeight
    || left.candidateId.localeCompare(right.candidateId)
  ));

  for (const candidate of orderedCandidates) {
    const conflicts = candidate.resourceIds.filter((resourceId) => ownedResources.has(resourceId));
    if (conflicts.length) {
      heldCandidates.push(freeze({ candidateId: candidate.candidateId, reason: 'RESOURCE_CONFLICT', conflictingResourceIds: conflicts }));
      continue;
    }
    if (!baseline?.eligible || !providerSupports(baseline, candidate)) {
      heldCandidates.push(freeze({ candidateId: candidate.candidateId, reason: 'GITHUB_BASELINE_UNAVAILABLE' }));
      continue;
    }
    const alternatives = providers
      .filter((provider) => provider.providerId !== 'github' && provider.eligible && (slots.get(provider.providerId) ?? 0) > 0 && providerSupports(provider, candidate))
      .map((provider) => ({
        provider,
        netSecondsSaved: baseline.predictedSeconds - provider.predictedSeconds,
      }))
      .filter(({ netSecondsSaved }) => netSecondsSaved >= minimumNetSavingsSeconds)
      .sort((left, right) => (
        right.netSecondsSaved - left.netSecondsSaved
        || left.provider.predictedSeconds - right.provider.predictedSeconds
        || left.provider.providerId.localeCompare(right.provider.providerId)
      ));
    const selected = alternatives[0];
    if (!selected) {
      heldCandidates.push(freeze({ candidateId: candidate.candidateId, reason: 'NO_POSITIVE_NET_ACCELERATION_USE_GITHUB' }));
      continue;
    }
    assignments.push(freeze({
      candidateId: candidate.candidateId,
      goalId: candidate.goalId,
      providerId: selected.provider.providerId,
      resourceIds: candidate.resourceIds,
      criticalPathWeight: candidate.criticalPathWeight,
      githubBaselineSeconds: baseline.predictedSeconds,
      predictedProviderSeconds: selected.provider.predictedSeconds,
      predictedNetSecondsSaved: selected.netSecondsSaved,
      capacityReceiptRef: selected.provider.capacityReceiptRef,
      runtimeReceiptRef: selected.provider.m3Runtime?.receiptRef ?? null,
      dispatchAuthority: false,
    }));
    slots.set(selected.provider.providerId, slots.get(selected.provider.providerId) - 1);
    for (const resourceId of candidate.resourceIds) ownedResources.add(resourceId);
  }

  const foundryAssignments = assignments.filter(({ providerId }) => providerId === 'foundry');
  const waitingForM3 = Boolean(foundry && !foundry.eligible && foundry.blockers.some((blocker) => blocker.startsWith('foundry-m3-')));
  const decision = assignments.length
    ? FOUNDRY_ACCELERATION_DECISIONS.READY
    : waitingForM3
      ? FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_M3
      : FOUNDRY_ACCELERATION_DECISIONS.NO_POSITIVE_GAIN;
  return freeze({
    schemaVersion: FOUNDRY_ACCELERATION_SCHEMA,
    valid: true,
    repository,
    canonicalMainHead,
    decision,
    blockers: [],
    assignments,
    heldCandidates,
    providerStatus: providers,
    foundryTelemetry: foundryTelemetry(foundry, foundryAssignments.length),
    totalCriticalPathSecondsSaved: assignments.reduce((total, assignment) => total + assignment.predictedNetSecondsSaved, 0),
    authority: authorityProjection(),
  });
}

export function planFoundryParallelProductionAcceleration(input = {}) {
  try {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return plan(source);
  } catch {
    return blockedResult();
  }
}
