import { createHash } from 'node:crypto';

export const REMOTE_CODEX_BATTLE_BRIDGE_HANDOFF_SCHEMA = 'stephanos.remote-codex-battle-bridge-handoff.v1';
export const REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE = 'CONNECTED_WINDOWS_BATTLE_BRIDGE';
export const REMOTE_CODEX_BATTLE_BRIDGE_ATTACHMENT_SCHEMA = 'stephanos.codex-dispatch-surface-attachment.v1';
export const REMOTE_CODEX_OPERATOR_APPROVAL_RECEIPT_SCHEMA = 'stephanos.remote-codex-operator-approval-receipt.v1';
export const REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_TOOLS = Object.freeze([
  'dispatch_codex_task',
  'get_codex_task_status',
  'read_codex_task_result',
]);

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const ALLOWED_OPERATION = 'dispatch_codex_task';
const SAFE_PROOF_COMMAND = /^(node|npm|git)\b(?!.*\b(reset\s+--hard|merge|push|branch\s+-d|branch\s+-D)\b)/i;
const FORBIDDEN_TEXT = /token|secret|password|credential|private key|\.env|session/i;
const FORBIDDEN_FIELDS = Object.freeze([
  'url', 'uri', 'selector', 'xpath', 'javascript', 'script', 'command', 'executable',
  'args', 'arguments', 'environment', 'env', 'token', 'credential', 'credentials', 'cookie',
  'cookies', 'session', 'password', 'secret', 'merge', 'push', 'force', 'shell', 'atCodex',
]);
const HANDOFF_FIELDS = Object.freeze([
  'schemaVersion', 'requestId', 'owningIssue', 'task', 'operatorApproval', 'operatorApprovalReceipt',
  'repository', 'expectedHead', 'exactHeadProof', 'requiredSurface', 'requiresCanLocalWindowsProof',
  'requestedProofCommands', 'createdAt', 'expiresAt', 'githubAtCodexFallbackAllowed',
  'duplicateDispatchAllowed', 'mergeAuthority', 'sourceMutationAuthority', 'arbitraryShellAllowed',
  'credentialAccessAllowed',
]);
const HANDOFF_INPUT_FIELDS = Object.freeze([
  'requestId', 'owningIssue', 'task', 'operatorApproval', 'operatorApprovalReceipt', 'repository',
  'expectedHead', 'exactHeadProof', 'requestedProofCommands', 'createdAt', 'expiresAt',
]);
const EXACT_HEAD_PROOF_FIELDS = Object.freeze([
  'repository', 'prNumber', 'expectedHead', 'proofTarget', 'pullRequestHead', 'mergeCommitHead',
  'githubMainHead', 'mergeCommitIncluded', 'proofScenario',
]);
const APPROVAL_RECEIPT_FIELDS = Object.freeze([
  'schemaVersion', 'approvalId', 'decision', 'allowedOperation', 'requestId', 'repository',
  'owningIssue', 'expectedHead', 'taskSha256', 'requestedProofCommandsSha256',
  'exactHeadProofSha256', 'approvedAt', 'expiresAt', 'bindingSha256',
]);

function blocked(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function unexpectedUnsafeField(value = {}) {
  return FORBIDDEN_FIELDS.find((field) => value[field] !== undefined) || '';
}

function validProofCommands(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 20
    && value.every((command) => typeof command === 'string' && command.length <= 300
      && SAFE_PROOF_COMMAND.test(command) && !FORBIDDEN_TEXT.test(command));
}

function hasExactFields(value, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...allowedFields].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalValue(value))).digest('hex');
}

function freezeAuthorityValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeAuthorityValue));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeAuthorityValue(item)])));
  }
  return value;
}

