import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const VERIFICATION_HARNESS_SCHEMA_VERSION = 'verification-harness.v1';
export const VERIFICATION_RESULT_KIND = 'stephanos.verification.result';
export const VERIFIER_RUNNER_VERSION = 'verification-runner.v1';
export const BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND = 'node --test shared/agents/verificationHarness*.test.mjs shared/agents/*Verifier*.test.mjs';

export const VERIFICATION_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  OBSERVED: 'OBSERVED',
  BLOCKED: 'BLOCKED',
});

export const VERIFIER_TYPES = Object.freeze([
  'BuildVerifier',
  'BackendVerifier',
  'FrontendVerifier',
  'WorkerVerifier',
  'OpenClawVerifier',
  'OpenClawGatewayVerifier',
  'GitVerifier',
  'FileVerifier',
  'PluginVerifier',
  'TaskVerifier',
  'PortVerifier',
  'ProcessVerifier',
  'HealthEndpointVerifier',
  'RelayVerifier',
  'TailscaleVerifier',
  'SharedWorkspaceVerifier',
  'WorkspaceRecordVerifier',
  'ProofReferenceVerifier',
  'CommandReceiptVerifier',
  'AgentCapabilityVerifier',
  'StaleCapabilityVerifier',
  'BattleBridgePreflightVerifier',
  'PRPublicationVerifier',
]);

export const OPENCLAW_GATEWAY_VERDICTS = Object.freeze({
  VERIFIED: 'OPENCLAW_GATEWAY_VERIFIED',
  READONLY_ADAPTER_ONLY: 'OPENCLAW_READONLY_ADAPTER_ONLY',
  UNVERIFIED_OWNER: 'OPENCLAW_GATEWAY_UNVERIFIED_OWNER',
  MISSING: 'OPENCLAW_GATEWAY_MISSING',
  UNSAFE_RESTART_TARGET: 'OPENCLAW_GATEWAY_UNSAFE_RESTART_TARGET',
});

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

