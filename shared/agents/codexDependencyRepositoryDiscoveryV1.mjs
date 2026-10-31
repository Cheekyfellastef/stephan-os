import { createHash } from 'node:crypto';

export const CODEX_DEPENDENCY_DISCOVERY_SCHEMA = 'stephanos.codex-dependency-repository-discovery.v1';
export const CODEX_DEPENDENCY_DISCOVERY_DIFF_SCHEMA = 'stephanos.codex-dependency-repository-discovery-diff.v1';

export const PROVIDER_SIGNAL = Object.freeze({
  CODEX: 'CODEX',
  REMOTE_CODEX: 'REMOTE_CODEX',
  WORK_AGENTIC: 'WORK_AGENTIC',
});

export const DISCOVERY_STATE = Object.freeze({
  STRUCTURED_TOUCHPOINT: 'STRUCTURED_TOUCHPOINT',
  NEEDS_SEMANTIC_CLASSIFICATION: 'NEEDS_SEMANTIC_CLASSIFICATION',
  REFERENCE_ONLY: 'REFERENCE_ONLY',
  EXCLUDED_GENERATED_OR_RUNTIME: 'EXCLUDED_GENERATED_OR_RUNTIME',
});

const VALID_SIGNALS = new Set(Object.values(PROVIDER_SIGNAL));
const EXCLUDED_PREFIXES = Object.freeze([
  '.git/',
  'node_modules/',
  'apps/stephanos/dist/',
  'runtime-activity/',
  '.runtime/',
]);

const PROVIDER_PATTERNS = Object.freeze([
  Object.freeze({ signal: PROVIDER_SIGNAL.REMOTE_CODEX, pattern: /\bremote[\s_-]+codex\b/i }),
  Object.freeze({ signal: PROVIDER_SIGNAL.WORK_AGENTIC, pattern: /\bwork(?:[\s_-]+agentic|[\s_-]+credits?|[\s_-]+mode)\b/i }),
  Object.freeze({ signal: PROVIDER_SIGNAL.CODEX, pattern: /\bcodex\b/i }),
]);

const REQUIRED_SEMANTIC_FIELDS = Object.freeze([
  'touchpointId',
  'component',
  'capabilityClass',
  'codexUseClass',
  'owningGoal',
  'workCreditCoupled',
  'active',
  'criticalPath',
]);

function text(value) {
  return String(value ?? '').trim();
}