function validateExactHeadProof(exactHeadProof, { repository, expectedHead } = {}) {
  if (!hasExactFields(exactHeadProof, EXACT_HEAD_PROOF_FIELDS)) return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_SHAPE_INVALID');
  if (exactHeadProof.repository !== repository || exactHeadProof.repository !== REPOSITORY) return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_REPOSITORY_MISMATCH');
  if (!Number.isSafeInteger(exactHeadProof.prNumber) || exactHeadProof.prNumber < 1) return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_PR_INVALID');
  if (!SHA40.test(String(exactHeadProof.expectedHead || ''))
      || String(exactHeadProof.expectedHead).toLowerCase() !== String(expectedHead || '').toLowerCase()) {
    return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_HEAD_MISMATCH');
  }
  if (!['PULL_REQUEST_HEAD', 'PULL_REQUEST_HEAD_BASE_BOUND', 'MERGED_MAIN'].includes(exactHeadProof.proofTarget)) return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_TARGET_INVALID');
  const pullRequestHead = String(exactHeadProof.pullRequestHead || '').toLowerCase();
  const mergeCommitHead = String(exactHeadProof.mergeCommitHead || '').toLowerCase();
  const githubMainHead = String(exactHeadProof.githubMainHead || '').toLowerCase();
  if (exactHeadProof.proofTarget === 'PULL_REQUEST_HEAD'
      && (pullRequestHead || mergeCommitHead || githubMainHead || exactHeadProof.mergeCommitIncluded !== false)) {
    return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_PULL_REQUEST_FIELDS_INVALID');
  }
  if (exactHeadProof.proofTarget === 'PULL_REQUEST_HEAD_BASE_BOUND'
      && (pullRequestHead !== String(expectedHead).toLowerCase()
        || !SHA40.test(githubMainHead)
        || mergeCommitHead
        || exactHeadProof.mergeCommitIncluded !== false)) {
    return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_PULL_REQUEST_BASE_BINDING_INVALID');
  }
  if (exactHeadProof.proofTarget === 'MERGED_MAIN'
      && (![pullRequestHead, mergeCommitHead, githubMainHead].every((head) => SHA40.test(head))
        || githubMainHead !== String(expectedHead).toLowerCase()
        || exactHeadProof.mergeCommitIncluded !== true)) {
    return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_MERGED_MAIN_INVALID');
  }
  if (typeof exactHeadProof.proofScenario !== 'string'
      || exactHeadProof.proofScenario.trim() !== exactHeadProof.proofScenario
      || exactHeadProof.proofScenario.length < 8
      || exactHeadProof.proofScenario.length > 240) {
    return blocked('REMOTE_CODEX_EXACT_HEAD_PROOF_SCENARIO_INVALID');
  }
  return Object.freeze({ ok: true, verdict: 'REMOTE_CODEX_EXACT_HEAD_PROOF_VALID' });
}

function approvalBindingPayload(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    approvalId: receipt.approvalId,
    decision: receipt.decision,
    allowedOperation: receipt.allowedOperation,
    requestId: receipt.requestId,
    repository: receipt.repository,
    owningIssue: receipt.owningIssue,
    expectedHead: receipt.expectedHead,
    taskSha256: receipt.taskSha256,
    requestedProofCommandsSha256: receipt.requestedProofCommandsSha256,
    exactHeadProofSha256: receipt.exactHeadProofSha256,
    approvedAt: receipt.approvedAt,
    expiresAt: receipt.expiresAt,
  };
}

