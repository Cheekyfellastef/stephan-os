export const SOURCE_HANDOFF_SCHEMA_VERSION = 'connector-safe-source-handoff.v1';

export const SOURCE_HANDOFF_STATE = Object.freeze({
  READY_FOR_SOURCE: 'READY_FOR_SOURCE',
  SOURCE_READY_FOR_PROOF: 'SOURCE_READY_FOR_PROOF',
  PROOF_REQUIRED: 'PROOF_REQUIRED',
  READY_TO_MERGE: 'READY_TO_MERGE',
  EMPTY_BRANCH_BLOCKED: 'EMPTY_BRANCH_BLOCKED',
  MISSING_FILE_BLOCKED: 'MISSING_FILE_BLOCKED',
  PLACEHOLDER_FILE_BLOCKED: 'PLACEHOLDER_FILE_BLOCKED',
  NO_REMOTE_BLOCKED: 'NO_REMOTE_BLOCKED',
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

function looksPlaceholder(file = {}) {
  const content = text(file.content);
  return /PASTE .* HERE|placeholder|TODO_SOURCE|<.*>/.test(content) || Number(file.lineCount || 0) <= 1;
}

function proofPassed(value = '') {
  return /pass|passed|0 failed|success/i.test(text(value));
}

export function buildSourceHandoffContract() {
  return {
    schemaVersion: SOURCE_HANDOFF_SCHEMA_VERSION,
    contractKind: 'stephanos.connector_safe_source_handoff.contract',
    states: Object.values(SOURCE_HANDOFF_STATE),
    requiredFields: ['goalId', 'targetBranch', 'proofCommand', 'files'],
    finalVerdict: 'SOURCE_HANDOFF_CONTRACT_READY',
  };
}

export function createSourceHandoffPacket(input = {}) {
  return {
    schemaVersion: SOURCE_HANDOFF_SCHEMA_VERSION,
    kind: 'stephanos.connector_safe_source_handoff.packet',
    goalId: text(input.goalId),
    targetBranch: text(input.targetBranch),
    proofCommand: text(input.proofCommand),
    hasRemote: input.hasRemote !== false,
    branchHasCommits: input.branchHasCommits === true,
    proofResult: text(input.proofResult),
    files: list(input.files).map((path) => ({ path })),
    observedFiles: Array.isArray(input.observedFiles) ? input.observedFiles : [],
    finalVerdict: 'SOURCE_HANDOFF_PACKET_READY',
  };
}

export function classifySourceHandoff(input = {}) {
  const packet = input.kind === 'stephanos.connector_safe_source_handoff.packet' ? input : createSourceHandoffPacket(input);
  const observed = Array.isArray(packet.observedFiles) ? packet.observedFiles : [];
  const expectedPaths = list(packet.files.map((file) => file.path));

  if (!packet.hasRemote) {
    return {
      state: SOURCE_HANDOFF_STATE.NO_REMOTE_BLOCKED,
      nextAction: 'Use a checkout with origin configured before source handoff or PR creation.',
      packet,
      finalVerdict: 'SOURCE_HANDOFF_NO_REMOTE_BLOCKED',
    };
  }

  if (!text(packet.goalId) || !text(packet.targetBranch) || !text(packet.proofCommand)) {
    return {
      state: SOURCE_HANDOFF_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Record goalId, targetBranch, and proofCommand before source handoff.',
      packet,
      finalVerdict: 'SOURCE_HANDOFF_MISSING_FIELDS',
    };
  }

  if (!packet.branchHasCommits && observed.length === 0) {
    return {
      state: SOURCE_HANDOFF_STATE.EMPTY_BRANCH_BLOCKED,
      nextAction: `Add expected source files to ${packet.targetBranch} before opening a PR.`,
      packet,
      finalVerdict: 'SOURCE_HANDOFF_EMPTY_BRANCH_BLOCKED',
    };
  }

  const observedPaths = new Set(observed.map((file) => text(file.path)));
  const missing = expectedPaths.filter((path) => !observedPaths.has(path));
  if (missing.length > 0) {
    return {
      state: SOURCE_HANDOFF_STATE.MISSING_FILE_BLOCKED,
      nextAction: `Create missing source file: ${missing[0]}`,
      packet,
      finalVerdict: 'SOURCE_HANDOFF_MISSING_FILE_BLOCKED',
    };
  }

  const placeholder = observed.find(looksPlaceholder);
  if (placeholder) {
    return {
      state: SOURCE_HANDOFF_STATE.PLACEHOLDER_FILE_BLOCKED,
      nextAction: `Replace placeholder source in ${placeholder.path} before proof.`,
      packet,
      finalVerdict: 'SOURCE_HANDOFF_PLACEHOLDER_BLOCKED',
    };
  }

  if (!proofPassed(packet.proofResult)) {
    return {
      state: SOURCE_HANDOFF_STATE.PROOF_REQUIRED,
      nextAction: packet.proofCommand,
      packet,
      finalVerdict: 'SOURCE_HANDOFF_PROOF_REQUIRED',
    };
  }

  return {
    state: SOURCE_HANDOFF_STATE.READY_TO_MERGE,
    nextAction: 'Source handoff complete; proof passed and merge readiness can be evaluated.',
    packet,
    finalVerdict: 'SOURCE_HANDOFF_READY_TO_MERGE',
  };
}

export function validateSourceHandoffResult(result = {}) {
  const errors = [];
  if (!Object.values(SOURCE_HANDOFF_STATE).includes(result.state)) errors.push('invalid-state');
  if (!text(result.nextAction)) errors.push('missing-next-action');
  if (!result.packet) errors.push('missing-packet');
  if (result.state.endsWith('BLOCKED') && !text(result.nextAction)) errors.push('blocked-without-exact-action');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'SOURCE_HANDOFF_RESULT_PASS' : 'SOURCE_HANDOFF_RESULT_BLOCKED',
  };
}
