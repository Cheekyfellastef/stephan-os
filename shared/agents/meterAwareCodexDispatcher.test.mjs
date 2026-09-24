import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METER_AWARE_DISPATCH_STATE,
  buildCapacityTaskFromQueueRecord,
  createMeterAwareDispatchDecision,
} from './meterAwareCodexDispatcher.mjs';
import { CODEX_AVAILABILITY, CODEX_TASK_CLASS, createMeterObservation } from './codexCapacityGovernorV1.mjs';
import { createProviderFamilyRouteV1 } from './zeroOpenAiBuilderFailoverV1.mjs';

const NOW = '2026-07-17T12:00:00.000Z';

function freshObservation(input = {}) {
  return createMeterObservation({
    observedAtUtc: NOW,
    remainingPercent: 60,
    availability: CODEX_AVAILABILITY.AVAILABLE,
    confidence: 'high',
    ...input,
  });
}

test('queue record becomes a capacity task without creating a second queue', () => {
  const task = buildCapacityTaskFromQueueRecord(
    { jobId: 'job-1351', issueNumber: 1351, prompt: 'Build meter governor' },
    { urgent: true },
  );
  assert.equal(task.taskId, 'job-1351');
  assert.equal(task.taskClass, CODEX_TASK_CLASS.FOCUSED_REPAIR);
  assert.equal(task.urgent, true);
  assert.match(task.title, /Build meter governor/);
});

test('zero-cost work suppresses Codex dispatch', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-status', issueNumber: 1351, prompt: 'Read checks' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.STATUS },
    capacity: { observation: freshObservation({ remainingPercent: 80 }) },
    dispatcher: () => { calls += 1; return {}; },
  });
  assert.equal(decision.dispatcherInvoked, false);
  assert.equal(calls, 0);
  assert.equal(decision.state, METER_AWARE_DISPATCH_STATE.ROUTED_ZERO_COST);
  assert.equal(decision.finalVerdict, 'CODEX_DISPATCH_SUPPRESSED_ZERO_COST_ROUTE');
});

test('meter-stalled work prepares reset action without dispatching when provider-neutral parity is unavailable', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-large', issueNumber: 1351, prompt: 'Implement large capability' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION },
    capacity: {
      nowUtc: NOW,
      observation: freshObservation({
        remainingPercent: 0,
        availability: CODEX_AVAILABILITY.METER_STALLED,
        naturalResetAtUtc: '2026-07-20T20:25:00.000Z',
        bankedResets: [{ resetId: 'reset-1', expiresAtUtc: '2026-07-18T12:00:00.000Z' }],
      }),
      standingOperatorPolicyActive: true,
    },
    dispatcher: () => { calls += 1; return {}; },
  });
  assert.equal(decision.dispatcherInvoked, false);
  assert.equal(calls, 0);
  assert.equal(decision.state, METER_AWARE_DISPATCH_STATE.RESET_ACTION_READY);
  assert.equal(decision.resetAction.resetId, 'reset-1');
});