function asBoolean(value) {
  return value === true;
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

function proofEvidence(label, value) {
  return `${label}=${value === undefined || value === null || value === '' ? 'unknown' : value}`;
}

export function createVerifierResult(input = {}) {
  const evidence = sanitizeEvidence(input.evidence);
  const allowedStatus = Object.values(VERIFICATION_STATUS).includes(input.status) ? input.status : VERIFICATION_STATUS.FAIL;
  const status = allowedStatus === VERIFICATION_STATUS.PASS && evidence.length === 0 ? VERIFICATION_STATUS.FAIL : allowedStatus;
  const checkId = safeId(input.checkId, 'verification-check');
  const exitCode = asInteger(input.exitCode, null);
  const commandOutputHash = asText(input.commandOutputHash, '');
  const sha256 = asText(input.sha256, '');
  const finalVerdict = asText(input.finalVerdict, status === VERIFICATION_STATUS.PASS ? 'VERIFIER_RESULT_PASS' : 'VERIFIER_RESULT_BLOCKED');

  return {
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    kind: VERIFICATION_RESULT_KIND,
    checkId,
    verifierType: normalizeVerifierType(input.verifierType),
    status,
    target: safeField(input.target, 'unknown'),
    evidence,
    reason: status === VERIFICATION_STATUS.PASS || status === VERIFICATION_STATUS.OBSERVED ? '' : safeField(input.reason, evidence.length === 0 ? 'verification evidence missing' : 'verification failed'),
    durationMs: Math.max(0, asInteger(input.durationMs, 0)),
    timestampUtc: safeField(input.timestampUtc, 'pending'),
    verifierVersion: safeField(input.verifierVersion, VERIFIER_RUNNER_VERSION),
    finalVerdict,
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
  if (!Object.values(VERIFICATION_STATUS).includes(result.status)) errors.push('invalid-status');
  if (result.status === VERIFICATION_STATUS.PASS && asList(result.evidence).length === 0) errors.push('missing-success-evidence');
  if ([VERIFICATION_STATUS.FAIL, VERIFICATION_STATUS.BLOCKED].includes(result.status) && !asText(result.reason, '')) errors.push('missing-failure-reason');
  if (!asText(result.verifierVersion, '')) errors.push('missing-verifier-version');
  if (!asText(result.finalVerdict, '')) errors.push('missing-final-verdict');
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

export function projectVerificationWorkspaceMessage(input = {}) {
  const status = input.status === VERIFICATION_STATUS.PASS ? 'VERIFIED' : (input.status === VERIFICATION_STATUS.OBSERVED ? 'OBSERVED' : 'BLOCKED');
  return createSharedWorkspaceMessage({
    messageId: safeId(input.messageId, `${safeId(input.aggregateId || input.checkId, 'verification')}-proof`),
    timestampUtc: input.timestampUtc || 'pending',
    sender: input.sender || 'codex',
    recipient: input.recipient || 'operator',
    kind: 'verification-result',
    severity: input.status === VERIFICATION_STATUS.PASS ? 'info' : 'warning',
    correlationId: input.correlationId || input.aggregateId || input.checkId || 'verification',
    relatedGoal: input.relatedGoal || '#1287',
    summary: input.summary || `${input.aggregateId || input.checkId || 'verification'} ${status}`,
    status,
    requiresOperator: input.status !== VERIFICATION_STATUS.PASS || asBoolean(input.requiresOperator),
    proofRefs: input.proofRefs || [],
    body: input.body || '',
  });
}

export function aggregateVerificationResults(input = {}) {
  const checks = Array.isArray(input.checks) ? input.checks.map(createVerifierResult) : [];
  const validated = checks.map(validateVerifierResult);
  const failedChecks = checks.filter((check, index) => !validated[index].valid || [VERIFICATION_STATUS.FAIL, VERIFICATION_STATUS.BLOCKED].includes(check.status));
  let status = VERIFICATION_STATUS.FAIL;
  const invalidChecks = checks.filter((check, index) => !validated[index].valid);
  if (checks.length > 0 && invalidChecks.length === 0) {
    if (checks.some((check) => check.status === VERIFICATION_STATUS.FAIL)) status = VERIFICATION_STATUS.FAIL;
    else if (checks.some((check) => check.status === VERIFICATION_STATUS.BLOCKED)) status = VERIFICATION_STATUS.BLOCKED;
    else if (checks.some((check) => check.status === VERIFICATION_STATUS.OBSERVED)) status = VERIFICATION_STATUS.OBSERVED;
    else status = VERIFICATION_STATUS.PASS;
  }
  const blockers = failedChecks.map((check) => check.reason || `${check.checkId} ${check.status}`);
  const proofRefs = [...new Set(checks.flatMap((check) => check.proofRefs))];
  const aggregateId = safeId(input.aggregateId, 'verification-aggregate');
  const aggregate = {
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    kind: 'stephanos.verification.aggregate',
    aggregateId,
    status,
    overall: status === VERIFICATION_STATUS.PASS ? 'VERIFIED' : (status === VERIFICATION_STATUS.OBSERVED ? 'OBSERVED' : 'BLOCKED'),
    checks,
    evidence: checks.map((check) => `${check.checkId}: ${check.status}`),
    proofRefs,
    blockers,
    operatorNeeded: [VERIFICATION_STATUS.FAIL, VERIFICATION_STATUS.BLOCKED].includes(status),
    reason: [VERIFICATION_STATUS.PASS, VERIFICATION_STATUS.OBSERVED].includes(status) ? '' : safeField(input.reason, `${failedChecks.length || 'unknown'} check(s) failed`),
    durationMs: checks.reduce((total, check) => total + check.durationMs, 0),
    timestampUtc: safeField(input.timestampUtc, 'pending'),
    verifierVersion: VERIFIER_RUNNER_VERSION,
    finalVerdict: status === VERIFICATION_STATUS.PASS ? 'VERIFICATION_HARNESS_PASS' : (status === VERIFICATION_STATUS.OBSERVED ? 'VERIFICATION_HARNESS_OBSERVED' : 'VERIFICATION_HARNESS_FAIL'),
  };
  aggregate.workspaceMessage = projectVerificationWorkspaceMessage({
    ...aggregate,
    messageId: `${aggregateId}-workspace-proof`,
    summary: `${aggregateId} ${aggregate.overall}`,
  });
  return aggregate;
}


function normalizeSha(value) {
  const text = asText(value, '').toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(text) ? text : '';
}

function shaMatches(actual, expected) {
  const normalizedActual = normalizeSha(actual);
  const normalizedExpected = normalizeSha(expected);
  if (!normalizedActual || !normalizedExpected) return false;
  return normalizedActual === normalizedExpected || normalizedActual.startsWith(normalizedExpected) || normalizedExpected.startsWith(normalizedActual);
}

function normalizePrCommitList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeSha(typeof item === 'string' ? item : item?.oid || item?.sha || item?.commit?.oid)).filter(Boolean);
}

export function createPRPublicationVerifierResult(packet = {}, options = {}) {
  const prNumber = asInteger(packet.prNumber || packet.pullRequestNumber, null);
  const headBranch = safeField(packet.headBranch || packet.branch, 'unknown');
  const expectedCommit = normalizeSha(packet.expectedCommit || packet.expectedCommitSha || packet.expectedHead || packet.head);
  const remotePrHeadSha = normalizeSha(packet.remotePrHeadSha || packet.prHeadRefOid || packet.headRefOid);
  const fetchedOriginBranchSha = normalizeSha(packet.fetchedOriginBranchSha || packet.originBranchSha || packet.remoteBranchSha);
  const localHeadSha = normalizeSha(packet.localHeadSha || packet.localHead || packet.head);
  const testedHeadSha = normalizeSha(packet.testedHeadSha || packet.testedCodeSha || packet.testHead || localHeadSha);
  const prCommits = normalizePrCommitList(packet.prCommits || packet.commits);
  const expectedCommitPresent = !!expectedCommit && (shaMatches(remotePrHeadSha, expectedCommit) || prCommits.some((sha) => shaMatches(sha, expectedCommit)));
  const prHeadMatchesExpected = !!expectedCommit && shaMatches(remotePrHeadSha, expectedCommit);
  const fetchedBranchMatchesPr = shaMatches(fetchedOriginBranchSha, remotePrHeadSha);
  const localHeadMatchesPr = shaMatches(localHeadSha, remotePrHeadSha);
  const testedCodeMatchesPr = shaMatches(testedHeadSha, remotePrHeadSha);
  const prNumberPresent = prNumber !== null && prNumber > 0;
  const branchPresent = headBranch !== 'unknown';
  const pass = prNumberPresent && branchPresent && expectedCommitPresent && prHeadMatchesExpected && fetchedBranchMatchesPr && localHeadMatchesPr && testedCodeMatchesPr;
  const blockers = [];
  if (!prNumberPresent) blockers.push('pr-number-missing');
  if (!branchPresent) blockers.push('head-branch-missing');
  if (!expectedCommitPresent) blockers.push('expected-commit-missing-from-pr');
  if (!prHeadMatchesExpected) blockers.push('pr-head-does-not-match-expected-commit');
  if (!fetchedBranchMatchesPr) blockers.push('origin-branch-stale-or-missing');
  if (!localHeadMatchesPr) blockers.push('local-head-is-not-pr-head');
  if (!testedCodeMatchesPr) blockers.push('tested-code-is-not-pr-code');
  return createVerifierResult({
    checkId: 'pr-publication-proof',
    verifierType: 'PRPublicationVerifier',
    status: pass ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.BLOCKED,
    target: prNumberPresent ? `pr-${prNumber}` : 'github-pr-publication',
    evidence: [
      proofEvidence('prNumber', prNumber ?? 'unknown'),
      proofEvidence('headBranch', headBranch),
      proofEvidence('expectedCommit', expectedCommit || 'missing'),
      proofEvidence('remotePrHeadSha', remotePrHeadSha || 'missing'),
      proofEvidence('fetchedOriginBranchSha', fetchedOriginBranchSha || 'missing'),
      proofEvidence('localHeadSha', localHeadSha || 'missing'),
      proofEvidence('testedHeadSha', testedHeadSha || 'missing'),
      proofEvidence('prCommitCount', prCommits.length),
      proofEvidence('expectedCommitPresent', expectedCommitPresent),
      proofEvidence('prHeadMatchesExpected', prHeadMatchesExpected),
      proofEvidence('fetchedBranchMatchesPr', fetchedBranchMatchesPr),
      proofEvidence('localHeadMatchesPr', localHeadMatchesPr),
      proofEvidence('testedCodeMatchesPr', testedCodeMatchesPr),
    ],
    reason: pass ? '' : blockers.join(' '),
    durationMs: options.durationMs ?? 0,
    timestampUtc: options.timestampUtc || packet.timestampUtc || 'pending',
    finalVerdict: pass ? 'PR_PUBLICATION_VERIFIER_PASS' : 'PR_PUBLICATION_VERIFIER_BLOCKED',
    proofRefs: packet.proofRefs || [],
  });
}

function packetVerifier({ verifierType, checkId, target, passField, evidenceFields, passVerdict, failVerdict }) {
  return (packet = {}, options = {}) => {
    const pass = packet[passField] === true || packet.status === 'pass' || packet.status === 'PASS';
    const evidence = evidenceFields.map((field) => proofEvidence(field, packet[field]));
    return createVerifierResult({
      checkId,
      verifierType,
      status: pass ? 'PASS' : 'FAIL',
      target,
      evidence,
      reason: pass ? '' : `${checkId} proof packet did not pass`,
      durationMs: options.durationMs ?? 0,
      timestampUtc: options.timestampUtc || packet.timestampUtc || 'pending',
      finalVerdict: pass ? passVerdict : failVerdict,
      proofRefs: packet.proofRefs || [],
    });
  };
}


function resultFromValidation({ checkId, verifierType, target, validation, passVerdict, failVerdict, timestampUtc, evidence = [], proofRefs = [] }) {
  const valid = validation?.valid === true;
  return createVerifierResult({
    checkId,
    verifierType,
    status: valid ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.BLOCKED,
    target,
    evidence: [...evidence, `valid=${valid}`, `errors=${(validation?.errors || []).join('|') || 'none'}`],
    reason: valid ? '' : (validation?.refusalReason || validation?.errors?.[0] || `${checkId} blocked`),
    timestampUtc,
    finalVerdict: valid ? passVerdict : failVerdict,
    proofRefs,
  });
}

export function createWorkspaceRecordVerifierResult(packet = {}, options = {}) {
  return resultFromValidation({
    checkId: 'workspace-record-proof',
    verifierType: 'WorkspaceRecordVerifier',
    target: packet.target || 'shared-agent-workspace-record',
    validation: validateSharedWorkspaceRecord(packet.record || packet, options),
    passVerdict: 'WORKSPACE_RECORD_VERIFIER_PASS',
    failVerdict: 'WORKSPACE_RECORD_VERIFIER_BLOCKED',
    timestampUtc: options.timestampUtc || packet.timestampUtc || packet.record?.timestampUtc || 'pending',
    evidence: [`recordKind=${packet.record?.kind || packet.kind || 'unknown'}`, `recordId=${packet.record?.recordId || packet.record?.proofId || packet.record?.statusId || packet.record?.agentId || 'unknown'}`],
    proofRefs: packet.proofRefs || packet.record?.proofRefs || [],
  });
}

export function createProofReferenceVerifierResult(packet = {}, options = {}) {
  const refs = asList(packet.proofRefs || packet.refs);
  const normalized = normalizeProofRefs(refs);
  const valid = refs.length > 0 && refs.length === normalized.length;
  return createVerifierResult({
    checkId: 'proof-reference-proof',
    verifierType: 'ProofReferenceVerifier',
    status: valid ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.BLOCKED,
    target: packet.target || 'shared-workspace-proof-refs',
    evidence: [`refCount=${refs.length}`, `safeRefCount=${normalized.length}`],
    reason: valid ? '' : 'proof references missing or unsafe',
    timestampUtc: options.timestampUtc || packet.timestampUtc || 'pending',
    finalVerdict: valid ? 'PROOF_REFERENCE_VERIFIER_PASS' : 'PROOF_REFERENCE_VERIFIER_BLOCKED',
    proofRefs: normalized,
  });
}

export function createCommandReceiptVerifierResult(packet = {}, options = {}) {
  const receipt = packet.receipt || packet;
  const hasIdentity = !!asText(receipt.receiptId || receipt.commandId, '');
  const exitCode = asInteger(receipt.exitCode, null);
  const hasHash = LOWERCASE_SHA256_PATTERN.test(asText(receipt.commandOutputHash || receipt.sha256, ''));
  const arbitraryShellAllowed = receipt.arbitraryShellAllowed === true;
  const valid = hasIdentity && exitCode !== null && hasHash && !arbitraryShellAllowed;
  return createVerifierResult({
    checkId: 'command-receipt-proof',
    verifierType: 'CommandReceiptVerifier',
    status: valid ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.BLOCKED,
    target: receipt.commandId || receipt.receiptId || 'command-receipt',
    evidence: [`receiptId=${receipt.receiptId || 'unknown'}`, `exitCode=${exitCode ?? 'unknown'}`, `outputHash=${hasHash ? 'sha256' : 'missing'}`, `arbitraryShellAllowed=${arbitraryShellAllowed}`],
    reason: valid ? '' : 'command receipt missing identity exit code output hash or safe shell posture',
    timestampUtc: options.timestampUtc || receipt.timestampUtc || 'pending',
    finalVerdict: valid ? 'COMMAND_RECEIPT_VERIFIER_PASS' : 'COMMAND_RECEIPT_VERIFIER_BLOCKED',
    proofRefs: receipt.proofRefs || [],
    exitCode,
    commandOutputHash: receipt.commandOutputHash || receipt.sha256 || '',
  });
}

export function createAgentCapabilityVerifierResult(packet = {}, options = {}) {
  const record = packet.record || packet.capability || packet;
  return resultFromValidation({
    checkId: 'agent-capability-proof',
    verifierType: 'AgentCapabilityVerifier',
    target: record.agentId || 'agent-capability',
    validation: validateSharedWorkspaceRecord(record, options),
    passVerdict: 'AGENT_CAPABILITY_VERIFIER_PASS',
    failVerdict: 'AGENT_CAPABILITY_VERIFIER_BLOCKED',
    timestampUtc: options.timestampUtc || record.timestampUtc || 'pending',
    evidence: [`agentId=${record.agentId || 'unknown'}`, `mergeAuthority=${record.mergeAuthority === true}`, `arbitraryShellAllowed=${record.arbitraryShellAllowed === true}`, `mode=${record.mode || 'unknown'}`],
    proofRefs: record.proofRefs || [],
  });
}

export function createStaleCapabilityVerifierResult(packet = {}, options = {}) {
  const record = packet.record || packet.capability || packet;
  const validation = validateSharedWorkspaceRecord(record, options);
  const valid = validation.valid && !validation.stale;
  return createVerifierResult({
    checkId: 'stale-capability-proof',
    verifierType: 'StaleCapabilityVerifier',
    status: valid ? VERIFICATION_STATUS.PASS : (validation.stale ? VERIFICATION_STATUS.OBSERVED : VERIFICATION_STATUS.BLOCKED),
    target: record.agentId || 'agent-capability-staleness',
    evidence: [`agentId=${record.agentId || 'unknown'}`, `classification=${validation.classification}`, `stale=${validation.stale}`],
    reason: valid || validation.stale ? '' : (validation.refusalReason || 'capability record invalid'),
    timestampUtc: options.timestampUtc || record.timestampUtc || 'pending',
    finalVerdict: valid ? 'STALE_CAPABILITY_VERIFIER_PASS' : (validation.stale ? 'CAPABILITY_RECORD_STALE_OBSERVED' : 'STALE_CAPABILITY_VERIFIER_BLOCKED'),
    proofRefs: record.proofRefs || [],
  });
}

export const VerifierFactories = Object.freeze({
  GitVerifier: packetVerifier({ verifierType: 'GitVerifier', checkId: 'git-proof', target: 'repo-source', passField: 'repoClean', evidenceFields: ['repoExists', 'branch', 'head', 'originMain', 'repoClean', 'ahead', 'behind'], passVerdict: 'GIT_VERIFIER_PASS', failVerdict: 'GIT_VERIFIER_BLOCKED' }),
  BuildVerifier: packetVerifier({ verifierType: 'BuildVerifier', checkId: 'build-proof', target: 'source-build', passField: 'buildPassed', evidenceFields: ['buildPassed', 'script', 'artifactScope'], passVerdict: 'BUILD_VERIFIER_PASS', failVerdict: 'BUILD_VERIFIER_BLOCKED' }),
  BackendVerifier: packetVerifier({ verifierType: 'BackendVerifier', checkId: 'backend-proof', target: 'stephanos-backend', passField: 'backendHealthy', evidenceFields: ['backendHealthy', 'httpStatus', 'endpoint'], passVerdict: 'BACKEND_VERIFIER_PASS', failVerdict: 'BACKEND_VERIFIER_BLOCKED' }),
  FrontendVerifier: packetVerifier({ verifierType: 'FrontendVerifier', checkId: 'frontend-proof', target: 'stephanos-frontend', passField: 'frontendHealthy', evidenceFields: ['frontendHealthy', 'uiReality', 'browserProof'], passVerdict: 'FRONTEND_VERIFIER_PASS', failVerdict: 'FRONTEND_VERIFIER_BLOCKED' }),
  WorkerVerifier: packetVerifier({ verifierType: 'WorkerVerifier', checkId: 'worker-proof', target: 'mission-worker', passField: 'workerRunning', evidenceFields: ['workerRunning', 'workerMode', 'taskState'], passVerdict: 'WORKER_VERIFIER_PASS', failVerdict: 'WORKER_VERIFIER_BLOCKED' }),
  FileVerifier: packetVerifier({ verifierType: 'FileVerifier', checkId: 'file-proof', target: 'required-files', passField: 'filesPresent', evidenceFields: ['filesPresent', 'sourcePresent', 'targetPluginSourcePresent'], passVerdict: 'FILE_VERIFIER_PASS', failVerdict: 'FILE_VERIFIER_BLOCKED' }),
  PluginVerifier: packetVerifier({ verifierType: 'PluginVerifier', checkId: 'plugin-proof', target: 'plugin-runtime', passField: 'pluginRuntimePresent', evidenceFields: ['pluginRuntimePresent', 'targetPluginSourcePresent'], passVerdict: 'PLUGIN_VERIFIER_PASS', failVerdict: 'PLUGIN_VERIFIER_BLOCKED' }),
  TaskVerifier: packetVerifier({ verifierType: 'TaskVerifier', checkId: 'task-proof', target: 'stephanos-backend-task', passField: 'taskReady', evidenceFields: ['taskReady', 'stephanosBackendTask'], passVerdict: 'TASK_VERIFIER_PASS', failVerdict: 'TASK_VERIFIER_BLOCKED' }),
  OpenClawGatewayVerifier: (packet = {}, options = {}) => createOpenClawGatewayVerifierResult(packet, options),
  SharedWorkspaceVerifier: (packet = {}, options = {}) => createWorkspaceRecordVerifierResult(packet, options),
  WorkspaceRecordVerifier: (packet = {}, options = {}) => createWorkspaceRecordVerifierResult(packet, options),
  ProofReferenceVerifier: (packet = {}, options = {}) => createProofReferenceVerifierResult(packet, options),
  CommandReceiptVerifier: (packet = {}, options = {}) => createCommandReceiptVerifierResult(packet, options),
  AgentCapabilityVerifier: (packet = {}, options = {}) => createAgentCapabilityVerifierResult(packet, options),
  StaleCapabilityVerifier: (packet = {}, options = {}) => createStaleCapabilityVerifierResult(packet, options),
  PRPublicationVerifier: (packet = {}, options = {}) => createPRPublicationVerifierResult(packet, options),
});

export function createOpenClawGatewayVerifierResult(packet = {}, options = {}) {
  const requiresExecution = packet.requiresExecution !== false;
  const endpointIdentity = asText(packet.endpointIdentity, 'unknown');
  const command = asText(packet.command, '');
  const executableGateway = endpointIdentity !== 'openclaw-readonly-adapter-stub' && packet.httpStatus === 200 && packet.canExecute === true && /openclaw.*gateway/i.test(command);
  let finalVerdict = OPENCLAW_GATEWAY_VERDICTS.MISSING;
  let reason = 'OpenClaw gateway missing';
  if (endpointIdentity === 'openclaw-readonly-adapter-stub' || packet.mode === 'readonly_status_only') {
    finalVerdict = OPENCLAW_GATEWAY_VERDICTS.READONLY_ADAPTER_ONLY;
    reason = 'OpenClaw readonly adapter cannot prove executable gateway readiness';
  } else if (packet.safeRestartTarget && packet.safeRestartTarget !== 'none' && packet.safeRestartTargetVerified !== true) {
    finalVerdict = OPENCLAW_GATEWAY_VERDICTS.UNSAFE_RESTART_TARGET;
    reason = 'OpenClaw restart target is not verified safe';
  } else if (packet.httpStatus === 200 && !executableGateway) {
    finalVerdict = OPENCLAW_GATEWAY_VERDICTS.UNVERIFIED_OWNER;
    reason = 'OpenClaw listener owner is unverified';
  } else if (executableGateway || !requiresExecution) {
    finalVerdict = OPENCLAW_GATEWAY_VERDICTS.VERIFIED;
    reason = '';
  }
  return createVerifierResult({
    checkId: 'openclaw-gateway-proof',
    verifierType: 'OpenClawGatewayVerifier',
    status: finalVerdict === OPENCLAW_GATEWAY_VERDICTS.VERIFIED ? 'PASS' : 'FAIL',
    target: packet.endpoint || 'openclaw-gateway',
    evidence: [proofEvidence('httpStatus', packet.httpStatus), proofEvidence('endpointIdentity', endpointIdentity), proofEvidence('canExecute', packet.canExecute), proofEvidence('safeRestartTarget', packet.safeRestartTarget || 'none')],
    reason,
    durationMs: options.durationMs ?? 0,
    timestampUtc: options.timestampUtc || packet.timestampUtc || 'pending',
    finalVerdict,
    proofRefs: packet.proofRefs || [],
  });
}

export function runVerifier(name, packet = {}, options = {}) {
  const factory = VerifierFactories[name];
  if (!factory) {
    return createVerifierResult({
      checkId: 'unknown-verifier',
      verifierType: 'HealthEndpointVerifier',
      status: 'FAIL',
      target: 'verification-harness',
      evidence: ['allowlistedVerifier=false'],
      reason: 'verifier name is not allowlisted',
      timestampUtc: options.timestampUtc || 'pending',
      finalVerdict: 'UNKNOWN_VERIFIER_BLOCKED',
    });
  }
  return factory(packet, options);
}

export function runVerificationHarness(input = {}) {
  const checks = asList(input.verifiers).map((name) => runVerifier(name, input.packets?.[name] || {}, input));
  return aggregateVerificationResults({ aggregateId: input.aggregateId || 'verification-run', checks, timestampUtc: input.timestampUtc || 'pending' });
}

export function runBattleBridgePreflightVerifier(packet = {}, options = {}) {
  const checks = [
    runVerifier('GitVerifier', packet.git || packet, options),
    runVerifier('BackendVerifier', packet.backend || packet, options),
    runVerifier('OpenClawGatewayVerifier', packet.openClawGateway || packet.openClaw || packet, options),
    runVerifier('WorkerVerifier', packet.worker || packet, options),
    runVerifier('FileVerifier', packet.files || packet, options),
    runVerifier('PluginVerifier', packet.plugin || packet, options),
    runVerifier('TaskVerifier', packet.task || packet, options),
  ];
  const aggregate = aggregateVerificationResults({ aggregateId: 'battle-bridge-preflight', checks, timestampUtc: options.timestampUtc || packet.timestampUtc || 'pending' });
  const blockingReasons = aggregate.blockers;
  return {
    ...aggregate,
    kind: 'stephanos.verification.battle_bridge_preflight',
    repoClean: packet.git?.repoClean === true || packet.repoClean === true,
    expectedHead: packet.git?.expectedHead === true || packet.expectedHead === true,
    sourcePresent: packet.files?.sourcePresent === true || packet.sourcePresent === true,
    backendHealth: checks[1].status === 'PASS' ? 'pass' : 'fail',
    openClawGateway: checks[2].status === 'PASS' ? 'running' : 'unknown',
    missionWorker: checks[3].status === 'PASS' ? 'running' : 'unknown',
    safeToInstall: aggregate.status === 'PASS',
    safeToBuild: aggregate.status === 'PASS',
    safeToRepair: aggregate.status === 'PASS',
    blockingReasons,
    finalVerdict: aggregate.status === 'PASS' ? 'BATTLE_BRIDGE_PREFLIGHT_PASS' : 'BATTLE_BRIDGE_PREFLIGHT_BLOCKED',
  };
}

export function buildVerificationHarnessContract() {
  return {
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    contractKind: 'stephanos.verification.contract',
    allowedVerifierTypes: [...VERIFIER_TYPES],
    resultStatuses: Object.values(VERIFICATION_STATUS),
    sharedWorkspaceWriter: 'writeVerificationPacketToSharedWorkspace',
    resultFields: ['schemaVersion', 'kind', 'checkId', 'verifierType', 'status', 'target', 'evidence', 'reason', 'durationMs', 'timestampUtc', 'verifierVersion', 'finalVerdict', 'proofRefs', 'workspaceMessage'],
    guardrails: { arbitraryShellAllowed: false, arbitraryPowerShellAllowed: false, mutationAllowedByDefault: false, secretOutputAllowed: false, successWithoutEvidenceAllowed: false },
    finalVerdict: 'VERIFICATION_HARNESS_CONTRACT_READY',
  };
}


export async function writeVerificationPacketToSharedWorkspace(root, aggregate, options = {}) {
  const timestampUtc = safeField(options.timestampUtc || aggregate.timestampUtc, 'pending');
  const aggregateId = safeId(aggregate.aggregateId, 'verification-aggregate');
  const proof = createSharedWorkspaceProofRecord({
    proofId: `${aggregateId}-verification`,
    timestampUtc,
    status: aggregate.status,
    summary: `${aggregateId} ${aggregate.overall}`,
    correlationId: aggregate.correlationId || aggregateId,
    relatedIssue: aggregate.relatedIssue || aggregate.relatedGoal || '#1287',
    proofRefs: [`proof/${aggregateId}-verification.json`, ...(aggregate.proofRefs || [])],
    refs: aggregate.proofRefs || [],
  });
  const status = createSharedWorkspaceStatusRecord({
    statusId: `${aggregateId}-status`,
    timestampUtc,
    status: aggregate.overall,
    summary: aggregate.reason || `${aggregateId} verification ${aggregate.overall}`,
    proofRefs: [`proof/${aggregateId}-verification.json`, ...(aggregate.proofRefs || [])],
  });
  const event = createSharedWorkspaceEventRecord({
    eventId: `${aggregateId}-event`,
    timestampUtc,
    eventKind: 'verification-result',
    summary: `${aggregateId} verification packet emitted`,
  });
  const proofWrite = await writeAtomicJson(root, ['proof', `${aggregateId}-verification.json`], proof, options);
  if (!proofWrite.ok) return { ok: false, reason: proofWrite.reason, proofWrite };
  const statusWrite = await writeAtomicJson(root, ['status', `${aggregateId}-status.json`], status, options);
  if (!statusWrite.ok) return { ok: false, reason: statusWrite.reason, proofWrite, statusWrite };
  const eventWrite = await appendWorkspaceJsonl(root, ['events', 'verification-results.jsonl'], event, options);
  if (!eventWrite.ok) return { ok: false, reason: eventWrite.reason, proofWrite, statusWrite, eventWrite };
  return { ok: true, reason: 'VERIFICATION_PACKET_WRITTEN', proof, status, event, proofWrite, statusWrite, eventWrite };
}
