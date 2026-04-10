const DEVICE_CLASSES = ['desktop', 'tablet', 'phone', 'vr-capable', 'unknown'];
const SURFACE_OVERRIDE_MODES = ['auto', 'force-desktop', 'force-tablet', 'force-phone', 'force-vr'];

export const EMBODIMENT_PROFILE_REGISTRY = Object.freeze({
  'battle-bridge-desktop': Object.freeze({
    id: 'battle-bridge-desktop',
    uiDensity: 'dense',
    panelStrategy: 'multi-panel',
    inputMode: 'keyboard-pointer',
    animationBudget: 'high',
    telemetryDensity: 'high',
    routingBiasHint: 'local-first',
    defaultLandingView: 'mission-console',
    debugVisibilityBias: 'expanded',
  }),
  'field-tablet': Object.freeze({
    id: 'field-tablet',
    uiDensity: 'comfortable',
    panelStrategy: 'stacked-docked',
    inputMode: 'touch-hybrid',
    animationBudget: 'medium',
    telemetryDensity: 'medium',
    routingBiasHint: 'home-node-first',
    defaultLandingView: 'operations',
    debugVisibilityBias: 'balanced',
  }),
  'pocket-ops-phone': Object.freeze({
    id: 'pocket-ops-phone',
    uiDensity: 'compact',
    panelStrategy: 'single-focus',
    inputMode: 'touch-primary',
    animationBudget: 'low',
    telemetryDensity: 'low',
    routingBiasHint: 'cloud-first',
    defaultLandingView: 'quick-command',
    debugVisibilityBias: 'quiet',
  }),
  'vr-cockpit': Object.freeze({
    id: 'vr-cockpit',
    uiDensity: 'comfortable',
    panelStrategy: 'cockpit',
    inputMode: 'spatial-controller',
    animationBudget: 'medium',
    telemetryDensity: 'high',
    routingBiasHint: 'cloud-first',
    defaultLandingView: 'cockpit',
    debugVisibilityBias: 'expanded',
  }),
  'generic-surface': Object.freeze({
    id: 'generic-surface',
    uiDensity: 'comfortable',
    panelStrategy: 'stacked-docked',
    inputMode: 'hybrid',
    animationBudget: 'medium',
    telemetryDensity: 'medium',
    routingBiasHint: 'auto',
    defaultLandingView: 'mission-console',
    debugVisibilityBias: 'balanced',
  }),
});

