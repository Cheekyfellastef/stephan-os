import { createExecutionReceipt, validateExecutionReceipt } from './executionReceiptV1.mjs';

export const PROVIDER_NEUTRAL_REVIEW_SCHEMA_VERSION = 'stephanos.provider-neutral-review.v1';
export const PROVIDER_NEUTRAL_REVIEW_KIND = 'stephanos.provider-neutral.review';
export const PROVIDER_NEUTRAL_REVIEW_VERDICTS = Object.freeze(['clean', 'findings', 'blocked']);
export const PROVIDER_NEUTRAL_REVIEW_RISK_TIERS = Object.freeze(['low', 'standard', 'high']);
export const PROVIDER_NEUTRAL_REVIEW_ASSURANCE_MODES = Object.freeze([
  'independent',
  'deterministic-quorum',
  'specialist',
]);
export const PROVIDER_NEUTRAL_REVIEWER_CLASSES = Object.freeze([
  'github-first',
  'remote-codex',
  'battle-bridge-codex',
  'openclaw-local-readonly',
  'external-qualified',
  'deterministic-harness',
]);
export const PROVIDER_NEUTRAL_PROVIDER_STATES = Object.freeze([
  'available',
  'busy',
  'unavailable',
  'unknown',
]);

const REVIEW_REQUIRED_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'receiptId',
  'repository',
  'issueNumber',
  'prNumber',
  'branch',
  'sourceHead',
  'reviewerId',
  'reviewerClass',
  'provider',
  'modelClass',
  'reviewerSessionId',
  'implementerProvider',
  'implementerSessionId',
  'riskTier',
  'assuranceMode',
  'reviewScope',
  'findings',
  'verdict',
  'timestampUtc',
  'proofRefs',
  'quorumChecks',
  'blocker',
]);
const FINDING_REQUIRED_KEYS = Object.freeze(['severity', 'code', 'summary', 'path']);
const EXACT_HEAD = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const SAFE_SCOPE = /^[a-z0-9][a-z0-9._:/-]{0,120}$/i;
const SAFE_PATH = /^(?:[a-z0-9]|\.[a-z0-9])[a-z0-9._/-]{0,240}$/i;
const SAFE_PROOF_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const TERMINAL_REVIEW_JOB_STATES = new Set(['completed', 'failed', 'cancelled']);
const SPECIALIST_REVIEWER_CLASSES = new Set([
  'remote-codex',
  'battle-bridge-codex',
  'external-qualified',
]);
const REQUIRED_QUORUM_CHECKS = Object.freeze([
  'exact-head-ci',
  'focused-tests',
  'policy-review',
]);
const CODEX_UNAVAILABLE_STATES = new Set([
  'unavailable',
  'meter-stalled',
  'blocked-by-meter',
  'codeX-blocked-by-meter'.toLowerCase(),
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function positiveInteger(value, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(text(value));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function safeId(value, fallback = '') {
  const normalized = text(value, fallback).toLowerCase();
  return SAFE_ID.test(normalized) ? normalized : fallback;
}

function isSafeProofRef(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..')) return false;
  return SAFE_PROOF_SEGMENT.test(normalized)
    || /^(proof|proofs|receipts|evidence\/receipts)\//.test(normalized);
}

function normalizeFinding(input = {}) {
  return Object.freeze({
    severity: text(input.severity).toUpperCase(),
    code: safeId(input.code),
    summary: text(input.summary),
    path: text(input.path).replace(/\\/g, '/'),
  });
}

function normalizeProvider(input = {}) {
  const reviewerClass = text(input.reviewerClass).toLowerCase();
  const state = text(input.state, 'unknown').toLowerCase();
  const providerId = safeId(input.providerId);
  return Object.freeze({
    providerId,
    provider: safeId(input.provider, providerId),
    reviewerClass,
    state: PROVIDER_NEUTRAL_PROVIDER_STATES.includes(state) ? state : 'unknown',
    sessionId: safeId(input.sessionId),
    qualifiedRiskTiers: Object.freeze([
      ...new Set(list(input.qualifiedRiskTiers).map((item) => item.toLowerCase())),
    ]),
    supportsIndependentReview: input.supportsIndependentReview === true,
    supportsDeterministicQuorum: input.supportsDeterministicQuorum === true,
    proofQualityRank: Number.isFinite(input.proofQualityRank) ? input.proofQualityRank : 0,
    costRank: Number.isFinite(input.costRank) ? input.costRank : 100,
    latencyRank: Number.isFinite(input.latencyRank) ? input.latencyRank : 100,
  });
}

function providerIsCodex(provider) {
  return provider.reviewerClass === 'remote-codex' || provider.reviewerClass === 'battle-bridge-codex';
}

function providerSupportsRisk(provider, riskTier) {
  if (!provider.qualifiedRiskTiers.includes(riskTier)) return false;
  return riskTier !== 'high' || SPECIALIST_REVIEWER_CLASSES.has(provider.reviewerClass);
}

function providerCanReviewIndependently(provider, input) {
  if (!provider.supportsIndependentReview) return false;
  if (!provider.provider || !provider.sessionId) return false;
  return !(
    provider.provider === input.implementerProvider
    && provider.sessionId === input.implementerSessionId
  );
}

function assuranceRank(mode) {
  return mode === 'specialist' || mode === 'independent' ? 0 : 1;
}

function reviewExecutionWorkerType(reviewerClass) {
  return ({
    'github-first': 'github-first',
    'remote-codex': 'remote-codex',
    'battle-bridge-codex': 'battle-bridge-codex',
    'openclaw-local-readonly': 'openclaw',
    'external-qualified': 'orchestration-engine',
    'deterministic-harness': 'orchestration-engine',
  })[reviewerClass] || 'orchestration-engine';
}

export function createProviderNeutralReviewReceipt(input = {}) {
  const findings = Array.isArray(input.findings)
    ? input.findings.map((finding) => normalizeFinding(finding))
    : [];
  const issueNumber = positiveInteger(input.issueNumber, 1574);
  const prNumber = positiveInteger(input.prNumber);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const timestampUtc = text(input.timestampUtc, new Date(0).toISOString());
  const verdict = PROVIDER_NEUTRAL_REVIEW_VERDICTS.includes(text(input.verdict).toLowerCase())
    ? text(input.verdict).toLowerCase()
    : (findings.length ? 'findings' : 'blocked');
  return Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_REVIEW_SCHEMA_VERSION,
    kind: PROVIDER_NEUTRAL_REVIEW_KIND,
    receiptId: safeId(input.receiptId, `review-${prNumber || 'unknown'}-${sourceHead.slice(0, 12) || 'unknown'}`),
    repository: text(input.repository),
    issueNumber,
    prNumber,
    branch: text(input.branch),
    sourceHead,
    reviewerId: safeId(input.reviewerId, 'unknown-reviewer'),
    reviewerClass: text(input.reviewerClass).toLowerCase(),
    provider: safeId(input.provider),
    modelClass: safeId(input.modelClass),
    reviewerSessionId: safeId(input.reviewerSessionId),
    implementerProvider: safeId(input.implementerProvider),
    implementerSessionId: safeId(input.implementerSessionId),
    riskTier: text(input.riskTier, 'standard').toLowerCase(),
    assuranceMode: text(input.assuranceMode).toLowerCase(),
    reviewScope: Object.freeze([...new Set(list(input.reviewScope).map((item) => item.toLowerCase()))]),
    findings: Object.freeze(findings),
    verdict,
    timestampUtc,
    proofRefs: Object.freeze([...new Set(list(input.proofRefs))]),
    quorumChecks: Object.freeze([...new Set(list(input.quorumChecks).map((item) => item.toLowerCase()))]),
    blocker: text(input.blocker),
  });
}

export function validateProviderNeutralReviewReceipt(receipt = {}, options = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['invalid-review-receipt']),
      refusalReason: 'invalid-review-receipt',
      finalVerdict: 'PROVIDER_NEUTRAL_REVIEW_BLOCKED',
    });
  }

  const errors = [];
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify([...REVIEW_REQUIRED_KEYS].sort())) errors.push('unbounded-schema');
  if (receipt.schemaVersion !== PROVIDER_NEUTRAL_REVIEW_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (receipt.kind !== PROVIDER_NEUTRAL_REVIEW_KIND) errors.push('invalid-kind');
  if (!SAFE_ID.test(text(receipt.receiptId))) errors.push('invalid-receipt-id');
  if (!SAFE_REPOSITORY.test(text(receipt.repository))) errors.push('invalid-repository');
  if (!positiveInteger(receipt.issueNumber)) errors.push('invalid-issue-number');
  if (!positiveInteger(receipt.prNumber)) errors.push('invalid-pr-number');
  if (!SAFE_BRANCH.test(text(receipt.branch)) || text(receipt.branch).includes('..')) errors.push('invalid-branch');
  if (!EXACT_HEAD.test(text(receipt.sourceHead))) errors.push('invalid-source-head');
  if (!SAFE_ID.test(text(receipt.reviewerId))) errors.push('invalid-reviewer-id');
  if (!PROVIDER_NEUTRAL_REVIEWER_CLASSES.includes(text(receipt.reviewerClass))) errors.push('invalid-reviewer-class');
  if (!SAFE_ID.test(text(receipt.provider))) errors.push('invalid-provider');
  if (!SAFE_ID.test(text(receipt.modelClass))) errors.push('invalid-model-class');
  if (!SAFE_ID.test(text(receipt.reviewerSessionId))) errors.push('invalid-reviewer-session');
  if (!SAFE_ID.test(text(receipt.implementerProvider))) errors.push('invalid-implementer-provider');
  if (!SAFE_ID.test(text(receipt.implementerSessionId))) errors.push('invalid-implementer-session');
  if (!PROVIDER_NEUTRAL_REVIEW_RISK_TIERS.includes(receipt.riskTier)) errors.push('invalid-risk-tier');
  if (!PROVIDER_NEUTRAL_REVIEW_ASSURANCE_MODES.includes(receipt.assuranceMode)) errors.push('invalid-assurance-mode');
  if (!PROVIDER_NEUTRAL_REVIEW_VERDICTS.includes(receipt.verdict)) errors.push('invalid-verdict');
  if (!Number.isFinite(timestampMs(receipt.timestampUtc))) errors.push('invalid-timestamp');

  const reviewScope = list(receipt.reviewScope);
  if (!Array.isArray(receipt.reviewScope) || reviewScope.length === 0) errors.push('missing-review-scope');
  for (const scope of reviewScope) if (!SAFE_SCOPE.test(scope)) errors.push('unsafe-review-scope');

  if (!Array.isArray(receipt.findings)) {
    errors.push('invalid-findings');
  } else {
    for (const finding of receipt.findings) {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
        errors.push('invalid-finding');
        continue;
      }
      if (JSON.stringify(Object.keys(finding).sort()) !== JSON.stringify([...FINDING_REQUIRED_KEYS].sort())) errors.push('unbounded-finding-schema');
      if (!['P0', 'P1', 'P2'].includes(text(finding.severity))) errors.push('invalid-finding-severity');
      if (!SAFE_ID.test(text(finding.code))) errors.push('invalid-finding-code');
      if (!text(finding.summary) || text(finding.summary).length > 500) errors.push('invalid-finding-summary');
      if (text(finding.path) && (!SAFE_PATH.test(text(finding.path)) || text(finding.path).includes('..'))) errors.push('unsafe-finding-path');
    }
  }

  const normalizedProofRefs = list(receipt.proofRefs);
  if (!Array.isArray(receipt.proofRefs) || normalizedProofRefs.length === 0) errors.push('missing-proof-refs');
  if (Array.isArray(receipt.proofRefs)) {
    for (const proofRef of receipt.proofRefs) if (!isSafeProofRef(proofRef)) errors.push('unsafe-proof-ref');
  }

  const quorumChecks = list(receipt.quorumChecks).map((item) => item.toLowerCase());
  if (!Array.isArray(receipt.quorumChecks)) errors.push('invalid-quorum-checks');
  for (const check of quorumChecks) if (!SAFE_SCOPE.test(check)) errors.push('unsafe-quorum-check');

  const findingCount = Array.isArray(receipt.findings) ? receipt.findings.length : 0;
  if (receipt.verdict === 'clean' && findingCount !== 0) errors.push('clean-verdict-with-findings');
  if (receipt.verdict === 'findings' && findingCount === 0) errors.push('findings-verdict-without-findings');
  if (receipt.verdict === 'blocked' && !text(receipt.blocker)) errors.push('blocked-without-blocker');
  if (receipt.verdict !== 'blocked' && text(receipt.blocker)) errors.push('unexpected-blocker');

  if (receipt.assuranceMode === 'independent' || receipt.assuranceMode === 'specialist') {
    if (
      receipt.provider === receipt.implementerProvider
      && receipt.reviewerSessionId === receipt.implementerSessionId
    ) errors.push('reviewer-not-independent');
    if (quorumChecks.length !== 0) errors.push('unexpected-quorum-checks');
  }
  if (receipt.assuranceMode === 'specialist' && !SPECIALIST_REVIEWER_CLASSES.has(receipt.reviewerClass)) {
    errors.push('invalid-specialist-reviewer');
  }
  if (receipt.assuranceMode === 'deterministic-quorum') {
    if (receipt.riskTier === 'high') errors.push('high-risk-deterministic-quorum-forbidden');
    for (const required of REQUIRED_QUORUM_CHECKS) {
      if (!quorumChecks.includes(required)) errors.push(`missing-quorum-check:${required}`);
    }
  }
  if (receipt.riskTier === 'high') {
    if (!SPECIALIST_REVIEWER_CLASSES.has(receipt.reviewerClass)) errors.push('high-risk-specialist-required');
    if (receipt.assuranceMode !== 'specialist') errors.push('high-risk-specialist-assurance-required');
  }

  if (options.repository && receipt.repository !== options.repository) errors.push('repository-mismatch');
  if (positiveInteger(options.issueNumber) && receipt.issueNumber !== positiveInteger(options.issueNumber)) errors.push('issue-mismatch');
  if (positiveInteger(options.prNumber) && receipt.prNumber !== positiveInteger(options.prNumber)) errors.push('pr-mismatch');
  if (options.branch && receipt.branch !== options.branch) errors.push('branch-mismatch');
  if (options.expectedHead && receipt.sourceHead !== String(options.expectedHead).toLowerCase()) errors.push('head-mismatch');
  if (options.riskTier && receipt.riskTier !== options.riskTier) errors.push('risk-tier-mismatch');

  const uniqueErrors = [...new Set(errors)];
  return Object.freeze({
    valid: uniqueErrors.length === 0,
    errors: Object.freeze(uniqueErrors),
    refusalReason: uniqueErrors[0] || '',
    findingCounts: Object.freeze({
      p0: Array.isArray(receipt.findings) ? receipt.findings.filter((finding) => finding?.severity === 'P0').length : 0,
      p1: Array.isArray(receipt.findings) ? receipt.findings.filter((finding) => finding?.severity === 'P1').length : 0,
      p2: Array.isArray(receipt.findings) ? receipt.findings.filter((finding) => finding?.severity === 'P2').length : 0,
    }),
    finalVerdict: uniqueErrors.length ? 'PROVIDER_NEUTRAL_REVIEW_BLOCKED' : 'PROVIDER_NEUTRAL_REVIEW_PASS',
  });
}

