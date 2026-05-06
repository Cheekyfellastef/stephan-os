import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeWorkGovernor } from './runtimeWorkGovernor.mjs';

function makeStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
}

test('visible tab becomes active leader', () => {
  const doc = { visibilityState: 'visible', addEventListener() {} };
  const storage = makeStorage();
  const states = [];
  const governor = createRuntimeWorkGovernor({ documentImpl: doc, storage, setIntervalImpl: () => null, clearIntervalImpl: () => {}, BroadcastChannelImpl: null, onStateChange: (s) => states.push(s), now: () => 1000, tabId: 'a' });
  governor.start();
  assert.equal(states.at(-1).mode, 'active');
  assert.equal(states.at(-1).leader, true);
  governor.stop();
});

test('hidden tab is hidden mode', () => {
  const doc = { visibilityState: 'hidden', addEventListener() {} };
  const governor = createRuntimeWorkGovernor({ documentImpl: doc, storage: makeStorage(), setIntervalImpl: () => null, clearIntervalImpl: () => {}, BroadcastChannelImpl: null, now: () => 1000, tabId: 'a' });
  governor.start();
  const state = governor.getState();
  assert.equal(state.mode, 'hidden');
  assert.equal(state.leader, false);
  governor.stop();
});

test('duplicate visible tab becomes standby', () => {
  const storage = makeStorage();
  const doc = { visibilityState: 'visible', addEventListener() {} };
  const g1 = createRuntimeWorkGovernor({ documentImpl: doc, storage, setIntervalImpl: () => null, clearIntervalImpl: () => {}, BroadcastChannelImpl: null, now: () => 1000, tabId: 'a' });
  g1.start();
  const g2 = createRuntimeWorkGovernor({ documentImpl: doc, storage, setIntervalImpl: () => null, clearIntervalImpl: () => {}, BroadcastChannelImpl: null, now: () => 1001, tabId: 'b' });
  g2.start();
  assert.equal(g2.getState().mode, 'standby');
  assert.equal(g2.getState().duplicateTabDetected, true);
  g1.stop(); g2.stop();
});

test('leader handoff after first disappears', () => {
  const storage = makeStorage();
  const doc = { visibilityState: 'visible', addEventListener() {} };
  let t = 1000;
  const g1 = createRuntimeWorkGovernor({ documentImpl: doc, storage, setIntervalImpl: () => null, clearIntervalImpl: () => {}, BroadcastChannelImpl: null, now: () => t, tabId: 'a' });
  const g2 = createRuntimeWorkGovernor({ documentImpl: doc, storage, setIntervalImpl: () => null, clearIntervalImpl: () => {}, BroadcastChannelImpl: null, now: () => t, tabId: 'b' });
  g1.start(); g2.start();
  g1.stop();
  t += 8000;
  g2.heartbeat('test-handoff');
  assert.equal(g2.getState().leader, true);
  g2.stop();
});
