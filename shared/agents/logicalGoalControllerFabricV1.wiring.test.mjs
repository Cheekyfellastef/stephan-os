import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../stephanos-server/services/programmeAuthorityService.js', import.meta.url), 'utf8');

test('Programme Authority publishes logical goal controller fabric from the canonical scheduler', () => {
  assert.match(source, /projectLogicalGoalControllerFabric/);
  assert.match(source, /scheduler,\s*\n\s*observedAtUtc:\s*nowUtc/);
  assert.match(source, /\['status',\s*LOGICAL_GOAL_CONTROLLER_FABRIC_FILE\]/);
  assert.match(source, /logicalGoalControllerFabricPublication/);
  assert.match(source, /logicalGoalControllerFabric,/);
});

test('logical controller publication is observability, not a new programme-wide handbrake', () => {
  assert.doesNotMatch(source, /source:logical-goal-controller-fabric-publication-failed/);
  assert.doesNotMatch(source, /source:logical-goal-controller-fabric-invalid/);
  assert.match(source, /logicalGoalControllerFabric:\s*logicalGoalControllerFabric\.valid/);
});

test('Programme Authority does not create a second scheduler or worker for logical controllers', () => {
  const schedulerBuilds = source.match(/deps\.buildMissionScheduler\(schedulerInput\)/g) || [];
  assert.equal(schedulerBuilds.length, 1);
  assert.doesNotMatch(source, /new\s+MissionScheduler|new\s+MissionWorker|createLogicalGoalWorker/);
});