export function providerNeutralReviewToExecutionReceipt(reviewReceipt, input = {}) {
  const validation = validateProviderNeutralReviewReceipt(reviewReceipt, {
    repository: input.repository,
    issueNumber: input.issueNumber,
    prNumber: input.prNumber,
    branch: input.branch,
    expectedHead: input.expectedHead,
    riskTier: input.riskTier,
  });
  if (!validation.valid) {
    return Object.freeze({
      ok: false,
      reason: validation.refusalReason,
      validation,
      receipt: null,
      executionValidation: null,
    });
  }

  const sequence = positiveInteger(input.sequence, 1);
  const blocked = reviewReceipt.verdict === 'blocked';
  const executionReceipt = createExecutionReceipt({
    receiptId: safeId(input.receiptId, reviewReceipt.receiptId),
    repository: reviewReceipt.repository,
    issueNumber: reviewReceipt.issueNumber,
    prNumber: reviewReceipt.prNumber,
    branch: reviewReceipt.branch,
    sourceHead: reviewReceipt.sourceHead,
    workerId: reviewReceipt.reviewerId,
    workerType: reviewExecutionWorkerType(reviewReceipt.reviewerClass),
    executionId: safeId(input.executionId, `review-${reviewReceipt.prNumber}-${reviewReceipt.sourceHead.slice(0, 12)}`),
    leaseKey: safeId(input.leaseKey, `review-pr-${reviewReceipt.prNumber}`),
    state: blocked ? 'failed' : 'completed',
    phase: `provider-neutral-review-${reviewReceipt.verdict}`,
    sequence,
    predecessorReceiptId: sequence === 1 ? '' : safeId(input.predecessorReceiptId),
    timestampUtc: reviewReceipt.timestampUtc,
    heartbeatExpiresAtUtc: reviewReceipt.timestampUtc,
    blocker: blocked ? reviewReceipt.blocker : '',
    operatorActionRequired: blocked && input.operatorActionRequired === true,
    proofRefs: reviewReceipt.proofRefs,
    expectedNextAction: '',
  });
  const executionValidation = validateExecutionReceipt(executionReceipt, {
    repository: reviewReceipt.repository,
    issueNumber: reviewReceipt.issueNumber,
    branch: reviewReceipt.branch,
    expectedHead: reviewReceipt.sourceHead,
  });
  return Object.freeze({
    ok: executionValidation.valid,
    reason: executionValidation.refusalReason || 'PROVIDER_NEUTRAL_REVIEW_EXECUTION_RECEIPT_READY',
    validation,
    receipt: executionReceipt,
    executionValidation,
  });
}

