import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_HOST_CAPABILITY,
  LOCAL_HOST_STATE,
  buildLocalHostContract,
  classifyLocalHost,
  createLocalHostDescriptor,
  createLocalHostPacket,
  createLocalHostWorkRequest,
  validateLocalHostPacket,
} from './localHostV1.mjs';

const host = createLocalHostDescriptor({
  online: true,
  repoPath: 'repo-root',
  currentBranch: 'main',
  capabilities: Object.values(LOCAL_HOST_CAPABILITY),
});

const request = createLocalHostWorkRequest({
  workId: 'work-1',
  goalId: '#1345',
  requestedCapability: LOCAL_HOST_CAPABILITY.FOCUSED_PROOF,
  branch: 'feature/local-host-v1',
  proofCommand: 'node --test shared/agents/localHostV1.test.mjs',
  approved: true,
});

const headSha = '1111111111111111111111111111111111111111';

test('contract exposes local host states and capabilities', () => {
  const contract = buildLocalHostContract();
  assert.equal(contract.finalVerdict, 'LOCAL_HOST_CONTRACT_READY');
  assert.equal(contract.states.includes(LOCAL_HOST_STATE.WORK_AVAILABLE), true);
  assert.equal(contract.capabilities.includes(LOCAL_HOST_CAPABILITY.FOCUSED_PROOF), true);
});

test('offline host blocks before work claim', () => {
  const result = classifyLocalHost({ host: { ...host, online: false }, request });
  assert.equal(result.state, LOCAL_HOST_STATE.OFFLINE);
});

test('online host without request is idle', () => {
  const result = classifyLocalHost({ host });
  assert.equal(result.state, LOCAL_HOST_STATE.IDLE);
});

test('missing repo path blocks exactly', () => {
  const result = classifyLocalHost({ host: { ...host, repoPath: '' }, request });
  assert.equal(result.state, LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.match(result.nextAction, /repository path/);
});

test('missing request fields block exactly', () => {
  const result = classifyLocalHost({ host, request: { ...request, workId: '' } });
  assert.equal(result.state, LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('capability mismatch blocks exactly', () => {
  const result = classifyLocalHost({
    host: { ...host, capabilities: [LOCAL_HOST_CAPABILITY.READ_STATUS] },
    request,
  });
  assert.equal(result.state, LOCAL_HOST_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.match(result.nextAction, /does not advertise capability/);
});

test('approved request is available for host claim', () => {
  const packet = createLocalHostPacket({ host, request });
  assert.equal(packet.state, LOCAL_HOST_STATE.WORK_AVAILABLE);
  assert.equal(packet.readyToClaim, true);
  assert.equal(packet.queueState, 'READY_TO_CLAIM');
  assert.equal(validateLocalHostPacket(packet).valid, true);
});

test('claimed request waits for result', () => {
  const claimedHost = { ...host, claimedWorkId: 'work-1' };
  const packet = createLocalHostPacket({ host: claimedHost, request });
  assert.equal(packet.state, LOCAL_HOST_STATE.WAITING_FOR_RESULT);
  assert.equal(packet.queueState, 'RESULT_REQUIRED');
});

test('accepted result is recorded and forwarded', () => {
  const claimedHost = { ...host, claimedWorkId: 'work-1' };
  const packet = createLocalHostPacket({
    host: claimedHost,
    request: {
      ...request,
      result: { exitCode: 0, stdout: 'passed', stderr: '', headSha, prNumber: 1345 },
    },
  });
  assert.equal(packet.state, LOCAL_HOST_STATE.RESULT_RECORDED);
  assert.equal(packet.resultRecorded, true);
  assert.equal(packet.queueState, 'RESULT_ACCEPTED');
});

test('validator blocks malformed host packet', () => {
  const result = validateLocalHostPacket({
    schemaVersion: 'local-host.v1',
    kind: 'stephanos.local_host.packet',
    state: LOCAL_HOST_STATE.WORK_AVAILABLE,
    nextAction: 'x',
    hostId: '',
    readyToClaim: true,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-host-id'), true);
});
