const EXPERIENCE_POLICY_CATEGORIES = Object.freeze([
  'inputBehavior',
  'panelBehavior',
  'uiDensity',
  'animationBudget',
  'debugVisibility',
  'telemetryDensity',
  'defaultLandingView',
  'interactionSafetyMode',
  'routingBiasHint',
]);

function protocol(definition) {
  return Object.freeze(definition);
}

export const SURFACE_PROTOCOL_REGISTRY = Object.freeze({
  'touch-first-input': protocol({ id: 'touch-first-input', category: 'inputBehavior', contribution: { resolvedInputMode: 'touch-primary' } }),
  'reduced-hover-dependence': protocol({ id: 'reduced-hover-dependence', category: 'interactionSafetyMode', contribution: { resolvedInteractionSafetyMode: 'hover-optional' } }),
  'safari-safe-dragging': protocol({ id: 'safari-safe-dragging', category: 'interactionSafetyMode', contribution: { resolvedInteractionSafetyMode: 'touch-drag-guarded' } }),
  'stacked-panels': protocol({ id: 'stacked-panels', category: 'panelBehavior', contribution: { resolvedPanelMode: 'stacked' } }),
  'docked-panels-preferred': protocol({ id: 'docked-panels-preferred', category: 'panelBehavior', contribution: { resolvedPanelMode: 'docked' } }),
  'compact-single-focus': protocol({ id: 'compact-single-focus', category: 'panelBehavior', contribution: { resolvedPanelMode: 'single-focus', resolvedDefaultLandingView: 'quick-command' } }),
  'comfortable-density': protocol({ id: 'comfortable-density', category: 'uiDensity', contribution: { resolvedUiDensity: 'comfortable' } }),
  'dense-mission-layout': protocol({ id: 'dense-mission-layout', category: 'uiDensity', contribution: { resolvedUiDensity: 'dense' } }),
  'keyboard-shortcuts-primary': protocol({ id: 'keyboard-shortcuts-primary', category: 'inputBehavior', contribution: { resolvedInputMode: 'keyboard-pointer' } }),
  'controller-focus-navigation': protocol({ id: 'controller-focus-navigation', category: 'inputBehavior', contribution: { resolvedInputMode: 'spatial-controller' } }),
  'low-animation-mode': protocol({ id: 'low-animation-mode', category: 'animationBudget', contribution: { resolvedAnimationBudget: 'low' } }),
  'telemetry-lite': protocol({ id: 'telemetry-lite', category: 'telemetryDensity', contribution: { resolvedTelemetryDensity: 'low' } }),
  'telemetry-dense': protocol({ id: 'telemetry-dense', category: 'telemetryDensity', contribution: { resolvedTelemetryDensity: 'high' } }),
  'local-route-bias-hint': protocol({ id: 'local-route-bias-hint', category: 'routingBiasHint', contribution: { resolvedRoutingBiasHint: 'local-first' } }),
  'hosted-route-bias-hint': protocol({ id: 'hosted-route-bias-hint', category: 'routingBiasHint', contribution: { resolvedRoutingBiasHint: 'cloud-first' } }),
  'home-node-route-bias-hint': protocol({ id: 'home-node-route-bias-hint', category: 'routingBiasHint', contribution: { resolvedRoutingBiasHint: 'home-node-first' } }),
  'cockpit-priority-view': protocol({ id: 'cockpit-priority-view', category: 'defaultLandingView', contribution: { resolvedDefaultLandingView: 'cockpit' } }),
  'mission-console-priority-view': protocol({ id: 'mission-console-priority-view', category: 'defaultLandingView', contribution: { resolvedDefaultLandingView: 'mission-console' } }),
  'debug-visible': protocol({ id: 'debug-visible', category: 'debugVisibility', contribution: { resolvedDebugVisibility: 'expanded' } }),
  'debug-reduced': protocol({ id: 'debug-reduced', category: 'debugVisibility', contribution: { resolvedDebugVisibility: 'reduced' } }),
});

export const EMBODIMENT_PROTOCOL_BUNDLES = Object.freeze({
  'battle-bridge-desktop': Object.freeze(['dense-mission-layout', 'keyboard-shortcuts-primary', 'telemetry-dense', 'debug-visible', 'local-route-bias-hint', 'mission-console-priority-view', 'docked-panels-preferred']),
  'field-tablet': Object.freeze(['touch-first-input', 'reduced-hover-dependence', 'safari-safe-dragging', 'stacked-panels', 'comfortable-density', 'home-node-route-bias-hint']),
  'pocket-ops-phone': Object.freeze(['compact-single-focus', 'touch-first-input', 'telemetry-lite', 'debug-reduced', 'hosted-route-bias-hint', 'low-animation-mode']),
  'vr-cockpit': Object.freeze(['controller-focus-navigation', 'cockpit-priority-view', 'comfortable-density', 'low-animation-mode', 'telemetry-dense', 'debug-visible']),
  'generic-surface': Object.freeze(['comfortable-density', 'mission-console-priority-view', 'debug-reduced']),
});

export function listSurfaceProtocolIds() {
  return Object.keys(SURFACE_PROTOCOL_REGISTRY);
}

export { EXPERIENCE_POLICY_CATEGORIES };