export function createRemoteCodexOperatorApprovalReceipt({
  approvalId,
  requestId,
  owningIssue,
  repository = REPOSITORY,
  expectedHead,
  task,
  requestedProofCommands,
  exactHeadProof,
  approvedAt,
  expiresAt,
  decision = 'APPROVED',
  allowedOperation = ALLOWED_OPERATION,
} = {}) {
  const approvedMs = Date.parse(String(approvedAt || ''));
  const expiresMs = Date.parse(String(expiresAt || ''));
  if (!REQUEST_ID.test(String(approvalId || '')) || !REQUEST_ID.test(String(requestId || ''))) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_ID_INVALID');
  if (!Number.isSafeInteger(owningIssue) || owningIssue < 1) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_ISSUE_INVALID');
  if (repository !== REPOSITORY) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_REPOSITORY_MISMATCH');
  if (!SHA40.test(String(expectedHead || ''))) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_HEAD_INVALID');
  if (typeof task !== 'string' || task.trim() !== task || task.length < 20 || task.length > 4000) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_TASK_INVALID');
  if (!validProofCommands(requestedProofCommands)) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_PROOF_COMMANDS_INVALID');
  const proofValidation = validateExactHeadProof(exactHeadProof, { repository, expectedHead });
  if (!proofValidation.ok) return proofValidation;
  if (decision !== 'APPROVED' || allowedOperation !== ALLOWED_OPERATION) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_DECISION_INVALID');
  if (!Number.isFinite(approvedMs) || !Number.isFinite(expiresMs) || expiresMs <= approvedMs || expiresMs - approvedMs > 6 * 60 * 60 * 1000) {
    return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_EXPIRY_INVALID');
  }
  const receipt = {
    schemaVersion: REMOTE_CODEX_OPERATOR_APPROVAL_RECEIPT_SCHEMA,
    approvalId: String(approvalId),
    decision,
    allowedOperation,
    requestId: String(requestId),
    repository,
    owningIssue,
    expectedHead: String(expectedHead).toLowerCase(),
    taskSha256: sha256(task),
    requestedProofCommandsSha256: sha256(requestedProofCommands),
    exactHeadProofSha256: sha256(exactHeadProof),
    approvedAt: new Date(approvedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
  };
  return Object.freeze({
    ok: true,
    verdict: 'REMOTE_CODEX_APPROVAL_RECEIPT_READY',
    receipt: freezeAuthorityValue({ ...receipt, bindingSha256: sha256(approvalBindingPayload(receipt)) }),
  });
}

export function validateRemoteCodexOperatorApprovalReceipt(receipt, {
  requestId,
  owningIssue,
  repository,
  expectedHead,
  task,
  requestedProofCommands,
  exactHeadProof,
  createdAt,
  expiresAt,
  now = new Date(),
} = {}) {
  if (!hasExactFields(receipt, APPROVAL_RECEIPT_FIELDS)) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_SHAPE_INVALID');
  if (receipt.schemaVersion !== REMOTE_CODEX_OPERATOR_APPROVAL_RECEIPT_SCHEMA) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_SCHEMA_MISMATCH');
  if (!REQUEST_ID.test(String(receipt.approvalId || '')) || receipt.requestId !== requestId) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_ID_MISMATCH');
  if (receipt.decision !== 'APPROVED' || receipt.allowedOperation !== ALLOWED_OPERATION) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_DECISION_INVALID');
  if (receipt.repository !== repository || receipt.repository !== REPOSITORY) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_REPOSITORY_MISMATCH');
  if (receipt.owningIssue !== owningIssue) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_ISSUE_MISMATCH');
  if (String(receipt.expectedHead || '').toLowerCase() !== String(expectedHead || '').toLowerCase()) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_HEAD_MISMATCH');
  if (receipt.taskSha256 !== sha256(task)) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_TASK_MISMATCH');
  if (receipt.requestedProofCommandsSha256 !== sha256(requestedProofCommands)) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_PROOF_COMMANDS_MISMATCH');
  if (receipt.exactHeadProofSha256 !== sha256(exactHeadProof)) return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_PROOF_MISMATCH');
  const approvedMs = Date.parse(String(receipt.approvedAt || ''));
  const createdMs = Date.parse(String(createdAt || ''));
  const receiptExpiresMs = Date.parse(String(receipt.expiresAt || ''));
  const expiresMs = Date.parse(String(expiresAt || ''));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (![approvedMs, createdMs, receiptExpiresMs, expiresMs, nowMs].every(Number.isFinite)
      || approvedMs > createdMs || receiptExpiresMs !== expiresMs || nowMs > receiptExpiresMs) {
    return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_STALE_OR_MISMATCHED');
  }
  if (!SHA64.test(String(receipt.bindingSha256 || '')) || receipt.bindingSha256 !== sha256(approvalBindingPayload(receipt))) {
    return blocked('REMOTE_CODEX_APPROVAL_RECEIPT_BINDING_INVALID');
  }
  return Object.freeze({ ok: true, verdict: 'REMOTE_CODEX_APPROVAL_RECEIPT_VALID' });
}

export function validateRemoteCodexBattleBridgeHandoff(handoff, { now = new Date() } = {}) {
  if (!hasExactFields(handoff, HANDOFF_FIELDS)) return blocked('REMOTE_CODEX_HANDOFF_SHAPE_INVALID');
  if (handoff.schemaVersion !== REMOTE_CODEX_BATTLE_BRIDGE_HANDOFF_SCHEMA) return blocked('REMOTE_CODEX_HANDOFF_SCHEMA_MISMATCH');
  if (!REQUEST_ID.test(String(handoff.requestId || ''))) return blocked('REMOTE_CODEX_HANDOFF_REQUEST_ID_INVALID');
  if (!Number.isSafeInteger(handoff.owningIssue) || handoff.owningIssue < 1) return blocked('REMOTE_CODEX_HANDOFF_ISSUE_INVALID');
  if (typeof handoff.task !== 'string' || handoff.task.trim() !== handoff.task || handoff.task.length < 20 || handoff.task.length > 4000) return blocked('REMOTE_CODEX_HANDOFF_TASK_INVALID');
  if (handoff.operatorApproval !== 'operator-approved') return blocked('REMOTE_CODEX_HANDOFF_OPERATOR_APPROVAL_REQUIRED');
  if (handoff.repository !== REPOSITORY) return blocked('REMOTE_CODEX_HANDOFF_REPOSITORY_MISMATCH');
  if (!SHA40.test(String(handoff.expectedHead || ''))) return blocked('REMOTE_CODEX_HANDOFF_EXPECTED_HEAD_INVALID');
  if (handoff.requiredSurface !== REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE || handoff.requiresCanLocalWindowsProof !== true) return blocked('REMOTE_CODEX_HANDOFF_SURFACE_INVALID');
  if (!validProofCommands(handoff.requestedProofCommands)) {
    return blocked('REMOTE_CODEX_HANDOFF_PROOF_COMMANDS_INVALID');
  }
  const noAuthority = handoff.githubAtCodexFallbackAllowed === false
    && handoff.duplicateDispatchAllowed === false
    && handoff.mergeAuthority === false
    && handoff.sourceMutationAuthority === false
    && handoff.arbitraryShellAllowed === false
    && handoff.credentialAccessAllowed === false;
  if (!noAuthority) return blocked('REMOTE_CODEX_HANDOFF_AUTHORITY_EXPANSION');
  const createdMs = Date.parse(String(handoff.createdAt || ''));
  const expiresMs = Date.parse(String(handoff.expiresAt || ''));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || !Number.isFinite(nowMs)
      || createdMs > nowMs || expiresMs <= createdMs || expiresMs - createdMs > 6 * 60 * 60 * 1000) {
    return blocked('REMOTE_CODEX_HANDOFF_EXPIRY_INVALID');
  }
  if (expiresMs <= nowMs) return blocked('REMOTE_CODEX_HANDOFF_EXPIRED');
  const proofValidation = validateExactHeadProof(handoff.exactHeadProof, {
    repository: handoff.repository,
    expectedHead: handoff.expectedHead,
  });
  if (!proofValidation.ok) return proofValidation;
  return validateRemoteCodexOperatorApprovalReceipt(handoff.operatorApprovalReceipt, {
    requestId: handoff.requestId,
    owningIssue: handoff.owningIssue,
    repository: handoff.repository,
    expectedHead: handoff.expectedHead,
    task: handoff.task,
    requestedProofCommands: handoff.requestedProofCommands,
    exactHeadProof: handoff.exactHeadProof,
    createdAt: handoff.createdAt,
    expiresAt: handoff.expiresAt,
    now,
  });
}

