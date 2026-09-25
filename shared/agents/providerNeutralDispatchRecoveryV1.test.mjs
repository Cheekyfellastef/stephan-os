import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileProviderNeutralDispatchReceipt,
  reconcileProviderNeutralDispatchCandidates,
  recoverProviderNeutralDispatches,
} from './providerNeutralDispatchRecoveryV1.mjs';

const HEAD = '5ca2da53b838f0668cf9b6917b62e45dd24a61e3';

function candidate(overrides = {}) {
  return {
    batonId: 'provider-baton-111111111111111111111111',
    dispatchJobId: 'codex-job-11111111111111111111',
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    selectedRoute: { providerFamily: 'OPENCLAW', adapterId: 'openclaw-local' },
    ...overrides,
  };
}

function verifiedReceipt(overrides = {}) {
  return {
    verified: true,
    dispatchJobId: 'codex-job-11111111111111111111',
    providerTaskId: 'openclaw-task-2222222222222222',
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    providerExecutionStarted: true,
    resultReadbackOperation: 'READ_OPENCLAW_TASK_RESULT',
    verificationProofRef: 'receipts/openclaw-task-2222222222222222.json',
    terminalState: '',
    ...overrides,
  };
}

test('baton without provider receipt stays unresolved and never permits automatic redispatch', () => {
  const result = reconcileProviderNeutralDispatchReceipt(candidate(), null);
  assert.equal(result.ok, true);
  assert.equal(result.providerExecutionStarted, false);
  assert.equal(result.automaticRedispatchAllowed, false);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_UNRESOLVED');
});

test('verified matching provider receipt recovers execution identity for readback', () => {
  const result = reconcileProviderNeutralDispatchReceipt(candidate(), verifiedReceipt());
  assert.equal(result.ok, true);
  assert.equal(result.providerExecutionStarted, true);
  assert.equal(result.providerTaskId, 'openclaw-task-2222222222222222');
  assert.equal(result.resultReadbackOperation, 'READ_OPENCLAW_TASK_RESULT');
  assert.equal(result.automaticRedispatchAllowed, false);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_EXECUTION_CONFIRMED');
});

test('verified terminal receipt recovers completion without redispatch', () => {
  const result = reconcileProviderNeutralDispatchReceipt(candidate(), verifiedReceipt({ terminalState: 'DONE' }));
  assert.equal(result.terminalState, 'DONE');
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_TERMINAL_CONFIRMED');
  assert.match(result.exactNextAction, /do not redispatch/i);
});

test('mismatched verified receipt fails closed', () => {
  const result = reconcileProviderNeutralDispatchReceipt(candidate(), verifiedReceipt({
    dispatchJobId: 'codex-job-99999999999999999999',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_JOB_MISMATCH');
  assert.equal(result.providerExecutionStarted, false);
  assert.equal(result.automaticRedispatchAllowed, false);
});

test('receipt reader failure is contained per baton and never becomes redispatch authority', async () => {
  const result = await reconcileProviderNeutralDispatchCandidates([candidate()], {
    readExecutionReceipt: async () => { throw new Error('surface interrupted'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].blocker, 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_READ_FAILED');
  assert.equal(result.results[0].automaticRedispatchAllowed, false);
});

test('mixed stranded batons reconcile independently after interruption', async () => {
  const second = candidate({
    batonId: 'provider-baton-222222222222222222222222',
    dispatchJobId: 'codex-job-22222222222222222222',
  });
  const result = await reconcileProviderNeutralDispatchCandidates([candidate(), second], {
    readExecutionReceipt: async (item) => item.dispatchJobId === candidate().dispatchJobId
      ? verifiedReceipt()
      : null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_WAITING_FOR_RECEIPTS');
  assert.equal(result.automaticRedispatchAllowed, false);
});

test('discovery failure remains a read-only blocked recovery state', async () => {
  const result = await recoverProviderNeutralDispatches({
    listCandidates: async () => ({ ok: false, blocker: 'BATON_DISCOVERY_IO_FAILED', candidates: [] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BATON_DISCOVERY_IO_FAILED');
  assert.equal(result.automaticRedispatchAllowed, false);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_BLOCKED');
});

test('recovery orchestration consumes discovery and verified receipt reader without mutation authority', async () => {
  const result = await recoverProviderNeutralDispatches({
    listCandidates: async () => ({ ok: true, candidates: [candidate()], invalidCount: 0, truncated: false }),
    readExecutionReceipt: async () => verifiedReceipt({ terminalState: 'BLOCKED' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.results[0].terminalState, 'BLOCKED');
  assert.equal(result.results[0].authority.runtimeMutationAllowed, false);
  assert.equal(result.automaticRedispatchAllowed, false);
});
