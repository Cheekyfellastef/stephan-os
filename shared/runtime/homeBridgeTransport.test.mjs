import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveBridgeMemoryFromPreferences,
  listBridgeTransportDefinitions,
  normalizeHomeBridgeMemory,
  normalizeBridgeTransportPreferences,
  projectHomeBridgeTransportTruth,
  resolveAutoBridgeRevalidationPlan,
  resolveBridgeMemoryReconciliation,
  resolveBridgeUrlRequireHttps,
  resolveBridgeValidationTruth,
} from './homeBridgeTransport.mjs';

test('bridge transport registry remains deterministic and includes planned wireguard placeholder', () => {
  const defs = listBridgeTransportDefinitions();
  assert.deepEqual(defs.map((entry) => entry.key), ['manual', 'tailscale', 'wireguard']);
  assert.equal(defs[2].status, 'planned');
});

test('selected transport truth remains distinct from configured/active/reachable/usable', () => {
  const prefs = normalizeBridgeTransportPreferences({
    selectedTransport: 'tailscale',
    transports: {
      tailscale: {
        enabled: true,
        backendUrl: 'https://100.64.0.10',
        accepted: false,
        active: false,
        reachability: 'unknown',
        usable: false,
      },
    },
  });
  const truth = projectHomeBridgeTransportTruth(prefs);
  assert.equal(truth.selectedTransport, 'tailscale');
  assert.equal(truth.activeTransport, 'none');
  assert.equal(truth.reachability, 'unknown');
  assert.equal(truth.usability, 'no');
});

test('manual bridge validation allows http in local-desktop canonical session truth', () => {
  const truth = resolveBridgeValidationTruth({
    runtimeStatusModel: {
      canonicalRouteRuntimeTruth: { sessionKind: 'local-desktop', winningRoute: 'local-desktop' },
      runtimeTruth: { session: { sessionKind: 'hosted-web' } },
    },
    selectedTransport: 'manual',
  });

  assert.equal(truth.sessionKind, 'local-desktop');
  assert.equal(truth.requireHttps, false);
  assert.equal(resolveBridgeUrlRequireHttps({ sessionKind: truth.sessionKind, selectedTransport: 'manual' }), false);
});

test('manual bridge validation requires https in hosted/off-network canonical session truth', () => {
  const truth = resolveBridgeValidationTruth({
    runtimeStatusModel: {
      canonicalRouteRuntimeTruth: { sessionKind: 'hosted-web', winningRoute: 'home-node' },
    },
    selectedTransport: 'manual',
  });

  assert.equal(truth.sessionKind, 'hosted-web');
  assert.equal(truth.requireHttps, true);
  assert.equal(resolveBridgeUrlRequireHttps({ sessionKind: truth.sessionKind, selectedTransport: 'manual' }), true);
});

test('bridge validation truth resolver is null-safe and defaults to strict https', () => {
  const truth = resolveBridgeValidationTruth({
    runtimeStatusModel: null,
    selectedTransport: 'manual',
  });

  assert.equal(truth.sessionKind, 'unknown');
  assert.equal(truth.requireHttps, true);
  assert.equal(resolveBridgeUrlRequireHttps({ sessionKind: 'local-desktop', selectedTransport: 'tailscale' }), true);
});

test('home bridge durable memory normalization is bounded and null-safe', () => {
  const memory = normalizeHomeBridgeMemory({
    transport: 'tailscale',
    backendUrl: 'https://100.64.0.10',
    tailscaleDeviceName: 'home-node',
    rememberedAt: '2026-04-11T10:00:00.000Z',
  });
  assert.equal(memory.transport, 'tailscale');
  assert.equal(memory.backendUrl, 'https://100.64.0.10');
  assert.equal(memory.tailscaleDeviceName, 'home-node');
  assert.equal(normalizeHomeBridgeMemory(null).transport, 'none');
});

