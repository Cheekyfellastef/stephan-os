import {
  SERVICE_ACTION_KIND,
  createLocalServiceQueuePacket,
} from './localServiceQueueV1.mjs';
import { createLocalServiceRunnerLoopPacket } from './localServiceRunnerLoopV1.mjs';

export const LOCAL_HOST_SCHEMA_VERSION = 'local-host.v1';

export const LOCAL_HOST_STATE = Object.freeze({
  OFFLINE: 'OFFLINE',
  IDLE: 'IDLE',
  WORK_AVAILABLE: 'WORK_AVAILABLE',
  CLAIMED: 'CLAIMED',
  WAITING_FOR_RESULT: 'WAITING_FOR_RESULT',
  RESULT_RECORDED: 'RESULT_RECORDED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const LOCAL_HOST_CAPABILITY = Object.freeze({
  READ_STATUS: 'READ_STATUS',
  SYNC_BRANCH: 'SYNC_BRANCH',
  FOCUSED_PROOF: 'FOCUSED_PROOF',
  PREPARE_COMPLETION: 'PREPARE_COMPLETION',
  RECORD_UPDATE: 'RECORD_UPDATE',
});

const CAPABILITY_TO_ACTION = Object.freeze({
  [LOCAL_HOST_CAPABILITY.READ_STATUS]: SERVICE_ACTION_KIND.READ_STATUS,
  [LOCAL_HOST_CAPABILITY.SYNC_BRANCH]: SERVICE_ACTION_KIND.SYNC_BRANCH,
  [LOCAL_HOST_CAPABILITY.FOCUSED_PROOF]: SERVICE_ACTION_KIND.FOCUSED_PROOF,
  [LOCAL_HOST_CAPABILITY.PREPARE_COMPLETION]: SERVICE_ACTION_KIND.PREPARE_COMPLETION,
  [LOCAL_HOST_CAPABILITY.RECORD_UPDATE]: SERVICE_ACTION_KIND.RECORD_UPDATE,
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function hasCapability(host, capability) {
  return list(host.capabilities).includes(capability);
}

export function buildLocalHostContract() {
  return {
    schemaVersion: LOCAL_HOST_SCHEMA_VERSION,
    contractKind: 'stephanos.local_host.contract',
    states: Object.values(LOCAL_HOST_STATE),
    capabilities: Object.values(LOCAL_HOST_CAPABILITY),
    consumes: ['localServiceQueueV1'],
    emits: ['localServiceRunnerLoopV1', 'localResultBridgeV1', 'missionOperations'],
    finalVerdict: 'LOCAL_HOST_CONTRACT_READY',
  };
}

export function createLocalHostDescriptor(input = {}) {
  return {
    schemaVersion: LOCAL_HOST_SCHEMA_VERSION,
    kind: 'stephanos.local_host.descriptor',
    hostId: text(input.hostId, 'battle-bridge-host'),
    online: input.online === true,
    repoPath: text(input.repoPath),
    currentBranch: text(input.currentBranch),
    currentHeadSha: text(input.currentHeadSha),
    capabilities: list(input.capabilities || Object.values(LOCAL_HOST_CAPABILITY)),
    claimedWorkId: text(input.claimedWorkId),
    finalVerdict: 'LOCAL_HOST_DESCRIPTOR_READY',
  };
}

export function createLocalHostWorkRequest(input = {}) {
  return {
    schemaVersion: LOCAL_HOST_SCHEMA_VERSION,
    kind: 'stephanos.local_host.work_request',
    workId: text(input.workId),
    goalId: text(input.goalId, '#1345'),
    requestedCapability: text(input.requestedCapability, LOCAL_HOST_CAPABILITY.FOCUSED_PROOF),
    repoPath: text(input.repoPath),
    branch: text(input.branch),
    proofCommand: text(input.proofCommand),
    approved: input.approved === true || input.operatorApproved === true,
    result: input.result || null,
    finalVerdict: 'LOCAL_HOST_WORK_REQUEST_READY',
  };
}

export function classifyLocalHost(input = {}) {
  const host = input.host?.kind === 'stephanos.local_host.descriptor' ? input.host : createLocalHostDescriptor(input.host || input);
  const request = input.request?.kind === 'stephanos.local_host.work_request' ? input.request : input.request ? createLocalHostWorkRequest(input.request) : null;

  if (!host.online) {
    return {
      state: LOCAL_HOST_STATE.OFFLINE,
      nextAction: 'Start the local host before claiming work.',
      host,
      request,
      finalVerdict: 'LOCAL_HOST_OFFLINE',
    };
  }

  if (!text(host.repoPath)) {
    return {
      state: LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Record the local repository path before the host can claim work.',
      host,
      request,
      finalVerdict: 'LOCAL_HOST_REPO_PATH_BLOCKED',
    };
  }

  if (!request) {
    return {
      state: LOCAL_HOST_STATE.IDLE,
      nextAction: 'Wait for a local service work request.',
      host,
      request,
      finalVerdict: 'LOCAL_HOST_IDLE',
    };
  }

  if (!text(request.workId) || !text(request.goalId) || !text(request.branch)) {
    return {
      state: LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Record workId, goalId, and branch before host claim.',
      host,
      request,
      finalVerdict: 'LOCAL_HOST_REQUEST_FIELDS_BLOCKED',
    };
  }

  if (!hasCapability(host, request.requestedCapability)) {
    return {
      state: LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: `Host ${host.hostId} does not advertise capability ${request.requestedCapability}.`,
      host,
      request,
      finalVerdict: 'LOCAL_HOST_CAPABILITY_BLOCKED',
    };
  }

  const actionKind = CAPABILITY_TO_ACTION[request.requestedCapability];
  if (!actionKind) {
    return {
      state: LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: `No service action mapping exists for capability ${request.requestedCapability}.`,
      host,
      request,
      finalVerdict: 'LOCAL_HOST_ACTION_MAPPING_BLOCKED',
    };
  }

  const queuePacket = createLocalServiceQueuePacket({
    workId: request.workId,
    goalId: request.goalId,
    actionKind,
    repoPath: request.repoPath || host.repoPath,
    branch: request.branch,
    proofCommand: request.proofCommand,
    approved: request.approved,
    claimedBy: host.claimedWorkId === request.workId ? host.hostId : '',
    result: request.result,
  });

  const loopPacket = createLocalServiceRunnerLoopPacket({
    serviceId: host.hostId,
    workItem: {
      workId: request.workId,
      goalId: request.goalId,
      actionKind,
      repoPath: request.repoPath || host.repoPath,
      branch: request.branch,
      proofCommand: request.proofCommand,
      approved: request.approved,
      claimedBy: host.claimedWorkId === request.workId ? host.hostId : '',
      result: request.result,
    },
  });

  if (queuePacket.state === 'READY_TO_CLAIM') {
    return {
      state: LOCAL_HOST_STATE.WORK_AVAILABLE,
      nextAction: `Claim work item ${request.workId}.`,
      host,
      request,
      queuePacket,
      loopPacket,
      finalVerdict: 'LOCAL_HOST_WORK_AVAILABLE',
    };
  }

  if (queuePacket.state === 'RESULT_REQUIRED') {
    return {
      state: LOCAL_HOST_STATE.WAITING_FOR_RESULT,
      nextAction: `Record result for work item ${request.workId}.`,
      host,
      request,
      queuePacket,
      loopPacket,
      finalVerdict: 'LOCAL_HOST_WAITING_RESULT',
    };
  }

  if (queuePacket.state === 'RESULT_ACCEPTED') {
    return {
      state: LOCAL_HOST_STATE.RESULT_RECORDED,
      nextAction: 'Forward result to Mission Operations and continue completion pipeline.',
      host,
      request,
      queuePacket,
      loopPacket,
      finalVerdict: 'LOCAL_HOST_RESULT_RECORDED',
    };
  }

  return {
    state: LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    nextAction: queuePacket.nextAction,
    host,
    request,
    queuePacket,
    loopPacket,
    finalVerdict: 'LOCAL_HOST_QUEUE_BLOCKED',
  };
}

export function createLocalHostPacket(input = {}) {
  const result = classifyLocalHost(input);
  return {
    schemaVersion: LOCAL_HOST_SCHEMA_VERSION,
    kind: 'stephanos.local_host.packet',
    state: result.state,
    nextAction: result.nextAction,
    hostId: result.host.hostId,
    workId: result.request?.workId || '',
    goalId: result.request?.goalId || '',
    queueState: result.queuePacket?.state || '',
    runnerState: result.loopPacket?.state || '',
    readyToClaim: result.state === LOCAL_HOST_STATE.WORK_AVAILABLE,
    resultRecorded: result.state === LOCAL_HOST_STATE.RESULT_RECORDED,
    finalVerdict: result.finalVerdict,
  };
}

export function validateLocalHostPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== LOCAL_HOST_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.local_host.packet') errors.push('invalid-kind');
  if (!Object.values(LOCAL_HOST_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!text(packet.nextAction)) errors.push('missing-next-action');
  if (!text(packet.hostId)) errors.push('missing-host-id');
  if (packet.readyToClaim && packet.state !== LOCAL_HOST_STATE.WORK_AVAILABLE) errors.push('invalid-ready-flag');
  if (packet.resultRecorded && packet.state !== LOCAL_HOST_STATE.RESULT_RECORDED) errors.push('invalid-result-flag');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'LOCAL_HOST_PACKET_PASS' : 'LOCAL_HOST_PACKET_BLOCKED',
  };
}
