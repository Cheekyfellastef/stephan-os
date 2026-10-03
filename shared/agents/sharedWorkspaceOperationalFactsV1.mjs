import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
} from './sharedAgentWorkspaceStore.mjs';

export const SHARED_WORKSPACE_OPERATIONAL_FACTS_SCHEMA = 'stephanos.shared-workspace.operational-facts.v1';
export const SHARED_WORKSPACE_OPERATIONAL_FACTS_STATUS_ID = 'operational-facts-current';
export const SHARED_WORKSPACE_OPERATIONAL_FACTS_RELATED_ISSUE = '#1556';
export const DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS = 35 * 60 * 1000;
export const DEFAULT_OPERATIONAL_FACT_MAX_FUTURE_SKEW_MS = 60 * 1000;

const FACT_ID = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[a-z0-9][a-z0-9._\/-]{0,240}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function timestamp(value) {
  const candidate = text(value);
  return Number.isFinite(Date.parse(candidate)) ? candidate : '';
}

function safeFactId(value) {
  const candidate = text(value);
  return FACT_ID.test(candidate) ? candidate : '';
}

function safeProofRefs(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((ref) => text(ref).replace(/\\/g, '/')).filter((ref) => SAFE_PROOF_REF.test(ref)))];
}

function safeValue(value) {
  if (value === null || value === undefined || value === '') return 'UNKNOWN';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  return 'UNKNOWN';
}

function freshnessFor({ value, observedAtUtc, nowMs, staleAfterMs, maxFutureSkewMs }) {
  if (value === 'UNKNOWN') return 'UNKNOWN';
  const observedMs = Date.parse(observedAtUtc);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return 'UNKNOWN';
  if (observedMs - nowMs > maxFutureSkewMs) return 'UNKNOWN';
  return Math.max(0, nowMs - observedMs) > staleAfterMs ? 'STALE' : 'CURRENT';
}

function canonicalOperationalFactsRecord(record = {}) {
  const refs = safeProofRefs(record?.proofRefs);
  return Boolean(
    record?.schemaVersion === SHARED_WORKSPACE_RECORD_SCHEMA_VERSION
    && record?.kind === SHARED_WORKSPACE_RECORD_KINDS.STATUS
    && record?.statusId === SHARED_WORKSPACE_OPERATIONAL_FACTS_STATUS_ID
    && record?.participantId === 'stephanos'
    && record?.relatedIssue === SHARED_WORKSPACE_OPERATIONAL_FACTS_RELATED_ISSUE
    && record?.operationalFactsSchemaVersion === SHARED_WORKSPACE_OPERATIONAL_FACTS_SCHEMA
    && refs.length > 0
  );
}

export function createSharedWorkspaceOperationalFact(input = {}) {
  const factId = safeFactId(input.factId);
  if (!factId) throw new Error('Operational fact requires a safe factId.');
  const rawValue = safeValue(input.value);
  const rawObservedAtUtc = timestamp(input.observedAtUtc);
  const staleAfterMs = Number.isFinite(input.staleAfterMs)
    ? Math.max(1_000, Math.floor(input.staleAfterMs))
    : DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS;
  const maxFutureSkewMs = Number.isFinite(input.maxFutureSkewMs)
    ? Math.max(0, Math.floor(input.maxFutureSkewMs))
    : DEFAULT_OPERATIONAL_FACT_MAX_FUTURE_SKEW_MS;
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const observedMs = Date.parse(rawObservedAtUtc);
  const futureOutOfBounds = Number.isFinite(observedMs)
    && Number.isFinite(nowMs)
    && observedMs - nowMs > maxFutureSkewMs;
  const observedAtUtc = futureOutOfBounds ? '' : rawObservedAtUtc;
  const value = futureOutOfBounds ? 'UNKNOWN' : rawValue;
  return Object.freeze({
    factId,
    label: text(input.label, factId),
    value,
    observedAtUtc,
    source: text(input.source, 'shared-workspace'),
    proofRefs: Object.freeze(safeProofRefs(input.proofRefs)),
    freshness: freshnessFor({ value, observedAtUtc, nowMs, staleAfterMs, maxFutureSkewMs }),
    staleAfterMs,
    maxFutureSkewMs,
  });
}

