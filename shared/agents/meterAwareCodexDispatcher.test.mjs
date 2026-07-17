import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METER_AWARE_DISPATCH_STATE,
  buildCapacityTaskFromQueueRecord,
  createMeterAwareDispatchDecision,
} from './meterAwareCodexDispatcher.mjs';
import { CODEX_AVAILABILITY, CODEX_TASK_CLASS, createMeterObservation } from './codexCapacityGovernorV1.mjs';

test('queue record becomes a capacity task without creating a second queue', () => {
  const task = buildCapacityTaskFromQueueRecord({ jobId: 'job-1351', issueNumber: 1351, prompt: 'Build meter governor' });
  assert.equal(task.taskId, 'job-1351');
  assert.equal(task.taskClass, CODEX_TASK_CLASS.FOCUSED_REPAIR);
  assert.match(task.title, /Build meter governor/);
});

test('zero-cost work suppresses Codex dispatch', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-status', issueNumber: 1351, prompt: 'Read checks' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.STATUS },
    capacity: {
      observation: createMeterObservation({ remainingPercent: 80, availability: CODEX_AVAILABILITY.AVAILABLE, confidence: 'high' }),
    },
    dispatcher: () => { calls += 1; return {}; },
  });
  assert.equal(decision.dispatcherInvoked, false);
  assert.equal(calls, 0);
  assert.equal(decision.state, METER_AWARE_DISPATCH_STATE.ROUTED_ZERO_COST);
  assert.equal(decision.finalVerdict, 'CODEX_DISPATCH_SUPPRESSED_ZERO_COST_ROUTE');
});

test('meter-stalled work prepares reset action without dispatching', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-large', issueNumber: 1351, prompt: 'Implement large capability' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION },
    capacity: {
      nowUtc: '2026-07-17T12:00:00.000Z',
      observation: createMeterObservation({
        observedAtUtc: '2026-07-17T12:00:00.000Z',
        remainingPercent: 0,
        availability: CODEX_AVAILABILITY.METER_STALLED,
        confidence: 'high',
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

test('sufficient capacity invokes the approved dispatcher exactly once', () => {
  let calls = 0;
  const decision = createMeterAwareDispatchDecision({
    queueRecord: { jobId: 'job-repair', issueNumber: 1351, prompt: 'Focused repair' },
    taskProfile: { taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR },
    capacity: {
      observation: createMeterObservation({ remainingPercent: 60, availability: CODEX_AVAILABILITY.AVAILABLE, confidence: 'high' }),
    },
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
