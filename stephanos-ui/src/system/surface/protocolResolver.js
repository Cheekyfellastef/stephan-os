import {
  EMBODIMENT_PROTOCOL_BUNDLES,
  SURFACE_PROTOCOL_REGISTRY,
} from '../protocols/surfaceProtocolRegistry.js';

const POLICY_DEFAULTS = Object.freeze({
  resolvedInputMode: 'hybrid',
  resolvedPanelMode: 'stacked',
  resolvedUiDensity: 'comfortable',
  resolvedAnimationBudget: 'medium',
  resolvedDebugVisibility: 'balanced',
  resolvedTelemetryDensity: 'medium',
  resolvedDefaultLandingView: 'mission-console',
  resolvedInteractionSafetyMode: 'balanced',
  resolvedRoutingBiasHint: 'auto',
});

function normalizeProtocolIds(value = []) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
}

function resolveBaseProtocols(embodimentProfileId = 'generic-surface') {
  return normalizeProtocolIds(EMBODIMENT_PROTOCOL_BUNDLES[embodimentProfileId] || EMBODIMENT_PROTOCOL_BUNDLES['generic-surface']);
}

function resolveCapabilityProtocols(surfaceIdentity = {}, surfaceCapabilities = {}) {
  const ids = [];
  if (surfaceIdentity.browserFamily === 'safari' && surfaceCapabilities.touchPrimary === true) ids.push('safari-safe-dragging');
  if (surfaceCapabilities.touchPrimary === true) ids.push('reduced-hover-dependence');
  if (surfaceCapabilities.constrainedNetworkLikely === true) ids.push('telemetry-lite');
  return normalizeProtocolIds(ids);
}

export function resolveSurfaceProtocols({
  surfaceIdentity = {},
  surfaceCapabilities = {},
  sessionContextSurfaceHints = {},
  embodimentProfile = {},
  operatorSurfaceOverrides = {},
} = {}) {
  const profileId = String(embodimentProfile?.id || 'generic-surface').trim() || 'generic-surface';
  const baseProtocols = resolveBaseProtocols(profileId);
  const capabilityProtocols = resolveCapabilityProtocols(surfaceIdentity, surfaceCapabilities);
  const overrideProtocolIds = normalizeProtocolIds(operatorSurfaceOverrides?.protocolIds);
  const activeProtocolIds = normalizeProtocolIds([...baseProtocols, ...capabilityProtocols, ...overrideProtocolIds]);

  const selectionReasons = [
    `embodiment bundle selected for ${profileId}`,
  ];
  if (capabilityProtocols.length > 0) selectionReasons.push(`capability protocols applied (${capabilityProtocols.join(', ')})`);
  if (overrideProtocolIds.length > 0) selectionReasons.push(`operator protocol overrides applied (${overrideProtocolIds.join(', ')})`);
  if (sessionContextSurfaceHints?.sessionKind) selectionReasons.push(`session context ${sessionContextSurfaceHints.sessionKind} informed resolver confidence only`);

  const warnings = [];
  if (overrideProtocolIds.some((id) => !SURFACE_PROTOCOL_REGISTRY[id])) {
    warnings.push('one or more operator override protocol IDs were unknown and ignored');
  }

  const effectiveExperiencePolicy = activeProtocolIds.reduce((policy, protocolId) => {
    const protocol = SURFACE_PROTOCOL_REGISTRY[protocolId];
    if (!protocol) return policy;
    return {
      ...policy,
      ...protocol.contribution,
    };
  }, { ...POLICY_DEFAULTS });

  return {
    activeProtocolIds,
    protocolSelectionReasons: selectionReasons,
    effectiveExperiencePolicy,
    overrideApplied: overrideProtocolIds.length > 0 || operatorSurfaceOverrides?.mode !== 'auto',
    confidence: profileId === 'generic-surface' ? 'medium' : 'high',
    warnings,
  };
}
