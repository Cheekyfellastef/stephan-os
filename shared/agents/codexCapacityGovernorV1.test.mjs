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
    observation: freshObservation({ remainingPercent: 80 }),
    tasks: [{ taskId: 'status', taskClass: CODEX_TASK_CLASS.STATUS, title: 'Read PR checks' }],
  });
  assert.equal(projection.decision, CODEX_CAPACITY_DECISION.CODEX_ROUTE_ZERO_COST);
  assert.equal(projection.selectedRoute, CODEX_ROUTE.BATTLE_BRIDGE);
  assert.equal(projection.dispatchAllowed, false);
});

test('capacity projection preserves configured reserves before ordinary Codex dispatch', () => {
  const projection = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ remainingPercent: 50 }),
    tasks: [{ taskId: 'repair', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, capabilityValue: 90 }],
  });
  assert.equal(projection.configuredReservedPercent, 25);
  assert.equal(projection.reservedPercent, 25);
  assert.equal(projection.safelySchedulablePercent, 25);
  assert.equal(projection.decision, CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED);
  assert.equal(projection.dispatchAllowed, true);
});

test('large task defers when it would consume protected capacity', () => {
  const projection = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({
      remainingPercent: 30,
      naturalResetAtUtc: '2026-07-19T20:25:00.000Z',
    }),
    tasks: [{ taskId: 'large', taskClass: CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION, complexityMultiplier: 1.5 }],
  });
  assert.equal(projection.decision, CODEX_CAPACITY_DECISION.CODEX_DEFER_UNTIL_NATURAL_RESET);
  assert.equal(projection.selectedRoute, CODEX_ROUTE.DEFER_UNTIL_RESET);
  assert.equal(projection.dispatchAllowed, false);
});

test('earliest-expiring reset is redeemed only when meter is blocked, demand exists, and standing policy is active', () => {
  const observation = freshObservation({
    remainingPercent: 0,
    availability: CODEX_AVAILABILITY.METER_STALLED,
    naturalResetAtUtc: '2026-07-20T20:25:00.000Z',
    bankedResets: [
      { resetId: 'reset-later', expiresAtUtc: '2026-07-25T12:00:00.000Z' },
      { resetId: 'reset-first', expiresAtUtc: '2026-07-18T12:00:00.000Z' },
    ],
  });
  const plan = planBankedReset({
    observation,
    nowUtc: NOW,
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
    observation: freshObservation({
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      naturalResetAtUtc: '2026-07-17T13:00:00.000Z',
      bankedResets: [{ resetId: 'reset-1', expiresAtUtc: '2026-07-25T12:00:00.000Z' }],
    }),
    nowUtc: NOW,
    queueDemandPercent: 30,
    standingOperatorPolicyActive: true,
  });
  assert.equal(plan.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.match(plan.reason, /natural meter reset is imminent/i);
});

test('automatic reset redemption fails closed without standing operator policy', () => {
  const plan = planBankedReset({
    observation: freshObservation({
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      bankedResets: [{ resetId: 'reset-1', expiresAtUtc: '2026-07-18T12:00:00.000Z' }],
    }),
    nowUtc: NOW,
    queueDemandPercent: 30,
  });
  assert.equal(plan.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.match(plan.reason, /standing operator policy/i);
});

test('busy degraded unavailable stalled and unknown availability never dispatch Codex', () => {
  for (const availability of [
    CODEX_AVAILABILITY.BUSY,
    CODEX_AVAILABILITY.DEGRADED,
    CODEX_AVAILABILITY.UNAVAILABLE,
    CODEX_AVAILABILITY.METER_STALLED,
    CODEX_AVAILABILITY.UNKNOWN,
  ]) {
    const projection = buildCodexCapacityProjection({
      nowUtc: NOW,
      observation: freshObservation({ availability, remainingPercent: 80 }),
      tasks: [{ taskId: availability, taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
    });
    assert.equal(projection.dispatchAllowed, false, availability);
    assert.equal(projection.selectedRoute, CODEX_ROUTE.BLOCKED, availability);
  }
});

test('stale and low-confidence meter truth fail closed before dispatch', () => {
  const stale = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ observedAtUtc: '2026-07-17T11:00:00.000Z' }),
    tasks: [{ taskId: 'stale', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
  });
  assert.equal(stale.decision, CODEX_CAPACITY_DECISION.CODEX_CAPACITY_UNKNOWN);
  assert.equal(stale.dispatchAllowed, false);
  assert.match(stale.reason, /stale/i);

  const lowConfidence = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ confidence: 'low' }),
    tasks: [{ taskId: 'low', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR }],
  });
  assert.equal(lowConfidence.decision, CODEX_CAPACITY_DECISION.CODEX_CAPACITY_UNKNOWN);
  assert.equal(lowConfidence.dispatchAllowed, false);
  assert.match(lowConfidence.reason, /confidence/i);
});

