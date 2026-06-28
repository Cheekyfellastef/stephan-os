export const SHARED_AGENT_WORKSPACE_SCHEMA_VERSION = 'shared-agent-workspace.v1';
export const SHARED_AGENT_WORKSPACE_MESSAGE_KIND = 'stephanos.shared_workspace.message';

export const DEFAULT_SHARED_WORKSPACE_ROOT = '%USERPROFILE%/Documents/Stephanos-openclaw-workspace';

export const SHARED_WORKSPACE_DIRECTORIES = Object.freeze([
  'inbox',
  'outbox',
  'events',
  'status',
  'proof',
  'logs',
  'commands',
  'receipts',
  'archive',
]);

export const SHARED_WORKSPACE_PARTICIPANTS = Object.freeze([
  'operator',
  'stephanos',
  'openclaw',
  'chatgpt',
  'codex',
  'powershell',
  'mission-orchestrator',
  'future-agent',
]);

export const SHARED_WORKSPACE_EVENT_KINDS = Object.freeze([
  'status',
  'request',
  'response',
  'proof',
  'warning',
  'error',
  'approval-request',
  'approval-result',
  'heartbeat',
  'command-intent',
  'command-result',
  'handoff',
  'bootstrap-request-received',
  'service-start-attempted',
  'service-start-result',
  'health-check-result',
  'verification-result',
  'blocked-reason',
  'operator-action-required',
  'codex-job-created',
  'codex-job-ready',
  'codex-dispatch-attempted',
  'codex-blocked-by-meter',
  'codex-accepted',
  'codex-result-received',
  'codex-pr-created',
  'codex-checks-updated',
  'codex-waiting-operator',
  'codex-complete',
]);

const PARTICIPANT_ALIASES = Object.freeze({
  human: 'operator',
  user: 'operator',
  stephan: 'operator',
  stephanos: 'stephanos',
  openclaw: 'openclaw',
  standalone: 'openclaw',
  chatgpt: 'chatgpt',
  codex: 'codex',
  powershell: 'powershell',
  worker: 'mission-orchestrator',
  'mission-worker': 'mission-orchestrator',
  'mission-orchestrator': 'mission-orchestrator',
});

const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/# -]{0,240}$/i;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const UNSAFE_PATH_PATTERN = /(^|\/)(\.git|node_modules|apps\/stephanos\/dist|stephanos-server\/data)(\/|$)|^(runtime|runtime-data|root-data|data|tmp)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asBoolean(value) {
  return value === true;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item, '')).filter(Boolean);
}

function uniqueList(items) {
  return [...new Set(asList(items))];
}

function normalizeWorkspacePath(path) {
  return asText(path, '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function isUnsafeWorkspaceRef(path) {
  const text = normalizeWorkspacePath(path);
  if (!text) return true;
  if (text.startsWith('/') || text.startsWith('//') || /^[a-z]:\//i.test(text)) return true;
  if (text.split('/').some((part) => part === '..')) return true;
  return UNSAFE_PATH_PATTERN.test(text);
}

function safeField(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text) return fallback;
  return SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

export function normalizeSharedWorkspaceParticipant(value) {
  const text = asText(value, '').toLowerCase();
  return PARTICIPANT_ALIASES[text] || (SHARED_WORKSPACE_PARTICIPANTS.includes(text) ? text : 'future-agent');
}

export function normalizeSharedWorkspaceKind(value) {
  const text = asText(value, '').toLowerCase();
  return SHARED_WORKSPACE_EVENT_KINDS.includes(text) ? text : 'status';
}

export function buildSharedAgentWorkspaceContract(options = {}) {
  const root = normalizeWorkspacePath(options.root || DEFAULT_SHARED_WORKSPACE_ROOT);
  return {
    schemaVersion: SHARED_AGENT_WORKSPACE_SCHEMA_VERSION,
    contractKind: 'stephanos.shared_workspace.contract',
    root,
    directories: [...SHARED_WORKSPACE_DIRECTORIES],
    participants: [...SHARED_WORKSPACE_PARTICIPANTS],
    eventKinds: [...SHARED_WORKSPACE_EVENT_KINDS],
    writePolicy: {
      sourceRepositoryWritesAllowed: false,
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      approvalSpoofingAllowed: false,
      generatedArtifactWritesAllowed: false,
      secretDumpingAllowed: false,
    },
    requiredMessageFields: [
      'schemaVersion',
      'messageId',
      'timestampUtc',
      'sender',
      'recipient',
      'channel',
      'kind',
      'severity',
      'correlationId',
      'summary',
      'status',
      'requiresOperator',
    ],
    finalVerdict: 'SHARED_AGENT_WORKSPACE_CONTRACT_READY',
  };
}

export function createSharedWorkspaceMessage(input = {}) {
  const sender = normalizeSharedWorkspaceParticipant(input.sender);
  const recipient = normalizeSharedWorkspaceParticipant(input.recipient || 'operator');
  const kind = normalizeSharedWorkspaceKind(input.kind);
  const proofRefs = uniqueList(input.proofRefs).filter((ref) => !isUnsafeWorkspaceRef(ref));
  const changedFiles = uniqueList(input.changedFiles).filter((ref) => !isUnsafeWorkspaceRef(ref));
  const messageId = safeField(input.messageId, `${sender}-${kind}-pending`);

  return {
    schemaVersion: SHARED_AGENT_WORKSPACE_SCHEMA_VERSION,
    kind: SHARED_AGENT_WORKSPACE_MESSAGE_KIND,
    messageId: SAFE_ID_PATTERN.test(messageId) ? messageId : `${sender}-${kind}-pending`,
    timestampUtc: safeField(input.timestampUtc, 'pending'),
    sender,
    recipient,
    channel: safeField(input.channel, 'shared-workspace'),
    eventKind: kind,
    severity: safeField(input.severity, 'info'),
    correlationId: safeField(input.correlationId, messageId),
    relatedGoal: safeField(input.relatedGoal, ''),
    relatedPr: safeField(input.relatedPr, ''),
    summary: safeField(input.summary, 'No summary supplied.'),
    body: asText(input.body, '').slice(0, 2000),
    changedFiles,
    proofRefs,
    status: safeField(input.status, 'pending'),
    requiresOperator: asBoolean(input.requiresOperator),
    expiresAtUtc: safeField(input.expiresAtUtc, ''),
  };
}

export function validateSharedWorkspaceMessage(message = {}) {
  const errors = [];
  if (message.schemaVersion !== SHARED_AGENT_WORKSPACE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (message.kind !== SHARED_AGENT_WORKSPACE_MESSAGE_KIND) errors.push('invalid-message-kind');
  if (!SAFE_ID_PATTERN.test(asText(message.messageId, ''))) errors.push('invalid-message-id');
  if (!SHARED_WORKSPACE_PARTICIPANTS.includes(message.sender)) errors.push('invalid-sender');
  if (!SHARED_WORKSPACE_PARTICIPANTS.includes(message.recipient)) errors.push('invalid-recipient');
  if (!SHARED_WORKSPACE_EVENT_KINDS.includes(message.eventKind)) errors.push('invalid-event-kind');
  for (const ref of asList(message.proofRefs)) {
    if (isUnsafeWorkspaceRef(ref)) errors.push('unsafe-proof-ref');
  }
  for (const ref of asList(message.changedFiles)) {
    if (isUnsafeWorkspaceRef(ref)) errors.push('unsafe-changed-file-ref');
  }
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'SHARED_WORKSPACE_MESSAGE_PASS' : 'SHARED_WORKSPACE_MESSAGE_BLOCKED',
  };
}
