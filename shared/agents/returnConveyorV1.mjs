const RETURN_CONVEYOR_STATES = [
  'RECEIVED',
  'NEEDS_SUMMARY',
  'NEEDS_PROOF',
  'PROOF_FAILED',
  'WAITING_FOR_APPROVAL',
  'READY_TO_COMPLETE',
  'DONE',
  'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
];

const RETURN_CONVEYOR_STATE_SET = new Set(RETURN_CONVEYOR_STATES);
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const PASSING_PROOF_RESULTS = new Set(['pass', 'passed', 'success', 'succeeded', 'ok', 'green']);

function asText(value = '') {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueTextList(value) {
  return [...new Set(asArray(value).map(asText).filter(Boolean))];
}

function hasText(value) {
  return asText(value).length > 0;
}

function hasPrNumber(value) {
  if (Number.isInteger(value)) return value > 0;
  return /^[1-9][0-9]*$/.test(asText(value));
}

function isPassingProofResult(value) {
  const normalized = asText(value).toLowerCase();
  return PASSING_PROOF_RESULTS.has(normalized) || /^pass(ed)?\b/.test(normalized);
}

function normalizeSha(value) {
  const normalized = asText(value);
  return SHA_PATTERN.test(normalized) ? normalized.toLowerCase() : normalized;
}

function buildBlocker(field, action) {
  return { field, action };
}

export function createDefaultReturnConveyorInput() {
  return {
    summary: '',
    changedFiles: [],
    proofCommand: '',
    proofResult: '',
    prNumber: '',
    headSha: '',
    completionSha: '',
    mergeSha: '',
    missionUpdate: '',
    approval: '',
    exactUnblockAction: '',
  };
}

export function normalizeReturnConveyorInput(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const completionSha = normalizeSha(source.completionSha || source.mergeSha);

  return {
    ...createDefaultReturnConveyorInput(),
    summary: asText(source.summary),
    changedFiles: uniqueTextList(source.changedFiles),
    proofCommand: Array.isArray(source.proofCommand)
      ? uniqueTextList(source.proofCommand).join(' && ')
      : asText(source.proofCommand),
    proofResult: asText(source.proofResult),
    prNumber: hasPrNumber(source.prNumber) ? Number.parseInt(source.prNumber, 10) : asText(source.prNumber),
    headSha: normalizeSha(source.headSha),
    completionSha,
    mergeSha: completionSha,
    missionUpdate: asText(source.missionUpdate),
    approval: asText(source.approval).toLowerCase(),
    exactUnblockAction: asText(source.exactUnblockAction),
  };
}

export function requiredCompletionGaps(input = {}) {
  const normalized = normalizeReturnConveyorInput(input);
  const gaps = [];

  if (!hasText(normalized.summary)) gaps.push(buildBlocker('summary', 'Add the completed work summary.'));
  if (!normalized.changedFiles.length) gaps.push(buildBlocker('changedFiles', 'List every changed source file.'));
  if (!hasText(normalized.proofCommand)) gaps.push(buildBlocker('proofCommand', 'Record the focused proof command.'));
  if (!isPassingProofResult(normalized.proofResult)) gaps.push(buildBlocker('proofResult', 'Run proof and record a passing result.'));
  if (!hasPrNumber(normalized.prNumber)) gaps.push(buildBlocker('prNumber', 'Open or attach the pull request number.'));
  if (!SHA_PATTERN.test(normalized.headSha)) gaps.push(buildBlocker('headSha', 'Record the exact 40-character head SHA.'));
  if (!SHA_PATTERN.test(normalized.completionSha)) {
    gaps.push(buildBlocker('completionSha', 'Record the exact completion or merge SHA.'));
  }
  if (!hasText(normalized.missionUpdate)) gaps.push(buildBlocker('missionUpdate', 'Post the mission update.'));

  return gaps;
}

export function classifyReturnConveyor(input = {}) {
  const normalized = normalizeReturnConveyorInput(input);
  const completionGaps = requiredCompletionGaps(normalized);
  const blockers = [];
  let state = 'RECEIVED';
  let nextAction = 'Receive completed Codex/source work and classify the next required lane.';

  if (normalized.exactUnblockAction) {
    state = 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION';
    nextAction = normalized.exactUnblockAction;
    blockers.push(buildBlocker('exactUnblockAction', normalized.exactUnblockAction));
  } else if (!hasText(normalized.summary) || !normalized.changedFiles.length) {
    state = 'NEEDS_SUMMARY';
    nextAction = !hasText(normalized.summary)
      ? 'Add the completed work summary.'
      : 'List every changed source file.';
  } else if (!hasText(normalized.proofCommand) || !hasText(normalized.proofResult)) {
    state = 'NEEDS_PROOF';
    nextAction = !hasText(normalized.proofCommand)
      ? 'Record and run the focused proof command.'
      : 'Record the proof result.';
  } else if (!isPassingProofResult(normalized.proofResult)) {
    state = 'PROOF_FAILED';
    nextAction = 'Repair the source work, rerun proof, and record a passing proof result.';
  } else if (normalized.approval !== 'approved') {
    state = 'WAITING_FOR_APPROVAL';
    nextAction = 'Wait for explicit operator approval before completion or merge.';
  } else if (completionGaps.length === 0) {
    state = 'DONE';
    nextAction = 'Return conveyor complete; mission update and completion SHA are recorded.';
  } else if (hasPrNumber(normalized.prNumber) && SHA_PATTERN.test(normalized.headSha)) {
    state = 'READY_TO_COMPLETE';
    nextAction = completionGaps[0].action;
  } else {
    state = 'WAITING_FOR_APPROVAL';
    nextAction = completionGaps[0].action;
  }

  if (!RETURN_CONVEYOR_STATE_SET.has(state)) {
    state = 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION';
    nextAction = 'Route state is invalid; correct the return conveyor classifier.';
  }

  return {
    schemaVersion: 'return-conveyor.v1',
    states: RETURN_CONVEYOR_STATES,
    state,
    nextAction,
    normalized,
    completionGaps,
    blockers,
    done: state === 'DONE',
  };
}

export { RETURN_CONVEYOR_STATES };