test('protected task classes may consume their matching reserve but preserve all others', () => {
  const exactHead = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ remainingPercent: 20 }),
    tasks: [{ taskId: 'review', taskClass: CODEX_TASK_CLASS.EXACT_HEAD_REVIEW }],
  });
  assert.equal(exactHead.reservedPercent, 17);
  assert.equal(exactHead.safelySchedulablePercent, 3);
  assert.equal(exactHead.decision, CODEX_CAPACITY_DECISION.CODEX_BLOCKED_BY_METER);

  const exactHeadFits = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ remainingPercent: 25 }),
    tasks: [{ taskId: 'review', taskClass: CODEX_TASK_CLASS.EXACT_HEAD_REVIEW }],
  });
  assert.equal(exactHeadFits.reservedPercent, 17);
  assert.equal(exactHeadFits.safelySchedulablePercent, 8);
  assert.equal(exactHeadFits.dispatchAllowed, true);

  const windowsProof = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ remainingPercent: 33 }),
    tasks: [{ taskId: 'windows', taskClass: CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF }],
  });
  assert.equal(windowsProof.reservedPercent, 18);
  assert.equal(windowsProof.safelySchedulablePercent, 15);
  assert.equal(windowsProof.dispatchAllowed, true);

  const urgentRepair = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation({ remainingPercent: 25 }),
    tasks: [{ taskId: 'urgent', taskClass: CODEX_TASK_CLASS.FOCUSED_REPAIR, urgent: true }],
  });
  assert.equal(urgentRepair.reservedPercent, 15);
  assert.equal(urgentRepair.safelySchedulablePercent, 10);
  assert.equal(urgentRepair.dispatchAllowed, true);
});

test('reset action is not prepared after its one-hour safety deadline', () => {
  const plan = planBankedReset({
    observation: freshObservation({
      remainingPercent: 0,
      availability: CODEX_AVAILABILITY.METER_STALLED,
      naturalResetAtUtc: '2026-07-20T12:00:00.000Z',
      bankedResets: [{ resetId: 'reset-soon', expiresAtUtc: '2026-07-17T12:30:00.000Z' }],
    }),
    nowUtc: NOW,
    queueDemandPercent: 30,
    standingOperatorPolicyActive: true,
  });
  assert.equal(plan.decision, CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD);
  assert.equal(plan.action, null);
  assert.match(plan.reason, /one-hour safety boundary/i);
});

test('stack velocity reports current, no-Codex, and OpenClaw-upgraded rates from verified slices only', () => {
  const projection = buildCodexCapacityProjection({
    nowUtc: NOW,
    observation: freshObservation(),
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
  assert.match(skill, /Generic browser automation is forbidden/);
  assert.match(skill, /Do not execute arbitrary JavaScript/);
  assert.match(skill, /Do not navigate to unrelated account, billing, security, cookie, session, or credential surfaces/);
});
