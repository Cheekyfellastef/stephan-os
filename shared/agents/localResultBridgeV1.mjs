export const LOCAL_RESULT_BRIDGE_SCHEMA_VERSION = 'local-result-bridge.v1';

export const LOCAL_RESULT_STATE = Object.freeze({
  READY_TO_RECORD: 'READY_TO_RECORD',
  RESULT_RECORDED: 'RESULT_RECORDED',
  PROOF_PASSED: 'PROOF_PASSED',
  PROOF_FAILED: 'PROOF_FAILED',
  BLOCKED_DIRTY_TREE: 'BLOCKED_DIRTY_TREE',
  BLOCKED_CONFLICT: 'BLOCKED_CONFLICT',
  BLOCKED_UNAPPROVED_ACTION: 'BLOCKED_UNAPPROVED_ACTION',
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

function proofPassed(output = '') {
  return /pass|passed|0 failed|success/i.test(text(output));
}

function proofFailed(output = '') {
  return /fail|failed|error|assertion|syntax/i.test(text(output)) && !proofPassed(output);
}

function exactHead(value = '') {
  return /^[a-f0-9]{7,40}$/i.test(text(value));
}

export function buildLocalResultBridgeContract() {
  return {
    schemaVersion: LOCAL_RESULT_BRIDGE_SCHEMA_VERSION,
    contractKind: 'stephanos.local_result_bridge.contract',
    states: Object.values(LOCAL_RESULT_STATE),
    requiredTranscriptFields: ['cwd', 'branch', 'headSha', 'actionId', 'exitCode', 'stdout', 'stderr'],
    finalVerdict: 'LOCAL_RESULT_BRIDGE_CONTRACT_READY',
  };
}

export function createLocalResultObservation(input = {}) {
  return {
    schemaVersion: LOCAL_RESULT_BRIDGE_SCHEMA_VERSION,
    kind: 'stephanos.local_result_bridge.observation',
    goalId: text(input.goalId, '#1337'),
    actionId: text(input.actionId),
    cwd: text(input.cwd),
    branch: text(input.branch),
    headSha: text(input.headSha),
    approved: input.approved === true,
    workingTreeClean: input.workingTreeClean === true,
    conflict: input.conflict === true,
    changedFiles: list(input.changedFiles),
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
    stdout: text(input.stdout),
    stderr: text(input.stderr),
    proofRequired: input.proofRequired !== false,
    exactUnblockAction: text(input.exactUnblockAction),
    finalVerdict: 'LOCAL_RESULT_OBSERVATION_READY',
  };
}

export function classifyLocalResult(input = {}) {
  const observation = input.kind === 'stephanos.local_result_bridge.observation' ? input : createLocalResultObservation(input);

  if (observation.exactUnblockAction) {
    return {
      state: LOCAL_RESULT_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: observation.exactUnblockAction,
      observation,
      finalVerdict: 'LOCAL_RESULT_BLOCKED_EXACT',
    };
  }
  if (!observation.approved) {
    return {
      state: LOCAL_RESULT_STATE.BLOCKED_UNAPPROVED_ACTION,
      nextAction: 'Approve the local result action before recording execution output.',
      observation,
      finalVerdict: 'LOCAL_RESULT_BLOCKED_UNAPPROVED',
    };
  }
  if (!observation.workingTreeClean) {
    return {
      state: LOCAL_RESULT_STATE.BLOCKED_DIRTY_TREE,
      nextAction: 'Clean, stash, or commit local changes before recording a completion result.',
      observation,
      finalVerdict: 'LOCAL_RESULT_BLOCKED_DIRTY_TREE',
    };
  }
  if (observation.conflict) {
    return {
      state: LOCAL_RESULT_STATE.BLOCKED_CONFLICT,
      nextAction: 'Resolve local conflict, rerun focused proof, then record a new result.',
      observation,
      finalVerdict: 'LOCAL_RESULT_BLOCKED_CONFLICT',
    };
  }
  if (!text(observation.actionId) || !text(observation.cwd) || !text(observation.branch) || !exactHead(observation.headSha)) {
    return {
      state: LOCAL_RESULT_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Record actionId, cwd, branch, and exact head SHA before result classification.',
      observation,
      finalVerdict: 'LOCAL_RESULT_MISSING_TRANSCRIPT_FIELDS',
    };
  }
  if (observation.exitCode === null) {
    return {
      state: LOCAL_RESULT_STATE.READY_TO_RECORD,
      nextAction: 'Record local result transcript with exit code, stdout, and stderr.',
      observation,
      finalVerdict: 'LOCAL_RESULT_READY_TO_RECORD',
    };
  }
  if (observation.proofRequired && (observation.exitCode !== 0 || proofFailed(`${observation.stdout}\n${observation.stderr}`))) {
    return {
      state: LOCAL_RESULT_STATE.PROOF_FAILED,
      nextAction: 'Repair failing proof, rerun focused proof, and record a passing result.',
      observation,
      finalVerdict: 'LOCAL_RESULT_PROOF_FAILED',
    };
  }
  if (observation.proofRequired && proofPassed(`${observation.stdout}\n${observation.stderr}`)) {
    return {
      state: LOCAL_RESULT_STATE.PROOF_PASSED,
      nextAction: 'Forward passing proof transcript to Return Conveyor and Mission Operations.',
      observation,
      finalVerdict: 'LOCAL_RESULT_PROOF_PASSED',
    };
  }
  return {
    state: LOCAL_RESULT_STATE.RESULT_RECORDED,
    nextAction: 'Forward local result transcript to Mission Operations.',
    observation,
    finalVerdict: 'LOCAL_RESULT_RECORDED',
  };
}

export function createLocalResultPacket(input = {}) {
  const classification = classifyLocalResult(input);
  return {
    schemaVersion: LOCAL_RESULT_BRIDGE_SCHEMA_VERSION,
    kind: 'stephanos.local_result_bridge.packet',
    goalId: classification.observation.goalId,
    state: classification.state,
    nextAction: classification.nextAction,
    observation: classification.observation,
    transcript: {
      cwd: classification.observation.cwd,
      branch: classification.observation.branch,
      headSha: classification.observation.headSha,
      actionId: classification.observation.actionId,
      exitCode: classification.observation.exitCode,
      stdout: classification.observation.stdout,
      stderr: classification.observation.stderr,
    },
    finalVerdict: classification.finalVerdict,
  };
}

export function validateLocalResultPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== LOCAL_RESULT_BRIDGE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.local_result_bridge.packet') errors.push('invalid-kind');
  if (!Object.values(LOCAL_RESULT_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!packet.observation) errors.push('missing-observation');
  if (!packet.transcript) errors.push('missing-transcript');
  if (!text(packet.goalId)) errors.push('missing-goal-id');
  if (packet.state.startsWith('BLOCKED') && !text(packet.nextAction)) errors.push('blocked-without-exact-action');
  if (packet.state === LOCAL_RESULT_STATE.PROOF_PASSED && packet.observation?.exitCode !== 0) errors.push('proof-passed-with-nonzero-exit');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'LOCAL_RESULT_PACKET_PASS' : 'LOCAL_RESULT_PACKET_BLOCKED',
  };
}
