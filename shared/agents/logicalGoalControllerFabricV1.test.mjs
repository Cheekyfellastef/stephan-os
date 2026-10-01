import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectLogicalGoalControllerFabric,
} from './logicalGoalControllerFabricV1.mjs';

const FLEET = Object.freeze([
  Object.freeze({ controllerId: 'a', title: 'A' }),
  Object.freeze({ controllerId: 'b', title: 'B' }),
  Object.freeze({ controllerId: 'c', title: 'C' }),
  Object.freeze({ controllerId: 'd', title: 'D' }),
  Object.freeze({ controllerId: 'e', title: 'E' }),
]);

function scheduler(portfolio, overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-scheduler.v1',
    portfolio,
    decisionReceipt: {
      selectedIssue: null,
      selectedIssues: [],
      ...overrides.decisionReceipt,
    },
    ...overrides,
  };
}

function goal(issue, lifecycle = 'READY', overrides = {}) {
  return {
    issue,
    title: `Goal ${issue}`,
    lifecycle,
    route: 'OPENCLAW_LOCAL',
    resourceIds: [`repo:Cheekyfellastef/stephan-os:path:goal-${issue}`],
    ...overrides,
  };
}

test('projects one stable logical controller for every scheduler portfolio goal across five hosts', () => {
  const result = projectLogicalGoalControllerFabric({
    scheduler: scheduler(Array.from({ length: 12 }, (_, index) => goal(1200 + index))),
    physicalControllers: FLEET,
    observedAtUtc: '2026-10-01T09:00:00.000Z',
  });

  assert.equal(result.valid, true);
  assert.equal(result.logicalControllerCount, 12);
  assert.equal(result.physicalControllerCount, 5);
  assert.equal(new Set(result.controllers.map((item) => item.logicalControllerId)).size, 12);
  assert.equal(result.hostLoads.reduce((sum, item) => sum + item.logicalControllerCount, 0), 12);
  assert.equal(result.controllers.every((item) => FLEET.some((host) => host.controllerId === item.hostControllerId)), true);
  assert.equal(result.schedulerIsSoleGoalSelectionAuthority, true);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('host assignment is stable even when portfolio order changes', () => {
  const first = projectLogicalGoalControllerFabric({
    scheduler: scheduler([goal(2314), goal(1657), goal(1637)]),
    physicalControllers: FLEET,
  });
  const second = projectLogicalGoalControllerFabric({
    scheduler: scheduler([goal(1637), goal(2314), goal(1657)]),
    physicalControllers: FLEET,
  });

  const host = (result, issue) => result.controllers.find((item) => item.goalIssueNumber === issue).hostControllerId;
  assert.equal(host(first, 2314), host(second, 2314));
  assert.equal(host(first, 1657), host(second, 1657));
  assert.equal(host(first, 1637), host(second, 1637));
});

test('selected scheduler goals are marked for admission without granting mutation authority', () => {
  const result = projectLogicalGoalControllerFabric({
    scheduler: scheduler([goal(2314), goal(1657)], {
      decisionReceipt: { selectedIssue: 2314, selectedIssues: [2314, 1657] },
    }),
    physicalControllers: FLEET,
  });

  assert.equal(result.valid, true);
  assert.equal(result.controllers.every((item) => item.selectedForAdmission), true);
  assert.equal(result.controllers.every((item) => item.executionOwner === 'canonical-mission-scheduler-and-mission-worker'), true);
  assert.equal(result.controllers.every((item) => item.sourceMutationAllowed === false), true);
});

test('terminal or superseded work retires only its logical controller while close-ready work remains tracked', () => {
  const result = projectLogicalGoalControllerFabric({
    scheduler: scheduler([
      goal(1, 'SUPERSEDED'),
      goal(2, 'DUPLICATE'),
      goal(3, 'CLOSE_READY'),
      goal(4, 'APPROVAL_REQUIRED'),
    ]),
    physicalControllers: FLEET,
  });

  assert.equal(result.controllers.find((item) => item.goalIssueNumber === 1).retired, true);
  assert.equal(result.controllers.find((item) => item.goalIssueNumber === 2).retired, true);
  assert.equal(result.controllers.find((item) => item.goalIssueNumber === 3).retired, false);
  assert.equal(result.controllers.find((item) => item.goalIssueNumber === 3).continuityState, 'TRACKING');
  assert.equal(result.controllers.find((item) => item.goalIssueNumber === 4).continuityState, 'PARKED');
});

test('fails closed on duplicate or malformed scheduler goal identity', () => {
  const duplicate = projectLogicalGoalControllerFabric({
    scheduler: scheduler([goal(2314), goal(2314)]),
    physicalControllers: FLEET,
  });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.blockers.some((item) => item.includes('DUPLICATE')));

  const malformed = projectLogicalGoalControllerFabric({
    scheduler: scheduler([{ title: 'missing issue', lifecycle: 'READY' }]),
    physicalControllers: FLEET,
  });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.blockers.includes('LOGICAL_CONTROLLER_GOAL_IDENTITY_INVALID'));
});

test('canonical scheduler truth, not prompt-era mission text, defines logical controller state', () => {
  const result = projectLogicalGoalControllerFabric({
    scheduler: {
      ...scheduler([goal(2461, 'SUPERSEDED')]),
      currentPrimaryAcceptance: 'pretend this old prompt is still current',
    },
    physicalControllers: FLEET,
  });

  assert.equal(result.valid, true);
  assert.equal(result.controllers[0].retired, true);
  assert.equal(result.controllers[0].promptMissionAuthoritative, false);
  assert.equal(result.currentTruthMustBeReconciledEveryCycle, true);
  assert.equal(result.stalePromptMissionMayNotOverrideCanonicalTruth, true);
});
