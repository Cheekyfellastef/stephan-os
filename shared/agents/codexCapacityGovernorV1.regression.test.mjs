import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_AVAILABILITY,
  CODEX_CAPACITY_DECISION,
  CODEX_TASK_CLASS,
  DEFAULT_TASK_COST_PERCENT,
  buildCodexCapacityProjection,
  buildTaskCostModel,
  createMeterObservation,
  createTaskConsumptionReceipt,
  planBankedReset,
} from './codexCapacityGovernorV1.mjs';

const NOW = '2026-07-20T22:30:00.000Z';
const RESET = { resetId: 'reset-1', expiresAtUtc: '2026-07-25T12:00:00.000Z' };

function validObservation(overrides = {}) {
  return createMeterObservation({
    observedAtUtc: NOW,
    remainingPercent: 0,
    availability: CODEX_AVAILABILITY.METER_STALLED,
    confidence: 'high',
    naturalResetAtUtc: '2026-07-26T12:00:00.000Z',
    bankedResets: [RESET],
    ...overrides,
  });
}

function plan(overrides = {}) {
  return planBankedReset({
    observation: validObservation(),
    nowUtc: NOW,
    queueDemandPercent: 30,
    standingOperatorPolicyActive: true,
    standingOperatorPolicyRef: 'operator-policy/codex-banked-reset-v1',
    ...overrides,
  });
}

test('missing remaining percentage remains unknown and cannot prepare reset', () => {
  const observation = createMeterObservation({
    observedAtUtc: NOW,
    availability: CODEX_AVAILABILITY.METER_STALLED,
    confidence: 'high',
    bankedResets: [RESET],
  });
  assert.equal(observation.remainingPercent, null);
  assert.equal(observation.remainingPercentObserved, false);
  assert.equal(observation.complete, false);
  const result = plan({ observation });
  assert.equal(result.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.equal(result.action, null);
  assert.match(result.reason, /incomplete/i);
});

test('missing availability remains unknown and cannot prepare reset', () => {
  const observation = createMeterObservation({
    observedAtUtc: NOW,
    remainingPercent: 0,
    confidence: 'high',
    bankedResets: [RESET],
  });
  assert.equal(observation.availability, CODEX_AVAILABILITY.UNKNOWN);
  assert.equal(observation.availabilityObserved, false);
  const result = plan({ observation });
  assert.equal(result.action, null);
  assert.match(result.reason, /incomplete/i);
});

test('incomplete observation also blocks normal dispatch', () => {
  const result = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: createMeterObservation({ observedAtUtc: NOW, confidence: 'high' }),
    tasks: [{ taskId: 'repair', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
  });
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.decision, CODEX_CAPACITY_DECISION.CODEX_CAPACITY_UNKNOWN);
  assert.match(result.reason, /explicit remaining percentage and availability/i);
});

test('one optimistic sample cannot lower conservative task cost default', () => {
  const model = buildTaskCostModel([
    createTaskConsumptionReceipt({
      taskId: 'one',
      taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR,
      observedConsumptionPercent: 1,
    }),
  ]);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.sampleCount, 1);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.p80Percent, DEFAULT_TASK_COST_PERCENT.FOCUSED_REPAIR);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.source, 'conservative-default-insufficient-samples');
});

test('enough samples remain floored by conservative default', () => {
  const model = buildTaskCostModel([1, 2, 3].map((value, index) => createTaskConsumptionReceipt({
    taskId: `sample-${index}`,
    taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR,
    observedConsumptionPercent: value,
  })));
  assert.equal(model.taskClasses.FOCUSED_REPAIR.sampleCount, 3);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.p50Percent, DEFAULT_TASK_COST_PERCENT.FOCUSED_REPAIR);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.p80Percent, DEFAULT_TASK_COST_PERCENT.FOCUSED_REPAIR);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.source, 'observed-with-conservative-floor');
});

test('completion receipt prevents the same reset being prepared again', () => {
  const result = plan({
    resetCompletionReceipts: [{
      ok: true,
      finalVerdict: 'CODEX_BANKED_RESET_CONFIRMED',
      resetId: RESET.resetId,
    }],
  });
  assert.equal(result.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.equal(result.action, null);
  assert.match(result.reason, /completion receipt/i);
  assert.deepEqual(result.completedResetIds, [RESET.resetId]);
});

test('completed reset IDs pass through the capacity projection', () => {
  const result = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: validObservation(),
    tasks: [{ taskId: 'repair', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
    standingOperatorPolicyActive: true,
    standingOperatorPolicyRef: 'operator-policy/codex-banked-reset-v1',
    completedResetIds: [RESET.resetId],
  });
  assert.equal(result.resetPlan.action, null);
  assert.match(result.resetPlan.reason, /completion receipt/i);
});

test('prepared action matches the bounded Battle Bridge mailbox contract', () => {
  const result = plan();
  assert.equal(result.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW);
  assert.equal(result.action.executionSurface, 'BATTLE_BRIDGE_AUTHENTICATED_CODEX_UI');
  assert.equal(result.action.singlePressOnly, true);
  assert.equal(result.action.resetExpiresAtUtc, RESET.expiresAtUtc);
  assert.equal(result.action.genericBrowserAutomationAllowed, false);
});