export function selectProviderNeutralReviewRoute(input = {}) {
  const repository = text(input.repository);
  const prNumber = positiveInteger(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const riskTier = text(input.riskTier, 'standard').toLowerCase();
  const implementerProvider = safeId(input.implementerProvider);
  const implementerSessionId = safeId(input.implementerSessionId);
  const targetErrors = [];
  if (!SAFE_REPOSITORY.test(repository)) targetErrors.push('invalid-repository');
  if (!prNumber) targetErrors.push('invalid-pr-number');
  if (!SAFE_BRANCH.test(branch) || branch.includes('..')) targetErrors.push('invalid-branch');
  if (!EXACT_HEAD.test(sourceHead)) targetErrors.push('invalid-source-head');
  if (!PROVIDER_NEUTRAL_REVIEW_RISK_TIERS.includes(riskTier)) targetErrors.push('invalid-risk-tier');
  if (!implementerProvider) targetErrors.push('invalid-implementer-provider');
  if (!implementerSessionId) targetErrors.push('invalid-implementer-session');
  if (targetErrors.length) {
    return Object.freeze({
      decision: 'REVIEW_ROUTE_BLOCKED',
      reason: targetErrors[0],
      errors: Object.freeze(targetErrors),
      capacityClassification: 'UNKNOWN_PROVIDER_CAPACITY',
      selectedProvider: null,
      duplicateDispatchAllowed: false,
      binding: null,
    });
  }

  const activeReviewJobs = Array.isArray(input.activeReviewJobs) ? input.activeReviewJobs : [];
  const activeForHead = activeReviewJobs.find((job) => (
    positiveInteger(job?.prNumber) === prNumber
    && text(job?.sourceHead).toLowerCase() === sourceHead
    && (!text(job?.repository) || text(job.repository) === repository)
    && (!text(job?.branch) || text(job.branch) === branch)
    && !TERMINAL_REVIEW_JOB_STATES.has(text(job?.state).toLowerCase())
  ));
  if (activeForHead) {
    return Object.freeze({
      decision: 'WAIT_EXISTING_REVIEW',
      reason: 'active-review-job-already-exists',
      errors: Object.freeze([]),
      capacityClassification: 'REVIEW_ALREADY_ACTIVE',
      selectedProvider: null,
      duplicateDispatchAllowed: false,
      binding: Object.freeze({ repository, prNumber, branch, sourceHead, riskTier }),
    });
  }

  const providers = (Array.isArray(input.providers) ? input.providers : []).map((provider) => normalizeProvider(provider));
  const codexProviders = providers.filter(providerIsCodex);
  const explicitCodexState = text(input.codexCapacityState).toLowerCase();
  const codexUnavailable = CODEX_UNAVAILABLE_STATES.has(explicitCodexState)
    || (codexProviders.length > 0 && codexProviders.every((provider) => provider.state !== 'available'));
  const candidates = providers
    .filter((provider) => provider.providerId && provider.provider)
    .filter((provider) => provider.state === 'available')
    .filter((provider) => providerSupportsRisk(provider, riskTier))
    .map((provider) => {
      const independent = providerCanReviewIndependently(provider, { implementerProvider, implementerSessionId });
      const deterministicQuorum = !independent
        && riskTier !== 'high'
        && provider.supportsDeterministicQuorum;
      const assuranceMode = riskTier === 'high'
        ? (independent ? 'specialist' : '')
        : (independent ? 'independent' : (deterministicQuorum ? 'deterministic-quorum' : ''));
      return Object.freeze({ ...provider, assuranceMode });
    })
    .filter((provider) => provider.assuranceMode)
    .sort((left, right) => (
      assuranceRank(left.assuranceMode) - assuranceRank(right.assuranceMode)
      || right.proofQualityRank - left.proofQualityRank
      || left.costRank - right.costRank
      || left.latencyRank - right.latencyRank
      || left.providerId.localeCompare(right.providerId)
    ));

  const selectedProvider = candidates[0] || null;
  const binding = Object.freeze({ repository, prNumber, branch, sourceHead, riskTier });
  if (selectedProvider) {
    const nonCodexFallback = codexUnavailable && !providerIsCodex(selectedProvider);
    return Object.freeze({
      decision: 'ROUTE_SELECTED',
      reason: nonCodexFallback ? 'codex-unavailable-qualified-fallback-selected' : 'qualified-review-route-selected',
      errors: Object.freeze([]),
      capacityClassification: nonCodexFallback
        ? 'PROVIDER_CAPACITY_UNAVAILABLE'
        : 'PROVIDER_CAPACITY_AVAILABLE_OR_NOT_REQUIRED',
      selectedProvider: Object.freeze({
        providerId: selectedProvider.providerId,
        provider: selectedProvider.provider,
        reviewerClass: selectedProvider.reviewerClass,
        sessionId: selectedProvider.sessionId,
        assuranceMode: selectedProvider.assuranceMode,
      }),
      duplicateDispatchAllowed: false,
      binding,
    });
  }

  return Object.freeze({
    decision: riskTier === 'high' ? 'SPECIALIST_REVIEW_REQUIRED' : 'NO_QUALIFIED_REVIEW_ROUTE',
    reason: codexUnavailable ? 'provider-capacity-unavailable-no-qualified-fallback' : 'no-qualified-review-provider',
    errors: Object.freeze([]),
    capacityClassification: codexUnavailable ? 'PROVIDER_CAPACITY_UNAVAILABLE' : 'UNKNOWN_PROVIDER_CAPACITY',
    selectedProvider: null,
    duplicateDispatchAllowed: false,
    binding,
  });
}

export function buildProviderNeutralReviewerAdapterContract(reviewerClass) {
  const normalized = text(reviewerClass).toLowerCase();
  if (!PROVIDER_NEUTRAL_REVIEWER_CLASSES.includes(normalized)) {
    return Object.freeze({
      ok: false,
      reason: 'unsupported-reviewer-class',
      contract: null,
    });
  }
  return Object.freeze({
    ok: true,
    reason: 'PROVIDER_NEUTRAL_REVIEW_ADAPTER_READY',
    contract: Object.freeze({
      schemaVersion: 'stephanos.provider-neutral-review-adapter.v1',
      reviewerClass: normalized,
      exactHeadRequired: true,
      mutationAllowed: false,
      arbitraryShellAllowed: false,
      arbitraryFilesystemAllowed: false,
      credentialsReadable: false,
      rawOutputRequired: true,
      normalizedReceiptRequired: true,
      executionReceiptRequired: true,
    }),
  });
}

export function buildGitHubFirstReviewAdapterContract() {
  return buildProviderNeutralReviewerAdapterContract('github-first');
}

export function buildLocalReadonlyReviewAdapterContract() {
  return buildProviderNeutralReviewerAdapterContract('openclaw-local-readonly');
}