export function createRemoteCodexBattleBridgeHandoff(input = {}) {
  const unsafeField = unexpectedUnsafeField(input);
  if (unsafeField) return blocked('REMOTE_CODEX_HANDOFF_UNSAFE_FIELD', { field: unsafeField });
  const unexpectedField = Object.keys(input).find((field) => !HANDOFF_INPUT_FIELDS.includes(field));
  if (unexpectedField) return blocked('REMOTE_CODEX_HANDOFF_UNEXPECTED_FIELD', { field: unexpectedField });
  const createdMs = Date.parse(String(input.createdAt || ''));
  const expiresMs = Date.parse(String(input.expiresAt || ''));
  const handoff = {
    schemaVersion: REMOTE_CODEX_BATTLE_BRIDGE_HANDOFF_SCHEMA,
    requestId: String(input.requestId || ''),
    owningIssue: Number(input.owningIssue),
    task: String(input.task || '').trim(),
    operatorApproval: input.operatorApproval,
    operatorApprovalReceipt: input.operatorApprovalReceipt,
    repository: input.repository || REPOSITORY,
    expectedHead: String(input.expectedHead || '').toLowerCase(),
    exactHeadProof: input.exactHeadProof,
    requiredSurface: REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE,
    requiresCanLocalWindowsProof: true,
    requestedProofCommands: Array.isArray(input.requestedProofCommands) ? [...input.requestedProofCommands] : input.requestedProofCommands,
    createdAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : String(input.createdAt || ''),
    expiresAt: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : String(input.expiresAt || ''),
    githubAtCodexFallbackAllowed: false,
    duplicateDispatchAllowed: false,
    mergeAuthority: false,
    sourceMutationAuthority: false,
    arbitraryShellAllowed: false,
    credentialAccessAllowed: false,
  };
  const validation = validateRemoteCodexBattleBridgeHandoff(handoff, {
    now: Number.isFinite(createdMs) ? new Date(createdMs) : new Date(),
  });
  if (!validation.ok) return validation;
  return Object.freeze({
    ok: true,
    verdict: 'REMOTE_CODEX_HANDOFF_READY',
    handoff: freezeAuthorityValue(handoff),
  });
}