function validObservedAt(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function uniqueSorted(values) {
  return Object.freeze([...new Set(values.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
}

function authorityProjection() {
  return Object.freeze({
    sourceMutation: false,
    dispatch: false,
    providerQualification: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    spendingOrAccount: false,
    leaseSeizure: false,
  });
}

function sourceClass(path) {
  if (path.startsWith('.github/workflows/') || path.startsWith('.forgejo/workflows/')) return 'WORKFLOW';
  if (path.startsWith('scripts/windows/')) return 'WINDOWS_SCRIPT';
  if (path.startsWith('scripts/')) return 'SCRIPT';
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return 'TEST_FIXTURE';
  if (path.startsWith('shared/agents/')) return 'AGENT_SOURCE';
  if (path.startsWith('docs/')) return 'DURABLE_DOCUMENT';
  return 'OTHER_REPOSITORY_SOURCE';
}

function isExcluded(path) {
  return EXCLUDED_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

function detectedSignals(content) {
  const source = String(content ?? '');
  return PROVIDER_PATTERNS
    .filter(({ pattern }) => pattern.test(source))
    .map(({ signal }) => signal);
}

function declaredSignals(entry) {
  return (Array.isArray(entry?.declaredProviderSignals) ? entry.declaredProviderSignals : [])
    .map(text)
    .filter((signal) => VALID_SIGNALS.has(signal));
}

function stableFindingId(path, signals, state, semanticIdentity = '') {
  return createHash('sha256')
    .update(JSON.stringify([path, [...signals].sort(), state, semanticIdentity]))
    .digest('hex');
}

function semanticProblems(semantic = {}) {
  const problems = [];
  for (const field of REQUIRED_SEMANTIC_FIELDS) {
    if (['workCreditCoupled', 'active', 'criticalPath'].includes(field)) {
      if (typeof semantic[field] !== 'boolean') problems.push(`semantic-field-missing:${field}`);
    } else if (!text(semantic[field])) {
      problems.push(`semantic-field-missing:${field}`);
    }
  }
  return uniqueSorted(problems);
}

function semanticFindingIdentity(semantic = {}) {
  return JSON.stringify([
    text(semantic.touchpointId),
    text(semantic.component),
    text(semantic.capabilityClass),
    text(semantic.codexUseClass),
    text(semantic.provider),
    semantic.workCreditCoupled,
    semantic.active,
    semantic.criticalPath,
    text(semantic.owningGoal),
    text(semantic.currentPrimaryRoute),
    semantic.hardExternalBoundary === true,
    semantic.unrelatedWorkIsolation === true,
    text(semantic.missingGapOwner),
  ]);
}

function candidateFromSemantic(entry, path, signals) {
  const semantic = entry.semantic || {};
  return Object.freeze({
    touchpointId: text(semantic.touchpointId),
    pathOrGoalRef: text(semantic.pathOrGoalRef) || path,
    component: text(semantic.component),
    capabilityClass: text(semantic.capabilityClass),
    codexUseClass: text(semantic.codexUseClass),
    provider: text(semantic.provider) || (signals.includes(PROVIDER_SIGNAL.WORK_AGENTIC) ? 'WORK_AGENTIC' : 'CODEX'),
    workCreditCoupled: semantic.workCreditCoupled,
    active: semantic.active,
    criticalPath: semantic.criticalPath,
    owningGoal: text(semantic.owningGoal),
    currentPrimaryRoute: text(semantic.currentPrimaryRoute),
    nonCodexRoutes: Array.isArray(semantic.nonCodexRoutes) ? semantic.nonCodexRoutes : [],
    hardExternalBoundary: semantic.hardExternalBoundary === true,
    unrelatedWorkIsolation: semantic.unrelatedWorkIsolation === true,
    proofRefs: uniqueSorted(Array.isArray(semantic.proofRefs) ? semantic.proofRefs : []),
    missingGapOwner: text(semantic.missingGapOwner),
    discoveryProviderSignals: signals,
    discoveryProblems: semanticProblems(semantic),
  });
}

function normalizeEntry(entry = {}, index = 0) {
  const path = normalizePath(entry.path);
  if (!path) throw new Error(`entry[${index}] path is required`);
  const signals = uniqueSorted([...detectedSignals(entry.content), ...declaredSignals(entry)]);
  const semanticOperational = entry?.semantic?.operationalDependency === true;
  if (!signals.length && !semanticOperational) return null;

  const klass = sourceClass(path);
  if (isExcluded(path)) {
    const state = DISCOVERY_STATE.EXCLUDED_GENERATED_OR_RUNTIME;
    return Object.freeze({
      findingId: stableFindingId(path, signals, state),
      path,
      sourceClass: klass,
      providerSignals: signals,
      state,
      reason: 'generated-or-runtime-path-excluded',
      candidate: null,
    });
  }

  if (entry.referenceOnly === true || entry?.semantic?.operationalDependency === false) {
    const state = DISCOVERY_STATE.REFERENCE_ONLY;
    return Object.freeze({
      findingId: stableFindingId(path, signals, state),
      path,
      sourceClass: klass,
      providerSignals: signals,
      state,
      reason: entry.referenceOnly === true ? 'explicit-reference-only' : 'semantic-non-operational-reference',
      candidate: null,
    });
  }

  if (semanticOperational) {
    const state = DISCOVERY_STATE.STRUCTURED_TOUCHPOINT;
    const candidate = candidateFromSemantic(entry, path, signals);
    return Object.freeze({
      findingId: stableFindingId(path, signals, state, semanticFindingIdentity(entry.semantic)),
      path,
      sourceClass: klass,
      providerSignals: signals,
      state,
      reason: candidate.discoveryProblems.length ? 'semantic-contract-incomplete-fail-closed' : 'explicit-operational-dependency',
      candidate,
    });
  }

  const state = DISCOVERY_STATE.NEEDS_SEMANTIC_CLASSIFICATION;
  return Object.freeze({
    findingId: stableFindingId(path, signals, state),
    path,
    sourceClass: klass,
    providerSignals: signals,
    state,
    reason: 'provider-reference-is-not-dependency-proof',
    candidate: null,
  });
}

export function discoverCodexDependencyRepositoryCandidatesV1(input = {}) {
  const observedAtUtc = validObservedAt(input.observedAtUtc);
  if (!observedAtUtc) throw new Error('observedAtUtc must be a valid timestamp');
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const findings = Object.freeze(entries
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path) || a.state.localeCompare(b.state)));

  const candidates = Object.freeze(findings
    .filter((finding) => finding.state === DISCOVERY_STATE.STRUCTURED_TOUCHPOINT)
    .map((finding) => finding.candidate));
  const unclassifiedReferences = Object.freeze(findings.filter((finding) => finding.state === DISCOVERY_STATE.NEEDS_SEMANTIC_CLASSIFICATION));
  const referenceOnly = Object.freeze(findings.filter((finding) => finding.state === DISCOVERY_STATE.REFERENCE_ONLY));
  const excluded = Object.freeze(findings.filter((finding) => finding.state === DISCOVERY_STATE.EXCLUDED_GENERATED_OR_RUNTIME));
  const incompleteSemanticCount = candidates.filter((candidate) => candidate.discoveryProblems.length > 0).length;

  return Object.freeze({
    schema: CODEX_DEPENDENCY_DISCOVERY_SCHEMA,
    observedAtUtc,
    entryCount: entries.length,
    findingCount: findings.length,
    findings,
    candidateCount: candidates.length,
    candidates,
    unclassifiedReferenceCount: unclassifiedReferences.length,
    unclassifiedReferences,
    referenceOnlyCount: referenceOnly.length,
    referenceOnly,
    excludedCount: excluded.length,
    excluded,
    incompleteSemanticCount,
    semanticClassificationComplete: unclassifiedReferences.length === 0 && incompleteSemanticCount === 0,
    authority: authorityProjection(),
  });
}

function findingMap(snapshot = {}) {
  return new Map((Array.isArray(snapshot.findings) ? snapshot.findings : []).map((finding) => [finding.findingId, finding]));
}

export function diffCodexDependencyRepositoryDiscoveryV1(previous = {}, current = {}) {
  if (previous.schema !== CODEX_DEPENDENCY_DISCOVERY_SCHEMA || current.schema !== CODEX_DEPENDENCY_DISCOVERY_SCHEMA) {
    throw new Error('both snapshots must use the canonical discovery schema');
  }
  const before = findingMap(previous);
  const after = findingMap(current);
  const added = [...after.values()].filter((finding) => !before.has(finding.findingId));
  const removed = [...before.values()].filter((finding) => !after.has(finding.findingId));
  return Object.freeze({
    schema: CODEX_DEPENDENCY_DISCOVERY_DIFF_SCHEMA,
    previousObservedAtUtc: previous.observedAtUtc,
    currentObservedAtUtc: current.observedAtUtc,
    addedFindingIds: uniqueSorted(added.map((finding) => finding.findingId)),
    removedFindingIds: uniqueSorted(removed.map((finding) => finding.findingId)),
    addedUnclassifiedReferenceIds: uniqueSorted(added
      .filter((finding) => finding.state === DISCOVERY_STATE.NEEDS_SEMANTIC_CLASSIFICATION)
      .map((finding) => finding.findingId)),
    addedStructuredTouchpointIds: uniqueSorted(added
      .filter((finding) => finding.state === DISCOVERY_STATE.STRUCTURED_TOUCHPOINT)
      .map((finding) => finding.findingId)),
    requiresSemanticRefresh: added.some((finding) => finding.state === DISCOVERY_STATE.NEEDS_SEMANTIC_CLASSIFICATION),
    authority: authorityProjection(),
  });
}
