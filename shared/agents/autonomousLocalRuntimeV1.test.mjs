import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_RUNTIME_STATE,
  buildAutonomousLocalRuntimeContract,
  classifyLocalRuntimePlan,
  createAutonomousLocalRuntimePacket,
  validateAutonomousLocalRuntimePacket,
} from './autonomousLocalRuntimeV1.mjs';

const base = {
  goalId: '#1342',
  actionId: 'focused-proof',
  branch: 'feature/local-runtime-v1',
  approved: true,
  workingTreeClean: true,
  conflict: false,
  proofCommand: 'node --test shared/agents/autonomousLocalRuntimeV1.test.mjs',
};

const headSha = '1111111111111111111111111111111111111111';

test('contract exposes local runtime states and actions', () => {
  const contract = buildAutonomousLocalRuntimeContract();
  assert.equal(contract.finalVerdict, 'AUTONOMOUS_LOCAL_RUNTIME_CONTRACT_READY');
  assert.equal(contract.states.includes('WAITING_FOR_PROOF'), true);
  assert.equal(contract.safeActionIds.includes('focused-proof'), true);
});

test('unapproved plan waits for approval', () => {
  const result = classifyLocalRuntimePlan({ ...base, approved: false });
  assert.equal(result.state, LOCAL_RUNTIME_STATE.WAITING_FOR_APPROVAL);
});

test('unknown action blocks exactly', () => {
  const result = classifyLocalRuntimePlan({ ...base, actionId: 'unknown-action' });
  assert.equal(result.state, LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.match(result.nextAction, /not allowlisted/);
});

test('dirty tree and conflict block before proof', () => {
  assert.equal(classifyLocalRuntimePlan({ ...base, workingTreeClean: false }).state, LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(classifyLocalRuntimePlan({ ...base, conflict: true }).state, LOCAL_RUNTIME_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('approved clean plan waits for proof', () => {
  const result = classifyLocalRuntimePlan(base);
  assert.equal(result.state, LOCAL_RUNTIME_STATE.WAITING_FOR_PROOF);
  assert.match(result.nextAction, /node --test/);
});

test('proof failure requires repair', () => {
  const result = classifyLocalRuntimePlan({ ...base, proofOutput: '1 failed' });
  assert.equal(result.state, LOCAL_RUNTIME_STATE.PROOF_FAILED);
});

test('proof pass without merge evidence asks for PR and head', () => {
  const result = classifyLocalRuntimePlan({ ...base, proofOutput: '1 passed 0 failed' });
  assert.equal(result.state, LOCAL_RUNTIME_STATE.PROOF_PASSED);
});

test('proof pass with exact head is ready to complete', () => {
  const packet = createAutonomousLocalRuntimePacket({ ...base, proofOutput: '1 passed 0 failed', prNumber: 1342, headSha });
  assert.equal(packet.state, LOCAL_RUNTIME_STATE.READY_TO_MERGE);
  assert.equal(packet.readyToProceed, true);
  assert.equal(validateAutonomousLocalRuntimePacket(packet).valid, true);
});

test('done requires completion and mission update evidence', () => {
  const done = createAutonomousLocalRuntimePacket({ ...base, proofOutput: '1 passed 0 failed', prNumber: 1342, headSha, completed: true, missionUpdated: true });
  assert.equal(done.state, LOCAL_RUNTIME_STATE.DONE);
  assert.equal(validateAutonomousLocalRuntimePacket(done).valid, true);
});

test('validator blocks malformed packet', () => {
  const result = validateAutonomousLocalRuntimePacket({
    schemaVersion: 'autonomous-local-runtime.v1',
    kind: 'stephanos.autonomous_local_runtime.packet',
    state: LOCAL_RUNTIME_STATE.READY_TO_MERGE,
    action: 'PREPARE_COMPLETION',
    nextAction: 'x',
    plan: { proofPassed: false, headSha },
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('unsafe-completion-readiness'), true);
});
