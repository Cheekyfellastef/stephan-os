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

test('manual bridge validation keeps operator transport truth in hosted/off-network canonical session truth', () => {
  const truth = resolveBridgeValidationTruth({
    runtimeStatusModel: {
      canonicalRouteRuntimeTruth: { sessionKind: 'hosted-web', winningRoute: 'home-node' },
    },
    selectedTransport: 'manual',
  });

  assert.equal(truth.sessionKind, 'hosted-web');
  assert.equal(truth.requireHttps, false);
  assert.equal(resolveBridgeUrlRequireHttps({ sessionKind: truth.sessionKind, selectedTransport: 'manual' }), false);
});

test('bridge validation truth resolver is null-safe and defaults to http-compatible validation', () => {
  const truth = resolveBridgeValidationTruth({
    runtimeStatusModel: null,
    selectedTransport: 'manual',
  });

  assert.equal(truth.sessionKind, 'unknown');
  assert.equal(truth.requireHttps, false);
  assert.equal(resolveBridgeUrlRequireHttps({ sessionKind: 'local-desktop', selectedTransport: 'tailscale' }), false);
});

test('tailscale transport preserves explicit http backend URL without protocol coercion', () => {
  const input = 'http://desktop-9flonkj.taild6f215.ts.net:8787';
  const prefs = normalizeBridgeTransportPreferences({
    selectedTransport: 'tailscale',
    transports: {
      tailscale: {
        enabled: true,
        backendUrl: input,
        accepted: true,
        active: true,
        reachability: 'reachable',
        usable: true,
      },
    },
  }, {
    tailscaleRequireHttps: false,
  });
  const truth = projectHomeBridgeTransportTruth(prefs, {
    bridgeMemory: { transport: 'tailscale', backendUrl: input },
    bridgeMemoryPersistence: {
      bridgeInputRaw: input,
      bridgeInputNormalized: input,
      bridgePersistedValue: input,
      bridgeRehydratedValue: input,
      bridgeProbeTarget: input,
    },
  });
  assert.equal(prefs.transports.tailscale.backendUrl, input);
  assert.equal(truth.tailscale.backendUrl, input);
  assert.equal(truth.bridgeInputNormalized, input);
  assert.equal(truth.bridgePersistedValue, input);
  assert.equal(truth.bridgeProbeTarget, input);
});