test('proven meter stall reuses the existing provider-neutral handoff for an exact-head task', () => {
  let calls = 0;
  const head = 'a'.repeat(40);
  const decision = createMeterAwareDispatchDecision({
    queueRecord: {
      jobId: 'job-provider-neutral',
      issueNumber: 2312,
      prompt: 'Repair provider continuity',
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'main',
      exactHeadProof: {
        repository: 'Cheekyfellastef/stephan-os',
        prNumber: 2312,
        expectedHead: head,
        branch: 'main',
        proofTarget: 'PULL_REQUEST_HEAD',
      },
    },
    providerNeutralContext: {
      missionId: 'mission-2312',
      goalId: 'goal-2312',
      correlationId: 'corr-2312',
      exactBase: 'b'.repeat(40),
      taskClass: 'sourceImplementation',
      expectedStartingHeadIfMutable: head,
      allowedPaths: ['shared/agents/meterAwareCodexDispatcher.mjs'],
      allowedOperations: ['sourceImplementation'],
      resourceLeaseIds: ['lease-2312'],
      completionContract: 'Preserve the exact bounded task while rerouting around unavailable Codex capacity.',
      createdAtUtc: NOW,
      expiresAtUtc: '2026-07-18T12:00:00.000Z',
    },
    providerRoutes: [createProviderFamilyRouteV1({
      routeId: 'forge-existing',
      adapterId: 'forge-existing',
      providerFamily: 'FORGE',
      capabilityHealth: {
        builderIgnition: 'HEALTHY',
        sourceImplementation: 'HEALTHY',
        publication: 'WRITE_BLOCKED',
        review: 'WRITE_BLOCKED',
      },
      qualifiedTaskClasses: ['sourceImplementation'],
      allowedOperations: ['sourceImplementation'],
      priority: 10,
      proofRef: 'proof:forge-existing',
    })],
    capacity: {
      nowUtc: NOW,
      observation: freshObservation({
        remainingPercent: 0,
        availability: CODEX_AVAILABILITY.METER_STALLED,
        naturalResetAtUtc: '2026-07-20T20:25:00.000Z',
      }),
    },
    dispatcher: () => { calls += 1; return {}; },
  });
  assert.equal(calls, 0);
  assert.equal(decision.dispatcherInvoked, false);
  assert.equal(decision.state, METER_AWARE_DISPATCH_STATE.ROUTED_PROVIDER_NEUTRAL);
  assert.equal(decision.finalVerdict, 'CODEX_CAPACITY_REROUTE_READY');
  assert.equal(decision.providerNeutralHandoff.preserveIdentity.taskId, 'job-provider-neutral');
  assert.equal(decision.providerNeutralHandoff.authority.duplicateDispatchAllowed, false);
});

test('stale, low-confidence, and non-executable meter states never invoke the dispatcher', () => {
  for (const observation of [
    freshObservation({ observedAtUtc: '2026-07-17T11:00:00.000Z' }),
    freshObservation({ confidence: 'low' }),
    freshObservation({ availability: CODEX_AVAILABILITY.BUSY }),
    freshObservation({ availability: CODEX_AVAILABILITY.DEGRADED }),
    freshObservation({ availability: CODEX_AVAILABILITY.UNAVAILABLE }),
  ]) {
    let calls = 0;
    const decision = createMeterAwareDispatchDecision({
      queueRecord: { jobId: 'job-blocked', issueNumber: 1351, prompt: 'Blocked repair' },
      taskProfile: { taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR },
      capacity: { nowUtc: NOW, observation },
      dispatcher: () => { calls += 1; return {}; },
    });
    assert.equal(decision.dispatcherInvoked, false);
    assert.equal(calls, 0);
  }
});

test('urgent repair classification reaches the governor and may consume only the emergency reserve', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-urgent', issueNumber: 1351, prompt: 'Urgent focused repair' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, urgent: true },
    capacity: { nowUtc: NOW, observation: freshObservation({ remainingPercent: 25 }) },
    dispatcher: ({ capacityProjection }) => {
      calls += 1;
      assert.equal(capacityProjection.reservedPercent, 15);
      assert.equal(capacityProjection.safelySchedulablePercent, 10);
      return { decision: 'DISPATCHED', finalVerdict: 'CODEX_JOB_DISPATCHED', record: { jobId: 'job-urgent' } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(decision.dispatcherInvoked, true);
  assert.equal(decision.finalVerdict, 'CODEX_JOB_DISPATCHED');
});

test('sufficient fresh trusted capacity invokes the approved dispatcher exactly once', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-repair', issueNumber: 1351, prompt: 'Focused repair' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR },
    capacity: { nowUtc: NOW, observation: freshObservation() },
    dispatcher: ({ capacityProjection }) => {
      calls += 1;
      assert.equal(capacityProjection.dispatchAllowed, true);
      return { decision: 'DISPATCHED', finalVerdict: 'CODEX_JOB_DISPATCHED', record: { jobId: 'job-repair' } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(decision.dispatcherInvoked, true);
  assert.equal(decision.finalVerdict, 'CODEX_JOB_DISPATCHED');
});