function serviceFact({ serviceId, label, battleBridgeStatus, timestampUtc, nowMs }) {
  const service = battleBridgeStatus?.observedServiceFacts?.[serviceId];
  const known = service && typeof service.ready === 'boolean';
  return createSharedWorkspaceOperationalFact({
    factId: `service.${serviceId}.health`,
    label,
    value: known ? (service.ready ? 'READY' : 'UNAVAILABLE') : 'UNKNOWN',
    observedAtUtc: known ? timestamp(battleBridgeStatus?.timestampUtc || timestampUtc) : '',
    source: 'battle-bridge-shared-workspace-publisher',
    proofRefs: battleBridgeStatus?.proofRefs,
    staleAfterMs: 5 * 60 * 1000,
    nowMs,
  });
}

function headFact({ factId, label, value, observedAtUtc, headTruth, nowMs, staleAfterMs }) {
  return createSharedWorkspaceOperationalFact({
    factId,
    label,
    value: value || 'UNKNOWN',
    observedAtUtc,
    source: 'shared-workspace-head-truth',
    proofRefs: headTruth?.proofRefs,
    staleAfterMs,
    nowMs,
  });
}

export function buildSharedWorkspaceOperationalFactsRecord({
  headTruth = {},
  battleBridgeStatus = {},
  additionalFacts = [],
  timestampUtc = new Date().toISOString(),
  nowMs = Date.parse(timestampUtc),
} = {}) {
  const builtObservedAt = timestamp(headTruth?.windowsProofCoverage?.checks?.builtRuntime?.observedAtUtc);
  const servedObservedAt = timestamp(headTruth?.windowsProofCoverage?.checks?.servedRuntime?.observedAtUtc);
  const syncObservedAt = timestamp(headTruth?.syncTaskLastObservedUtc || headTruth?.syncObservedAtUtc);
  const facts = [
    headFact({
      factId: 'version.github-main-head',
      label: 'GitHub main head',
      value: headTruth?.githubMainHead,
      observedAtUtc: syncObservedAt,
      headTruth,
      nowMs,
      staleAfterMs: DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS,
    }),
    headFact({
      factId: 'version.battle-bridge-checkout-head',
      label: 'Battle Bridge checkout head',
      value: headTruth?.windowsCheckoutHead,
      observedAtUtc: syncObservedAt,
      headTruth,
      nowMs,
      staleAfterMs: DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS,
    }),
    headFact({
      factId: 'version.built-runtime-head',
      label: 'Built runtime head',
      value: headTruth?.builtRuntimeHead,
      observedAtUtc: builtObservedAt,
      headTruth,
      nowMs,
      staleAfterMs: DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS,
    }),
    headFact({
      factId: 'version.served-runtime-head',
      label: 'Served runtime head',
      value: headTruth?.servedRuntimeHead,
      observedAtUtc: servedObservedAt,
      headTruth,
      nowMs,
      staleAfterMs: 5 * 60 * 1000,
    }),
    createSharedWorkspaceOperationalFact({
      factId: 'runtime.head-truth-state',
      label: 'Head truth state',
      value: headTruth?.state || 'UNKNOWN',
      observedAtUtc: timestamp(headTruth?.observedAtUtc),
      source: 'shared-workspace-head-truth',
      proofRefs: headTruth?.proofRefs,
      staleAfterMs: DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS,
      nowMs,
    }),
    createSharedWorkspaceOperationalFact({
      factId: 'runtime.head-truth-blocker',
      label: 'Head truth blocker',
      value: headTruth?.blocker || 'NONE',
      observedAtUtc: timestamp(headTruth?.observedAtUtc),
      source: 'shared-workspace-head-truth',
      proofRefs: headTruth?.proofRefs,
      staleAfterMs: DEFAULT_OPERATIONAL_FACT_STALE_AFTER_MS,
      nowMs,
    }),
    serviceFact({ serviceId: 'backend', label: 'Backend 8787 health', battleBridgeStatus, timestampUtc, nowMs }),
    serviceFact({ serviceId: 'stephanos-ui', label: 'Stephanos UI 4173 health', battleBridgeStatus, timestampUtc, nowMs }),
    serviceFact({ serviceId: 'openclaw-gateway', label: 'OpenClaw gateway 18789 health', battleBridgeStatus, timestampUtc, nowMs }),
    serviceFact({ serviceId: 'shared-workspace', label: 'Shared Workspace health', battleBridgeStatus, timestampUtc, nowMs }),
    ...additionalFacts.map((fact) => createSharedWorkspaceOperationalFact({ ...fact, nowMs })),
  ];

  const byId = new Map();
  for (const fact of facts) {
    const existing = byId.get(fact.factId);
    const candidateMs = Date.parse(fact.observedAtUtc) || 0;
    const existingMs = Date.parse(existing?.observedAtUtc || '') || 0;
    if (!existing || candidateMs >= existingMs) byId.set(fact.factId, fact);
  }
  const operationalFacts = [...byId.values()];
  const currentCount = operationalFacts.filter((fact) => fact.freshness === 'CURRENT').length;
  const staleCount = operationalFacts.filter((fact) => fact.freshness === 'STALE').length;
  const unknownCount = operationalFacts.filter((fact) => fact.freshness === 'UNKNOWN').length;
  const proofRefs = [...new Set(operationalFacts.flatMap((fact) => fact.proofRefs))];

  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS,
    statusId: SHARED_WORKSPACE_OPERATIONAL_FACTS_STATUS_ID,
    participantId: 'stephanos',
    timestampUtc,
    relatedIssue: SHARED_WORKSPACE_OPERATIONAL_FACTS_RELATED_ISSUE,
    status: staleCount > 0 ? 'DEGRADED' : (currentCount > 0 ? 'CURRENT' : 'UNKNOWN'),
    summary: `Operational facts: ${currentCount} current, ${staleCount} stale, ${unknownCount} unknown.`,
    proofRefs,
    operationalFactsSchemaVersion: SHARED_WORKSPACE_OPERATIONAL_FACTS_SCHEMA,
    operationalFacts,
    factCounts: Object.freeze({ current: currentCount, stale: staleCount, unknown: unknownCount, total: operationalFacts.length }),
    readOnly: true,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
  });
}

