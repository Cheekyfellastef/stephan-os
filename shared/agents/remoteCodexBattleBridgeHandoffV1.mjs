export const REMOTE_CODEX_BATTLE_BRIDGE_HANDOFF_SCHEMA = 'stephanos.remote-codex-battle-bridge-handoff.v1';
export const REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE = 'CONNECTED_WINDOWS_BATTLE_BRIDGE';
export const REMOTE_CODEX_BATTLE_BRIDGE_ATTACHMENT_SCHEMA = 'stephanos.codex-dispatch-surface-attachment.v1';
export const REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_TOOLS = Object.freeze([
  'dispatch_codex_task',
  'get_codex_task_status',
  'read_codex_task_result',
]);

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const FORBIDDEN_FIELDS = Object.freeze([
  'url', 'uri', 'selector', 'xpath', 'javascript', 'script', 'command', 'executable',
  'args', 'arguments', 'environment', 'env', 'token', 'credential', 'credentials', 'cookie',
  'cookies', 'session', 'password', 'secret', 'merge', 'push', 'force', 'shell', 'atCodex',
]);

function blocked(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function unexpectedUnsafeField(value = {}) {
  return FORBIDDEN_FIELDS.find((field) => value[field] !== undefined) || '';
}

export function createRemoteCodexBattleBridgeHandoff({
  requestId,
  owningIssue,
  task,
  operatorApproval,
  repository = 'Cheekyfellastef/stephan-os',
  expectedHead,
  requestedProofCommands = [],
  createdAt,
  expiresAt,
} = {}) {
  const unsafeField = unexpectedUnsafeField(arguments[0] || {});
  if (unsafeField) return blocked('REMOTE_CODEX_HANDOFF_UNSAFE_FIELD', { field: unsafeField });
  if (!REQUEST_ID.test(String(requestId || ''))) return blocked('REMOTE_CODEX_HANDOFF_REQUEST_ID_INVALID');
  if (!Number.isInteger(Number(owningIssue)) || Number(owningIssue) < 1) return blocked('REMOTE_CODEX_HANDOFF_ISSUE_INVALID');
  const boundedTask = String(task || '').trim();
  if (boundedTask.length < 20 || boundedTask.length > 4000) return blocked('REMOTE_CODEX_HANDOFF_TASK_INVALID');
  if (operatorApproval !== 'operator-approved') return blocked('REMOTE_CODEX_HANDOFF_OPERATOR_APPROVAL_REQUIRED');
  if (repository !== 'Cheekyfellastef/stephan-os') return blocked('REMOTE_CODEX_HANDOFF_REPOSITORY_MISMATCH');
  if (!SHA40.test(String(expectedHead || ''))) return blocked('REMOTE_CODEX_HANDOFF_EXPECTED_HEAD_INVALID');
  if (!Array.isArray(requestedProofCommands) || requestedProofCommands.length > 20
      || requestedProofCommands.some((value) => typeof value !== 'string' || value.length > 300)) {
    return blocked('REMOTE_CODEX_HANDOFF_PROOF_COMMANDS_INVALID');
  }
  const createdMs = Date.parse(String(createdAt || ''));
  const expiresMs = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || expiresMs <= createdMs || expiresMs - createdMs > 6 * 60 * 60 * 1000) {
    return blocked('REMOTE_CODEX_HANDOFF_EXPIRY_INVALID');
  }
  return Object.freeze({
    ok: true,
    verdict: 'REMOTE_CODEX_HANDOFF_READY',
    handoff: Object.freeze({
      schemaVersion: REMOTE_CODEX_BATTLE_BRIDGE_HANDOFF_SCHEMA,
      requestId: String(requestId),
      owningIssue: Number(owningIssue),
      task: boundedTask,
      operatorApproval: 'operator-approved',
      repository,
      expectedHead: String(expectedHead).toLowerCase(),
      requiredSurface: REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE,
      requiresCanLocalWindowsProof: true,
      requestedProofCommands: Object.freeze([...requestedProofCommands]),
      createdAt: new Date(createdMs).toISOString(),
      expiresAt: new Date(expiresMs).toISOString(),
      githubAtCodexFallbackAllowed: false,
      duplicateDispatchAllowed: false,
      mergeAuthority: false,
      sourceMutationAuthority: false,
      arbitraryShellAllowed: false,
      credentialAccessAllowed: false,
    }),
  });
}

export function validateRemoteCodexBattleBridgeAttachment(handoff, attachment, {
  now = new Date(),
  maxAgeMs = 5 * 60 * 1000,
} = {}) {
  if (handoff?.schemaVersion !== REMOTE_CODEX_BATTLE_BRIDGE_HANDOFF_SCHEMA) return blocked('REMOTE_CODEX_HANDOFF_SCHEMA_MISMATCH');
  if (attachment?.schemaVersion !== REMOTE_CODEX_BATTLE_BRIDGE_ATTACHMENT_SCHEMA) return blocked('BATTLE_BRIDGE_ATTACHMENT_SCHEMA_MISMATCH');
  if (attachment?.attached !== true || attachment?.can_local_windows_proof !== true) return blocked('BATTLE_BRIDGE_EXECUTION_SURFACE_NOT_ATTACHED');
  if (!['win32', 'windows'].includes(String(attachment?.platform || '').toLowerCase())) return blocked('BATTLE_BRIDGE_PLATFORM_NOT_WINDOWS');
  if (String(attachment?.sourceHead || '').toLowerCase() !== String(handoff.expectedHead || '').toLowerCase()) return blocked('BATTLE_BRIDGE_ATTACHMENT_HEAD_MISMATCH');
  if (!SHA64.test(String(attachment?.serverSourceSha256 || ''))) return blocked('BATTLE_BRIDGE_SERVER_SHA256_INVALID');
  if (!String(attachment?.surfaceReceipt || '').trim()) return blocked('BATTLE_BRIDGE_SURFACE_RECEIPT_MISSING');
  const tools = Array.isArray(attachment?.toolsListed) ? attachment.toolsListed : [];
  if (!REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_TOOLS.every((tool) => tools.includes(tool))) return blocked('BATTLE_BRIDGE_REQUIRED_TOOLS_MISSING');
  const observedMs = Date.parse(String(attachment?.observedAt || ''));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs) || observedMs > nowMs || nowMs - observedMs > maxAgeMs) return blocked('BATTLE_BRIDGE_ATTACHMENT_HEARTBEAT_STALE');
  if (Date.parse(handoff.expiresAt) <= nowMs) return blocked('REMOTE_CODEX_HANDOFF_EXPIRED');
  return Object.freeze({ ok: true, verdict: 'REMOTE_CODEX_ATTACHMENT_ACCEPTED' });
}

export function buildRemoteCodexDispatchCall(handoff, attachment, options = {}) {
  const validation = validateRemoteCodexBattleBridgeAttachment(handoff, attachment, options);
  if (!validation.ok) return validation;
  return Object.freeze({
    ok: true,
    verdict: 'REMOTE_CODEX_DISPATCH_CALL_READY',
    toolName: 'dispatch_codex_task',
    args: Object.freeze({
      issueNumber: handoff.owningIssue,
      task: handoff.task,
      operatorApproval: 'operator-approved',
      branch: 'main',
      requestedProofCommands: handoff.requestedProofCommands,
    }),
    requiredSurface: REMOTE_CODEX_BATTLE_BRIDGE_REQUIRED_SURFACE,
    surfaceReceipt: attachment.surfaceReceipt,
    sourceHead: attachment.sourceHead,
  });
}
