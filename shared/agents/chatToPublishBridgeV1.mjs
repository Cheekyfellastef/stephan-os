import { validatePublishSourceScope } from './repositoryNativePublishMergeLane.mjs';

export const CHAT_TO_PUBLISH_SCHEMA_VERSION = 'chat-to-publish-bridge.v1';

export const PACKET_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  READY_FOR_PUBLISH_LANE: 'READY_FOR_PUBLISH_LANE',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function normalizeFile(input = {}) {
  return {
    path: text(input.path),
    content: text(input.content),
  };
}

function sourceFilePaths(sourceFiles = []) {
  return sourceFiles.map((file) => file.path).filter(Boolean);
}

function defaultForbiddenFiles() {
  return [
    'runtime/**',
    'tmp/**',
    'memory/**',
    'node_modules/**',
    '.env*',
    '**/*secret*',
    '**/*token*',
  ];
}

function scopeBlockers(scope = {}) {
  if (Array.isArray(scope.errors)) return scope.errors;
  if (Array.isArray(scope.blockers)) return scope.blockers;
  if (Array.isArray(scope.violations)) return scope.violations;
  if (scope.valid === false && scope.finalVerdict) return [scope.finalVerdict];
  return [];
}

export function buildChatToPublishBridgeContract() {
  return {
    schemaVersion: CHAT_TO_PUBLISH_SCHEMA_VERSION,
    contractKind: 'stephanos.chat_to_publish_bridge.contract',
    packetStatuses: Object.values(PACKET_STATUS),
    completionRule: 'A chat packet is complete only after publish lane merge evidence and proof are recorded.',
    finalVerdict: 'CHAT_TO_PUBLISH_BRIDGE_CONTRACT_READY',
  };
}

export function createChatToPublishPacket(input = {}) {
  const sourceFiles = (Array.isArray(input.sourceFiles) ? input.sourceFiles : []).map(normalizeFile);
  const allowedFiles = list(input.allowedFiles).length ? list(input.allowedFiles) : sourceFilePaths(sourceFiles);
  const proofCommand = text(input.proofCommand);
  const goalId = text(input.goalId, '#unknown');
  const branch = text(input.branch, `feature/${goalId.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-chat-publish`);

  return {
    schemaVersion: CHAT_TO_PUBLISH_SCHEMA_VERSION,
    kind: 'stephanos.chat_to_publish_bridge.packet',
    goalId,
    title: text(input.title, `Publish source slice for ${goalId}`),
    branch,
    sourceFiles,
    allowedFiles,
    forbiddenFiles: list(input.forbiddenFiles).length ? list(input.forbiddenFiles) : defaultForbiddenFiles(),
    proofCommand,
    prTitle: text(input.prTitle, `Advance ${goalId}`),
    prBody: text(input.prBody, `Source slice for ${goalId}. Proof: ${proofCommand}`),
    exactHeadMergeRequired: input.exactHeadMergeRequired !== false,
    approvalGated: input.approvalGated !== false,
    expectedCompletionPacket: {
      goalId,
      requiresPrNumber: true,
      requiresHeadSha: true,
      requiresMergeSha: true,
      requiresProofResult: true,
    },
    finalVerdict: 'CHAT_TO_PUBLISH_PACKET_CREATED',
  };
}

export function validateChatToPublishPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== CHAT_TO_PUBLISH_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.chat_to_publish_bridge.packet') errors.push('invalid-kind');
  if (!text(packet.goalId)) errors.push('missing-goal-id');
  if (!text(packet.branch)) errors.push('missing-branch');
  if (!Array.isArray(packet.sourceFiles) || packet.sourceFiles.length === 0) errors.push('missing-source-files');
  if (!text(packet.proofCommand)) errors.push('missing-proof-command');
  if (packet.exactHeadMergeRequired !== true) errors.push('exact-head-merge-required');
  if (packet.approvalGated !== true) errors.push('approval-gated-required');

  const sourceFiles = Array.isArray(packet.sourceFiles) ? packet.sourceFiles.map(normalizeFile) : [];
  for (const file of sourceFiles) {
    if (!file.path) errors.push('source-file-missing-path');
    if (!file.content) errors.push(`source-file-missing-content:${file.path || 'unknown'}`);
  }

  const scope = validatePublishSourceScope({
    files: sourceFilePaths(sourceFiles),
    allowDist: packet.allowDist === true,
  });
  errors.push(...scopeBlockers(scope));

  return {
    valid: errors.length === 0,
    errors,
    status: errors.length === 0 ? PACKET_STATUS.READY_FOR_PUBLISH_LANE : PACKET_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    exactUnblockAction: errors.length === 0 ? '' : `Fix chat publish packet: ${errors.join(', ')}`,
    finalVerdict: errors.length === 0 ? 'CHAT_TO_PUBLISH_PACKET_PASS' : 'CHAT_TO_PUBLISH_PACKET_BLOCKED',
  };
}

export function createBattleBridgePublishCommand(packet = {}) {
  const validation = validateChatToPublishPacket(packet);
  if (!validation.valid) {
    return {
      schemaVersion: CHAT_TO_PUBLISH_SCHEMA_VERSION,
      kind: 'stephanos.chat_to_publish_bridge.command',
      status: PACKET_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      command: '',
      validation,
      finalVerdict: 'CHAT_TO_PUBLISH_COMMAND_BLOCKED',
    };
  }

  const packetPath = text(packet.packetPath, `tmp/chat-publish/${packet.goalId.replace(/[^0-9a-z]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.json`);
  return {
    schemaVersion: CHAT_TO_PUBLISH_SCHEMA_VERSION,
    kind: 'stephanos.chat_to_publish_bridge.command',
    status: PACKET_STATUS.READY_FOR_PUBLISH_LANE,
    packetPath,
    command: `npm run stephanos:publish-merge -- --packet ${packetPath}`,
    validation,
    finalVerdict: 'CHAT_TO_PUBLISH_COMMAND_READY',
  };
}

export function createChatToPublishCompletion(input = {}) {
  const proofPassed = input.proofPassed === true;
  const merged = Boolean(text(input.prNumber) && text(input.headSha) && text(input.mergeSha));
  const done = proofPassed && merged;
  return {
    schemaVersion: CHAT_TO_PUBLISH_SCHEMA_VERSION,
    kind: 'stephanos.chat_to_publish_bridge.completion',
    goalId: text(input.goalId, '#unknown'),
    prNumber: text(input.prNumber),
    headSha: text(input.headSha),
    mergeSha: text(input.mergeSha),
    proofCommand: text(input.proofCommand),
    proofPassed,
    status: done ? 'DONE' : PACKET_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    finalVerdict: done ? 'CHAT_TO_PUBLISH_COMPLETION_DONE' : 'CHAT_TO_PUBLISH_COMPLETION_BLOCKED',
  };
}