function toText(value = '', fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function normalizeOverride(override = 'auto') {
  const candidate = toText(override, 'auto').toLowerCase();
  return SURFACE_OVERRIDE_MODES.includes(candidate) ? candidate : 'auto';
}

function normalizeDeviceClass(value = 'unknown') {
  const candidate = toText(value, 'unknown').toLowerCase();
  return DEVICE_CLASSES.includes(candidate) ? candidate : 'unknown';
}

function readMediaQuery(windowObj, query) {
  if (!windowObj || typeof windowObj.matchMedia !== 'function') {
    return false;
  }
  try {
    return windowObj.matchMedia(query).matches === true;
  } catch {
    return false;
  }
}

function classifyViewport(width = 0) {
  if (width <= 0) return 'unknown';
  if (width < 640) return 'compact';
  if (width < 1024) return 'medium';
  return 'wide';
}

function inferDeviceClass({ touch = false, finePointer = false, viewportWidth = 0, viewportHeight = 0, webxrAvailable = false } = {}) {
  if (webxrAvailable) return 'vr-capable';
  const shortSide = Math.min(viewportWidth || 0, viewportHeight || 0);
  const longSide = Math.max(viewportWidth || 0, viewportHeight || 0);
  if (touch && shortSide > 0 && shortSide < 600) return 'phone';
  if (touch && shortSide >= 600 && longSide <= 1400) return 'tablet';
  if (finePointer || !touch) return 'desktop';
  return 'unknown';
}

function inferOsFamily(ua = '', platform = '') {
  const source = `${ua} ${platform}`.toLowerCase();
  if (source.includes('windows')) return 'windows';
  if (source.includes('android')) return 'android';
  if (source.includes('iphone') || source.includes('ipad') || source.includes('ios')) return 'ios';
  if (source.includes('mac os') || source.includes('macintosh')) return 'macos';
  if (source.includes('linux')) return 'linux';
  return 'unknown';
}

function inferBrowserFamily(ua = '') {
  const source = ua.toLowerCase();
  if (source.includes('edg/')) return 'edge';
  if (source.includes('firefox/')) return 'firefox';
  if (source.includes('samsungbrowser/')) return 'samsung-internet';
  if (source.includes('chrome/') && !source.includes('edg/')) return 'chrome';
  if (source.includes('safari/') && !source.includes('chrome/')) return 'safari';
  return 'unknown';
}

export function detectSurfaceIdentity({ windowObj = globalThis?.window, navigatorObj = globalThis?.navigator } = {}) {
  const viewportWidth = Number(windowObj?.innerWidth || 0);
  const viewportHeight = Number(windowObj?.innerHeight || 0);
  const touchSupport = Boolean(navigatorObj?.maxTouchPoints > 0 || readMediaQuery(windowObj, '(pointer: coarse)'));
  const hoverSupport = readMediaQuery(windowObj, '(hover: hover)');
  const finePointer = readMediaQuery(windowObj, '(pointer: fine)');
  const orientation = viewportWidth > viewportHeight ? 'landscape' : 'portrait';
  const ua = toText(navigatorObj?.userAgent);
  const platform = toText(navigatorObj?.platform);
  const webxrAvailable = Boolean(navigatorObj?.xr);

  return {
    deviceClass: normalizeDeviceClass(inferDeviceClass({
      touch: touchSupport,
      finePointer,
      viewportWidth,
      viewportHeight,
      webxrAvailable,
    })),
    formFactorHint: viewportWidth && viewportHeight ? `${viewportWidth}x${viewportHeight}` : 'unknown',
    osFamily: inferOsFamily(ua, platform),
    browserFamily: inferBrowserFamily(ua),
    touchSupport,
    hoverSupport,
    finePointer,
    viewportClass: classifyViewport(viewportWidth),
    orientation,
    standaloneHint: Boolean(windowObj?.navigator?.standalone === true || readMediaQuery(windowObj, '(display-mode: standalone)')),
    userAgentPlatformFamily: platform ? platform.toLowerCase() : 'unknown',
    webxrAvailable,
  };
}

export function deriveSurfaceCapabilities(surfaceIdentity = {}, { runtimeContext = {}, navigatorObj = globalThis?.navigator, documentObj = globalThis?.document } = {}) {
  const identity = surfaceIdentity && typeof surfaceIdentity === 'object' ? surfaceIdentity : {};
  const networkInfo = navigatorObj?.connection || null;
  const constrainedNetworkLikely = networkInfo
    ? Boolean(networkInfo.saveData || ['slow-2g', '2g'].includes(String(networkInfo.effectiveType || '').toLowerCase()))
    : false;

  const constrainedScreen = identity.viewportClass === 'compact' || identity.deviceClass === 'phone';
  const multiPanelComfort = constrainedScreen
    ? 'low'
    : (identity.deviceClass === 'tablet' ? 'medium' : 'high');

  const sessionKind = toText(runtimeContext.sessionKind, 'unknown');
  const lanHint = runtimeContext.deviceContext === 'lan-companion' || runtimeContext.homeNode?.reachable === true;

  return {
    touchPrimary: identity.touchSupport === true && identity.finePointer !== true,
    hoverReliable: identity.hoverSupport === true && identity.finePointer === true,
    finePointer: identity.finePointer === true,
    keyboardLikely: identity.finePointer === true || identity.deviceClass === 'desktop',
    gamepadPossible: typeof navigatorObj?.getGamepads === 'function',
    fullscreenFriendly: typeof documentObj?.documentElement?.requestFullscreen === 'function',
    multiPanelComfort,
    localBackendLikely: sessionKind === 'local-desktop',
    localhostUsableHint: sessionKind === 'local-desktop',
    lanReachableHint: lanHint,
    webxrAvailable: identity.webxrAvailable === true,
    constrainedScreen,
    constrainedNetworkLikely,
  };
}

export function deriveSessionContextSurfaceHints({ runtimeContext = {}, capabilities = {}, surfaceIdentity = {} } = {}) {
  const sessionKind = toText(runtimeContext.sessionKind, 'unknown');
  let launchSurfaceRole = 'unknown';

  if (capabilities.webxrAvailable) launchSurfaceRole = 'vr-surface';
  else if (surfaceIdentity.deviceClass === 'phone') launchSurfaceRole = 'pocket-device';
  else if (surfaceIdentity.deviceClass === 'tablet') launchSurfaceRole = 'field-device';
  else if (surfaceIdentity.deviceClass === 'desktop') launchSurfaceRole = 'battle-bridge';

  return {
    sessionKind,
    launchSurfaceRole,
    localCompanionPossible: sessionKind !== 'hosted-web' || runtimeContext.deviceContext === 'lan-companion',
    remoteCompanionLikely: sessionKind === 'hosted-web',
  };
}

function pickProfileId({ identity = {}, capabilities = {}, hints = {}, override = 'auto' } = {}) {
  if (override === 'force-vr' && capabilities.webxrAvailable) return 'vr-cockpit';
  if (override === 'force-vr') return 'generic-surface';
  if (override === 'force-phone') return 'pocket-ops-phone';
  if (override === 'force-tablet') return 'field-tablet';
  if (override === 'force-desktop') return 'battle-bridge-desktop';

  if (capabilities.webxrAvailable === true && identity.deviceClass === 'vr-capable') return 'vr-cockpit';
  if (identity.deviceClass === 'phone') return 'pocket-ops-phone';
  if (identity.deviceClass === 'tablet') return 'field-tablet';
  if (identity.deviceClass === 'desktop' && hints.sessionKind === 'local-desktop') return 'battle-bridge-desktop';
  return 'generic-surface';
}

export function resolveEffectiveSurfaceExperience({
  surfaceIdentity = {},
  surfaceCapabilities = {},
  sessionContextSurfaceHints = {},
  operatorSurfaceOverrides = { mode: 'auto' },
} = {}) {
  const overrideMode = normalizeOverride(operatorSurfaceOverrides?.mode);
  const selectedProfileId = pickProfileId({
    identity: surfaceIdentity,
    capabilities: surfaceCapabilities,
    hints: sessionContextSurfaceHints,
    override: overrideMode,
  });
  const profile = EMBODIMENT_PROFILE_REGISTRY[selectedProfileId] || EMBODIMENT_PROFILE_REGISTRY['generic-surface'];

  const reasons = [];
  if (overrideMode !== 'auto') reasons.push(`operator override ${overrideMode} selected profile ${selectedProfileId}`);
  else reasons.push(`auto selection from deviceClass=${surfaceIdentity.deviceClass || 'unknown'} sessionKind=${sessionContextSurfaceHints.sessionKind || 'unknown'}`);
  if (surfaceCapabilities.constrainedScreen) reasons.push('constrained screen favored compact/single-focus defaults');
  if (surfaceCapabilities.webxrAvailable) reasons.push('webxr capability detected');

  const confidence = overrideMode !== 'auto'
    ? 'high'
    : (surfaceIdentity.deviceClass === 'unknown' ? 'low' : 'medium');

  return {
    selectedProfileId,
    selectionReasons: reasons,
    resolvedInputMode: profile.inputMode,
    resolvedPanelStrategy: profile.panelStrategy,
    resolvedUiDensity: profile.uiDensity,
    resolvedRoutingBiasHint: profile.routingBiasHint,
    resolvedAnimationBudget: profile.animationBudget,
    resolvedDefaultLandingView: profile.defaultLandingView,
    overrideApplied: overrideMode !== 'auto',
    confidence,
    debugVisibilityBias: profile.debugVisibilityBias,
    telemetryDensity: profile.telemetryDensity,
  };
}

export function resolveSurfaceAwareness({
  runtimeContext = {},
  operatorSurfaceOverrides = { mode: 'auto' },
  windowObj = globalThis?.window,
  navigatorObj = globalThis?.navigator,
  documentObj = globalThis?.document,
} = {}) {
  const surfaceIdentity = detectSurfaceIdentity({ windowObj, navigatorObj });
  const surfaceCapabilities = deriveSurfaceCapabilities(surfaceIdentity, { runtimeContext, navigatorObj, documentObj });
  const sessionContextSurfaceHints = deriveSessionContextSurfaceHints({ runtimeContext, capabilities: surfaceCapabilities, surfaceIdentity });
  const effectiveSurfaceExperience = resolveEffectiveSurfaceExperience({
    surfaceIdentity,
    surfaceCapabilities,
    sessionContextSurfaceHints,
    operatorSurfaceOverrides,
  });

  return {
    surfaceIdentity,
    surfaceCapabilities,
    sessionContextSurfaceHints,
    operatorSurfaceOverrides: { mode: normalizeOverride(operatorSurfaceOverrides?.mode) },
    embodimentProfile: EMBODIMENT_PROFILE_REGISTRY[effectiveSurfaceExperience.selectedProfileId] || EMBODIMENT_PROFILE_REGISTRY['generic-surface'],
    effectiveSurfaceExperience,
  };
}

export function resolveSurfaceUiLayoutDefaults(uiLayout = {}, effectiveSurfaceExperience = {}) {
  const strategy = toText(effectiveSurfaceExperience.resolvedPanelStrategy, 'stacked-docked');
  if (strategy === 'single-focus') {
    return {
      ...uiLayout,
      knowledgeGraphPanel: false,
      simulationHistoryPanel: false,
      proposalPanel: false,
      telemetryFeedPanel: false,
      promptBuilderPanel: false,
      roadmapPanel: false,
      missionPacketQueuePanel: false,
      cockpitPanel: false,
    };
  }
  if (strategy === 'stacked-docked') {
    return {
      ...uiLayout,
      knowledgeGraphPanel: false,
      simulationHistoryPanel: false,
      missionPacketQueuePanel: false,
    };
  }
  return { ...uiLayout };
}

export { SURFACE_OVERRIDE_MODES, normalizeOverride as normalizeSurfaceOverride };
