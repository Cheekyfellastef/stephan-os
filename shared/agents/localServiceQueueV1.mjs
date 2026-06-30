export const LOCAL_SERVICE_QUEUE_SCHEMA_VERSION = 'local-service-queue.v1';

export const SERVICE_QUEUE_STATE = Object.freeze({
  QUEUED: 'QUEUED',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  READY_TO_CLAIM: 'READY_TO_CLAIM',
  CLAIMED: 'CLAIMED',
  RESULT_REQUIRED: 'RESULT_REQUIRED',
  RESULT_ACCEPTED: 'RESULT_ACCEPTED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const SERVICE_ACTION_KIND = Object.freeze({
  READ_STATUS: 'READ_STATUS',
  SYNC_BRANCH: 'SYNC_BRANCH',
  FOCUSED_PROOF: 'FOCUSED_PROOF',
  PREPARE_COMPLETION: 'PREPARE_COMPLETION',
  RECORD_UPDATE: 'RECORD_UPDATE',
});

const ALLOWED_ACTIONS = new Set(Object.values(SERVICE_ACTION_KIND));

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function exactSha(value = '') {
  return /^[a-f0-9]{7,40}$/i.test(text(value));
}

export function buildLocalServiceQueueContract() {
  return {
    schemaVersion: LOCAL_SERVICE_QUEUE_SCHEMA_VERSION,
    contractKind: 'stephanos.local_service_queue.contract',
    states: Object.values(SERVICE_QUEUE_STATE),
    actionKinds: Object.values(SERVICE_ACTION_KIND),
    requiredWorkItemFields: ['workId', 'goalId', 'actionKind', 'repoPath', 'branch', 'proofCommand'],
    requiredResultFields: ['workId', 'exitCode', 'stdout', 'stderr', 'headSha'],
    finalVerdict: 'LOCAL_SERVICE_QUEUE_CONTRACT_READY',
  };
}

export function createLocalServiceWorkItem(input = {}) {
  return {
    schemaVersion: LOCAL_SERVICE_QUEUE_SCHEMA_VERSION,
    kind: 'stephanos.local_service_queue.work_item',
    workId: text(input.workId),
    goalId: text(input.goalId, '#1343'),
    actionKind: text(input.actionKind),
    repoPath: text(input.repoPath),
    branch: text(input.branch),
    proofCommand: text(input.proofCommand),
    approved: input.approved === true || input.operatorApproved === true,
    requiresApproval: input.requiresApproval !== false,
    requiresProof: input.requiresProof !== false,
    claimedBy: text(input.claimedBy),
    result: input.result && typeof input.result === 'object' ? input.result : null,
    exactUnblockAction: text(input.exactUnblockAction),
    finalVerdict: 'LOCAL_SERVICE_WORK_ITEM_READY',
  };
}

export function classifyLocalServiceWorkItem(input = {}) {
  const item = input.kind === 'stephanos.local_service_queue.work_item' ? input : createLocalServiceWorkItem(input);

  if (item.exactUnblockAction) {
    return {
      state: SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: item.exactUnblockAction,
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_BLOCKED_EXACT',
    };
  }
  if (!text(item.workId) || !text(item.goalId) || !text(item.repoPath) || !text(item.branch)) {
    return {
      state: SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Record workId, goalId, repoPath, and branch before queueing local service work.',
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_MISSING_FIELDS',
    };
  }
  if (!ALLOWED_ACTIONS.has(item.actionKind)) {
    return {
      state: SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: `Action kind ${item.actionKind || '<missing>'} is not allowlisted for the local service queue.`,
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_ACTION_BLOCKED',
    };
  }
  if (item.requiresApproval && !item.approved) {
    return {
      state: SERVICE_QUEUE_STATE.WAITING_FOR_APPROVAL,
      nextAction: `Approve work item ${item.workId} before local service claim.`,
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_WAITING_APPROVAL',
    };
  }
  if (item.requiresProof && !text(item.proofCommand)) {
    return {
      state: SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Record focused proof command before local service claim.',
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_MISSING_PROOF_COMMAND',
    };
  }
  if (!item.claimedBy) {
    return {
      state: SERVICE_QUEUE_STATE.READY_TO_CLAIM,
      nextAction: `Local service may claim work item ${item.workId}.`,
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_READY_TO_CLAIM',
    };
  }
  if (!item.result) {
    return {
      state: SERVICE_QUEUE_STATE.RESULT_REQUIRED,
      nextAction: `Record result for claimed work item ${item.workId}.`,
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_RESULT_REQUIRED',
    };
  }
  if (item.requiresProof && (item.result.exitCode !== 0 || !exactSha(item.result.headSha))) {
    return {
      state: SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      nextAction: 'Result must include exitCode 0 and exact head SHA before acceptance.',
      item,
      finalVerdict: 'LOCAL_SERVICE_QUEUE_RESULT_BLOCKED',
    };
  }
  return {
    state: SERVICE_QUEUE_STATE.RESULT_ACCEPTED,
    nextAction: 'Forward accepted local service result to Local Result Bridge and Mission Operations.',
    item,
    finalVerdict: 'LOCAL_SERVICE_QUEUE_RESULT_ACCEPTED',
  };
}

export function createLocalServiceQueuePacket(input = {}) {
  const result = classifyLocalServiceWorkItem(input);
  return {
    schemaVersion: LOCAL_SERVICE_QUEUE_SCHEMA_VERSION,
    kind: 'stephanos.local_service_queue.packet',
    workId: result.item.workId,
    goalId: result.item.goalId,
    state: result.state,
    nextAction: result.nextAction,
    item: result.item,
    readyForLocalService: result.state === SERVICE_QUEUE_STATE.READY_TO_CLAIM,
    resultAccepted: result.state === SERVICE_QUEUE_STATE.RESULT_ACCEPTED,
    finalVerdict: result.finalVerdict,
  };
}

export function validateLocalServiceQueuePacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== LOCAL_SERVICE_QUEUE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.local_service_queue.packet') errors.push('invalid-kind');
  if (!Object.values(SERVICE_QUEUE_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!packet.item) errors.push('missing-item');
  if (!text(packet.nextAction)) errors.push('missing-next-action');
  if (packet.readyForLocalService && packet.state !== SERVICE_QUEUE_STATE.READY_TO_CLAIM) errors.push('invalid-ready-flag');
  if (packet.resultAccepted && packet.state !== SERVICE_QUEUE_STATE.RESULT_ACCEPTED) errors.push('invalid-accepted-flag');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'LOCAL_SERVICE_QUEUE_PACKET_PASS' : 'LOCAL_SERVICE_QUEUE_PACKET_BLOCKED',
  };
}