export function projectSharedWorkspaceOperationalFacts({
  statusRecords = [],
  nowMs = Date.now(),
} = {}) {
  const candidates = Array.isArray(statusRecords) ? statusRecords : [];
  const latestById = new Map();

  for (const record of candidates) {
    if (!canonicalOperationalFactsRecord(record) || !Array.isArray(record?.operationalFacts)) continue;
    for (const rawFact of record.operationalFacts) {
      let fact;
      try {
        fact = createSharedWorkspaceOperationalFact({ ...rawFact, nowMs });
      } catch {
        continue;
      }
      const existing = latestById.get(fact.factId);
      const candidateMs = Date.parse(fact.observedAtUtc) || 0;
      const existingMs = Date.parse(existing?.observedAtUtc || '') || 0;
      if (!existing || candidateMs >= existingMs) latestById.set(fact.factId, fact);
    }
  }

  const facts = [...latestById.values()].sort((a, b) => a.factId.localeCompare(b.factId));
  const currentCount = facts.filter((fact) => fact.freshness === 'CURRENT').length;
  const staleCount = facts.filter((fact) => fact.freshness === 'STALE').length;
  const unknownCount = facts.filter((fact) => fact.freshness === 'UNKNOWN').length;

  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_OPERATIONAL_FACTS_SCHEMA,
    projectionKind: 'shared-workspace-operational-facts',
    state: staleCount > 0 ? 'DEGRADED' : (currentCount > 0 ? 'CURRENT' : 'UNKNOWN'),
    factCounts: Object.freeze({ current: currentCount, stale: staleCount, unknown: unknownCount, total: facts.length }),
    facts: Object.freeze(facts),
    factsById: Object.freeze(Object.fromEntries(facts.map((fact) => [fact.factId, fact]))),
    readOnly: true,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
  });
}
