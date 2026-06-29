import { createMissionOperationsPacket } from './missionIntegrationV1.mjs';
import { classifyReturnConveyor } from './returnConveyorV1.mjs';

export const MISSION_ORCHESTRATOR_CONTROL_LOOP_SCHEMA_VERSION = 'mission-orchestrator-control-loop.v1';

export const ORCHESTRATOR_STATE = Object.freeze({
  WAITING_FOR_INTENT: 'WAITING_FOR_INTENT',
  INTENT_READY: 'INTENT_READY',
  DISPATCH_READY: 'DISPATCH_READY',
  WAITING_FOR_RESULT: 'WAITING_FOR_RESULT',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  REPAIR_REQUIRED: 'REPAIR_REQUIRED',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  READY_TO_COMPLETE: 'READY_TO_COMPLETE',
  UPDATING_RUNTIME: 'UPDATING_RUNTIME',
  DONE: 'DONE',
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

function hasIntent(input = {}) {
  return Boolean(text(input.intent) || text(input.idea));
}

function hasDispatchEvidence(input = {}) {
  return Boolean(text(input.dispatchId) || text(input.branch) || list(input.sourceFiles).length);
}

function repairLimitExceeded(input = {}) {
  return Number(input.repairAttempts || 0) > Number(input.maxRepairAttempts || 3);
}

export function buildMissionOrchestratorControlLoopContract() {
  return {
    schemaVersion: MISSION_ORCHESTRATOR_CONTROL_LOOP_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_orchestrator.control_loop.contract',
    states: Object.values(ORCHESTRATOR_STATE),
    hardRules: [
      'No dispatch without operator intent.',
      'No BUILDING-style state without branch, dispatch, or source evidence.',
      'Repair is bounded by maxRepairAttempts.',
      'DONE requires return completion, proof, merge/completion evidence, mission update, and runtime update.',
    ],
    finalVerdict: 'MISSION_ORCHESTRATOR_CONTROL_LOOP_CONTRACT_READY',
  };
}

export function createIntentPacket(input = {}) {
  return {
    schemaVersion: MISSION_ORCHESTRATOR_CONTROL_LOOP_SCHEMA_VERSION,
    kind: 'stephanos.mission_orchestrator.intent_packet',
    intentId: text(input.intentId, 'intent-current'),
    goalId: text(input.goalId, '#1263'),
    intent: text(input.intent || input.idea),
    idea: text(input.idea || input.intent),
    operatorApproved: input.operatorApproved === true,
    finalVerdict: hasIntent(input) ? 'MISSION_ORCHESTRATOR_INTENT_READY' : 'MISSION_ORCHESTRATOR_INTENT_MISSING',
  };
}

export function deriveOrchestratorState(input = {}) {
  const returnState = input.returnState || classifyReturnConveyor(input.returnRecord || input);
  if (text(input.blocker)) return ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (!hasIntent(input)) return ORCHESTRATOR_STATE.WAITING_FOR_INTENT;
  if (!hasDispatchEvidence(input)) return ORCHESTRATOR_STATE.INTENT_READY;
  if (!text(input.resultId) && !list(input.changedFiles).length && !text(input.summary)) return ORCHESTRATOR_STATE.WAITING_FOR_RESULT;
  if (returnState.state === 'NEEDS_PROOF') return ORCHESTRATOR_STATE.WAITING_FOR_PROOF;
  if (returnState.state === 'PROOF_FAILED') return repairLimitExceeded(input) ? ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : ORCHESTRATOR_STATE.REPAIR_REQUIRED;
  if (returnState.state === 'WAITING_FOR_APPROVAL') return ORCHESTRATOR_STATE.WAITING_FOR_APPROVAL;
  if (returnState.state === 'READY_TO_COMPLETE') return ORCHESTRATOR_STATE.READY_TO_COMPLETE;
  if (returnState.state === 'DONE' && input.updateApplied !== true) return ORCHESTRATOR_STATE.UPDATING_RUNTIME;
  if (returnState.state === 'DONE' && input.updateApplied === true) return ORCHESTRATOR_STATE.DONE;
  if (returnState.state === 'NEEDS_SUMMARY' || returnState.state === 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION') return ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  return ORCHESTRATOR_STATE.DISPATCH_READY;
}

export function createMissionOrchestratorPacket(input = {}) {
  const intent = createIntentPacket(input);
  const returnState = input.returnState || classifyReturnConveyor({
    summary: input.summary,
    changedFiles: input.changedFiles,
    proofCommand: input.proofCommand,
    proofResult: input.proofResult,
    approval: input.approval,
    prNumber: input.prNumber,
    headSha: input.headSha,
    completionSha: input.completionSha,
    missionUpdate: input.missionUpdate,
    exactUnblockAction: input.returnUnblockAction,
  });
  const state = deriveOrchestratorState({ ...input, intent: intent.intent, idea: intent.idea, returnState });
  const blocker = state === ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    ? text(input.blocker, returnState.nextAction || 'Provide exact mission orchestration unblock action.')
    : '';
  const operations = createMissionOperationsPacket({
    goalId: intent.goalId,
    idea: intent.idea || intent.intent,
    branch: input.branch,
    prNumber: input.prNumber,
    headSha: input.headSha,
    proofCommand: input.proofCommand,
    sourceFiles: input.sourceFiles,
    returnState,
    sourceMerged: Boolean(input.completionSha),
    focusedProofRecorded: /pass/i.test(text(input.proofResult)),
    missionStateUpdated: text(input.missionUpdate).length > 0,
    updateApplied: input.updateApplied === true,
    blocker,
  });

  return {
    schemaVersion: MISSION_ORCHESTRATOR_CONTROL_LOOP_SCHEMA_VERSION,
    kind: 'stephanos.mission_orchestrator.control_loop.packet',
    state,
    goalId: intent.goalId,
    intent,
    dispatch: {
      dispatchId: text(input.dispatchId),
      branch: text(input.branch),
      sourceFiles: list(input.sourceFiles),
      worker: text(input.worker, operations.currentWorker),
    },
    returnState,
    repair: {
      repairAttempts: Number(input.repairAttempts || 0),
      maxRepairAttempts: Number(input.maxRepairAttempts || 3),
      bounded: !repairLimitExceeded(input),
    },
    operations,
    blocker,
    nextAction: blocker || returnState.nextAction || operations.nextAction,
    showInMissionOperations: true,
    finalVerdict: state === ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'MISSION_ORCHESTRATOR_BLOCKED' : 'MISSION_ORCHESTRATOR_READY',
  };
}

export function validateMissionOrchestratorPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== MISSION_ORCHESTRATOR_CONTROL_LOOP_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.mission_orchestrator.control_loop.packet') errors.push('invalid-kind');
  if (!Object.values(ORCHESTRATOR_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!packet.intent || !text(packet.intent.goalId)) errors.push('missing-intent');
  if (!packet.returnState) errors.push('missing-return-state');
  if (!packet.operations) errors.push('missing-operations');
  if (packet.state === ORCHESTRATOR_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !text(packet.blocker)) errors.push('blocked-without-exact-unblock-action');
  if (packet.state === ORCHESTRATOR_STATE.DONE && (packet.returnState?.state !== 'DONE' || packet.operations?.state !== 'DONE')) errors.push('done-without-integrated-completion');
  if (packet.state === ORCHESTRATOR_STATE.REPAIR_REQUIRED && packet.repair?.bounded !== true) errors.push('repair-required-but-unbounded');
  if (packet.showInMissionOperations !== true) errors.push('missing-mission-operations-visibility');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_ORCHESTRATOR_PACKET_PASS' : 'MISSION_ORCHESTRATOR_PACKET_BLOCKED',
  };
}
