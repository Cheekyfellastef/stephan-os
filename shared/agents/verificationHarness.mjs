import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

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
  'FileVerifier',
  'PluginVerifier',
  'TaskVerifier',
  'OpenClawGatewayVerifier',
  'BattleBridgePreflightVerifier',
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
  if (result.status === VERIFICATION_STATUS.PASS && asList(result.evidence).length === 0) errors.push('missing-pass-evidence');
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
    overall: status === VERIFICATION_STATUS.PASS ? 'VERIFIED' : 'BLOCKED',
    evidence: checks.map((check) => `${check.checkId}: ${check.status}`),
    proofRefs: [...new Set(checks.flatMap((check) => check.proofRefs))],
    blockers: failedChecks.map((check) => `${check.checkId}: ${check.reason || check.status}`),
    operatorNeeded: failedChecks.length > 0,
    reason: status === VERIFICATION_STATUS.PASS ? '' : safeField(input.reason, `${failedChecks.length || 'unknown'} check(s) failed`),
    durationMs: checks.reduce((total, check) => total + check.durationMs, 0),
    timestampUtc: safeField(input.timestampUtc, 'pending'),
    finalVerdict: status === VERIFICATION_STATUS.PASS ? 'VERIFICATION_HARNESS_PASS' : 'VERIFICATION_HARNESS_FAIL',
    workspaceMessage: createSharedWorkspaceMessage({
      messageId: safeId(input.aggregateId, 'verification-aggregate'),
      sender: 'codex',
      recipient: 'operator',
      kind: 'verification-result',
      severity: status === VERIFICATION_STATUS.PASS ? 'info' : 'warning',
      summary: status === VERIFICATION_STATUS.PASS ? 'Verification harness proof verified.' : 'Verification harness proof blocked.',
      status: status === VERIFICATION_STATUS.PASS ? 'verified' : 'blocked',
      requiresOperator: failedChecks.length > 0,
      proofRefs: [...new Set(checks.flatMap((check) => check.proofRefs))],
    }),
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

export const BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND = 'node --test shared/agents/verificationHarness*.test.mjs shared/agents/*Verifier*.test.mjs';
export const VERIFIER_RUNNER_VERSION = 'verification-runner.v1';

function bool(value) {
  return value === true;
}

function packetEvidence(packet = {}, fields = []) {
  return fields.map((field) => `${field}=${asText(packet[field], 'unknown')}`);
}

function resultFromPacket(verifierType, packet = {}, options = {}) {
  const passed = options.pass === true;
  return createVerifierResult({
    checkId: options.checkId || verifierType.replace(/Verifier$/, '').toLowerCase(),
    verifierType,
    status: passed ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: options.target || packet.target || verifierType,
    evidence: options.evidence || packetEvidence(packet, options.fields || ['pass']),
    reason: passed ? '' : options.reason || packet.reason || `${verifierType} proof packet blocked`,
    durationMs: packet.durationMs || 0,
    timestampUtc: packet.timestampUtc || 'pending',
    proofRefs: packet.proofRefs || [],
  });
}

export function runProofPacketVerifier(name, packet = {}) {
  if (!VERIFIER_TYPES.includes(name)) {
    return createVerifierResult({
      checkId: 'unknown-verifier',
      verifierType: 'HealthEndpointVerifier',
      status: VERIFICATION_STATUS.FAIL,
      evidence: ['unknownVerifier=true'],
      reason: 'unknown verifier name failed closed',
    });
  }

  if (name === 'OpenClawGatewayVerifier') return runOpenClawGatewayVerifier(packet);
  if (name === 'BattleBridgePreflightVerifier') return runBattleBridgePreflightVerifier(packet);

  const fieldsByVerifier = {
    GitVerifier: ['repoClean', 'headMatchesOrigin', 'branch', 'head'],
    BuildVerifier: ['buildPassed', 'sourceOnly'],
    BackendVerifier: ['backendHealth', 'httpStatus'],
    FrontendVerifier: ['uiProof', 'browserProof'],
    WorkerVerifier: ['missionWorker'],
    FileVerifier: ['sourcePresent'],
    PluginVerifier: ['targetPluginSourcePresent'],
    TaskVerifier: ['stephanosBackendTask'],
  };
  const passByVerifier = {
    GitVerifier: bool(packet.repoClean) && bool(packet.headMatchesOrigin),
    BuildVerifier: bool(packet.buildPassed) && bool(packet.sourceOnly),
    BackendVerifier: packet.backendHealth === 'pass',
    FrontendVerifier: packet.uiProof === 'pass' || packet.browserProof === 'pass',
    WorkerVerifier: packet.missionWorker === 'running',
    FileVerifier: bool(packet.sourcePresent),
    PluginVerifier: bool(packet.targetPluginSourcePresent),
    TaskVerifier: ['running', 'ready'].includes(packet.stephanosBackendTask),
  };
  return resultFromPacket(name, packet, {
    pass: passByVerifier[name],
    fields: fieldsByVerifier[name] || ['pass'],
    reason: packet.reason || `${name} proof packet blocked`,
  });
}

