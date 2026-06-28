export const VERIFICATION_HARNESS_SCHEMA_VERSION = 'verification-harness.v1';
export const VERIFICATION_RESULT_KIND = 'stephanos.verification.result';

export const VERIFICATION_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
});

export const VERIFIER_TYPES = Object.freeze([
  'BuildVerifier',
  'BackendVerifier',
  'FrontendVerifier',
  'WorkerVerifier',
  'OpenClawVerifier',
  'GitVerifier',
  'PortVerifier',
  'ProcessVerifier',
  'HealthEndpointVerifier',
  'RelayVerifier',
  'TailscaleVerifier',
  'SharedWorkspaceVerifier',
]);

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/# -]{0,240}$/i;
const LOWERCASE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_OUTPUT_PATTERN = /token|secret|password|credential|\.env|private key/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item, '')).filter(Boolean);
}

function asInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
}

function safeField(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text) return fallback;
  return SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function safeId(value, fallback) {
  const text = asText(value, fallback);
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function normalizeVerifierType(value) {
  const text = asText(value, 'HealthEndpointVerifier');
  return VERIFIER_TYPES.includes(text) ? text : 'HealthEndpointVerifier';
}

function sanitizeEvidenceLine(value) {
  const text = asText(value, '').slice(0, 300);
  if (!text || FORBIDDEN_OUTPUT_PATTERN.test(text)) return '';
  return text;
}

function sanitizeEvidence(evidence) {
  return asList(evidence).map(sanitizeEvidenceLine).filter(Boolean).slice(0, 20);
}

function normalizeProofRefs(proofRefs) {
  return asList(proofRefs).filter((ref) => {
    if (ref.startsWith('/') || ref.startsWith('//') || /^[a-z]:/i.test(ref)) return false;
    if (ref.split(/[\\/]/).some((part) => part === '..')) return false;
    return /^(proof|proofs|receipts|evidence\/receipts)\//.test(ref.replace(/\\/g, '/'));
  });
}

export function createVerifierResult(input = {}) {
  const status = input.status === VERIFICATION_STATUS.PASS ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL;
  const checkId = safeId(input.checkId, 'verification-check');
  const exitCode = asInteger(input.exitCode, null);
  const commandOutputHash = asText(input.commandOutputHash, '');
  const sha256 = asText(input.sha256, '');

  return {
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    kind: VERIFICATION_RESULT_KIND,
    checkId,
    verifierType: normalizeVerifierType(input.verifierType),
    status,
    target: safeField(input.target, 'unknown'),
    evidence: sanitizeEvidence(input.evidence),
    reason: status === VERIFICATION_STATUS.PASS ? '' : safeField(input.reason, 'verification failed'),
    durationMs: Math.max(0, asInteger(input.durationMs, 0)),
    timestampUtc: safeField(input.timestampUtc, 'pending'),
    exitCode,
    sha256: LOWERCASE_SHA256_PATTERN.test(sha256) ? sha256 : '',
    commandOutputHash: LOWERCASE_SHA256_PATTERN.test(commandOutputHash) ? commandOutputHash : '',
    proofRefs: normalizeProofRefs(input.proofRefs),
  };
}

export function validateVerifierResult(result = {}) {
  const errors = [];
  if (result.schemaVersion !== VERIFICATION_HARNESS_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (result.kind !== VERIFICATION_RESULT_KIND) errors.push('invalid-result-kind');
  if (!SAFE_ID_PATTERN.test(asText(result.checkId, ''))) errors.push('invalid-check-id');
  if (!VERIFIER_TYPES.includes(result.verifierType)) errors.push('invalid-verifier-type');
  if (![VERIFICATION_STATUS.PASS, VERIFICATION_STATUS.FAIL].includes(result.status)) errors.push('invalid-status');
  if (result.status === VERIFICATION_STATUS.FAIL && !asText(result.reason, '')) errors.push('missing-failure-reason');
  for (const line of asList(result.evidence)) {
    if (FORBIDDEN_OUTPUT_PATTERN.test(line)) errors.push('unsafe-evidence-line');
  }
  for (const ref of asList(result.proofRefs)) {
    if (!normalizeProofRefs([ref]).includes(ref)) errors.push('unsafe-proof-ref');
  }
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'VERIFIER_RESULT_PASS' : 'VERIFIER_RESULT_BLOCKED',
  };
}

export function aggregateVerificationResults(input = {}) {
  const checks = Array.isArray(input.checks) ? input.checks.map(createVerifierResult) : [];
  const validated = checks.map(validateVerifierResult);
  const failedChecks = checks.filter((check, index) => check.status !== VERIFICATION_STATUS.PASS || !validated[index].valid);
  const status = checks.length > 0 && failedChecks.length === 0 ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL;

  return {
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    kind: 'stephanos.verification.aggregate',
    aggregateId: safeId(input.aggregateId, 'verification-aggregate'),
    status,
    checks,
    evidence: checks.map((check) => `${check.checkId}: ${check.status}`),
    reason: status === VERIFICATION_STATUS.PASS ? '' : safeField(input.reason, `${failedChecks.length || 'unknown'} check(s) failed`),
    durationMs: checks.reduce((total, check) => total + check.durationMs, 0),
    timestampUtc: safeField(input.timestampUtc, 'pending'),
    finalVerdict: status === VERIFICATION_STATUS.PASS ? 'VERIFICATION_HARNESS_PASS' : 'VERIFICATION_HARNESS_FAIL',
  };
}

export function buildVerificationHarnessContract() {
  return {
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    contractKind: 'stephanos.verification.contract',
    allowedVerifierTypes: [...VERIFIER_TYPES],
    resultFields: [
      'schemaVersion',
      'kind',
      'checkId',
      'verifierType',
      'status',
      'target',
      'evidence',
      'reason',
      'durationMs',
      'timestampUtc',
      'proofRefs',
    ],
    guardrails: {
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      mutationAllowedByDefault: false,
      secretOutputAllowed: false,
      successWithoutEvidenceAllowed: false,
    },
    finalVerdict: 'VERIFICATION_HARNESS_CONTRACT_READY',
  };
}
