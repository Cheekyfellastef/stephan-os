import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKEND_EXPECTED_HEAD_HANDOFF_SCHEMA,
  evaluateBackendExpectedHeadHandoffConsumption,
  evaluateBackendExpectedHeadHandoffPublication,
} from './backendExpectedHeadHandoffV1.mjs';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const NOW = 1_800_000_000_000;

function validHandoff(overrides = {}) {
  return {
    handoffObserved: true,
    consumeSucceeded: true,
    schemaVersion: BACKEND_EXPECTED_HEAD_HANDOFF_SCHEMA,
    target: 'backend',
    handoffHead: HEAD_A,
    issuedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    nowMs: NOW,
    currentHead: HEAD_A,
    canonicalStandaloneSource: true,
    ...overrides,
  };
}

test('publication is impossible until every previous consumer is proven stopped', () => {
  for (const taskWasRunning of [false, true]) {
    for (const taskStopped of [false, true]) {
      for (const listenerWasPresent of [false, true]) {
        for (const listenerStopped of [false, true]) {
          for (const taskStateImmediatelyBeforePublish of ['Ready', 'Running', 'Queued', 'Disabled']) {
            const result = evaluateBackendExpectedHeadHandoffPublication({ expectedHead: HEAD_A, taskWasRunning, taskStopped, taskStateImmediatelyBeforePublish, listenerWasPresent, listenerStopped });
            const requiredStopsHold = (!taskWasRunning || taskStopped) && taskStateImmediatelyBeforePublish === 'Disabled' && (!listenerWasPresent || listenerStopped);
            assert.equal(result.publishAllowed, requiredStopsHold, JSON.stringify({ taskWasRunning, taskStopped, taskStateImmediatelyBeforePublish, listenerWasPresent, listenerStopped, result }));
          }
        }
      }
    }
  }
});

test('an observed handoff never degrades into standalone derivation', () => {
  const adversarialCases = [
    { consumeSucceeded: false },
    { schemaVersion: 'wrong' },
    { target: 'mission-worker' },
    { handoffHead: 'not-a-sha' },
    { expiresAtMs: NOW },
    { issuedAtMs: NOW + 31_000 },
    { expiresAtMs: NOW + 126_000 },
    { issuedAtMs: NOW + 20_000, expiresAtMs: NOW + 10_000 },
    { currentHead: HEAD_B },
  ];
  for (const hostile of adversarialCases) {
    const result = evaluateBackendExpectedHeadHandoffConsumption(validHandoff(hostile));
    assert.equal(result.mutationAllowed, false, JSON.stringify({ hostile, result }));
    assert.equal(result.bindingSource, 'handoff');
  }
});

test('only a fresh consumed exact-head handoff authorizes restart mutation', () => {
  assert.deepEqual(evaluateBackendExpectedHeadHandoffConsumption(validHandoff()), {
    mutationAllowed: true,
    reason: 'handoff-exact-head',
    bindingSource: 'handoff',
    expectedHead: HEAD_A,
    observedHead: HEAD_A,
  });
});

test('ordinary logon derivation is available only when no handoff was observed and source is canonical', () => {
  const canonical = evaluateBackendExpectedHeadHandoffConsumption({ handoffObserved: false, currentHead: HEAD_B, canonicalStandaloneSource: true });
  assert.equal(canonical.mutationAllowed, true);
  assert.equal(canonical.bindingSource, 'standalone');
  assert.equal(canonical.expectedHead, HEAD_B);
  assert.equal(evaluateBackendExpectedHeadHandoffConsumption({ handoffObserved: false, currentHead: HEAD_B, canonicalStandaloneSource: false }).mutationAllowed, false);
});