export function runOpenClawGatewayVerifier(packet = {}) {
  let verdict = 'OPENCLAW_GATEWAY_MISSING';
  if (packet.endpointIdentity === 'openclaw-readonly-adapter-stub' || packet.mode === 'readonly_status_only') verdict = 'OPENCLAW_READONLY_ADAPTER_ONLY';
  else if (packet.unsafeRestartTarget) verdict = 'OPENCLAW_GATEWAY_UNSAFE_RESTART_TARGET';
  else if (packet.portOwnerVerified !== true || packet.processIdentityVerified !== true) verdict = 'OPENCLAW_GATEWAY_UNVERIFIED_OWNER';
  else if (packet.canExecute === true && packet.executionAllowed === true && packet.endpointIdentity !== 'openclaw-readonly-adapter-stub') verdict = 'OPENCLAW_GATEWAY_VERIFIED';
  const pass = verdict === 'OPENCLAW_GATEWAY_VERIFIED';
  return createVerifierResult({
    checkId: 'openclaw-gateway',
    verifierType: 'OpenClawGatewayVerifier',
    status: pass ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: packet.endpoint || 'OpenClaw Gateway',
    evidence: [
      `finalVerdict=${verdict}`,
      `httpStatus=${asText(packet.httpStatus, 'unknown')}`,
      `endpointIdentity=${asText(packet.endpointIdentity, 'unknown')}`,
      `canExecute=${asText(packet.canExecute, 'unknown')}`,
      `executionAllowed=${asText(packet.executionAllowed, 'unknown')}`,
      `portOwnerVerified=${asText(packet.portOwnerVerified, 'unknown')}`,
      `processIdentityVerified=${asText(packet.processIdentityVerified, 'unknown')}`,
    ],
    reason: pass ? '' : verdict,
    durationMs: packet.durationMs || 0,
    timestampUtc: packet.timestampUtc || 'pending',
    proofRefs: packet.proofRefs || [],
  });
}

export function runBattleBridgePreflightVerifier(packet = {}) {
  const checks = [
    runProofPacketVerifier('GitVerifier', packet),
    runProofPacketVerifier('BackendVerifier', packet),
    runProofPacketVerifier('OpenClawGatewayVerifier', packet.openClawGateway || packet),
    runProofPacketVerifier('WorkerVerifier', packet),
    runProofPacketVerifier('FileVerifier', packet),
    runProofPacketVerifier('PluginVerifier', packet),
    runProofPacketVerifier('TaskVerifier', packet),
  ];
  const blockers = checks.filter((check) => check.status !== VERIFICATION_STATUS.PASS).map((check) => check.reason || check.checkId);
  const pass = blockers.length === 0 && bool(packet.safeToBuild) && bool(packet.safeToInstall) && bool(packet.safeToRepair);
  return createVerifierResult({
    checkId: 'battle-bridge-preflight',
    verifierType: 'BattleBridgePreflightVerifier',
    status: pass ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: 'Battle Bridge preflight',
    evidence: [
      `repoClean=${asText(packet.repoClean, false)}`,
      `sourcePresent=${asText(packet.sourcePresent, false)}`,
      `backendHealth=${asText(packet.backendHealth, 'unknown')}`,
      `safeToInstall=${asText(packet.safeToInstall, false)}`,
      `safeToBuild=${asText(packet.safeToBuild, false)}`,
      `safeToRepair=${asText(packet.safeToRepair, false)}`,
      `blockingReasons=${blockers.join('|') || 'none'}`,
      `finalVerdict=${pass ? 'BATTLE_BRIDGE_PREFLIGHT_PASS' : 'BATTLE_BRIDGE_PREFLIGHT_BLOCKED'}`,
    ],
    reason: pass ? '' : blockers.join('; ') || 'Battle Bridge preflight blocked',
    durationMs: checks.reduce((total, check) => total + check.durationMs, 0),
    timestampUtc: packet.timestampUtc || 'pending',
    proofRefs: packet.proofRefs || [],
  });
}

export function runVerificationHarness(input = {}) {
  const checks = asList(input.verifiers).map((name) => runProofPacketVerifier(name, input.packets?.[name] || input.packet || {}));
  return aggregateVerificationResults({ aggregateId: input.aggregateId || 'verification-harness', checks });
}