test('bridge memory projection remains separate from current live acceptance truth', () => {
  const preferences = normalizeBridgeTransportPreferences({
    selectedTransport: 'tailscale',
    transports: {
      tailscale: {
        enabled: true,
        backendUrl: 'https://100.64.0.10',
        accepted: false,
        reachability: 'unknown',
      },
    },
  });
  const remembered = deriveBridgeMemoryFromPreferences(preferences, {
    rememberedAt: '2026-04-11T10:01:00.000Z',
    reason: 'Remembered Home Bridge loaded from shared memory and awaiting validation on this surface.',
  });
  const projected = projectHomeBridgeTransportTruth(preferences, {
    runtimeBridge: { accepted: false, reachability: 'unknown' },
    bridgeMemory: remembered,
    bridgeMemoryRehydrated: true,
  });
  assert.equal(projected.bridgeMemoryPresent, true);
  assert.equal(projected.bridgeMemoryNeedsValidation, true);
  assert.equal(projected.tailscale.accepted, false);
  assert.equal(projected.bridgeMemoryValidationState, 'awaiting-validation');
  assert.equal(projected.bridgeMemoryReconciliationState, 'remembered-awaiting-validation');
});

test('auto bridge revalidation plan skips when stronger accepted live config exists', () => {
  const plan = resolveAutoBridgeRevalidationPlan({
    bridgeMemory: {
      transport: 'tailscale',
      backendUrl: 'https://100.64.0.10',
    },
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: {
        tailscale: {
          enabled: true,
          backendUrl: 'https://100.64.0.20',
          accepted: true,
        },
      },
    }),
    bridgeValidationTruth: { sessionKind: 'hosted-web', requireHttps: true },
  });
  assert.equal(plan.shouldAttempt, false);
  assert.equal(plan.outcome, 'remembered-superseded-by-live-config');
});

test('auto bridge revalidation plan reports no-remembered-bridge when durable memory is absent', () => {
  const plan = resolveAutoBridgeRevalidationPlan({
    bridgeMemory: {},
    preferences: normalizeBridgeTransportPreferences({ selectedTransport: 'manual' }),
    bridgeValidationTruth: { sessionKind: 'hosted-web', requireHttps: true },
  });
  assert.equal(plan.shouldAttempt, false);
  assert.equal(plan.outcome, 'no-remembered-bridge');
});

test('bridge memory reconciliation reports revalidated and unreachable outcomes truthfully', () => {
  const revalidated = resolveBridgeMemoryReconciliation({
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'manual',
      transports: {
        manual: { backendUrl: 'https://bridge.example.com', accepted: true, reachability: 'reachable' },
      },
    }),
    runtimeBridge: { accepted: true, backendUrl: 'https://bridge.example.com', reachability: 'reachable' },
    bridgeMemory: { transport: 'manual', backendUrl: 'https://bridge.example.com' },
    autoRevalidation: { state: 'revalidated', reason: 'ok' },
  });
  assert.equal(revalidated.state, 'remembered-revalidated');
  assert.equal(revalidated.provenance, 'remembered-manual-revalidated-as-manual');

  const unreachable = resolveBridgeMemoryReconciliation({
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: {
        tailscale: { enabled: true, backendUrl: 'https://100.64.0.10', accepted: false, reachability: 'unreachable' },
      },
    }),
    runtimeBridge: { accepted: false, backendUrl: 'https://100.64.0.10', reachability: 'unreachable' },
    bridgeMemory: { transport: 'tailscale', backendUrl: 'https://100.64.0.10' },
    autoRevalidation: { state: 'unreachable', reason: 'probe failed' },
  });
  assert.equal(unreachable.state, 'remembered-unreachable');
  assert.equal(unreachable.provenance, 'remembered-tailscale-unreachable');
});

test('bridge memory reconciliation preserves tailscale provenance after successful revalidation even if selected transport drifted', () => {
  const revalidated = resolveBridgeMemoryReconciliation({
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'manual',
      transports: {
        manual: { enabled: true, backendUrl: 'http://192.168.0.198:8787', accepted: true, reachability: 'reachable' },
        tailscale: { enabled: true, backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net', accepted: true, reachability: 'reachable' },
      },
    }),
    runtimeBridge: { accepted: true, backendUrl: 'http://192.168.0.198:8787', reachability: 'reachable' },
    bridgeMemory: { transport: 'tailscale', backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net' },
    autoRevalidation: { state: 'revalidated', reason: 'ok' },
  });

  assert.equal(revalidated.state, 'remembered-revalidated');
  assert.equal(revalidated.provenance, 'remembered-tailscale-revalidated-as-tailscale');
});
