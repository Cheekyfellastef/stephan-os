import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICE_ACTION_KIND,
  SERVICE_QUEUE_STATE,
  buildLocalServiceQueueContract,
  classifyLocalServiceWorkItem,
  createLocalServiceQueuePacket,
  validateLocalServiceQueuePacket,
} from './localServiceQueueV1.mjs';

const base = {
  workId: 'work-1',
  goalId: '#1343',
  actionKind: SERVICE_ACTION_KIND.FOCUSED_PROOF,
  repoPath: 'repo-root',
  branch: 'feature/service-queue-v1',
  proofCommand: 'node --test shared/agents/localServiceQueueV1.test.mjs',
  approved: true,
};

const headSha = '1111111111111111111111111111111111111111';

test('contract exposes queue states and action kinds', () => {
  const contract = buildLocalServiceQueueContract();
  assert.equal(contract.finalVerdict, 'LOCAL_SERVICE_QUEUE_CONTRACT_READY');
  assert.equal(contract.states.includes(SERVICE_QUEUE_STATE.READY_TO_CLAIM), true);
  assert.equal(contract.actionKinds.includes(SERVICE_ACTION_KIND.FOCUSED_PROOF), true);
});

test('missing required fields blocks exactly', () => {
  const result = classifyLocalServiceWorkItem({ ...base, workId: '' });
  assert.equal(result.state, SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('unknown action kind is blocked', () => {
  const result = classifyLocalServiceWorkItem({ ...base, actionKind: 'NOT_ALLOWED' });
  assert.equal(result.state, SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.match(result.nextAction, /not allowlisted/);
});

test('approval required item waits for approval', () => {
  const result = classifyLocalServiceWorkItem({ ...base, approved: false });
  assert.equal(result.state, SERVICE_QUEUE_STATE.WAITING_FOR_APPROVAL);
});

test('approved item is ready to claim', () => {
  const packet = createLocalServiceQueuePacket(base);
  assert.equal(packet.state, SERVICE_QUEUE_STATE.READY_TO_CLAIM);
  assert.equal(packet.readyForLocalService, true);
  assert.equal(validateLocalServiceQueuePacket(packet).valid, true);
});

test('claimed item requires result', () => {
  const result = classifyLocalServiceWorkItem({ ...base, claimedBy: 'local-service' });
  assert.equal(result.state, SERVICE_QUEUE_STATE.RESULT_REQUIRED);
});

test('bad result is blocked before acceptance', () => {
  const result = classifyLocalServiceWorkItem({
    ...base,
    claimedBy: 'local-service',
    result: { exitCode: 1, stdout: 'failed', stderr: '', headSha },
  });
  assert.equal(result.state, SERVICE_QUEUE_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('passing result is accepted', () => {
  const packet = createLocalServiceQueuePacket({
    ...base,
    claimedBy: 'local-service',
    result: { exitCode: 0, stdout: 'passed', stderr: '', headSha },
  });
  assert.equal(packet.state, SERVICE_QUEUE_STATE.RESULT_ACCEPTED);
  assert.equal(packet.resultAccepted, true);
  assert.equal(validateLocalServiceQueuePacket(packet).valid, true);
});

test('validator blocks malformed packet', () => {
  const result = validateLocalServiceQueuePacket({
    schemaVersion: 'local-service-queue.v1',
    kind: 'stephanos.local_service_queue.packet',
    state: SERVICE_QUEUE_STATE.READY_TO_CLAIM,
    nextAction: 'x',
    readyForLocalService: false,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-item'), true);
});
