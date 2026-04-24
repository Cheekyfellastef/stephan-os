import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveContinuityLoopSnapshot } from './continuityLoopSnapshot.js';

function runtimeStatusWithTruth({ memory = {}, tile = {} } = {}) {
  return {
    runtimeTruth: {
      memory,
      tile,
    },
  };
}

test('continuity snapshot resolves live state for shared backend with ready tile and ai continuity evidence', () => {
  const snapshot = deriveContinuityLoopSnapshot({
    runtimeStatus: runtimeStatusWithTruth({
      memory: {
        sourceUsedOnLoad: 'shared-backend',
        hydrationCompleted: true,
        hydrationState: 'ready',
        recordCount: 14,
      },
      tile: {
        ready: true,
      },
    }),
    commandHistory: [{
      timestamp: '2026-04-03T01:02:03.000Z',
      success: true,
      data_payload: {
        execution_metadata: {
          actual_provider_used: 'groq',
        },
      },
      memory_hits: [{ id: 'hit-1' }],
    }],
    now: Date.parse('2026-04-03T01:02:10.000Z'),
  });

  assert.equal(snapshot.sharedMemorySource, 'backend');
  assert.equal(snapshot.sharedMemoryHydrationState, 'ready');
  assert.equal(snapshot.tileLinkState, 'linked');
  assert.equal(snapshot.aiContinuityMode, 'context-ready');
  assert.equal(snapshot.continuityLoopState, 'live');
  assert.equal(snapshot.memoryCapabilityState, 'backend');
  assert.equal(snapshot.memoryCapabilityReady, true);
  assert.equal(snapshot.memoryCapabilityCanonical, true);
});

test('continuity snapshot resolves degraded state for local fallback and recording-only ai mode', () => {
  const snapshot = deriveContinuityLoopSnapshot({
    runtimeStatus: runtimeStatusWithTruth({
      memory: {
        sourceUsedOnLoad: 'local-mirror-fallback',
        hydrationCompleted: true,
        hydrationState: 'degraded',
        fallbackReason: 'backend-unavailable',
      },
      tile: {
        ready: false,
        reason: 'tile registry still hydrating',
      },
    }),
    commandHistory: [{
      timestamp: '2026-04-03T01:02:03.000Z',
      success: true,
      data_payload: {
        execution_metadata: {
          actual_provider_used: 'mock',
        },
      },
      memory_hits: [],
    }],
    now: Date.parse('2026-04-03T01:02:40.000Z'),
  });

  assert.equal(snapshot.sharedMemorySource, 'degraded-local');
  assert.equal(snapshot.sharedMemoryHydrationState, 'degraded');
  assert.equal(snapshot.tileLinkState, 'partial');
  assert.equal(snapshot.aiContinuityMode, 'recording-only');
  assert.equal(snapshot.continuityLoopState, 'degraded');
  assert.equal(snapshot.recentActivityActive, false);
  assert.equal(snapshot.memoryCapabilityState, 'degraded-local');
  assert.equal(snapshot.memoryCapabilityReady, true);
  assert.equal(snapshot.memoryCapabilityCanonical, false);
});

test('continuity snapshot exposes hydrating memory capability while hydration is incomplete', () => {
  const snapshot = deriveContinuityLoopSnapshot({
    runtimeStatus: runtimeStatusWithTruth({
      memory: {
        sourceUsedOnLoad: 'shared-backend',
        hydrationCompleted: false,
      },
    }),
    commandHistory: [],
    now: Date.parse('2026-04-03T01:03:00.000Z'),
  });

  assert.equal(snapshot.memoryCapabilityState, 'hydrating');
  assert.equal(snapshot.memoryCapabilityReady, false);
  assert.equal(snapshot.memoryCapabilityCanonical, false);
  assert.match(snapshot.memoryCapabilityReason, /hydration/i);
});

test('continuity snapshot keeps recent continuity activity bounded and meaningful', () => {
  const commandHistory = Array.from({ length: 9 }, (_, index) => ({
    timestamp: `2026-04-03T01:02:${String(index).padStart(2, '0')}.000Z`,
    parsed_command: { command: 'memory', subcommand: 'save' },
    success: true,
    data_payload: {},
    memory_hits: [],
  }));

  const snapshot = deriveContinuityLoopSnapshot({
    runtimeStatus: runtimeStatusWithTruth(),
    commandHistory,
    now: Date.parse('2026-04-03T01:02:10.000Z'),
  });

  assert.equal(snapshot.recentContinuityEvents.length, 5);
  assert.ok(snapshot.recentContinuityEvents.every((event) => event.type === 'memory.save.persisted'));
});

test('continuity snapshot treats MEMORY subsystem telemetry transitions as real continuity activity', () => {
  const snapshot = deriveContinuityLoopSnapshot({
    runtimeStatus: runtimeStatusWithTruth(),
    commandHistory: [],
    telemetryEntries: [{
      id: 'memory-mode-transition',
      subsystem: 'MEMORY',
      change: 'degraded → live',
      timestamp: '2026-04-03T02:00:00.000Z',
    }],
    now: Date.parse('2026-04-03T02:00:05.000Z'),
  });

  assert.equal(snapshot.lastContinuityEventType, 'memory');
  assert.equal(snapshot.recentActivityActive, true);
  assert.equal(snapshot.recentContinuityEvents.length, 1);
});