export function validateRemoteCodexBattleBridgeAttachment(handoff, attachment, {
  now = new Date(),
  maxAgeMs = 5 * 60 * 1000,
} = {}) {
  const handoffValidation = validateRemoteCodexBattleBridgeHandoff(handoff, { now });
  if (!handoffValidation.ok) return handoffValidation;
  if (attachment?.schemaVersion !== REMOTE_CODEX_BATTLE_BRIDGE_ATTACHMENT_SCHEMA) return blocked('BATTLE_BRIDGE_ATTACHMENT_SCHEMA_MISMATCH');
  if (attachment?.surfaceId !== 'stephanos-codex-dispatch-local-mcp') return blocked('BATTLE_BRIDGE_ATTACHMENT_SURFACE_MISMATCH');
  if (attachment?.attached !== true || attachment?.can_local_windows_proof !== true) return blocked('BATTLE_BRIDGE_EXECUTION_SURFACE_NOT_ATTACHED');
  if (!['win32', 'windows'].includes(String(attachment?.platform || '').toLowerCase())) return blocked('BATTLE_BRIDGE_PLATFORM_NOT_WINDOWS');
  const attachmentHead = String(attachment?.sourceHead || '').toLowerCase();
  if (!SHA40.test(attachmentHead)) return blocked('BATTLE_BRIDGE_ATTACHMENT_HEAD_INVALID');
  if (['PULL_REQUEST_HEAD', 'MERGED_MAIN'].includes(handoff.exactHeadProof.proofTarget)
      && attachmentHead !== String(handoff.expectedHead || '').toLowerCase()) {
    return blocked('BATTLE_BRIDGE_ATTACHMENT_HEAD_MISMATCH');
  }
  if (handoff.exactHeadProof.proofTarget === 'PULL_REQUEST_HEAD_BASE_BOUND'
      && attachmentHead !== String(handoff.exactHeadProof.githubMainHead || '').toLowerCase()) {
    return blocked('BATTLE_BRIDGE_ATTACHMENT_BASE_HEAD_MISMATCH');
  }
  if (!SHA64.test(String(attachment?.serverSourceSha256 || ''))) return blocked('BATTLE_BRIDGE_SERVER_SHA256_INVALID');
  if (!String(attachment?.surfaceReceipt || '').trim()) return blocked('BATTLE_BRIDGE_SURFACE_RECEIPT_MISSING');
  const tools = Array.isArray(attachment?.toolsListed) ? attachment.toolsListed : [];
  if (attachment?.requiredDispatchToolsPresent !== true
      || !REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_TOOLS.every((tool) => tools.includes(tool))) {
    return blocked('BATTLE_BRIDGE_REQUIRED_TOOLS_MISSING');
  }
  const observedMs = Date.parse(String(attachment?.observedAt || ''));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs) || observedMs > nowMs || nowMs - observedMs > maxAgeMs) return blocked('BATTLE_BRIDGE_ATTACHMENT_HEARTBEAT_STALE');
  return Object.freeze({ ok: true, verdict: 'REMOTE_CODEX_ATTACHMENT_ACCEPTED' });
}

export function buildRemoteCodexDispatchCall(handoff, attachment, options = {}) {
  const validation = validateRemoteCodexBattleBridgeAttachment(handoff, attachment, options);
  if (!validation.ok) return validation;
  const authorityEnvelope = freezeAuthorityValue(handoff);
  const surfaceAttachment = freezeAuthorityValue(attachment);
  return Object.freeze({
    ok: true,
    verdict: 'REMOTE_CODEX_DISPATCH_CALL_READY',
    toolName: ALLOWED_OPERATION,
    args: freezeAuthorityValue({
      requestId: handoff.requestId,
      issueNumber: handoff.owningIssue,
      task: handoff.task,
      operatorApproval: handoff.operatorApproval,
      operatorApprovalReceipt: handoff.operatorApprovalReceipt,
      repository: handoff.repository,
      expectedHead: handoff.expectedHead,
      exactHeadProof: handoff.exactHeadProof,
      branch: 'main',
      requestedProofCommands: handoff.requestedProofCommands,
      authorityEnvelope,
      surfaceAttachment,
    }),
    requiredSurface: REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE,
    surfaceReceipt: attachment.surfaceReceipt,
    sourceHead: attachment.sourceHead,
  });
}
