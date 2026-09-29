import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNNER_LOOP_STATE,
  buildLocalServiceRunnerLoopContract,
  classifyRunnerLoop,
  createLocalServiceRunnerLoopPacket,
  validateLocalServiceRunnerLoopPacket,
} from './localServiceRunnerLoopV1.mjs';
import { SERVICE_ACTION_KIND } from './localServiceQueueV1.mjs';

const baseWork = {
  workId: 'work-1',
  goalId: '#1344',
  actionKind: SERVICE_ACTION_KIND.FOCUSED_PROOF,
  repoPath: 'repo-root',
  branch: 'feature/runner-loop-v1',
  proofCommand: 'node --test shared/agents/localServiceRunnerLoopV1.test.mjs',
  approved: true,
};

const headSha = '1111111111111111111111111111111111111111';

test('contract exposes runner loop states and integrations', () => {
  const contract = buildLocalServiceRunnerLoopContract();
  assert.equal(contract.finalVerdict, 'LOCAL_SERVICE_RUNNER_LOOP_CONTRACT_READY');
  assert.equal(contract.states.includes(RUNNER_LOOP_STATE.CLAIM_READY), true);
  assert.equal(contract.consumes.includes('localServiceQueueV1'), true);
  assert.equal(contract.emits.includes('localResultBridgeV1'), true);
});

test('loop is idle without work item', () => {
  const result = classifyRunnerLoop({});
  assert.equal(result.state, RUNNER_LOOP_STATE.IDLE);
});

test('approved queue item becomes claim ready', () => {
  const packet = createLocalServiceRunnerLoopPacket({ workItem: baseWork });
  assert.equal(packet.state, RUNNER_LOOP_STATE.CLAIM_READY);
  assert.equal(packet.readyToClaim, true);
  assert.equal(validateLocalServiceRunnerLoopPacket(packet).valid, true);
});

test('claimed item waits for result', () => {
  const result = classifyRunnerLoop({ workItem: { ...baseWork, claimedBy: 'battle-bridge-local-service' } });
  assert.equal(result.state, RUNNER_LOOP_STATE.CLAIMED_WAITING_RESULT);
});

test('bad result is rejected with exact action', () => {
  const result = classifyRunnerLoop({
    workItem: {
      ...baseWork,
      claimedBy: 'battle-bridge-local-service',
      result: { exitCode: 1, stdout: 'failed', stderr: '', headSha },
    },
  });
  assert.equal(result.state, RUNNER_LOOP_STATE.RESULT_REJECTED);
  assert.match(result.nextAction, /exitCode 0/);
});

test('accepted result emits local result and runtime state', () => {
  const packet = createLocalServiceRunnerLoopPacket({
    workItem: {
      ...baseWork,
      claimedBy: 'battle-bridge-local-service',
      result: { exitCode: 0, stdout: 'passed', stderr: '', headSha, prNumber: 1344 },
    },
  });
  assert.equal(packet.state, RUNNER_LOOP_STATE.RESULT_ACCEPTED);
  assert.equal(packet.localResultState, 'PROOF_PASSED');
  assert.equal(packet.runtimeState, 'READY_TO_MERGE');
  assert.equal(packet.resultAccepted, true);
});

test('explicit unblock action overrides normal loop', () => {
  const result = classifyRunnerLoop({ exactUnblockAction: 'Record missing service id.' });
  assert.equal(result.state, RUNNER_LOOP_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(result.nextAction, 'Record missing service id.');
});

test('validator blocks malformed packet', () => {
  const result = validateLocalServiceRunnerLoopPacket({
    schemaVersion: 'local-service-runner-loop.v1',
    kind: 'stephanos.local_service_runner_loop.packet',
    state: RUNNER_LOOP_STATE.RESULT_ACCEPTED,
    nextAction: 'x',
    serviceId: '',
    resultAccepted: true,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-service-id'), true);
});
