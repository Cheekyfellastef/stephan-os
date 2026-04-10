import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSurfaceProtocols } from './protocolResolver.js';

test('protocol resolution for desktop battle-bridge profile', () => {
  const result = resolveSurfaceProtocols({
    surfaceIdentity: { browserFamily: 'chrome' },
    surfaceCapabilities: { touchPrimary: false, constrainedNetworkLikely: false },
    sessionContextSurfaceHints: { sessionKind: 'local-desktop' },
    embodimentProfile: { id: 'battle-bridge-desktop' },
    operatorSurfaceOverrides: { mode: 'auto', protocolIds: [] },
  });

  assert.ok(result.activeProtocolIds.includes('dense-mission-layout'));
  assert.equal(result.effectiveExperiencePolicy.resolvedInputMode, 'keyboard-pointer');
  assert.equal(result.effectiveExperiencePolicy.resolvedRoutingBiasHint, 'local-first');
});

test('protocol resolution for iPad field-tablet profile', () => {
  const result = resolveSurfaceProtocols({
    surfaceIdentity: { browserFamily: 'safari' },
    surfaceCapabilities: { touchPrimary: true, constrainedNetworkLikely: false },
    sessionContextSurfaceHints: { sessionKind: 'hosted-web' },
    embodimentProfile: { id: 'field-tablet' },
    operatorSurfaceOverrides: { mode: 'auto', protocolIds: [] },
  });

  assert.ok(result.activeProtocolIds.includes('touch-first-input'));
  assert.ok(result.activeProtocolIds.includes('safari-safe-dragging'));
  assert.equal(result.effectiveExperiencePolicy.resolvedPanelMode, 'stacked');
});

test('protocol resolution for phone pocket profile and override behavior', () => {
  const result = resolveSurfaceProtocols({
    surfaceIdentity: { browserFamily: 'chrome' },
    surfaceCapabilities: { touchPrimary: true, constrainedNetworkLikely: true },
    sessionContextSurfaceHints: { sessionKind: 'hosted-web' },
    embodimentProfile: { id: 'pocket-ops-phone' },
    operatorSurfaceOverrides: { mode: 'auto', protocolIds: ['debug-visible'] },
  });

  assert.ok(result.activeProtocolIds.includes('compact-single-focus'));
  assert.ok(result.activeProtocolIds.includes('debug-visible'));
  assert.equal(result.overrideApplied, true);
  assert.equal(Object.hasOwn(result.effectiveExperiencePolicy, 'routeAvailable'), false);
  assert.equal(result.effectiveExperiencePolicy.resolvedRoutingBiasHint, 'cloud-first');
});
