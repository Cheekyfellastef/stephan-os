import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSurfaceAwareness } from './surfaceAwareness.js';

function mockWindow({ width = 1024, height = 768, coarse = false, fine = true, hover = true, standalone = false } = {}) {
  return {
    innerWidth: width,
    innerHeight: height,
    navigator: { standalone },
    matchMedia: (query) => ({
      matches: query === '(pointer: coarse)' ? coarse
        : query === '(pointer: fine)' ? fine
          : query === '(hover: hover)' ? hover
            : query === '(display-mode: standalone)' ? standalone
              : false,
    }),
  };
}

test('resolves hosted tablet touch-first embodiment deterministically', () => {
  const awareness = resolveSurfaceAwareness({
    runtimeContext: { sessionKind: 'hosted-web', deviceContext: 'lan-companion' },
    windowObj: mockWindow({ width: 1024, height: 1366, coarse: true, fine: false, hover: false }),
    navigatorObj: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_3 like Mac OS X)', platform: 'iPad' },
    documentObj: { documentElement: { requestFullscreen: () => {} } },
  });

  assert.equal(awareness.surfaceIdentity.deviceClass, 'tablet');
  assert.equal(awareness.effectiveSurfaceExperience.selectedProfileId, 'field-tablet');
  assert.equal(awareness.effectiveSurfaceExperience.resolvedInputMode, 'touch-hybrid');
  assert.equal(awareness.effectiveSurfaceExperience.resolvedRoutingBiasHint, 'home-node-first');
});

test('resolves local desktop battle-bridge profile', () => {
  const awareness = resolveSurfaceAwareness({
    runtimeContext: { sessionKind: 'local-desktop', deviceContext: 'pc-local-browser' },
    windowObj: mockWindow({ width: 1600, height: 900, coarse: false, fine: true, hover: true }),
    navigatorObj: { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0', platform: 'Win32' },
    documentObj: { documentElement: { requestFullscreen: () => {} } },
  });

  assert.equal(awareness.surfaceIdentity.deviceClass, 'desktop');
  assert.equal(awareness.effectiveSurfaceExperience.selectedProfileId, 'battle-bridge-desktop');
  assert.equal(awareness.surfaceCapabilities.multiPanelComfort, 'high');
});

test('resolves compact phone profile and low certainty route hints', () => {
  const awareness = resolveSurfaceAwareness({
    runtimeContext: { sessionKind: 'hosted-web', deviceContext: 'off-network' },
    windowObj: mockWindow({ width: 390, height: 844, coarse: true, fine: false, hover: false }),
    navigatorObj: {
      maxTouchPoints: 5,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15',
      platform: 'iPhone',
      connection: { saveData: true, effectiveType: '2g' },
    },
    documentObj: { documentElement: {} },
  });

  assert.equal(awareness.surfaceIdentity.deviceClass, 'phone');
  assert.equal(awareness.effectiveSurfaceExperience.selectedProfileId, 'pocket-ops-phone');
  assert.equal(awareness.surfaceCapabilities.constrainedNetworkLikely, true);
});

test('operator override forces profile while remaining explicit', () => {
  const awareness = resolveSurfaceAwareness({
    runtimeContext: { sessionKind: 'hosted-web', deviceContext: 'off-network' },
    operatorSurfaceOverrides: { mode: 'force-desktop' },
    windowObj: mockWindow({ width: 390, height: 844, coarse: true, fine: false, hover: false }),
    navigatorObj: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Android 14) Chrome/124.0', platform: 'Linux arm' },
    documentObj: { documentElement: {} },
  });

  assert.equal(awareness.effectiveSurfaceExperience.selectedProfileId, 'battle-bridge-desktop');
  assert.equal(awareness.effectiveSurfaceExperience.overrideApplied, true);
  assert.match(awareness.effectiveSurfaceExperience.selectionReasons[0], /operator override/);
});

test('unknown signals stay bounded and do not fake certainty', () => {
  const awareness = resolveSurfaceAwareness({
    runtimeContext: {},
    windowObj: { innerWidth: 0, innerHeight: 0, matchMedia: () => ({ matches: false }), navigator: {} },
    navigatorObj: {},
    documentObj: {},
  });

  assert.notEqual(awareness.effectiveSurfaceExperience.confidence, 'high');
  assert.equal(awareness.effectiveSurfaceExperience.overrideApplied, false);
});
