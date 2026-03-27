import test from 'node:test';
import assert from 'node:assert/strict';

import { createRealitySyncController, evaluateStaleness } from '../shared/runtime/realitySync.mjs';

function createFetchStub(resolvers = {}) {
  return async function fetchStub(url) {
    const key = String(url);
    const payload = resolvers[key];
    if (payload == null) {
      return { ok: false, status: 404, async json() { return {}; } };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    };
  };
}

test('evaluateStaleness detects stale and current marker states', () => {
  assert.equal(evaluateStaleness({ displayedMarker: 'a', latestMarker: 'b' }), true);
  assert.equal(evaluateStaleness({ displayedMarker: 'a', latestMarker: 'a' }), false);
});

test('reality sync triggers refresh when enabled and stale', async () => {
  const refreshCalls = [];
  const stateChanges = [];
  const controller = createRealitySyncController({
    fetchImpl: createFetchStub({
      './__stephanos/health': { runtimeMarker: 'build-new', buildTimestamp: '2026-03-27T02:00:00.000Z' },
    }),
    setIntervalImpl() {
      return 1;
    },
    clearIntervalImpl() {},
    onStateChange(state) {
      stateChanges.push(state);
    },
    onRefreshRequest(state) {
      refreshCalls.push(state.lastRefreshReason);
    },
    enabled: true,
  });

  controller.updateDisplayedTruth({ marker: 'build-old', timestamp: '2026-03-27T01:00:00.000Z' });
  controller.setEnabled(true);
  await controller.checkNow({ reason: 'test' });

  assert.equal(refreshCalls.length, 1);
  assert.match(refreshCalls[0], /new-truth-detected/);
  assert.equal(stateChanges.at(-1).isStale, true);
  controller.dispose();
});

test('reality sync does not refresh when disabled even when stale', async () => {
  let refreshed = false;
  const controller = createRealitySyncController({
    fetchImpl: createFetchStub({
      './__stephanos/health': { runtimeMarker: 'build-new', buildTimestamp: '2026-03-27T02:00:00.000Z' },
    }),
    setIntervalImpl() {
      return 1;
    },
    clearIntervalImpl() {},
    onRefreshRequest() {
      refreshed = true;
    },
    enabled: false,
  });

  controller.updateDisplayedTruth({ marker: 'build-old', timestamp: '2026-03-27T01:00:00.000Z' });
  controller.setEnabled(false);
  await controller.checkNow({ reason: 'test' });

  assert.equal(controller.getState().isStale, true);
  assert.equal(refreshed, false);
  controller.dispose();
});

test('reality sync loop protection blocks repeated refresh for same marker', async () => {
  let refreshCount = 0;
  const controller = createRealitySyncController({
    fetchImpl: createFetchStub({
      './__stephanos/health': { runtimeMarker: 'build-new', buildTimestamp: '2026-03-27T02:00:00.000Z' },
    }),
    setIntervalImpl() {
      return 1;
    },
    clearIntervalImpl() {},
    onRefreshRequest() {
      refreshCount += 1;
    },
    maxAutoRefreshAttemptsPerMarker: 1,
    refreshCooldownMs: 0,
    enabled: true,
  });

  controller.updateDisplayedTruth({ marker: 'build-old', timestamp: '2026-03-27T01:00:00.000Z' });
  controller.setEnabled(true);
  await controller.checkNow({ reason: 'first' });
  await controller.checkNow({ reason: 'second' });

  assert.equal(refreshCount, 1);
  controller.dispose();
});

test('reality sync falls back cleanly when authoritative endpoints are unavailable', async () => {
  const controller = createRealitySyncController({
    fetchImpl: createFetchStub({
      './apps/stephanos/dist/stephanos-build.json': { runtimeMarker: 'dist-only', buildTimestamp: '2026-03-27T02:00:00.000Z' },
    }),
    setIntervalImpl() {
      return 1;
    },
    clearIntervalImpl() {},
    enabled: false,
  });

  controller.updateDisplayedTruth({ marker: 'dist-only', timestamp: '2026-03-27T02:00:00.000Z' });
  controller.setEnabled(false);
  const state = await controller.checkNow({ reason: 'fallback' });

  assert.equal(state.latestMarker, 'dist-only');
  assert.equal(state.latestSource, 'dist-metadata');
  assert.equal(state.isStale, false);
  controller.dispose();
});
