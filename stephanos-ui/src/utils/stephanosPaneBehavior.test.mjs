import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaneMoveAvailability, resolvePaneCollapsedState } from './stephanosPaneBehavior.js';

test('resolvePaneCollapsedState reads stable layoutKey and defaults open', () => {
  assert.equal(resolvePaneCollapsedState({ id: 'missionConsole', layoutKey: 'missionConsolePanel' }, { missionConsolePanel: false }), true);
  assert.equal(resolvePaneCollapsedState({ id: 'missionConsole', layoutKey: 'missionConsolePanel' }, { missionConsolePanel: true }), false);
  assert.equal(resolvePaneCollapsedState({ id: 'missionConsole' }, {}), false);
});

test('getPaneMoveAvailability disables first up and last down', () => {
  const order = ['mission-console', 'capability-radar', 'skill-forge'];
  assert.deepEqual(getPaneMoveAvailability(order, 'mission-console'), { canMoveUp: false, canMoveDown: true });
  assert.deepEqual(getPaneMoveAvailability(order, 'capability-radar'), { canMoveUp: true, canMoveDown: true });
  assert.deepEqual(getPaneMoveAvailability(order, 'skill-forge'), { canMoveUp: true, canMoveDown: false });
  assert.deepEqual(getPaneMoveAvailability(order, 'missing'), { canMoveUp: false, canMoveDown: false });
});
