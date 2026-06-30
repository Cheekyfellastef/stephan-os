import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOST_ADAPTER_STATE,
  buildLocalHostAdapterContract,
  classifyHostAdapter,
  createLocalHostAdapterPacket,
  validateLocalHostAdapterPacket,
} from './localHostAdapterV1.mjs';

const config = {
  hostId: 'local-host',
  repoPath: 'repo-root',
  queuePath: 'queue-slot',
  claimPath: 'claim-slot',
  resultPath: 'result-slot',
  transcriptPath: 'transcript-slot',
};

const queueRecord = { workId: 'work-1', goalId: '#1346' };

test('contract exposes adapter states and file slots', () => {
  const contract = buildLocalHostAdapterContract();
  assert.equal(contract.finalVerdict, 'LOCAL_HOST_ADAPTER_CONTRACT_READY');
  assert.equal(contract.states.includes(HOST_ADAPTER_STATE.CLAIM_RECORD_READY), true);
  assert.equal(contract.fileSlots.includes('queuePath'), true);
});

test('missing config blocks as not configured', () => {
  const result = classifyHostAdapter({ config: {}, snapshot: {} });
  assert.equal(result.state, HOST_ADAPTER_STATE.NOT_CONFIGURED);
});

test('empty queue waits for queue record', () => {
  const result = classifyHostAdapter({ config, snapshot: { queueExists: false } });
  assert.equal(result.state, HOST_ADAPTER_STATE.QUEUE_EMPTY);
});

test('queue record without claim creates claim record state', () => {
  const packet = createLocalHostAdapterPacket({
    config,
    snapshot: { queueExists: true, queueRecord, claimExists: false },
  });
  assert.equal(packet.state, HOST_ADAPTER_STATE.CLAIM_RECORD_READY);
  assert.match(packet.nextAction, /work-1/);
  assert.equal(validateLocalHostAdapterPacket(packet).valid, true);
});

test('claim without result creates result record state', () => {
  const result = classifyHostAdapter({
    config,
    snapshot: { queueExists: true, queueRecord, claimExists: true, resultExists: false },
  });
  assert.equal(result.state, HOST_ADAPTER_STATE.RESULT_RECORD_READY);
});

test('accepted result forwards result record', () => {
  const packet = createLocalHostAdapterPacket({
    config,
    snapshot: { queueExists: true, queueRecord, claimExists: true, resultExists: true, resultRecord: { accepted: true } },
  });
  assert.equal(packet.state, HOST_ADAPTER_STATE.RESULT_ACCEPTED);
});

test('present but unaccepted result blocks exactly', () => {
  const result = classifyHostAdapter({
    config,
    snapshot: { queueExists: true, queueRecord, claimExists: true, resultExists: true, resultRecord: { accepted: false } },
  });
  assert.equal(result.state, HOST_ADAPTER_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('validator blocks malformed adapter packet', () => {
  const result = validateLocalHostAdapterPacket({
    schemaVersion: 'local-host-adapter.v1',
    kind: 'stephanos.local_host_adapter.packet',
    state: HOST_ADAPTER_STATE.RESULT_ACCEPTED,
    nextAction: 'x',
    hostId: '',
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-host-id'), true);
});
