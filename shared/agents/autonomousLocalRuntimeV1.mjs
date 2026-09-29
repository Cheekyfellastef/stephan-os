export const AUTONOMOUS_LOCAL_RUNTIME_SCHEMA_VERSION = 'autonomous-local-runtime.v1';

export const LOCAL_RUNTIME_STATE = Object.freeze({
  PLAN_READY: 'PLAN_READY',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  PROOF_PASSED: 'PROOF_PASSED',
  PROOF_FAILED: 'PROOF_FAILED',
  READY_TO_MERGE: 'READY_TO_MERGE',
  MERGED_NEEDS_UPDATE: 'MERGED_NEEDS_UPDATE',
  DONE: 'DONE',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const LOCAL_RUNTIME_ACTION = Object.freeze({
  RECORD_PLAN: 'RECORD_PLAN',
  REQUEST_APPROVAL: 'REQUEST_APPROVAL',
  RUN_FOCUSED_PROOF: 'RUN_FOCUSED_PROOF',
  REPAIR_PROOF: 'REPAIR_PROOF',
  PREPARE_COMPLETION: 'PREPARE_COMPLETION',
  RECORD_COMPLETION_UPDATE: 'RECORD_COMPLETION_UPDATE',
  COMPLETE: 'COMPLETE',
  BLOCK: 'BLOCK',
});

const SAFE_ACTION_IDS = new Set([
  'repo-status',
  'branch-sync',
  'focused-proof',
  'pr-ready',
  'pr-complete',
  'duplicate-close',
  'mission-update',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function exactSha(value = '') {
  return /^[a-f0-9]{7,40}$/i.test(text(value));
}

function passed(value = '') {
  return /pass|passed|0 failed|success/i.test(text(value));
}

function failed(value = '') {
  return /fail|failed|error|assertion|syntax/i.test(text(value)) && !passed(value);
}

export function buildAutonomousLocalRuntimeContract() {
  return {
    schemaVersion: AUTONOMOUS_LOCAL_RUNTIME_SCHEMA_VERSION,
    contractKind: 'stephanos.autonomous_local_runtime.contract',
    states: Object.values(LOCAL_RUNTIME_STATE),
    actions: Object.values(LOCAL_RUNTIME_ACTION),
    safeActionIds: [...SAFE_ACTION_IDS],
    finalVerdict: 'AUTONOMOUS_LOCAL_RUNTIME_CONTRACT_READY',
  };
}

export function createLocalRuntimePlan(input = {}) {
  return {
    schemaVersion: AUTONOMOUS_LOCAL_RUNTIME_SCHEMA_VERSION,
    kind: 'stephanos.autonomous_local_runtime.plan',
    goalId: text(input.goalId, '#1342'),
    actionId: text(input.actionId, 'focused-proof'),
    branch: text(input.branch),
    prNumber: text(input.prNumber),
    headSha: text(input.headSha),
    proofCommand: text(input.proofCommand),
    approved: input.approved === true || input.operatorApproved === true,
    workingTreeClean: input.workingTreeClean === true,
    conflict: input.conflict === true,
    proofOutput: text(input.proofOutput),
    proofPassed: input.proofPassed === true || passed(input.proofOutput),
    proofFailed: input.proofFailed === true || failed(input.proofOutput),
    completed: input.completed === true,
    missionUpdated: input.missionUpdated === true,
    exactUnblockAction: text(input.exactUnblockAction),
    finalVerdict: 'AUTONOMOUS_LOCAL_RUNTIME_PLAN_READY',
  };
}

export function classifyLocalRuntimePlan(input = {}) {
  const plan = input.kind === 'stephanos.autonomous_local_runtime.plan' ? input : createLocalRuntimePlan(input);

  if (plan.exactUnblockAction) return { state: LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, action: LOCAL_RUNTIME_ACTION.BLOCK, nextAction: plan.exactUnblockAction, plan };
  if (!SAFE_ACTION_IDS.has(plan.actionId)) return { state: LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, action: LOCAL_RUNTIME_ACTION.BLOCK, nextAction: `Action ${plan.actionId || '<missing>'} is not allowlisted.`, plan };
  if (!plan.approved) return { state: LOCAL_RUNTIME_STATE.WAITING_FOR_APPROVAL, action: LOCAL_RUNTIME_ACTION.REQUEST_APPROVAL, nextAction: `Approve action ${plan.actionId}.`, plan };
  if (!plan.workingTreeClean || plan.conflict) return { state: LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, action: LOCAL_RUNTIME_ACTION.BLOCK, nextAction: plan.conflict ? 'Resolve local conflict before proof.' : 'Clean local working tree before proof.', plan };
  if (!text(plan.proofCommand)) return { state: LOCAL_RUNTIME_STATE.PLAN_READY, action: LOCAL_RUNTIME_ACTION.RECORD_PLAN, nextAction: 'Record focused proof command.', plan };
  if (!plan.proofPassed && !plan.proofFailed) return { state: LOCAL_RUNTIME_STATE.WAITING_FOR_PROOF, action: LOCAL_RUNTIME_ACTION.RUN_FOCUSED_PROOF, nextAction: plan.proofCommand, plan };
  if (plan.proofFailed) return { state: LOCAL_RUNTIME_STATE.PROOF_FAILED, action: LOCAL_RUNTIME_ACTION.REPAIR_PROOF, nextAction: 'Repair failing proof and record a new result.', plan };
  if (!text(plan.prNumber) || !exactSha(plan.headSha)) return { state: LOCAL_RUNTIME_STATE.PROOF_PASSED, action: LOCAL_RUNTIME_ACTION.PREPARE_COMPLETION, nextAction: 'Record PR number and exact head SHA.', plan };
  if (!plan.completed) return { state: LOCAL_RUNTIME_STATE.READY_TO_MERGE, action: LOCAL_RUNTIME_ACTION.PREPARE_COMPLETION, nextAction: `Complete PR ${plan.prNumber} at ${plan.headSha}.`, plan };
  if (!plan.missionUpdated) return { state: LOCAL_RUNTIME_STATE.MERGED_NEEDS_UPDATE, action: LOCAL_RUNTIME_ACTION.RECORD_COMPLETION_UPDATE, nextAction: 'Record completion evidence in Mission Operations.', plan };
  return { state: LOCAL_RUNTIME_STATE.DONE, action: LOCAL_RUNTIME_ACTION.COMPLETE, nextAction: 'Local runtime plan complete.', plan };
}

export function createAutonomousLocalRuntimePacket(input = {}) {
  const result = classifyLocalRuntimePlan(input);
  return {
    schemaVersion: AUTONOMOUS_LOCAL_RUNTIME_SCHEMA_VERSION,
    kind: 'stephanos.autonomous_local_runtime.packet',
    goalId: result.plan.goalId,
    state: result.state,
    action: result.action,
    nextAction: result.nextAction,
    plan: result.plan,
    readyToProceed: [LOCAL_RUNTIME_STATE.WAITING_FOR_PROOF, LOCAL_RUNTIME_STATE.READY_TO_MERGE].includes(result.state),
    finalVerdict: result.state === LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'AUTONOMOUS_LOCAL_RUNTIME_BLOCKED' : 'AUTONOMOUS_LOCAL_RUNTIME_READY',
  };
}

export function validateAutonomousLocalRuntimePacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== AUTONOMOUS_LOCAL_RUNTIME_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.autonomous_local_runtime.packet') errors.push('invalid-kind');
  if (!Object.values(LOCAL_RUNTIME_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!Object.values(LOCAL_RUNTIME_ACTION).includes(packet.action)) errors.push('invalid-action');
  if (!packet.plan) errors.push('missing-plan');
  if (!text(packet.nextAction)) errors.push('missing-next-action');
  if (packet.state === LOCAL_RUNTIME_STATE.READY_TO_MERGE && (!packet.plan?.proofPassed || !exactSha(packet.plan?.headSha))) errors.push('unsafe-completion-readiness');
  if (packet.state === LOCAL_RUNTIME_STATE.DONE && (!packet.plan?.completed || !packet.plan?.missionUpdated)) errors.push('done-without-completion-evidence');
  return { valid: errors.length === 0, errors, finalVerdict: errors.length === 0 ? 'AUTONOMOUS_LOCAL_RUNTIME_PACKET_PASS' : 'AUTONOMOUS_LOCAL_RUNTIME_PACKET_BLOCKED' };
}
