import test from 'node:test';
import assert from 'node:assert/strict';

import { projectLogicalGoalControllerFabric } from './logicalGoalControllerFabricV1.mjs';
import { buildMonitorRuntimeProjectionV2 } from './monitorAdmissionRuntimeV2.mjs';
import { proposalToMonitorDefinition } from './monitorAdmissionBridge.mjs';

const FLEET = Object.freeze([
  Object.freeze({ controllerId: 'controller-0', title: 'Controller 0' }),
  Object.freeze({ controllerId: 'controller-1', title: 'Controller 1' }),
  Object.freeze({ controllerId: 'controller-2', title: 'Controller 2' }),
  Object.freeze({ controllerId: 'controller-3', title: 'Controller 3' }),
  Object.freeze({ controllerId: 'controller-4', title: 'Controller 4' }),
]);

function goal(issue, lifecycle = 'READY') {
  return {
    issue,
    title: `Goal ${issue}`,
    lifecycle,
    route: 'OPENCLAW_LOCAL',
    resourceIds: [`repo:Cheekyfellastef/stephan-os:path:goal-${issue}`],
  };
}

function scheduler(goals) {
  return {
    schemaVersion: 'stephanos.mission-scheduler.v1',
    portfolio: goals,
    decisionReceipt: {
      selectedIssue: goals[0]?.issue ?? null,
      selectedIssues: goals.slice(0, 3).map((item) => item.issue),
    },
  };
}

test('seven scheduler goals become seven logical controller pulses through one multiplexer task slot', async () => {
  const fabric = projectLogicalGoalControllerFabric({
    scheduler: scheduler(Array.from({ length: 7 }, (_, index) => goal(2300 + index))),
    physicalControllers: FLEET,
    observedAtUtc: '2026-10-01T09:00:00.000Z',
  });
  const projection = buildMonitorRuntimeProjectionV2({
    registrySchemaVersion: 'stephanos.monitor-admission-registry.v1',
    monitors: {},
    idempotency: {},
  }, {
    logicalGoalControllerFabric: fabric,
    nowMs: Date.parse('2026-10-01T09:00:00.000Z'),
  });

  assert.equal(fabric.valid, true);
  assert.equal(projection.monitorCount, 7);
  assert.equal(projection.logicalControllerCount, 7);
  assert.equal(projection.logicalGoalControllerCount, 7);
  assert.equal(projection.externalTaskSlotsRequired, 1);
  assert.deepEqual(projection.logicalControllerCollisions, []);
  assert.equal(projection.monitors.every((monitor) => monitor.handlerId === 'scheduled-summary'), true);

  const result = await projection.handlers['scheduled-summary']({
    monitorId: 'logical-goal-2300',
    timestampUtc: '2026-10-01T09:00:00.000Z',
  });
  assert.equal(result.state, 'PASS');
  assert.match(result.summary, /logical-goal-2300/i);
  assert.equal(result.notify, true);
});

test('closed/superseded goal controllers disappear from the live multiplexer overlay', () => {
  const fabric = projectLogicalGoalControllerFabric({
    scheduler: scheduler([
      goal(2400, 'SUPERSEDED'),
      goal(2401, 'READY'),
      goal(2402, 'APPROVAL_REQUIRED'),
    ]),
    physicalControllers: FLEET,
  });
  const projection = buildMonitorRuntimeProjectionV2({
    registrySchemaVersion: 'stephanos.monitor-admission-registry.v1',
    monitors: {},
    idempotency: {},
  }, { logicalGoalControllerFabric: fabric, nowMs: 1 });

  assert.equal(fabric.controllers.find((item) => item.goalIssueNumber === 2400).retired, true);
  assert.equal(projection.logicalGoalControllerCount, 2);
  assert.equal(projection.monitors.some((item) => item.monitorId === 'logical-goal-2400'), false);
  assert.equal(projection.monitors.some((item) => item.monitorId === 'logical-goal-2401'), true);
  assert.equal(projection.monitors.some((item) => item.monitorId === 'logical-goal-2402'), true);
});

test('logical controller ID collision cannot replace an existing durable monitor', () => {
  const fabric = projectLogicalGoalControllerFabric({
    scheduler: scheduler([goal(2500)]),
    physicalControllers: FLEET,
  });
  const durableProposal = {
    schemaVersion: 'stephanos.monitor-admission-proposal.v1',
    monitorId: 'logical-goal-2500',
    idempotencyKey: 'durable-existing',
    handlerType: 'SCHEDULED_SUMMARY',
    boundedSubject: { topic: 'Existing durable monitor', scope: 'controller:existing' },
    schedule: { intervalMs: 60_000, nextDueUtc: '2026-10-01T09:00:00.000Z' },
    mode: 'RECURRING',
    notificationPolicy: 'STATE_CHANGE',
    relatedIssueOrGoal: '#2500',
    enabled: true,
    proofRefs: ['proof/existing.json'],
  };
  const durableDefinition = proposalToMonitorDefinition(durableProposal);
  const projection = buildMonitorRuntimeProjectionV2({
    registrySchemaVersion: 'stephanos.monitor-admission-registry.v1',
    monitors: {
      'logical-goal-2500': {
        monitorId: 'logical-goal-2500',
        proposal: durableProposal,
        definition: durableDefinition,
        updatedAtUtc: '2026-10-01T09:00:00.000Z',
      },
    },
    idempotency: {},
  }, {
    logicalGoalControllerFabric: fabric,
    nowMs: Date.parse('2026-10-01T09:00:00.000Z'),
  });

  assert.deepEqual(projection.logicalControllerCollisions, ['logical-goal-2500']);
  assert.equal(projection.logicalGoalControllerCount, 0);
  assert.equal(projection.monitorCount, 1);
});
