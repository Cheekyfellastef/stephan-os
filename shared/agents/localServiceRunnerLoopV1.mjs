import {
  SERVICE_QUEUE_STATE,
  classifyLocalServiceWorkItem,
  createLocalServiceQueuePacket,
} from './localServiceQueueV1.mjs';
import { createLocalResultPacket } from './localResultBridgeV1.mjs';
import { createAutonomousLocalRuntimePacket } from './autonomousLocalRuntimeV1.mjs';

export const LOCAL_SERVICE_RUNNER_LOOP_SCHEMA_VERSION = 'local-service-runner-loop.v1';

export const RUNNER_LOOP_STATE = Object.freeze({
  IDLE: 'IDLE',
  CLAIM_READY: 'CLAIM_READY',
  CLAIMED_WAITING_RESULT: 'CLAIMED_WAITING_RESULT',
  RESULT_ACCEPTED: 'RESULT_ACCEPTED',
  RESULT_REJECTED: 'RESULT_REJECTED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function exactSha(value = '') {
  return /^[a-f0-9]{7,40}$/i.test(text(value));
}

export function buildLocalServiceRunnerLoopContract() {
  return {
    schemaVersion: LOCAL_SERVICE_RUNNER_LOOP_SCHEMA_VERSION,
    contractKind: 'stephanos.local_service_runner_loop.contract',
    states: Object.values(RUNNER_LOOP_STATE),
    consumes: ['localServiceQueueV1', 'autonomousLocalRuntimeV1'],
    emits: ['localResultBridgeV1', 'missionOperations'],
    finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_CONTRACT_READY',
  };
}

export function createRunnerLoopInput(input = {}) {
  return {
    schemaVersion: LOCAL_SERVICE_RUNNER_LOOP_SCHEMA_VERSION,
    kind: 'stephanos.local_service_runner_loop.input',
    serviceId: text(input.serviceId, 'battle-bridge-local-service'),
    workItem: input.workItem || null,
    result: input.result || null,
    exactUnblockAction: text(input.exactUnblockAction),
    finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_INPUT_READY',
  };
}

export function classifyRunnerLoop(input = {}) {
  const loopInput = input.kind === 'stephanos.local_service_runner_loop.input' ? input : createRunnerLoopInput(input);

  if (loopInput.exactUnblockAction) {
    return {
      state: RUNNER_LOOP_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: loopInput.exactUnblockAction,
      loopInput,
      finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_BLOCKED_EXACT',
    };
  }

  if (!loopInput.workItem) {
    return {
      state: RUNNER_LOOP_STATE.IDLE,
      nextAction: 'Wait for an approved local service queue work item.',
      loopInput,
      finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_IDLE',
    };
  }

  const queue = classifyLocalServiceWorkItem(loopInput.workItem);
  if (queue.state === SERVICE_QUEUE_STATE.READY_TO_CLAIM) {
    return {
      state: RUNNER_LOOP_STATE.CLAIM_READY,
      nextAction: `Claim work item ${queue.item.workId} as ${loopInput.serviceId}.`,
      loopInput,
      queue,
      finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_CLAIM_READY',
    };
  }

  if (queue.state === SERVICE_QUEUE_STATE.RESULT_REQUIRED) {
    return {
      state: RUNNER_LOOP_STATE.CLAIMED_WAITING_RESULT,
      nextAction: `Record result for work item ${queue.item.workId}.`,
      loopInput,
      queue,
      finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_WAITING_RESULT',
    };
  }

  if (queue.state === SERVICE_QUEUE_STATE.RESULT_ACCEPTED) {
    const result = queue.item.result || loopInput.result || {};
    const localResult = createLocalResultPacket({
      goalId: queue.item.goalId,
      actionId: queue.item.actionKind,
      cwd: queue.item.repoPath,
      branch: queue.item.branch,
      headSha: result.headSha,
      approved: queue.item.approved,
      workingTreeClean: true,
      conflict: false,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      proofRequired: queue.item.requiresProof,
    });
    const runtime = createAutonomousLocalRuntimePacket({
      goalId: queue.item.goalId,
      actionId: queue.item.actionKind === 'FOCUSED_PROOF' ? 'focused-proof' : 'mission-update',
      branch: queue.item.branch,
      approved: queue.item.approved,
      workingTreeClean: true,
      conflict: false,
      proofCommand: queue.item.proofCommand,
      proofOutput: result.stdout,
      headSha: result.headSha,
      prNumber: result.prNumber,
      completed: result.completed === true,
      missionUpdated: result.missionUpdated === true,
    });
    return {
      state: RUNNER_LOOP_STATE.RESULT_ACCEPTED,
      nextAction: 'Forward accepted result to Local Result Bridge, runtime state, and Mission Operations.',
      loopInput,
      queue,
      localResult,
      runtime,
      finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_RESULT_ACCEPTED',
    };
  }

  return {
    state: RUNNER_LOOP_STATE.RESULT_REJECTED,
    nextAction: queue.nextAction || 'Resolve queue blocker before runner loop can continue.',
    loopInput,
    queue,
    finalVerdict: 'LOCAL_SERVICE_RUNNER_LOOP_RESULT_REJECTED',
  };
}

export function createLocalServiceRunnerLoopPacket(input = {}) {
  const result = classifyRunnerLoop(input);
  return {
    schemaVersion: LOCAL_SERVICE_RUNNER_LOOP_SCHEMA_VERSION,
    kind: 'stephanos.local_service_runner_loop.packet',
    state: result.state,
    nextAction: result.nextAction,
    serviceId: result.loopInput.serviceId,
    queueState: result.queue?.state || '',
    localResultState: result.localResult?.state || '',
    runtimeState: result.runtime?.state || '',
    readyToClaim: result.state === RUNNER_LOOP_STATE.CLAIM_READY,
    resultAccepted: result.state === RUNNER_LOOP_STATE.RESULT_ACCEPTED,
    finalVerdict: result.finalVerdict,
  };
}

export function validateLocalServiceRunnerLoopPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== LOCAL_SERVICE_RUNNER_LOOP_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.local_service_runner_loop.packet') errors.push('invalid-kind');
  if (!Object.values(RUNNER_LOOP_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!text(packet.nextAction)) errors.push('missing-next-action');
  if (!text(packet.serviceId)) errors.push('missing-service-id');
  if (packet.readyToClaim && packet.state !== RUNNER_LOOP_STATE.CLAIM_READY) errors.push('invalid-claim-flag');
  if (packet.resultAccepted && packet.state !== RUNNER_LOOP_STATE.RESULT_ACCEPTED) errors.push('invalid-result-flag');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'LOCAL_SERVICE_RUNNER_LOOP_PACKET_PASS' : 'LOCAL_SERVICE_RUNNER_LOOP_PACKET_BLOCKED',
  };
}