test('tailscale transport stores hosted HTTPS execution URL separately from operator transport URL', () => {
  const prefs = normalizeBridgeTransportPreferences({
    selectedTransport: 'tailscale',
    transports: {
      tailscale: {
        enabled: true,
        backendUrl: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        hostOverride: 'desktop-9flonkj.taild6f215.ts.net',
        accepted: true,
        active: true,
        reachability: 'reachable',
        usable: true,
      },
    },
  });
  const memory = deriveBridgeMemoryFromPreferences(prefs);
  const truth = projectHomeBridgeTransportTruth(prefs, {
    bridgeMemory: memory,
  });
  assert.equal(memory.backendUrl, 'http://desktop-9flonkj.taild6f215.ts.net:8787');
  assert.equal(memory.executionUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(truth.bridgeOperatorTransportUrl, 'http://desktop-9flonkj.taild6f215.ts.net:8787');
  assert.equal(truth.bridgeHostedExecutionBridgeUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(truth.tailscale.executionUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
});

test('home bridge durable memory normalization is bounded and null-safe', () => {
  const memory = normalizeHomeBridgeMemory({
    selectedTransport: 'tailscale',
    savedBridgeUrl: 'https://100.64.0.10',
    tailscaleDeviceName: 'home-node',
    rememberedAt: '2026-04-11T10:00:00.000Z',
  });
  assert.equal(memory.transport, 'tailscale');
  assert.equal(memory.selectedTransport, 'tailscale');
  assert.equal(memory.backendUrl, 'https://100.64.0.10');
  assert.equal(memory.savedBridgeUrl, 'https://100.64.0.10');
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

test('bridge memory projection surfaces read/write diagnostics breadcrumbs', () => {
  const preferences = normalizeBridgeTransportPreferences({
    selectedTransport: 'tailscale',
    transports: {
      tailscale: {
        enabled: true,
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
    },
  });
  const projected = projectHomeBridgeTransportTruth(preferences, {
    bridgeMemory: {
      transport: 'tailscale',
      backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
    },
    bridgeMemoryPersistence: {
      state: 'save-persisted',
      bridgeMemoryWriteAttempted: true,
      bridgeMemoryWriteSucceeded: true,
      bridgeMemoryReadAttempted: true,
      bridgeMemoryReadSource: 'shared-runtime-memory',
      bridgeMemoryReadResult: 'remembered-bridge',
      bridgeMemoryStorageKey: 'stephanos.durable.memory.v2',
      bridgeMemoryStorageScope: 'shared-runtime-memory',
      bridgeMemoryLastRawValueSummary: 'record-payload:bridgeMemory',
    },
  });
  assert.equal(projected.bridgeMemoryWriteAttempted, true);
  assert.equal(projected.bridgeMemoryWriteSucceeded, true);
  assert.equal(projected.bridgeMemoryReadAttempted, true);
  assert.equal(projected.bridgeMemoryReadSource, 'shared-runtime-memory');
  assert.equal(projected.bridgeMemoryReadResult, 'remembered-bridge');
  assert.equal(projected.bridgeMemoryStorageScope, 'shared-runtime-memory');
});

test('bridge memory derivation prefers valid configured tailscale transport even when selected transport drifts', () => {
  const derived = deriveBridgeMemoryFromPreferences(
    normalizeBridgeTransportPreferences({
      selectedTransport: 'manual',
      transports: {
        manual: { backendUrl: '' },
        tailscale: {
          enabled: true,
          backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
          deviceName: 'desktop-9flonkj',
          hostOverride: 'desktop-9flonkj.taild6f215.ts.net',
        },
      },
    }),
    { rememberedAt: '2026-04-11T11:00:00.000Z' },
    { preferredTransport: 'tailscale' },
  );

  assert.equal(derived.transport, 'tailscale');
  assert.equal(derived.selectedTransport, 'tailscale');
  assert.equal(derived.backendUrl, 'https://desktop-9flonkj.taild6f215.ts.net:8787');
  assert.equal(derived.savedBridgeUrl, 'https://desktop-9flonkj.taild6f215.ts.net:8787');
  assert.equal(derived.tailscaleDeviceName, 'desktop-9flonkj');
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

test('auto bridge revalidation plan allows remembered manual bridge on local desktop surfaces', () => {
  const plan = resolveAutoBridgeRevalidationPlan({
    bridgeMemory: {
      transport: 'manual',
      backendUrl: 'http://192.168.1.22:8787',
    },
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'manual',
      transports: {
        manual: {
          enabled: true,
          backendUrl: 'http://192.168.1.22:8787',
        },
      },
    }),
    bridgeValidationTruth: { sessionKind: 'local-desktop', requireHttps: false },
  });
  assert.equal(plan.shouldAttempt, true);
  assert.equal(plan.transport, 'manual');
  assert.equal(plan.policyAllowed, true);
});

test('auto bridge revalidation plan allows remembered tailscale bridge on hosted surfaces', () => {
  const plan = resolveAutoBridgeRevalidationPlan({
    bridgeMemory: {
      transport: 'tailscale',
      backendUrl: 'http://100.116.99.92:8787',
      executionUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
    },
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: {
        tailscale: {
          enabled: true,
          backendUrl: 'http://100.116.99.92:8787',
          executionUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
        },
      },
    }),
    bridgeValidationTruth: { sessionKind: 'hosted-web', requireHttps: true },
  });
  assert.equal(plan.shouldAttempt, true);
  assert.equal(plan.transport, 'tailscale');
  assert.equal(plan.candidateUrl, 'http://100.116.99.92:8787');
  assert.equal(plan.hostedExecutionCandidate, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(plan.policyAllowed, true);
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

test('bridge memory reconciliation classifies hosted execution-incompatible truth separately from unreachable', () => {
  const result = resolveBridgeMemoryReconciliation({
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: {
        tailscale: { enabled: true, backendUrl: 'http://desktop.tailnet.ts.net:8787', accepted: false, reachability: 'reachable' },
      },
    }),
    runtimeBridge: { accepted: false, backendUrl: 'http://desktop.tailnet.ts.net:8787', reachability: 'reachable' },
    bridgeMemory: { transport: 'tailscale', backendUrl: 'http://desktop.tailnet.ts.net:8787' },
    autoRevalidation: {
      state: 'execution-incompatible',
      reason: 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.',
      directReachability: 'reachable',
      executionCompatibility: 'mixed-scheme-blocked',
      infrastructureRequirement: 'Publish HTTPS bridge endpoint.',
    },
  });
  assert.equal(result.state, 'remembered-execution-incompatible');
  assert.equal(result.provenance, 'remembered-tailscale-execution-incompatible');

  const projected = projectHomeBridgeTransportTruth(
    normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: { tailscale: { enabled: true, backendUrl: 'http://desktop.tailnet.ts.net:8787' } },
    }),
    {
      bridgeMemory: { transport: 'tailscale', backendUrl: 'http://desktop.tailnet.ts.net:8787' },
      autoRevalidation: {
        state: 'execution-incompatible',
        reason: 'blocked',
        directReachability: 'reachable',
        executionCompatibility: 'mixed-scheme-blocked',
        infrastructureRequirement: 'Publish HTTPS bridge endpoint.',
      },
    },
  );
  assert.equal(projected.bridgeMemoryReconciliationState, 'remembered-execution-incompatible');
  assert.equal(projected.bridgeDirectReachability, 'reachable');
  assert.equal(projected.bridgeHostedExecutionCompatibility, 'mixed-scheme-blocked');
  assert.equal(projected.bridgeMemoryPromotedToRouteCandidate, false);
  assert.match(projected.bridgeMemoryPromotionReason, /blocked by hosted\/browser policy/i);
});

test('home bridge projection reports promoted remembered bridge and promotion reason truth', () => {
  const projected = projectHomeBridgeTransportTruth(
    normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: {
        tailscale: {
          enabled: true,
          backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
          accepted: true,
          active: true,
          reachability: 'reachable',
          usable: true,
        },
      },
    }),
    {
      bridgeMemory: { transport: 'tailscale', backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net' },
      autoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        attemptedAt: '2026-04-17T08:00:00.000Z',
        attemptCount: 1,
        promotionReason: 'Remembered tailscale bridge promoted into live route candidates.',
      },
    },
  );
  assert.equal(projected.bridgeMemoryAutoValidationAttempted, true);
  assert.equal(projected.bridgeMemoryValidatedOnThisSurface, true);
  assert.equal(projected.bridgeMemoryReachableOnThisSurface, true);
  assert.equal(projected.bridgeMemoryPromotedToRouteCandidate, true);
  assert.equal(projected.bridgeMemoryPromotionReason, 'Remembered tailscale bridge promoted into live route candidates.');
  assert.equal(projected.bridgeMemoryLastValidatedAt, '2026-04-17T08:00:00.000Z');
});

test('bridge memory reconciliation requires canonical tailscale selection before projecting tailscale revalidated provenance', () => {
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

  assert.equal(revalidated.state, 'remembered-awaiting-validation');
  assert.equal(revalidated.provenance, 'remembered-tailscale-pending-transport-config');
});

test('bridge memory reconciliation does not project tailscale revalidated when transport is not canonically configured', () => {
  const result = resolveBridgeMemoryReconciliation({
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'manual',
      transports: {
        manual: { enabled: true, backendUrl: 'https://bridge.example.com', accepted: true, reachability: 'reachable' },
      },
    }),
    runtimeBridge: { accepted: false, backendUrl: 'https://bridge.example.com', reachability: 'unknown' },
    bridgeMemory: { transport: 'tailscale', backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net' },
    autoRevalidation: { state: 'revalidated', reason: 'ok' },
  });

  assert.equal(result.state, 'remembered-awaiting-validation');
  assert.equal(result.provenance, 'remembered-tailscale-pending-transport-config');
});

test('bridge memory reconciliation keeps tailscale in awaiting state when selected but not accepted/reachable', () => {
  const result = resolveBridgeMemoryReconciliation({
    preferences: normalizeBridgeTransportPreferences({
      selectedTransport: 'tailscale',
      transports: {
        tailscale: { enabled: true, backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net', accepted: false, reachability: 'unknown' },
      },
    }),
    runtimeBridge: { accepted: false, backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net', reachability: 'unknown' },
    bridgeMemory: { transport: 'tailscale', backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net' },
    autoRevalidation: { state: 'revalidated', reason: 'ok' },
  });

  assert.equal(result.state, 'remembered-awaiting-validation');
  assert.equal(result.provenance, 'remembered-candidate-not-yet-accepted');
});
