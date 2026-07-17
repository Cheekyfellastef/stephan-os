import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CODEX_AVAILABILITY,
  CODEX_CAPACITY_DECISION,
  CODEX_ROUTE,
  CODEX_TASK_CLASS,
  buildCodexCapacityProjection,
  buildTaskCostModel,
  createMeterObservation,
  createTaskConsumptionReceipt,
  planBankedReset,
} from './codexCapacityGovernorV1.mjs';

test('task receipts build a conservative observed cost model', () => {
  const model = buildTaskCostModel([
    createTaskConsumptionReceipt({ taskId: 'a', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, meterBeforePercent: 80, meterAfterPercent: 72 }),
    createTaskConsumptionReceipt({ taskId: 'b', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, meterBeforePercent: 72, meterAfterPercent: 60 }),
    createTaskConsumptionReceipt({ taskId: 'c', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, observedConsumptionPercent: 20 }),
  ]);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.sampleCount, 3);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.p50Percent, 12);
  assert.equal(model.taskClasses.FOCUSED_REPAIR.p80Percent, 20);
  assert.equal(model.taskClasses.EXACT_HEAD_REVIEW.source, 'conservative-default');
});

test('status and architecture work route away from Codex', () => {
  const projection = buildCodexCapacityProjection({
    observation: createMeterObservation({ remainingPercent: 80, availability: CODEX_AVAILABILITY.AVAILABLE, confidence: 'high' }),
    tasks: [{ taskId: 'status', taskClass: CODEX_TASK_CLASS.STATUS, title: 'Read PR checks' }],
  });
  assert.equal(projection.decision, CODEX_CAPACITY_DECISION.CODEX_ROUTE_ZERO_COST);
  assert.equal(projection.selectedRoute, CODEX_ROUTE.BATTLE_BRIDGE);
  assert.equal(projection.dispatchAllowed, false);
});

test('capacity projection preserves configured reserves before Codex dispatch', () => {
  const projection = buildCodexCapacityProjection({
    observation: createMeterObservation({ remainingPercent: 50, availability: CODEX_AVAILABILITY.AVAILABLE, confidence: 'high' }),
    tasks: [{ taskId: 'repair', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, capabilityValue: 90 }],
  });
  assert.equal(projection.reservedPercent, 25);
  assert.equal(projection.safelySchedulablePercent, 25);
  assert.equal(projection.decision, CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED);
  assert.equal(projection.dispatchAllowed, true);
});

test('large task defers when it would consume protected capacity', () => {
  const projection = buildCodexCapacityProjection({
    nowUtc: '2026-07-17T12:00:00.000Z',
    observation: createMeterObservation({
      observedAtUtc: '2026-07-17T12:00:00.000Z',
      remainingPercent: 30,
      availability: CODEX_AVAILABILITY.AVAILABLE,
      confidence: 'high',
      naturalResetAtUtc: '2026-07-19T20:25:00.000Z',
    }),
    tasks: [{ taskId: 'large', taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION, complexityMultiplier: 1.5 }],
  });
  assert.equal(projection.decision, CODEX_CAPACITY_DECISION.CODEX_DEFER_UNTIL_NATURAL_RESET);
  assert.equal(projection.selectedRoute, CODEX_ROUTE.DEFER_UNTIL_RESET);
  assert.equal(projection.dispatchAllowed, false);
});

test('earliest-expiring reset is redeemed only when meter is blocked, demand exists, and standing policy is active', () => {
  const observation = createMeterObservation({
    observedAtUtc: '2026-07-17T12:00:00.000Z',
    remainingPercent: 0,
    availability: CODEX_AVAILABILITY.METER_STALLED,
    confidence: 'high',
    naturalResetAtUtc: '2026-07-20T20:25:00.000Z',
    bankedResets: [
      { resetId: 'reset-later', expiresAtUtc: '2026-07-25T12:00:00.000Z' },
      { resetId: 'reset-first', expiresAtUtc: '2026-07-18T12:00:00.000Z' },
    ],
  });
  const plan = planBankedReset({
    observation,
    nowUtc: '2026-07-17T12:00:00.000Z',
    queueDemandPercent: 30,
    standingOperatorPolicyActive: true,
  });
  assert.equal(plan.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW);
  assert.equal(plan.selectedReset.resetId, 'reset-first');
  assert.equal(plan.action.operation, 'REDEEM_BANKED_CODEX_RATE_LIMIT_RESET');
  assert.equal(plan.action.fixedUiActionOnly, true);
  assert.equal(plan.action.genericBrowserAutomationAllowed, false);
  assert.equal(plan.action.credentialsMayBeReadOrExported, false);
});

test('banked reset is held when natural reset is imminent', () => {
  const plan = planBankedReset({
    observation: createMeterObservation({
      observedAtUtc: '2026-07-17T12:00:00.000Z',
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      confidence: 'high',
      naturalResetAtUtc: '2026-07-17T13:00:00.000Z',
      bankedResets: [{ resetId: 'reset-1', expiresAtUtc: '2026-07-25T12:00:00.000Z' }],
    }),
    nowUtc: '2026-07-17T12:00:00.000Z',
    queueDemandPercent: 30,
    standingOperatorPolicyActive: true,
  });
  assert.equal(plan.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.match(plan.reason, /natural meter reset is imminent/i);
});

test('automatic reset redemption fails closed without standing operator policy', () => {
  const plan = planBankedReset({
    observation: createMeterObservation({
      observedAtUtc: '2026-07-17T12:00:00.000Z',
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      confidence: 'high',
      bankedResets: [{ resetId: 'reset-1', expiresAtUtc: '2026-07-18T12:00:00.000Z' }],
    }),
    nowUtc: '2026-07-17T12:00:00.000Z',
    queueDemandPercent: 30,
  });
  assert.equal(plan.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.match(plan.reason, /standing operator policy/i);
});

test('stack velocity reports current, no-Codex, and OpenClaw-upgraded rates from verified slices only', () => {
  const projection = buildCodexCapacityProjection({
    observation: createMeterObservation({ remainingPercent: 60, availability: CODEX_AVAILABILITY.AVAILABLE, confidence: 'high' }),
    stackVelocity: {
      verifiedCapabilitySlices: 12,
      elapsedDays: 28,
      codexContributionFraction: 0.25,
      openClawUpliftFraction: 0.5,
      primaryConstraint: 'runtime acceptance',
    },
  });
  assert.equal(projection.stackVelocity.currentSlicesPerWeek, 3);
  assert.equal(projection.stackVelocity.withoutCodexSlicesPerWeek, 2.25);
  assert.equal(projection.stackVelocity.withOpenClawUpgradeSlicesPerWeek, 4.125);
  assert.equal(projection.stackVelocity.verifiedSlicesOnly, true);
});

test('Remote Codex reset skill stays bounded to one authenticated reset action', async () => {
  const skill = await readFile(new URL('../../.codex/skills/redeem-banked-codex-reset/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /REDEEM_BANKED_CODEX_RATE_LIMIT_RESET/);
  assert.match(skill, /earliest-expiring/i);
  assert.match(skill, /press exactly one/i);
  assert.match(skill, /BLOCKED_RESET_UI_MISMATCH/);
  assert.doesNotMatch(skill, /export cookies|read credentials|generic browser automation/i);
});
