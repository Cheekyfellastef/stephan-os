export const LOCAL_HOST_ADAPTER_SCHEMA_VERSION = 'local-host-adapter.v1';

export const HOST_ADAPTER_STATE = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  READY: 'READY',
  QUEUE_EMPTY: 'QUEUE_EMPTY',
  CLAIM_RECORD_READY: 'CLAIM_RECORD_READY',
  RESULT_RECORD_READY: 'RESULT_RECORD_READY',
  RESULT_ACCEPTED: 'RESULT_ACCEPTED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

export function buildLocalHostAdapterContract() {
  return {
    schemaVersion: LOCAL_HOST_ADAPTER_SCHEMA_VERSION,
    contractKind: 'stephanos.local_host_adapter.contract',
    states: Object.values(HOST_ADAPTER_STATE),
    fileSlots: ['queuePath', 'claimPath', 'resultPath', 'transcriptPath'],
    finalVerdict: 'LOCAL_HOST_ADAPTER_CONTRACT_READY',
  };
}

export function createHostAdapterConfig(input = {}) {
  return {
    schemaVersion: LOCAL_HOST_ADAPTER_SCHEMA_VERSION,
    kind: 'stephanos.local_host_adapter.config',
    hostId: text(input.hostId, 'battle-bridge-host'),
    repoPath: text(input.repoPath),
    queuePath: text(input.queuePath),
    claimPath: text(input.claimPath),
    resultPath: text(input.resultPath),
    transcriptPath: text(input.transcriptPath),
    finalVerdict: 'LOCAL_HOST_ADAPTER_CONFIG_READY',
  };
}

export function createHostAdapterSnapshot(input = {}) {
  return {
    schemaVersion: LOCAL_HOST_ADAPTER_SCHEMA_VERSION,
    kind: 'stephanos.local_host_adapter.snapshot',
    queueExists: input.queueExists === true,
    claimExists: input.claimExists === true,
    resultExists: input.resultExists === true,
    queueRecord: input.queueRecord && typeof input.queueRecord === 'object' ? input.queueRecord : null,
    resultRecord: input.resultRecord && typeof input.resultRecord === 'object' ? input.resultRecord : null,
    finalVerdict: 'LOCAL_HOST_ADAPTER_SNAPSHOT_READY',
  };
}

export function classifyHostAdapter(input = {}) {
  const config = input.config?.kind === 'stephanos.local_host_adapter.config' ? input.config : createHostAdapterConfig(input.config || input);
  const snapshot = input.snapshot?.kind === 'stephanos.local_host_adapter.snapshot' ? input.snapshot : createHostAdapterSnapshot(input.snapshot || input);

  if (!text(config.repoPath) || !text(config.queuePath) || !text(config.claimPath) || !text(config.resultPath)) {
    return { state: HOST_ADAPTER_STATE.NOT_CONFIGURED, nextAction: 'Record repoPath, queuePath, claimPath, and resultPath.', config, snapshot };
  }
  if (!snapshot.queueExists || !snapshot.queueRecord) {
    return { state: HOST_ADAPTER_STATE.QUEUE_EMPTY, nextAction: `Wait for queue record at ${config.queuePath}.`, config, snapshot };
  }
  if (!snapshot.claimExists) {
    return { state: HOST_ADAPTER_STATE.CLAIM_RECORD_READY, nextAction: `Create claim record for ${snapshot.queueRecord.workId || '<workId>'}.`, config, snapshot };
  }
  if (!snapshot.resultExists) {
    return { state: HOST_ADAPTER_STATE.RESULT_RECORD_READY, nextAction: `Create result record for ${snapshot.queueRecord.workId || '<workId>'}.`, config, snapshot };
  }
  if (snapshot.resultRecord && snapshot.resultRecord.accepted === true) {
    return { state: HOST_ADAPTER_STATE.RESULT_ACCEPTED, nextAction: 'Forward accepted result record.', config, snapshot };
  }
  return { state: HOST_ADAPTER_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, nextAction: 'Result record is present but not accepted.', config, snapshot };
}

export function createLocalHostAdapterPacket(input = {}) {
  const result = classifyHostAdapter(input);
  return {
    schemaVersion: LOCAL_HOST_ADAPTER_SCHEMA_VERSION,
    kind: 'stephanos.local_host_adapter.packet',
    state: result.state,
    nextAction: result.nextAction,
    hostId: result.config.hostId,
    queuePath: result.config.queuePath,
    claimPath: result.config.claimPath,
    resultPath: result.config.resultPath,
    finalVerdict: result.state === HOST_ADAPTER_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'LOCAL_HOST_ADAPTER_BLOCKED' : 'LOCAL_HOST_ADAPTER_READY',
  };
}

export function validateLocalHostAdapterPacket(packet = {}) {
  const errors = [];
  if (packet.schemaVersion !== LOCAL_HOST_ADAPTER_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (packet.kind !== 'stephanos.local_host_adapter.packet') errors.push('invalid-kind');
  if (!Object.values(HOST_ADAPTER_STATE).includes(packet.state)) errors.push('invalid-state');
  if (!text(packet.nextAction)) errors.push('missing-next-action');
  if (!text(packet.hostId)) errors.push('missing-host-id');
  return { valid: errors.length === 0, errors, finalVerdict: errors.length === 0 ? 'LOCAL_HOST_ADAPTER_PACKET_PASS' : 'LOCAL_HOST_ADAPTER_PACKET_BLOCKED' };
}
