import {
  AI_SETTINGS_STORAGE_KEY,
  CLOUD_FIRST_PROVIDER_KEYS,
  CLOUD_PROVIDER_KEYS,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  FALLBACK_PROVIDER_KEYS,
  LOCAL_FIRST_PROVIDER_KEYS,
  LOCAL_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
} from '../ai/providerDefaults.mjs';
import {
  isMalformedStephanosHost,
  isLikelyLanHost,
  isLoopbackHost,
  normalizeStephanosHomeNode,
  validateStephanosBackendTargetUrl,
} from './stephanosHomeNode.mjs';
import { readPersistedStephanosSessionMemory } from './stephanosSessionMemory.mjs';
import { STEPHANOS_PROVIDER_ROUTING_MARKER, STEPHANOS_ROUTE_ADOPTION_MARKER } from './stephanosRouteMarkers.mjs';
import { normalizeBridgeTransportPreferences, normalizeBridgeTransportSelection, projectHomeBridgeTransportTruth } from './homeBridgeTransport.mjs';
import { evaluateRuntimeGuardrails } from './runtimeGuardrails.mjs';
import { adjudicateRuntimeTruth } from './runtimeAdjudicator.mjs';

function isBrowserStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function';
}

function normalizeProviderHealth(providerHealth = {}) {
  return providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
}

function parseHostname(value = '') {
  try {
    return new URL(value).hostname || '';
  } catch {
    return '';
  }
}

function isStaticGithubPagesOrigin(value = '') {
  return parseHostname(value).endsWith('.github.io');
}

function createBackendTargetCandidate(source = '', url = '') {
  return {
    source: String(source || '').trim() || 'unknown',
    url: String(url || '').trim(),
  };
}

function collectBackendTargetCandidates(runtimeContext = {}, fallbackUrl = '') {
  const diagnostics = runtimeContext.routeDiagnostics && typeof runtimeContext.routeDiagnostics === 'object'
    ? runtimeContext.routeDiagnostics
    : {};
  const frontendHost = parseHostname(runtimeContext.frontendOrigin || '');
  const hostedSession = runtimeContext.sessionKind === 'hosted-web'
    || (frontendHost ? !isLoopbackHost(frontendHost) : false);
  const onLanSession = runtimeContext.deviceContext === 'lan-companion'
    || (hostedSession && isLikelyLanHost(frontendHost));
  const homeNodeLan = diagnostics['home-node-lan'] || {};
  const homeNode = diagnostics['home-node'] || {};
  const homeNodeBridge = diagnostics['home-node-bridge'] || {};
  const bridgeTruth = runtimeContext.bridgeTransportTruth && typeof runtimeContext.bridgeTransportTruth === 'object'
    ? runtimeContext.bridgeTransportTruth
    : {};
  const rememberedBridgeReconciliationState = String(bridgeTruth.bridgeMemoryReconciliationState || '').trim();
  const rememberedBridgeDirectlyReachable = String(bridgeTruth.bridgeDirectReachability || '').trim() === 'reachable';
  const hostedExecutionIncompatible = hostedSession
    && rememberedBridgeReconciliationState === 'remembered-execution-incompatible'
    && ['mixed-scheme-blocked', 'cors-blocked'].includes(String(bridgeTruth.bridgeHostedExecutionCompatibility || '').trim());
  const rememberedBridgeUrl = String(bridgeTruth.bridgeMemoryUrl || '').trim();
  const liveTailscaleUrl = String(bridgeTruth?.tailscale?.backendUrl || '').trim();
  const liveTailscaleExecutionUrl = String(
    bridgeTruth?.tailscale?.executionUrl
    || bridgeTruth?.bridgeHostedExecutionBridgeUrl
    || '',
  ).trim();
  const rememberedRevalidatedAsTailscale = rememberedBridgeReconciliationState === 'remembered-revalidated'
    && bridgeTruth.selectedTransport === 'tailscale'
    && bridgeTruth?.tailscale?.accepted === true
    && bridgeTruth?.tailscale?.reachable === true;
  const canonicalHostedTailscale = hostedSession
    && bridgeTruth.bridgeMemoryTransport === 'tailscale'
    && Boolean(rememberedBridgeUrl || liveTailscaleUrl)
    && bridgeTruth?.tailscale?.accepted === true
    && bridgeTruth?.tailscale?.reachable === true
    && (
      bridgeTruth.selectedTransport === 'tailscale'
      || rememberedRevalidatedAsTailscale
    );
  const rememberedBridgeEligible = hostedSession
    && rememberedBridgeUrl
    && [
      'remembered-awaiting-validation',
      'remembered-revalidated',
      'remembered-unreachable',
      ...(rememberedBridgeDirectlyReachable ? ['remembered-execution-incompatible'] : []),
    ].includes(rememberedBridgeReconciliationState);
  const hostedRememberedTailscaleState = hostedSession
    && bridgeTruth.bridgeMemoryTransport === 'tailscale'
    && Boolean(rememberedBridgeUrl)
    && [
      'remembered-awaiting-validation',
      'remembered-revalidated',
      'remembered-unreachable',
      ...(rememberedBridgeDirectlyReachable ? ['remembered-execution-incompatible'] : []),
    ].includes(rememberedBridgeReconciliationState);
  const preferLanHomeNode = hostedSession && onLanSession && !canonicalHostedTailscale;
  const preferBridgeHomeNode = hostedSession && (!onLanSession || canonicalHostedTailscale);
  const homeNodeLooksLan = !String(homeNode.routeVariant || homeNode.source || '').includes('bridge');

  const prioritizedCandidates = [
    ...(preferLanHomeNode && !hostedExecutionIncompatible ? [
      createBackendTargetCandidate('routeDiagnostics.home-node-lan.actualTarget', homeNodeLan.actualTarget),
      createBackendTargetCandidate('routeDiagnostics.home-node-lan.target', homeNodeLan.target),
    ] : []),
    ...(preferLanHomeNode && homeNodeLooksLan && !hostedExecutionIncompatible ? [
      createBackendTargetCandidate('routeDiagnostics.home-node.actualTarget', homeNode.actualTarget),
      createBackendTargetCandidate('routeDiagnostics.home-node.target', homeNode.target),
    ] : []),
    ...(preferBridgeHomeNode ? [
      ...(rememberedRevalidatedAsTailscale && liveTailscaleUrl
        ? [createBackendTargetCandidate('bridgeTransport.liveTailscale.backendUrl', liveTailscaleUrl)]
        : []),
      ...(liveTailscaleExecutionUrl
        ? [createBackendTargetCandidate('bridgeTransport.liveTailscale.executionUrl', liveTailscaleExecutionUrl)]
        : []),
      ...(rememberedBridgeEligible
        ? [createBackendTargetCandidate('bridgeMemory.remembered.backendUrl', rememberedBridgeUrl)]
        : []),
      createBackendTargetCandidate('routeDiagnostics.home-node-bridge.actualTarget', homeNodeBridge.actualTarget),
      createBackendTargetCandidate('routeDiagnostics.home-node-bridge.target', homeNodeBridge.target),
    ] : []),
    ...(preferBridgeHomeNode ? [
      createBackendTargetCandidate('bridgeTransport.tailscale.executionUrl', runtimeContext.bridgeTransportPreferences?.transports?.tailscale?.executionUrl),
      createBackendTargetCandidate('bridgeTransport.tailscale.backendUrl', runtimeContext.bridgeTransportPreferences?.transports?.tailscale?.backendUrl),
      createBackendTargetCandidate('runtimeContext.bridgeTransportTruth.tailscale.backendUrl', runtimeContext.bridgeTransportTruth?.tailscale?.backendUrl),
    ] : []),
    ...(preferBridgeHomeNode ? [
      ...(!rememberedRevalidatedAsTailscale ? [
        ...(hostedExecutionIncompatible ? [] : [
          createBackendTargetCandidate('routeDiagnostics.home-node.actualTarget', homeNode.actualTarget),
          createBackendTargetCandidate('routeDiagnostics.home-node.target', homeNode.target),
        ]),
      ] : []),
    ] : []),
    createBackendTargetCandidate('routeDiagnostics.cloud.actualTarget', diagnostics.cloud?.actualTarget),
    createBackendTargetCandidate('routeDiagnostics.cloud.target', diagnostics.cloud?.target),
  ];
  const compatibilityCandidates = [
    ...(!hostedRememberedTailscaleState && !hostedExecutionIncompatible ? [
      createBackendTargetCandidate('routeDiagnostics.home-node.actualTarget', diagnostics['home-node']?.actualTarget),
      createBackendTargetCandidate('routeDiagnostics.home-node.target', diagnostics['home-node']?.target),
      createBackendTargetCandidate('routeDiagnostics.home-node-lan.actualTarget', diagnostics['home-node-lan']?.actualTarget),
      createBackendTargetCandidate('routeDiagnostics.home-node-lan.target', diagnostics['home-node-lan']?.target),
    ] : []),
    createBackendTargetCandidate('routeDiagnostics.home-node-bridge.actualTarget', diagnostics['home-node-bridge']?.actualTarget),
    createBackendTargetCandidate('routeDiagnostics.home-node-bridge.target', diagnostics['home-node-bridge']?.target),
    createBackendTargetCandidate('runtimeContext.backendTargetResolvedUrl', runtimeContext.backendTargetResolvedUrl),
    ...(!hostedRememberedTailscaleState && !hostedExecutionIncompatible ? [
      createBackendTargetCandidate('runtimeContext.actualTargetUsed', runtimeContext.actualTargetUsed),
      createBackendTargetCandidate('runtimeContext.preferredTarget', runtimeContext.preferredTarget),
      createBackendTargetCandidate('runtimeContext.homeNode.backendUrl', runtimeContext.homeNode?.backendUrl),
    ] : []),
    createBackendTargetCandidate('runtimeContext.apiBaseUrl', runtimeContext.apiBaseUrl),
    createBackendTargetCandidate('bridgeTransport.tailscale.backendUrl', runtimeContext.bridgeTransportPreferences?.transports?.tailscale?.backendUrl),
    createBackendTargetCandidate('fallback.actualTarget', fallbackUrl),
  ];
  const candidates = [...prioritizedCandidates, ...compatibilityCandidates];

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate.url) {
      continue;
    }
    const key = candidate.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function resolveBackendReachabilityByTarget(diagnostics = {}) {
  const reachabilityByTarget = new Map();
  for (const [routeKey, routeValue] of Object.entries(diagnostics || {})) {
    if (!routeValue || typeof routeValue !== 'object') {
      continue;
    }
    const route = routeValue;
    const reachable = route.available === true
      || route.backendReachable === true
      || route.usable === true;
    const routeTarget = typeof route.target === 'string' ? route.target.trim() : '';
    const routeActualTarget = typeof route.actualTarget === 'string' ? route.actualTarget.trim() : '';
    if (routeTarget) {
      reachabilityByTarget.set(routeTarget, reachable);
    }
    if (routeActualTarget) {
      reachabilityByTarget.set(routeActualTarget, reachable);
    }
    if (routeKey === 'home-node' && String(route.routeVariant || '').includes('bridge') && routeActualTarget) {
      reachabilityByTarget.set(routeActualTarget, reachable);
    }
  }
  return reachabilityByTarget;
}

function resolveCompatibleUrl(candidate = '', fallback = '', { allowLoopback = false } = {}) {
  const candidateValidation = validateStephanosBackendTargetUrl(candidate, { allowLoopback });
  if (candidateValidation.ok) {
    return candidate;
  }

  const fallbackValidation = validateStephanosBackendTargetUrl(fallback, { allowLoopback });
  if (fallbackValidation.ok) {
    return fallback;
  }

  return allowLoopback ? (candidate || fallback || '') : '';
}

function normalizeSurfaceAwareness(surfaceAwareness = {}) {
  const source = surfaceAwareness && typeof surfaceAwareness === 'object' ? surfaceAwareness : {};
  const identity = source.surfaceIdentity && typeof source.surfaceIdentity === 'object' ? source.surfaceIdentity : {};
  const capabilities = source.surfaceCapabilities && typeof source.surfaceCapabilities === 'object' ? source.surfaceCapabilities : {};
  const hints = source.sessionContextSurfaceHints && typeof source.sessionContextSurfaceHints === 'object'
    ? source.sessionContextSurfaceHints
    : {};
  const overrides = source.operatorSurfaceOverrides && typeof source.operatorSurfaceOverrides === 'object'
    ? source.operatorSurfaceOverrides
    : { mode: 'auto' };
  const effective = source.effectiveSurfaceExperience && typeof source.effectiveSurfaceExperience === 'object'
    ? source.effectiveSurfaceExperience
    : {};
  return {
    surfaceIdentity: identity,
    surfaceCapabilities: capabilities,
    sessionContextSurfaceHints: hints,
    operatorSurfaceOverrides: { mode: String(overrides.mode || 'auto') },
    embodimentProfile: source.embodimentProfile && typeof source.embodimentProfile === 'object' ? source.embodimentProfile : {},
    effectiveSurfaceExperience: effective,
  };
}

function enforceHostedRememberedTailscaleRevalidationTruthGate({
  runtimeContext = {},
  nodeRoute = {},
  finalRoute = {},
} = {}) {
  if (runtimeContext?.sessionKind !== 'hosted-web') {
    return runtimeContext;
  }
  const bridgeTruth = runtimeContext.bridgeTransportTruth && typeof runtimeContext.bridgeTransportTruth === 'object'
    ? runtimeContext.bridgeTransportTruth
    : {};
  const tailscale = bridgeTruth.tailscale && typeof bridgeTruth.tailscale === 'object' ? bridgeTruth.tailscale : {};
  const selectedTransport = String(bridgeTruth.selectedTransport || '').trim();
  const backendUrl = String(tailscale.backendUrl || '').trim();
  const autoState = String(bridgeTruth.bridgeAutoRevalidationState || '').trim();
  const provenance = String(bridgeTruth.bridgeMemoryReconciliationProvenance || '').trim();
  const reconciliationState = String(bridgeTruth.bridgeMemoryReconciliationState || '').trim();
  const claimsRevalidated = reconciliationState === 'remembered-revalidated'
    || provenance === 'remembered-tailscale-revalidated-as-tailscale'
    || autoState === 'revalidated';
  if (!claimsRevalidated || bridgeTruth.bridgeMemoryTransport !== 'tailscale') {
    return runtimeContext;
  }

  const backendCandidateAccepted = Array.isArray(runtimeContext.backendTargetCandidates)
    && runtimeContext.backendTargetCandidates.some((candidate) => candidate?.url === backendUrl && candidate?.accepted === true);
  const winnerUsesTailscale = nodeRoute?.routeCandidateWinner?.candidateKey === 'home-node-tailscale'
    && nodeRoute?.routeCandidateWinner?.usable === true
    && String(finalRoute?.actualTarget || '').trim() === backendUrl;
  const strictGate = selectedTransport === 'tailscale'
    && Boolean(backendUrl)
    && tailscale.accepted === true
    && tailscale.reachable === true
    && backendCandidateAccepted
    && winnerUsesTailscale;
  if (strictGate) {
    return runtimeContext;
  }

  const blocker = selectedTransport !== 'tailscale' || !backendUrl
    ? {
      state: 'remembered-awaiting-validation',
      reason: 'Remembered Tailscale bridge is loaded, but transport configuration is not yet canonical for hosted routing.',
      provenance: 'remembered-tailscale-pending-transport-config',
      autoState: 'probing',
    }
    : (!backendCandidateAccepted
      ? {
        state: 'remembered-awaiting-validation',
        reason: 'Remembered Tailscale bridge candidate is present, but backend target acceptance is not yet established.',
        provenance: 'remembered-candidate-not-yet-accepted',
        autoState: 'probing',
      }
      : {
        state: 'remembered-awaiting-validation',
        reason: 'Remembered Tailscale bridge target is accepted, but hosted route winner is not yet using that target.',
        provenance: 'remembered-route-not-yet-usable',
        autoState: 'probing',
      });

  return {
    ...runtimeContext,
    bridgeTransportTruth: {
      ...bridgeTruth,
      activeTransport: 'none',
      state: 'configured',
      detail: blocker.reason,
      reason: blocker.reason,
      source: 'bridgeTransport:awaiting-route-adjudication',
      reachability: 'pending',
      usability: 'no',
      bridgeMemoryReconciliationState: blocker.state,
      bridgeMemoryReconciliationReason: blocker.reason,
      bridgeMemoryReconciliationProvenance: blocker.provenance,
      bridgeAutoRevalidationState: blocker.autoState,
      bridgeAutoRevalidationReason: blocker.reason,
      tailscale: {
        ...tailscale,
        active: false,
        usable: false,
        reason: blocker.reason,
      },
    },
  };
}

function buildCanonicalHostedRouteTruth({
  runtimeContext = {},
  selectedRouteKind = 'unavailable',
  selectedRoute = {},
  backendAvailable = false,
} = {}) {
  if (runtimeContext.sessionKind !== 'hosted-web') {
    return null;
  }
  const backendTargetResolvedUrl = String(runtimeContext.backendTargetResolvedUrl || '').trim();
  const backendTargetValidity = backendTargetResolvedUrl
    ? 'valid'
    : (runtimeContext.backendTargetInvalidReason ? 'invalid' : 'unresolved');
  const homeNodeDiagnostic = runtimeContext.routeDiagnostics?.['home-node'] || {};
  const backendTargetDiagnostic = runtimeContext.routeDiagnostics?.['backend-target'] || {};
  const bridgeTruth = runtimeContext.bridgeTransportTruth && typeof runtimeContext.bridgeTransportTruth === 'object'
    ? runtimeContext.bridgeTransportTruth
    : {};
  const hostedExecutionCompatibility = String(bridgeTruth.bridgeHostedExecutionCompatibility || '').trim();
  const executionIncompatible = hostedExecutionCompatibility === 'mixed-scheme-blocked'
    || hostedExecutionCompatibility === 'cors-blocked';
  const selectedKind = String(selectedRouteKind || 'unavailable');
  const selectedRouteReachable = selectedRoute?.available === true;
  const selectedRouteUsable = selectedRoute?.usable === true;
  const publicationFailure = homeNodeDiagnostic.misconfigured === true
    || (homeNodeDiagnostic.backendReachable === true && homeNodeDiagnostic.uiReachable === false);
  const backendTargetReachable = backendAvailable && (
    homeNodeDiagnostic.backendReachable === true
    || selectedKind === 'home-node'
    || backendTargetDiagnostic.available === true
  );
  const blockingIssues = [];
  if (!backendTargetResolvedUrl) {
    blockingIssues.push({
      code: backendTargetValidity === 'invalid' ? 'hosted-backend-target-invalid' : 'hosted-backend-target-unresolved',
      message: backendTargetValidity === 'invalid'
        ? (runtimeContext.backendTargetInvalidReason || 'Hosted backend target is invalid.')
        : 'Hosted backend target is unresolved.',
    });
  } else if (executionIncompatible && !backendTargetReachable) {
    blockingIssues.push({
      code: 'hosted-backend-execution-incompatible',
      message: bridgeTruth.bridgeHostedExecutionReason
        || 'Hosted backend target is directly reachable but blocked for execution by browser security policy.',
    });
  } else if (!backendTargetReachable) {
    blockingIssues.push({
      code: 'hosted-backend-target-unreachable',
      message: 'Hosted backend target is resolved but unreachable.',
    });
  } else if (publicationFailure) {
    blockingIssues.push({
      code: 'hosted-home-node-publication-failed',
      message: homeNodeDiagnostic.blockedReason
        || homeNodeDiagnostic.reason
        || 'Hosted home-node publication is misconfigured or unreachable.',
    });
  }

  return {
    backendTargetResolvedUrl,
    backendTargetValidity,
    backendTargetReachable,
    selectedRouteKind: selectedKind,
    selectedRouteReachable,
    selectedRouteUsable,
    blockingIssues,
    winningReason: String(selectedRoute?.reason || ''),
    reconciliationReason: blockingIssues.length > 0
      ? blockingIssues[0].message
      : 'Hosted route truth is internally consistent.',
  };
}

export function normalizeRuntimeContext(runtimeContext = {}) {
  const frontendOrigin = String(runtimeContext.frontendOrigin || '');
  const apiBaseUrl = String(runtimeContext.apiBaseUrl || runtimeContext.backendBaseUrl || runtimeContext.baseUrl || '');
  const frontendHost = parseHostname(frontendOrigin);
  const backendHost = parseHostname(apiBaseUrl);
  const frontendLocal = isLoopbackHost(frontendHost) || !frontendHost;
  const backendLocal = isLoopbackHost(backendHost) || !backendHost;
  const launcherLocal = frontendLocal;
  const frontendReachability = frontendLocal ? 'local' : 'reachable';
  const backendReachability = backendLocal && launcherLocal ? 'local' : 'reachable';
  const homeNode = normalizeStephanosHomeNode(runtimeContext.homeNode || {}, {
    source: runtimeContext.homeNode?.source || 'manual',
  });
  const homeNodeBridgeRaw = runtimeContext.homeNodeBridge && typeof runtimeContext.homeNodeBridge === 'object'
    ? runtimeContext.homeNodeBridge
    : {};
  const bridgeValidation = validateStephanosBackendTargetUrl(homeNodeBridgeRaw.backendUrl || '', {
    allowLoopback: false,
  });
  const homeNodeBridge = {
    configured: homeNodeBridgeRaw.configured === true,
    accepted: homeNodeBridgeRaw.accepted === true && bridgeValidation.ok,
    backendUrl: bridgeValidation.ok ? bridgeValidation.normalizedUrl : '',
    reachability: String(homeNodeBridgeRaw.reachability || (bridgeValidation.ok ? 'unknown' : 'invalid')),
    reason: String(homeNodeBridgeRaw.reason || ''),
  };
  let bridgeTransportPreferences = normalizeBridgeTransportPreferences(runtimeContext.bridgeTransportPreferences, {
    homeBridgeUrl: homeNodeBridge.backendUrl || '',
    frontendOrigin,
  });
  let bridgeTransportTruth = projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
    runtimeBridge: homeNodeBridge,
    bridgeMemory: runtimeContext.bridgeMemory,
    bridgeMemoryRehydrated: runtimeContext.bridgeMemoryRehydrated === true,
    autoRevalidation: runtimeContext.bridgeAutoRevalidation,
  });
  const loopbackBackendMismatch = !launcherLocal && backendLocal;
  const localDesktopBackendSession = !launcherLocal
    && backendLocal
    && runtimeContext.routeDiagnostics?.['local-desktop']?.configured === true;
  const preliminaryDeviceContext = launcherLocal || localDesktopBackendSession
    ? 'pc-local-browser'
    : (homeNode.reachable
      || (homeNode.configured && isLikelyLanHost(homeNode.host))
      || (Boolean(backendHost) && !isLoopbackHost(backendHost) && isLikelyLanHost(backendHost)))
      ? 'lan-companion'
      : 'off-network';
  const sessionKind = launcherLocal || localDesktopBackendSession ? 'local-desktop' : 'hosted-web';
  const rememberedBridgeMemory = bridgeTransportTruth.bridgeMemoryTransport === 'tailscale'
    ? String(bridgeTransportTruth.bridgeMemoryUrl || '').trim()
    : '';
  const liveTailscaleConfig = bridgeTransportPreferences?.transports?.tailscale || {};
  const hostedValidatedRememberedTailscale = sessionKind === 'hosted-web'
    && Boolean(rememberedBridgeMemory)
    && liveTailscaleConfig.enabled === true
    && liveTailscaleConfig.accepted === true
    && String(liveTailscaleConfig.reachability || '').trim() === 'reachable';
  if (hostedValidatedRememberedTailscale && bridgeTransportPreferences.selectedTransport !== 'tailscale') {
    bridgeTransportPreferences = normalizeBridgeTransportPreferences({
      ...bridgeTransportPreferences,
      selectedTransport: 'tailscale',
      transports: {
        ...(bridgeTransportPreferences?.transports || {}),
        tailscale: {
          ...liveTailscaleConfig,
          enabled: true,
          backendUrl: rememberedBridgeMemory,
          accepted: true,
          active: true,
          reachability: 'reachable',
          usable: true,
        },
      },
    }, {
      homeBridgeUrl: homeNodeBridge.backendUrl || '',
      frontendOrigin,
    });
    bridgeTransportTruth = projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
      runtimeBridge: homeNodeBridge,
      bridgeMemory: runtimeContext.bridgeMemory,
      bridgeMemoryRehydrated: runtimeContext.bridgeMemoryRehydrated === true,
      autoRevalidation: runtimeContext.bridgeAutoRevalidation,
    });
  }
  const hostedDirectRememberedTailscalePromotion = sessionKind === 'hosted-web'
    && bridgeTransportTruth.bridgeMemoryTransport === 'tailscale'
    && String(bridgeTransportTruth.bridgeDirectReachability || '').trim() === 'reachable'
    && validateStephanosBackendTargetUrl(bridgeTransportTruth.bridgeMemoryUrl, { allowLoopback: false }).ok;
  if (hostedDirectRememberedTailscalePromotion) {
    bridgeTransportPreferences = normalizeBridgeTransportPreferences({
      ...bridgeTransportPreferences,
      selectedTransport: 'tailscale',
      transports: {
        ...(bridgeTransportPreferences?.transports || {}),
        tailscale: {
          ...(bridgeTransportPreferences?.transports?.tailscale || {}),
          enabled: true,
          backendUrl: bridgeTransportTruth.bridgeMemoryUrl,
          accepted: true,
          active: true,
          reachability: 'reachable',
          usable: true,
          reason: bridgeTransportTruth.bridgeAutoRevalidationReason
            || 'Remembered Home Bridge direct health probe succeeded on this hosted surface.',
        },
      },
    }, {
      homeBridgeUrl: homeNodeBridge.backendUrl || '',
      frontendOrigin,
    });
    bridgeTransportTruth = projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
      runtimeBridge: homeNodeBridge,
      bridgeMemory: runtimeContext.bridgeMemory,
      bridgeMemoryRehydrated: runtimeContext.bridgeMemoryRehydrated === true,
      autoRevalidation: {
        ...(runtimeContext.bridgeAutoRevalidation || {}),
        state: 'revalidated',
        reason: runtimeContext.bridgeAutoRevalidation?.reason
          || 'Remembered Home Bridge direct health probe succeeded on this hosted surface.',
        promotionReason: runtimeContext.bridgeAutoRevalidation?.promotionReason
          || 'Remembered tailscale bridge promoted into live route candidates from direct probe evidence.',
      },
    });
  }
  const hostedRememberedTailscaleCandidatePromotion = sessionKind === 'hosted-web'
    && bridgeTransportTruth.bridgeMemoryTransport === 'tailscale'
    && bridgeTransportTruth.bridgeMemoryReconciliationState === 'remembered-revalidated'
    && bridgeTransportTruth?.tailscale?.accepted === true
    && bridgeTransportTruth?.tailscale?.reachable === true
    && Boolean(bridgeTransportTruth?.tailscale?.backendUrl);
  if (hostedRememberedTailscaleCandidatePromotion && bridgeTransportPreferences.selectedTransport !== 'tailscale') {
    bridgeTransportPreferences = normalizeBridgeTransportPreferences({
      ...bridgeTransportPreferences,
      selectedTransport: 'tailscale',
      transports: {
        ...(bridgeTransportPreferences?.transports || {}),
        tailscale: {
          ...(bridgeTransportPreferences?.transports?.tailscale || {}),
          enabled: true,
          backendUrl: bridgeTransportTruth.bridgeMemoryUrl,
          accepted: bridgeTransportTruth?.tailscale?.accepted === true,
          active: bridgeTransportTruth?.tailscale?.accepted === true
            && bridgeTransportTruth?.tailscale?.reachable === true,
          reachability: bridgeTransportTruth?.tailscale?.accepted === true
            ? (bridgeTransportTruth?.tailscale?.reachable === true ? 'reachable' : 'unknown')
            : 'pending',
          usable: bridgeTransportTruth?.tailscale?.usable === true,
        },
      },
    }, {
      homeBridgeUrl: homeNodeBridge.backendUrl || '',
      frontendOrigin,
    });
    bridgeTransportTruth = projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
      runtimeBridge: homeNodeBridge,
      bridgeMemory: runtimeContext.bridgeMemory,
      bridgeMemoryRehydrated: runtimeContext.bridgeMemoryRehydrated === true,
      autoRevalidation: runtimeContext.bridgeAutoRevalidation,
    });
  }
  const hostedRememberedTailscalePromotion = sessionKind === 'hosted-web'
    && bridgeTransportTruth.bridgeMemoryReconciliationState === 'remembered-revalidated'
    && bridgeTransportTruth.bridgeMemoryTransport === 'tailscale'
    && bridgeTransportTruth?.tailscale?.accepted === true
    && bridgeTransportTruth?.tailscale?.reachable === true
    && Boolean(bridgeTransportTruth?.tailscale?.backendUrl);
  if (hostedRememberedTailscalePromotion && bridgeTransportPreferences.selectedTransport !== 'tailscale') {
    bridgeTransportPreferences = normalizeBridgeTransportPreferences({
      ...bridgeTransportPreferences,
      selectedTransport: 'tailscale',
      transports: {
        ...(bridgeTransportPreferences?.transports || {}),
        tailscale: {
          ...(bridgeTransportPreferences?.transports?.tailscale || {}),
          enabled: true,
          backendUrl: bridgeTransportTruth.tailscale.backendUrl,
          accepted: true,
          active: true,
          reachability: 'reachable',
          usable: true,
        },
      },
    }, {
      homeBridgeUrl: homeNodeBridge.backendUrl || '',
      frontendOrigin,
    });
    bridgeTransportTruth = projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
      runtimeBridge: homeNodeBridge,
      bridgeMemory: runtimeContext.bridgeMemory,
      bridgeMemoryRehydrated: runtimeContext.bridgeMemoryRehydrated === true,
      autoRevalidation: runtimeContext.bridgeAutoRevalidation,
    });
  }
  const canonicalHomeNodeBridge = hostedRememberedTailscalePromotion
    ? {
      ...homeNodeBridge,
      configured: true,
      accepted: true,
      backendUrl: bridgeTransportTruth?.tailscale?.backendUrl || homeNodeBridge.backendUrl,
      reachability: 'reachable',
      reason: bridgeTransportTruth?.tailscale?.reason || homeNodeBridge.reason,
    }
    : homeNodeBridge;
  const hostedRememberedTailscaleCanonicalTarget = hostedRememberedTailscaleCandidatePromotion
    ? String(bridgeTransportTruth?.tailscale?.backendUrl || bridgeTransportTruth.bridgeMemoryUrl || '').trim()
    : '';
  const hostedExecutionBlocked = sessionKind === 'hosted-web'
    && bridgeTransportTruth.bridgeMemoryReconciliationState === 'remembered-execution-incompatible'
    && ['mixed-scheme-blocked', 'cors-blocked'].includes(String(bridgeTransportTruth.bridgeHostedExecutionCompatibility || '').trim());
  const rememberedBridgeDirectlyReachable = String(bridgeTransportTruth.bridgeDirectReachability || '').trim() === 'reachable';
  const compatiblePreferredTarget = hostedRememberedTailscaleCanonicalTarget
    || (hostedExecutionBlocked
      ? ''
      : resolveCompatibleUrl(
        runtimeContext.preferredTarget,
        homeNode?.uiUrl || frontendOrigin || apiBaseUrl,
        { allowLoopback: launcherLocal },
      ));
  const compatibleActualTarget = hostedRememberedTailscaleCanonicalTarget
    || (hostedExecutionBlocked
      ? ''
      : resolveCompatibleUrl(
        runtimeContext.actualTargetUsed,
        homeNode?.backendUrl || (!loopbackBackendMismatch ? apiBaseUrl : ''),
        { allowLoopback: launcherLocal },
      ));
  const runtimeResolvedBackendTarget = String(runtimeContext.backendTargetResolvedUrl || '').trim();
  const backendTargetResolutionSourceRaw = String(runtimeContext.backendTargetResolutionSource || '').trim();
  const backendTargetCandidates = collectBackendTargetCandidates({
    ...runtimeContext,
    sessionKind,
    deviceContext: preliminaryDeviceContext,
    bridgeTransportPreferences,
    bridgeTransportTruth,
    homeNodeBridge: canonicalHomeNodeBridge,
  }, compatibleActualTarget);
  const backendReachabilityByTarget = resolveBackendReachabilityByTarget(runtimeContext.routeDiagnostics || {});
  const backendTargetCandidateDecisions = backendTargetCandidates.map((candidate) => {
    const sameOriginStaticHostedCandidate = sessionKind === 'hosted-web'
      && isStaticGithubPagesOrigin(frontendOrigin)
      && Boolean(frontendOrigin)
      && candidate.url === frontendOrigin;
    const validation = validateStephanosBackendTargetUrl(
      candidate.url,
      { allowLoopback: sessionKind === 'local-desktop' },
    );
    const directBackendProbeSucceeded = sessionKind === 'hosted-web'
      && rememberedBridgeDirectlyReachable
      && (
        candidate.url === String(bridgeTransportTruth.bridgeMemoryUrl || '').trim()
        || candidate.url === String(bridgeTransportTruth?.tailscale?.backendUrl || '').trim()
      );
    const hostedExecutionProbeSucceeded = sessionKind === 'hosted-web'
      && String(bridgeTransportTruth.bridgeHostedExecutionCompatibility || '').trim() === 'compatible'
      && candidate.url === String(bridgeTransportTruth.bridgeHostedExecutionTarget || '').trim()
      && String(bridgeTransportTruth.bridgeAutoRevalidationState || '').trim() === 'revalidated';
    const candidateMixedSchemeBlocked = sessionKind === 'hosted-web'
      && bridgeTransportTruth.bridgeHostedExecutionCompatibility === 'mixed-scheme-blocked'
      && candidate.url === bridgeTransportTruth.bridgeMemoryUrl
      && !directBackendProbeSucceeded;
    const bridgeTargetReachable = canonicalHomeNodeBridge.accepted === true
      && canonicalHomeNodeBridge.reachability === 'reachable'
      && Boolean(canonicalHomeNodeBridge.backendUrl)
      && candidate.url === canonicalHomeNodeBridge.backendUrl;
    const reachable = bridgeTargetReachable
      ? true
      : directBackendProbeSucceeded
      ? true
      : backendReachabilityByTarget.has(candidate.url)
      ? backendReachabilityByTarget.get(candidate.url) === true
      : (sessionKind === 'local-desktop' ? validation.ok : false);
    const accepted = validation.ok
      && reachable
      && !candidateMixedSchemeBlocked
      && !sameOriginStaticHostedCandidate;
    return {
      source: candidate.source,
      url: candidate.url,
      accepted,
      directBackendProbeSucceeded,
      hostedExecutionProbeSucceeded,
      reachable: candidateMixedSchemeBlocked ? true : reachable,
      reason: accepted
        ? ''
        : (sameOriginStaticHostedCandidate
          ? 'Same-origin static-host backend fallback is invalid for hosted-web sessions (GitHub Pages origin cannot be a backend target).'
        : (candidateMixedSchemeBlocked
          ? (bridgeTransportTruth.bridgeHostedExecutionReason
            || 'Hosted HTTPS frontend cannot execute this HTTP bridge target due browser mixed-content policy.')
        : (validation.ok
          ? 'Backend target candidate failed reachability probe or has no route probe evidence.'
          : validation.reason))),
    };
  });
  const acceptedBackendCandidate = backendTargetCandidateDecisions.find((candidate) => candidate.accepted);
  const hasValidationRejectedCandidates = backendTargetCandidateDecisions.some((candidate) => candidate.reason && !candidate.reason.includes('reachability probe'));
  const hasReachabilityRejectedCandidates = backendTargetCandidateDecisions.some((candidate) => candidate.reason.includes('reachability probe'));
  const backendTargetResolvedUrlRaw = String(acceptedBackendCandidate?.url || '').trim();
  const backendTargetValidation = validateStephanosBackendTargetUrl(
    backendTargetResolvedUrlRaw,
    { allowLoopback: sessionKind === 'local-desktop' },
  );
  const sameOriginStaticHostedFallbackCandidate = sessionKind === 'hosted-web'
    && isStaticGithubPagesOrigin(frontendOrigin)
    && Boolean(frontendOrigin)
    && backendTargetCandidateDecisions.some((candidate) => candidate.url === frontendOrigin);
  const sameOriginStaticHostedFallbackInvalid = sameOriginStaticHostedFallbackCandidate
    && (!backendTargetResolvedUrlRaw || backendTargetResolvedUrlRaw === frontendOrigin);
  const backendTargetResolvedUrl = (sameOriginStaticHostedFallbackInvalid || !backendTargetValidation.ok)
    ? ''
    : backendTargetResolvedUrlRaw;
  const resolvedBackendHost = parseHostname(backendTargetResolvedUrl);
  const deviceContext = preliminaryDeviceContext === 'pc-local-browser'
    ? preliminaryDeviceContext
    : (sessionKind === 'hosted-web' && isLikelyLanHost(resolvedBackendHost))
      ? 'lan-companion'
      : preliminaryDeviceContext;
  const backendTargetResolutionSource = sameOriginStaticHostedFallbackInvalid
    ? 'unresolved'
    : (!backendTargetValidation.ok && backendTargetResolvedUrlRaw)
      ? 'invalid'
    : (!backendTargetResolvedUrl && hasValidationRejectedCandidates)
      ? 'invalid'
    : (!backendTargetResolvedUrl && hasReachabilityRejectedCandidates)
      ? 'unresolved'
    : (backendTargetResolutionSourceRaw
      || (acceptedBackendCandidate?.source || '')
      || (backendTargetResolvedUrl ? (runtimeContext.nodeAddressSource || 'route-diagnostics') : 'unresolved')
      || 'unresolved');
  const backendTargetFallbackUsed = sameOriginStaticHostedFallbackInvalid
    ? false
    : (acceptedBackendCandidate?.source === 'fallback.actualTarget'
      ? true
      : (runtimeContext.backendTargetFallbackUsed === true
        || (!runtimeResolvedBackendTarget && Boolean(compatibleActualTarget) && !acceptedBackendCandidate)));
  const backendTargetInvalidReason = String(
    runtimeContext.backendTargetInvalidReason
    || (sameOriginStaticHostedFallbackInvalid
      ? 'Same-origin static-host backend fallback is invalid for hosted-web sessions (GitHub Pages origin cannot be a backend target).'
      : ((!backendTargetValidation.ok && backendTargetResolvedUrlRaw)
        ? backendTargetValidation.reason
      : (!backendTargetResolvedUrl && backendTargetCandidateDecisions.some((candidate) => !candidate.accepted))
        ? backendTargetCandidateDecisions.find((candidate) => !candidate.accepted)?.reason || 'No valid backend target candidates were accepted.'
      : ((sessionKind === 'hosted-web' && !backendTargetResolvedUrl)
        ? 'No non-loopback backend target resolved for hosted session.'
        : ''))),
  ).trim();
  const backendTargetRejectedSummary = backendTargetCandidateDecisions
    .filter((candidate) => !candidate.accepted)
    .slice(0, 4)
    .map((candidate) => `${candidate.source}: ${candidate.reason || 'rejected'}`);
  const backendTargetRouteDiagnostic = {
    configured: backendTargetCandidates.length > 0,
    available: Boolean(backendTargetResolvedUrl),
    usable: Boolean(backendTargetResolvedUrl),
    source: backendTargetResolutionSource,
    target: backendTargetResolvedUrl,
    actualTarget: backendTargetResolvedUrl,
    reason: backendTargetResolvedUrl
      ? `Resolved backend target from ${backendTargetResolutionSource}.`
      : (backendTargetInvalidReason || 'Backend target unresolved.'),
    blockedReason: backendTargetResolvedUrl ? '' : (backendTargetInvalidReason || 'Backend target unresolved.'),
    candidates: backendTargetCandidateDecisions,
    rejectedSummary: backendTargetRejectedSummary.join(' | '),
  };
  const routeDiagnosticsSource = (runtimeContext.routeDiagnostics && typeof runtimeContext.routeDiagnostics === 'object')
    ? runtimeContext.routeDiagnostics
    : {};
  const hasHostedTailscaleRouteEvidence = sessionKind === 'hosted-web'
    && bridgeTransportTruth.bridgeMemoryTransport === 'tailscale'
    && bridgeTransportTruth.bridgeMemoryReconciliationState === 'remembered-revalidated'
    && bridgeTransportTruth.selectedTransport === 'tailscale'
    && bridgeTransportTruth?.tailscale?.accepted === true
    && bridgeTransportTruth?.tailscale?.reachable === true
    && Boolean(bridgeTransportTruth?.tailscale?.backendUrl)
    && backendTargetRouteDiagnostic.available === true
    && backendTargetRouteDiagnostic.target === bridgeTransportTruth.tailscale.backendUrl;
  const canonicalHostedTailscaleRouteEvidence = hasHostedTailscaleRouteEvidence
    ? {
      configured: true,
      available: true,
      usable: true,
      routeVariant: 'home-node-bridge',
      source: 'bridgeTransport:tailscale',
      target: bridgeTransportTruth.tailscale.backendUrl,
      actualTarget: bridgeTransportTruth.tailscale.backendUrl,
      reason: 'Remembered Tailscale bridge revalidated and accepted as hosted route evidence.',
      blockedReason: '',
      backendReachable: true,
      uiReachable: true,
    }
    : null;

  const surfaceAwareness = normalizeSurfaceAwareness(runtimeContext.surfaceAwareness);
  const surfaceRoutingBiasHint = String(surfaceAwareness.effectiveSurfaceExperience?.resolvedRoutingBiasHint || 'auto');
  return {
    frontendOrigin,
    apiBaseUrl,
    baseUrl: apiBaseUrl,
    frontendHost,
    backendHost,
    frontendReachability,
    backendReachability,
    frontendLocal,
    backendLocal,
    deviceContext,
    sessionKind,
    localNodeReachableFromSession: runtimeContext.localNodeReachableFromSession,
    homeNode,
    homeNodeBridge: canonicalHomeNodeBridge,
    bridgeTransportPreferences,
    bridgeTransportTruth,
    publishedClientRouteState: runtimeContext.publishedClientRouteState || 'unknown',
    preferredTarget: compatiblePreferredTarget,
    actualTargetUsed: compatibleActualTarget,
    nodeAddressSource: runtimeContext.nodeAddressSource || (homeNode?.configured ? homeNode.source : '') || (launcherLocal ? 'local-backend-session' : 'route-diagnostics'),
    restoreDecision: String(runtimeContext.restoreDecision || ''),
    routeDiagnostics: {
      ...routeDiagnosticsSource,
      ...(canonicalHostedTailscaleRouteEvidence ? {
        'home-node': {
          ...(routeDiagnosticsSource['home-node'] || {}),
          ...canonicalHostedTailscaleRouteEvidence,
        },
        'home-node-bridge': {
          ...(routeDiagnosticsSource['home-node-bridge'] || {}),
          ...canonicalHostedTailscaleRouteEvidence,
        },
      } : {}),
      'backend-target': backendTargetRouteDiagnostic,
    },
    backendTargetResolutionSource,
    backendTargetResolvedUrl,
    backendTargetFallbackUsed,
    backendTargetInvalidReason,
    backendTargetCandidates: backendTargetCandidateDecisions,
    memoryTruth: runtimeContext.memoryTruth && typeof runtimeContext.memoryTruth === 'object'
      ? runtimeContext.memoryTruth
      : {},
    tileTruth: runtimeContext.tileTruth && typeof runtimeContext.tileTruth === 'object'
      ? runtimeContext.tileTruth
      : {},
    homeNodeOperatorOverrideActive: runtimeContext.homeNodeOperatorOverrideActive === true,
    homeNodeOperatorOverrideNodeConfigured: runtimeContext.homeNodeOperatorOverrideNodeConfigured === true,
    loopbackBackendMismatch,
    surfaceAwareness,
    surfaceRoutingBiasHint,
  };
}

function orderedProviders(primaryOrder = [], fallbackOrder = []) {
  return [...new Set([
    ...primaryOrder,
    ...normalizeFallbackOrder(fallbackOrder),
    ...Object.keys(PROVIDER_DEFINITIONS),
  ])].filter((providerKey) => PROVIDER_DEFINITIONS[providerKey]);
}

export function readPersistedProviderPreferences(storage = globalThis?.localStorage) {
  const defaults = {
    selectedProvider: DEFAULT_PROVIDER_KEY,
    routeMode: DEFAULT_ROUTE_MODE,
    fallbackEnabled: true,
    fallbackOrder: [...FALLBACK_PROVIDER_KEYS],
  };

  if (!isBrowserStorageAvailable(storage)) {
    return defaults;
  }

  const persistedSession = readPersistedStephanosSessionMemory(storage);
  const persistedProviderPreferences = persistedSession?.session?.providerPreferences;
  if (persistedProviderPreferences) {
    return {
      selectedProvider: normalizeProviderSelection(persistedProviderPreferences.provider),
      routeMode: normalizeRouteMode(persistedProviderPreferences.routeMode),
      fallbackEnabled: persistedProviderPreferences.fallbackEnabled !== false,
      fallbackOrder: normalizeFallbackOrder(persistedProviderPreferences.fallbackOrder),
    };
  }

  try {
    const parsed = JSON.parse(storage.getItem(AI_SETTINGS_STORAGE_KEY) || '{}');
    return {
      selectedProvider: normalizeProviderSelection(parsed.provider),
      routeMode: normalizeRouteMode(parsed.routeMode),
      fallbackEnabled: parsed.fallbackEnabled !== false,
      fallbackOrder: normalizeFallbackOrder(parsed.fallbackOrder),
    };
  } catch {
    return defaults;
  }
}

export function getReadyCloudProviders(providerHealth = {}, fallbackOrder = FALLBACK_PROVIDER_KEYS) {
  const health = normalizeProviderHealth(providerHealth);
  return orderedProviders(CLOUD_FIRST_PROVIDER_KEYS, fallbackOrder)
    .filter((providerKey) => CLOUD_PROVIDER_KEYS.includes(providerKey))
    .filter((providerKey) => health[providerKey]?.ok);
}

function getReadyLocalProviders(providerHealth = {}) {
  const health = normalizeProviderHealth(providerHealth);
  return LOCAL_PROVIDER_KEYS.filter((providerKey) => health[providerKey]?.ok);
}

function chooseAutoRouteMode({ runtimeContext, localAvailable, cloudAvailable }) {
  const surfaceRoutingBiasHint = String(runtimeContext.surfaceRoutingBiasHint || '').trim().toLowerCase();
  if (surfaceRoutingBiasHint === 'local-first' && localAvailable) return 'local-first';
  if (surfaceRoutingBiasHint === 'cloud-first' && cloudAvailable) return 'cloud-first';

  if (runtimeContext.sessionKind === 'hosted-web') {
    if (
      runtimeContext.deviceContext === 'lan-companion'
      && runtimeContext.homeNode?.reachable === true
      && localAvailable
    ) {
      return 'local-first';
    }
    if (cloudAvailable) return 'cloud-first';
    if (localAvailable) return 'local-first';
    return 'cloud-first';
  }

  if (runtimeContext.deviceContext === 'lan-companion') {
    if (localAvailable) return 'local-first';
    if (cloudAvailable) return 'cloud-first';
    return 'local-first';
  }

  if (localAvailable) return 'local-first';
  if (cloudAvailable) return 'cloud-first';
  return 'local-first';
}

function reconcileHostedSelectedProvider({
  runtimeContext = {},
  selectedProvider = DEFAULT_PROVIDER_KEY,
  requestedProvider = DEFAULT_PROVIDER_KEY,
  finalRoute = {},
  routePlan = {},
} = {}) {
  if (runtimeContext.sessionKind !== 'hosted-web') {
    return selectedProvider;
  }

  const selectedIsLocal = LOCAL_PROVIDER_KEYS.includes(selectedProvider);
  const localEligible = finalRoute?.providerEligibility?.localProviders === true;
  const cloudEligible = finalRoute?.providerEligibility?.cloudProviders === true;
  const preferredCloud = routePlan?.readyCloudProviders?.[0]
    || (CLOUD_PROVIDER_KEYS.includes(requestedProvider) ? requestedProvider : '');

  if (!selectedIsLocal) {
    if (finalRoute?.routeKind === 'cloud' && preferredCloud && !CLOUD_PROVIDER_KEYS.includes(selectedProvider)) {
      return preferredCloud;
    }
    return selectedProvider;
  }

  if (localEligible) {
    return selectedProvider;
  }

  if (cloudEligible && preferredCloud) {
    return preferredCloud;
  }

  if (CLOUD_PROVIDER_KEYS.includes(requestedProvider)) {
    return requestedProvider;
  }

  return selectedProvider === 'ollama' ? 'groq' : selectedProvider;
}

function getPreferredLocalFailure(providerHealth = {}) {
  const health = normalizeProviderHealth(providerHealth);
  for (const providerKey of LOCAL_PROVIDER_KEYS) {
    const providerState = health[providerKey];
    if (!providerState || providerState.ok) {
      continue;
    }

    const detail = String(
      providerState.reason
      || providerState.detail
      || providerState.message
      || providerState.failureReason
      || '',
    ).trim();
    const label = PROVIDER_DEFINITIONS[providerKey]?.label || providerKey;
    return detail ? `${label} unavailable: ${detail}` : `${label} unavailable`;
  }

  return 'Local Ollama unavailable';
}

function deriveRoutePlan({
  selectedProvider = DEFAULT_PROVIDER_KEY,
  routeMode = DEFAULT_ROUTE_MODE,
  fallbackEnabled = true,
  fallbackOrder = FALLBACK_PROVIDER_KEYS,
  providerHealth = {},
  runtimeContext = {},
} = {}) {
  const normalizedProvider = normalizeProviderSelection(selectedProvider);
  const normalizedRouteMode = normalizeRouteMode(routeMode);
  const health = normalizeProviderHealth(providerHealth);
  const readyLocalProviders = getReadyLocalProviders(health);
  const readyCloudProviders = getReadyCloudProviders(health, fallbackOrder);
  const localAvailable = readyLocalProviders.length > 0;
  const cloudAvailable = readyCloudProviders.length > 0;
  const effectiveRouteMode = normalizedRouteMode === 'auto'
    ? chooseAutoRouteMode({ runtimeContext, localAvailable, cloudAvailable })
    : normalizedRouteMode;

  let preferredOrder;
  if (effectiveRouteMode === 'explicit') {
    preferredOrder = [normalizedProvider];
  } else if (effectiveRouteMode === 'cloud-first') {
    preferredOrder = CLOUD_FIRST_PROVIDER_KEYS;
  } else {
    preferredOrder = LOCAL_FIRST_PROVIDER_KEYS;
  }

  const attemptOrder = orderedProviders(preferredOrder, fallbackEnabled ? fallbackOrder : [])
    .filter((providerKey) => {
      if (providerKey === 'openrouter') {
        return Boolean(health.openrouter?.config?.enabled || health.openrouter?.ok);
      }
      return true;
    });

  const selectedFromHealth = effectiveRouteMode === 'explicit'
    ? normalizedProvider
    : attemptOrder.find((providerKey) => health[providerKey]?.ok) || attemptOrder[0] || normalizedProvider;

  return {
    requestedProvider: normalizedProvider,
    requestedRouteMode: normalizedRouteMode,
    effectiveRouteMode,
    selectedProvider: selectedFromHealth,
    attemptOrder: effectiveRouteMode === 'explicit' ? [normalizedProvider] : attemptOrder,
    readyLocalProviders,
    readyCloudProviders,
    localAvailable,
    cloudAvailable,
  };
}

function asTriState(value) {
  if (value === true) return 'reachable';
  if (value === false) return 'unreachable';
  return 'unknown';
}

function toLatency(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getRouteLatencyMs(route = {}) {
  return toLatency(route.latencyMs ?? route.latency_ms ?? route.latency);
}

function createRouteCandidate({
  candidateKey = '',
  routeKind = 'unavailable',
  transportKind = 'none',
  configured = false,
  reachable = false,
  usable = false,
  selected = false,
  active = false,
  score = -1,
  latencyMs = null,
  reason = '',
  source = '',
  blockedReason = '',
  truthWarnings = [],
  lastCheckedAt = '',
  rank = 0,
} = {}) {
  return {
    candidateKey: String(candidateKey || routeKind || 'unknown'),
    routeKind: String(routeKind || 'unavailable'),
    transportKind: String(transportKind || 'none'),
    configured: configured === true,
    reachable: reachable === true,
    usable: usable === true,
    selected: selected === true,
    active: active === true,
    score: Number.isFinite(Number(score)) ? Number(score) : -1,
    rank: Number.isFinite(Number(rank)) ? Number(rank) : 0,
    latencyMs: toLatency(latencyMs),
    reason: String(reason || ''),
    source: String(source || 'route-diagnostics'),
    blockedReason: String(blockedReason || ''),
    truthWarnings: Array.isArray(truthWarnings) ? truthWarnings.filter(Boolean).map((entry) => String(entry)) : [],
    lastCheckedAt: String(lastCheckedAt || ''),
  };
}

function getCandidateBasePriority(candidateKey = '', runtimeContext = {}) {
  const sessionKind = runtimeContext.sessionKind || 'unknown';
  const deviceContext = runtimeContext.deviceContext || 'unknown';
  if (sessionKind === 'local-desktop' || deviceContext === 'pc-local-browser') {
    return {
      'local-desktop': 1000,
      'home-node-manual': 860,
      'home-node-tailscale': 820,
      cloud: 720,
      'dist-fallback': 80,
      'home-node-wireguard': 20,
    }[candidateKey] ?? 0;
  }
  if (deviceContext === 'lan-companion') {
    return {
      'home-node-manual': 980,
      'home-node-tailscale': 900,
      cloud: 760,
      'dist-fallback': 90,
      'local-desktop': 40,
      'home-node-wireguard': 20,
    }[candidateKey] ?? 0;
  }
  return {
    'home-node-tailscale': 980,
    'home-node-manual': 930,
    cloud: 780,
    'dist-fallback': 95,
    'local-desktop': 35,
    'home-node-wireguard': 20,
  }[candidateKey] ?? 0;
}

function scoreRouteCandidate(candidate = {}, runtimeContext = {}) {
  const base = getCandidateBasePriority(candidate.candidateKey, runtimeContext);
  if (!candidate.configured) return -4000 + base;
  if (!candidate.reachable) return -3000 + base;
  if (!candidate.usable) return -2000 + base;
  const latencyPenalty = candidate.latencyMs === null ? 0 : Math.min(200, Math.round(candidate.latencyMs / 5));
  return base - latencyPenalty;
}

function buildRouteCandidates({ runtimeContext = {}, evaluations = {}, preferenceOrder = [] } = {}) {
  const selectedTransport = normalizeBridgeTransportSelection(runtimeContext.bridgeTransportPreferences?.selectedTransport);
  const bridgeTruth = runtimeContext.bridgeTransportTruth || {};
  const localDesktop = evaluations['local-desktop'] || {};
  const homeNode = evaluations['home-node'] || {};
  const homeNodeBridge = evaluations['home-node-bridge'] || {};
  const cloud = evaluations.cloud || {};
  const dist = evaluations.dist || {};
  const wireguardConfigured = runtimeContext.bridgeTransportPreferences?.transports?.wireguard?.enabled === true;
  const tailscaleReachability = bridgeTruth?.tailscale?.reachable === true;
  const tailscaleUsable = bridgeTruth?.tailscale?.usable === true && homeNodeBridge.usable === true;
  const manualConfigured = runtimeContext.bridgeTransportPreferences?.transports?.manual?.enabled !== false
    && Boolean(runtimeContext.bridgeTransportPreferences?.transports?.manual?.backendUrl || runtimeContext.homeNodeBridge?.backendUrl);
  const homeNodeSource = String(homeNode.routeVariant || homeNode.source || '').trim();
  const hostedSession = runtimeContext.sessionKind === 'hosted-web';
  const hostedManualProbe = runtimeContext.routeDiagnostics?.['home-node-lan'] || {};
  const hostedManualEvidence = hostedManualProbe.available === true || hostedManualProbe.usable === true;
  const homeNodeBridgeBacked = homeNodeSource.includes('bridge');
  const hostedCanonicalTailscale = hostedSession
    && bridgeTruth.selectedTransport === 'tailscale'
    && bridgeTruth?.tailscale?.accepted === true
    && bridgeTruth?.tailscale?.reachable === true;
  const manualReachable = hostedSession
    ? (hostedManualEvidence || (homeNode.available === true && (!hostedCanonicalTailscale || !homeNodeBridgeBacked)))
    : (homeNode.available === true || homeNodeBridge.available === true);
  const manualUsable = hostedSession
    ? (hostedManualEvidence || (homeNode.usable === true && (!hostedCanonicalTailscale || !homeNodeBridgeBacked)))
    : (homeNode.usable === true);

  const candidates = [
    createRouteCandidate({
      candidateKey: 'local-desktop',
      routeKind: 'local-desktop',
      transportKind: 'direct',
      configured: localDesktop.configured === true,
      reachable: localDesktop.available === true,
      usable: localDesktop.usable === true,
      selected: preferenceOrder[0] === 'local-desktop',
      latencyMs: getRouteLatencyMs(localDesktop),
      reason: localDesktop.reason || '',
      source: localDesktop.source || '',
      blockedReason: localDesktop.blockedReason || '',
      lastCheckedAt: runtimeContext.lastHealthCheckAt || '',
    }),
    createRouteCandidate({
      candidateKey: 'home-node-manual',
      routeKind: 'home-node',
      transportKind: 'manual',
      configured: homeNode.configured === true || manualConfigured,
      reachable: manualReachable,
      usable: manualUsable,
      selected: selectedTransport === 'manual',
      latencyMs: getRouteLatencyMs(homeNode),
      reason: homeNode.reason || runtimeContext.homeNodeBridge?.reason || '',
      source: homeNode.source || runtimeContext.homeNode?.source || 'manual',
      blockedReason: homeNode.blockedReason || '',
      lastCheckedAt: runtimeContext.lastHealthCheckAt || '',
    }),
    createRouteCandidate({
      candidateKey: 'home-node-tailscale',
      routeKind: 'home-node',
      transportKind: 'tailscale',
      configured: runtimeContext.bridgeTransportPreferences?.transports?.tailscale?.enabled === true
        && Boolean(runtimeContext.bridgeTransportPreferences?.transports?.tailscale?.backendUrl),
      reachable: tailscaleReachability,
      usable: tailscaleUsable,
      selected: selectedTransport === 'tailscale',
      latencyMs: getRouteLatencyMs(homeNodeBridge),
      reason: bridgeTruth?.tailscale?.reason || homeNodeBridge.reason || '',
      source: bridgeTruth?.source || homeNodeBridge.source || 'bridgeTransport:tailscale',
      blockedReason: homeNodeBridge.blockedReason || (!tailscaleReachability ? 'tailscale transport unreachable' : ''),
      truthWarnings: bridgeTruth?.tailscale?.diagnostics || [],
      lastCheckedAt: runtimeContext.lastHealthCheckAt || '',
    }),
    createRouteCandidate({
      candidateKey: 'home-node-wireguard',
      routeKind: 'home-node',
      transportKind: 'wireguard',
      configured: wireguardConfigured,
      reachable: false,
      usable: false,
      selected: selectedTransport === 'wireguard',
      reason: 'WireGuard transport is planned and not probe-capable.',
      source: 'bridgeTransport:wireguard',
      blockedReason: 'planned transport placeholder only',
      truthWarnings: ['wireguard-planned-not-active'],
    }),
    createRouteCandidate({
      candidateKey: 'cloud',
      routeKind: 'cloud',
      transportKind: 'internet',
      configured: cloud.configured === true,
      reachable: cloud.available === true,
      usable: cloud.usable === true,
      selected: preferenceOrder[0] === 'cloud',
      latencyMs: getRouteLatencyMs(cloud),
      reason: cloud.reason || '',
      source: cloud.source || '',
      blockedReason: cloud.blockedReason || '',
      lastCheckedAt: runtimeContext.lastHealthCheckAt || '',
    }),
    createRouteCandidate({
      candidateKey: 'dist-fallback',
      routeKind: 'dist',
      transportKind: 'bundled-dist',
      configured: dist.configured === true,
      reachable: dist.available === true,
      usable: dist.usable === true,
      selected: preferenceOrder[0] === 'dist',
      latencyMs: getRouteLatencyMs(dist),
      reason: dist.reason || '',
      source: dist.source || '',
      blockedReason: dist.blockedReason || '',
      lastCheckedAt: runtimeContext.lastHealthCheckAt || '',
    }),
  ].map((candidate) => ({ ...candidate, score: scoreRouteCandidate(candidate, runtimeContext) }));

  const ranked = [...candidates]
    .sort((a, b) => (b.score - a.score) || a.candidateKey.localeCompare(b.candidateKey))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const winner = ranked.find((candidate) => candidate.usable === true) || null;
  const withActive = ranked.map((candidate) => ({ ...candidate, active: winner?.candidateKey === candidate.candidateKey }));
  const autoSwitch = runtimeContext.finalRoute?.routeKind
    && winner
    && runtimeContext.finalRoute.routeKind !== winner.routeKind;
  return {
    candidates: withActive,
    winner,
    autoSwitch: autoSwitch === true,
    autoSwitchReason: autoSwitch
      ? `Auto-switched from ${runtimeContext.finalRoute.routeKind} to ${winner.routeKind} based on deterministic route scoring.`
      : '',
    selectionSource: winner ? 'runtime-truth-adjudication' : 'no-usable-route',
  };
}


function buildRoutePreference(runtimeContext = {}) {
  const homeNodeDiagnostic = runtimeContext.routeDiagnostics?.['home-node'] || {};
  const bridgeDiagnostic = runtimeContext.routeDiagnostics?.['home-node-bridge'] || {};
  const hostedBridgeReady = runtimeContext.sessionKind === 'hosted-web'
    && runtimeContext.deviceContext !== 'lan-companion'
    && (
      String(homeNodeDiagnostic.routeVariant || '').includes('bridge')
      || bridgeDiagnostic.available === true
      || runtimeContext.homeNodeBridge?.reachability === 'reachable'
    );
  if (runtimeContext.deviceContext === 'pc-local-browser') {
    return ['local-desktop', 'home-node', 'cloud', 'dist'];
  }

  if (runtimeContext.routeDiagnostics?.['local-desktop']?.configured === true && runtimeContext.backendLocal) {
    return ['local-desktop', 'home-node', 'cloud', 'dist'];
  }

  if (runtimeContext.deviceContext === 'lan-companion') {
    return ['home-node', 'cloud', 'dist', 'local-desktop'];
  }

  if (hostedBridgeReady) {
    return ['home-node', 'cloud', 'dist', 'local-desktop'];
  }

  return ['cloud', 'home-node', 'local-desktop', 'dist'];
}

function createRouteEvaluation(routeKey, defaults = {}, override = {}) {
  const merged = { ...defaults, ...(override && typeof override === 'object' ? override : {}) };
  return {
    kind: routeKey,
    available: Boolean(merged.available),
    configured: merged.configured !== false,
    misconfigured: Boolean(merged.misconfigured),
    optional: Boolean(merged.optional),
    target: typeof merged.target === 'string' ? merged.target : '',
    actualTarget: typeof merged.actualTarget === 'string' ? merged.actualTarget : '',
    routeVariant: String(merged.routeVariant || ''),
    source: String(merged.source || 'route-diagnostics'),
    reason: String(merged.reason || ''),
    blockedReason: String(merged.blockedReason || ''),
    backendReachable: merged.backendReachable === true ? true : (merged.backendReachable === false ? false : null),
    uiReachable: merged.uiReachable === true ? true : (merged.uiReachable === false ? false : null),
    usable: merged.usable !== false && Boolean(merged.available),
  };
}

function deriveFallbackSuppressionReason(routeKey, evaluations, preferenceOrder = []) {
  const preferredLiveRoutes = preferenceOrder
    .filter((candidate) => candidate !== routeKey && candidate !== 'dist');

  for (const candidate of preferredLiveRoutes) {
    const evaluation = evaluations[candidate];
    if (!evaluation?.configured) {
      continue;
    }

    if (evaluation.available) {
      return `${candidate} is a valid live route and outranks ${routeKey}`;
    }

    if (evaluation.blockedReason) {
      return `${candidate} unavailable: ${evaluation.blockedReason}`;
    }

    if (evaluation.reason) {
      return `${candidate} unavailable: ${evaluation.reason}`;
    }
  }

  return '';
}

function deriveRouteEvaluations({ runtimeContext, backendAvailable, cloudAvailable, validationState }) {
  const diagnostics = runtimeContext.routeDiagnostics || {};
  const localDesktopDiagnosticEligible = diagnostics['local-desktop']?.configured === true
    && runtimeContext.backendLocal;
  const localDesktopSession = runtimeContext.deviceContext === 'pc-local-browser'
    || runtimeContext.sessionKind === 'local-desktop'
    || localDesktopDiagnosticEligible;
  const hostedCloudSession = runtimeContext.sessionKind === 'hosted-web' && backendAvailable && cloudAvailable;
  const homeNodeConfigured = Boolean(runtimeContext.homeNode?.configured);
  const homeNodeReachable = Boolean(runtimeContext.homeNode?.reachable);
  const homeNodeOverrideActive = runtimeContext.homeNodeOperatorOverrideActive === true && localDesktopSession;
  const homeNodeConfiguredOverride = diagnostics['home-node'] && typeof diagnostics['home-node'].configured === 'boolean'
    ? diagnostics['home-node'].configured
    : undefined;
  const effectiveHomeNodeConfigured = homeNodeOverrideActive
    ? false
    : (homeNodeConfiguredOverride ?? homeNodeConfigured);
  const localDesktopProbe = diagnostics['local-desktop'] || {};
  const homeNodeProbe = diagnostics['home-node'] || {};
  const backendTargetProbe = diagnostics['backend-target'] || {};
  const homeNodeBridgeProbe = diagnostics['home-node-bridge'] || {};
  const bridgeReachable = homeNodeBridgeProbe.available === true
    || runtimeContext.homeNodeBridge?.reachability === 'reachable'
    || runtimeContext.bridgeTransportTruth?.tailscale?.reachable === true;
  const hostedExecutionCompatibility = String(runtimeContext.bridgeTransportTruth?.bridgeHostedExecutionCompatibility || '').trim();
  const hostedExecutionIncompatible = runtimeContext.sessionKind === 'hosted-web'
    && runtimeContext.bridgeTransportTruth?.bridgeMemoryReconciliationState === 'remembered-execution-incompatible'
    && ['mixed-scheme-blocked', 'cors-blocked'].includes(hostedExecutionCompatibility);
  const hostedExecutionBlockedReason = String(
    runtimeContext.bridgeTransportTruth?.bridgeHostedExecutionReason
    || runtimeContext.bridgeTransportTruth?.bridgeMemoryReconciliationReason
    || 'Hosted surface can reach remembered bridge, but browser execution policy blocks this target.',
  ).trim();
  const hostedResolvedBackendCandidate = runtimeContext.sessionKind === 'hosted-web'
    && runtimeContext.deviceContext === 'lan-companion'
    && backendAvailable
    && backendTargetProbe.available === true
    && isLikelyLanHost(parseHostname(runtimeContext.backendTargetResolvedUrl || ''))
    && Boolean(runtimeContext.backendTargetResolvedUrl);
  const effectiveHomeNodeReachable = (effectiveHomeNodeConfigured
    && (homeNodeReachable || homeNodeProbe.available === true || bridgeReachable))
    || hostedResolvedBackendCandidate;
  const homeNodeMisconfigured = homeNodeReachable && runtimeContext.publishedClientRouteState === 'misconfigured';
  const homeNodePublicationBlocked = homeNodeProbe.misconfigured === true
    || (homeNodeProbe.backendReachable === true && homeNodeProbe.uiReachable === false);
  const distProbe = diagnostics.dist || {};
  const localDesktopAvailable = localDesktopSession && backendAvailable;
  const localDesktopProbeAvailable = localDesktopProbe.available === true;
  const localDesktopClassificationFailed = localDesktopSession && backendAvailable && localDesktopProbe.available === false;
  const localDesktopSource = localDesktopProbe.source && localDesktopProbe.source !== 'not-applicable'
    ? localDesktopProbe.source
    : (runtimeContext.backendLocal ? 'local-backend-session' : 'local-browser-session');
  const localDesktopReadyReason = localDesktopProbeAvailable
    ? 'Backend online and local desktop route probe succeeded'
    : (runtimeContext.backendLocal
      ? 'Backend online locally; local-desktop stays valid and will use bundled dist UI until a live UI probe is available'
      : 'Backend online from local desktop session; using bundled dist UI until a live UI probe is published');
  const localDesktopProbeGapBlockedReason = 'backend is online locally, but no explicit live UI route was published';
  const localDesktopBlockedReason = localDesktopProbeAvailable
    ? ''
    : localDesktopProbeGapBlockedReason;
  const localDesktopExplicitBlockedReason = String(localDesktopProbe.blockedReason || '').trim();
  const localDesktopHasExplicitBlocker = Boolean(
    localDesktopExplicitBlockedReason
    && localDesktopExplicitBlockedReason !== localDesktopProbeGapBlockedReason,
  );
  const localDesktopUsable = localDesktopAvailable && !(
    localDesktopProbe.usable === false
    && localDesktopHasExplicitBlocker
  );

  const evaluations = {
    'local-desktop': createRouteEvaluation('local-desktop', {
      configured: localDesktopSession,
      available: localDesktopAvailable,
      misconfigured: localDesktopClassificationFailed,
      optional: runtimeContext.deviceContext !== 'pc-local-browser',
      source: localDesktopSession ? localDesktopSource : 'not-applicable',
      reason: localDesktopSession
        ? (backendAvailable
          ? localDesktopReadyReason
          : 'Local desktop browser detected, but the backend is offline')
        : 'Current session is not a local desktop browser',
      blockedReason: localDesktopSession
        ? (backendAvailable
          ? (localDesktopProbe.blockedReason || localDesktopBlockedReason)
          : 'backend is offline')
        : 'not a local desktop session',
      usable: localDesktopUsable,
    }, {
      ...localDesktopProbe,
      available: localDesktopAvailable,
      misconfigured: localDesktopClassificationFailed || Boolean(localDesktopProbe.misconfigured),
      source: localDesktopSession ? localDesktopSource : 'not-applicable',
      reason: localDesktopProbe.reason || (localDesktopSession
        ? (backendAvailable
          ? localDesktopReadyReason
          : 'Local desktop browser detected, but the backend is offline')
        : 'Current session is not a local desktop browser'),
      blockedReason: localDesktopProbe.blockedReason || (localDesktopSession
        ? (backendAvailable
          ? localDesktopBlockedReason
          : 'backend is offline')
        : 'not a local desktop session'),
      usable: localDesktopUsable,
    }),
    'home-node': createRouteEvaluation('home-node', {
      configured: effectiveHomeNodeConfigured || hostedResolvedBackendCandidate,
      available: effectiveHomeNodeReachable,
      misconfigured: effectiveHomeNodeReachable && homeNodeMisconfigured,
      optional: runtimeContext.deviceContext === 'pc-local-browser',
      source: homeNodeOverrideActive
        ? 'local-operator-override'
        : hostedResolvedBackendCandidate
        ? (runtimeContext.backendTargetResolutionSource || 'backend-target-candidate')
        : (runtimeContext.homeNode?.source || (effectiveHomeNodeConfigured ? 'configured-home-node' : 'not-configured')),
      reason: homeNodeOverrideActive
        ? 'Home-node/manual route source ignored for this local browser session by operator override.'
        : hostedExecutionIncompatible
        ? hostedExecutionBlockedReason
        : effectiveHomeNodeReachable
        ? (homeNodeMisconfigured
          ? 'Home PC node is reachable, but the published client route is misconfigured'
          : (homeNodeProbe.reason || 'Home PC node is reachable on the LAN'))
        : (effectiveHomeNodeConfigured
          ? 'Home PC node is configured but currently unreachable'
          : 'Home PC node is not configured'),
      blockedReason: homeNodeOverrideActive
        ? 'home-node/manual route source ignored by local operator override'
        : hostedExecutionIncompatible
        ? hostedExecutionBlockedReason
        : effectiveHomeNodeConfigured
        ? (homeNodeProbe.blockedReason || (effectiveHomeNodeReachable ? '' : 'health probe could not confirm the home-node route'))
        : 'home node is not configured',
      usable: !hostedExecutionIncompatible && effectiveHomeNodeReachable && !homeNodePublicationBlocked,
    }, {
      ...homeNodeProbe,
      configured: effectiveHomeNodeConfigured || hostedResolvedBackendCandidate,
      available: effectiveHomeNodeReachable,
      misconfigured: effectiveHomeNodeReachable && (homeNodeMisconfigured || Boolean(homeNodeProbe.misconfigured)),
      source: homeNodeOverrideActive
        ? 'local-operator-override'
        : hostedResolvedBackendCandidate
        ? (runtimeContext.backendTargetResolutionSource || 'backend-target-candidate')
        : (homeNodeProbe.source || runtimeContext.homeNode?.source || (effectiveHomeNodeConfigured ? 'configured-home-node' : 'not-configured')),
      reason: homeNodeOverrideActive
        ? 'Home-node/manual route source ignored for this local browser session by operator override.'
        : hostedExecutionIncompatible
        ? hostedExecutionBlockedReason
        : homeNodeProbe.reason || (effectiveHomeNodeReachable
        ? (homeNodeMisconfigured
          ? 'Home PC node is reachable, but the published client route is misconfigured'
          : 'Home PC node is reachable on the LAN')
        : (effectiveHomeNodeConfigured
          ? 'Home PC node is configured but currently unreachable'
          : 'Home PC node is not configured')),
      blockedReason: homeNodeOverrideActive
        ? 'home-node/manual route source ignored by local operator override'
        : hostedExecutionIncompatible
        ? hostedExecutionBlockedReason
        : homeNodeProbe.blockedReason || (effectiveHomeNodeConfigured
        ? (effectiveHomeNodeReachable ? '' : 'health probe could not confirm the home-node route')
        : 'home node is not configured'),
      usable: homeNodeProbe.usable === false
        ? false
        : (!hostedExecutionIncompatible && effectiveHomeNodeReachable && !homeNodePublicationBlocked),
    }),
    'home-node-bridge': createRouteEvaluation('home-node-bridge', {
      configured: homeNodeBridgeProbe.configured === true || runtimeContext.homeNodeBridge?.configured === true,
      available: bridgeReachable,
      misconfigured: homeNodeBridgeProbe.misconfigured === true || (homeNodeBridgeProbe.configured === true && homeNodeBridgeProbe.available !== true),
      optional: runtimeContext.sessionKind !== 'hosted-web',
      target: homeNodeBridgeProbe.target || runtimeContext.bridgeTransportTruth?.tailscale?.backendUrl || runtimeContext.homeNodeBridge?.backendUrl || '',
      actualTarget: homeNodeBridgeProbe.actualTarget || runtimeContext.bridgeTransportTruth?.tailscale?.backendUrl || runtimeContext.homeNodeBridge?.backendUrl || '',
      source: homeNodeBridgeProbe.source || runtimeContext.bridgeTransportTruth?.source || 'home-node-bridge',
      reason: homeNodeBridgeProbe.reason || runtimeContext.bridgeTransportTruth?.detail || (bridgeReachable ? 'Home-node bridge configured and reachable' : 'Home-node bridge unavailable'),
      blockedReason: hostedExecutionIncompatible
        ? hostedExecutionBlockedReason
        : (homeNodeBridgeProbe.blockedReason || (bridgeReachable ? '' : 'home-node bridge unavailable')),
      backendReachable: bridgeReachable,
      uiReachable: bridgeReachable,
      usable: !hostedExecutionIncompatible && bridgeReachable,
    }, homeNodeBridgeProbe),
    dist: createRouteEvaluation('dist', {
      configured: Boolean(distProbe.configured),
      available: Boolean(distProbe.available),
      misconfigured: false,
      optional: false,
      target: typeof distProbe.target === 'string' ? distProbe.target : '',
      actualTarget: typeof distProbe.actualTarget === 'string' ? distProbe.actualTarget : '',
      source: distProbe.source || 'dist-entry',
      reason: distProbe.reason || 'Bundled dist runtime is not the active route',
      blockedReason: '',
    }, distProbe),
    cloud: createRouteEvaluation('cloud', {
      configured: diagnostics.cloud?.configured === true || hostedCloudSession,
      available: diagnostics.cloud?.available === true || hostedCloudSession,
      misconfigured: false,
      optional: false,
      target: typeof diagnostics.cloud?.target === 'string' ? diagnostics.cloud.target : '',
      actualTarget: typeof diagnostics.cloud?.actualTarget === 'string' ? diagnostics.cloud.actualTarget : '',
      source: diagnostics.cloud?.source || (hostedCloudSession ? 'backend-cloud-session' : 'cloud-route-unavailable'),
      reason: hostedCloudSession
        ? 'A cloud-backed Stephanos route is ready'
        : 'No cloud-backed Stephanos route is currently ready',
      blockedReason: hostedCloudSession ? '' : 'no cloud-backed route is currently ready',
    }, diagnostics.cloud),
  };

  const preferenceOrder = buildRoutePreference(runtimeContext);
  if (evaluations.dist.available && !evaluations.dist.reason) {
    evaluations.dist.reason = 'Bundled dist runtime is reachable';
  }
  if (evaluations.dist.available) {
    const suppressionReason = deriveFallbackSuppressionReason('dist', evaluations, preferenceOrder);
    if (suppressionReason) {
      evaluations.dist.blockedReason = suppressionReason;
      evaluations.dist.reason = `${evaluations.dist.reason || 'Bundled dist runtime is reachable'} · fallback only because ${suppressionReason}`;
    }
  }

  const candidateTruth = buildRouteCandidates({
    runtimeContext,
    evaluations,
    preferenceOrder,
  });
  const winnerRouteKey = candidateTruth.winner?.routeKind === 'home-node'
    ? 'home-node'
    : candidateTruth.winner?.routeKind;
  const preferredRoute = winnerRouteKey || preferenceOrder.find((routeKey) => evaluations[routeKey]?.available) || null;

  return {
    evaluations,
    preferenceOrder,
    preferredRoute,
    localDesktopClassificationFailed,
    candidateTruth,
  };
}

function summarizeSelectedRoute(routeKey, route, runtimeContext, backendAvailable, validationState) {
  if (!routeKey || !route) {
    if (backendAvailable && runtimeContext.frontendLocal) {
      return {
        headline: 'Backend online but route classification failed',
        summary: 'Backend online, but Stephanos could not classify a valid route explicitly',
      };
    }

    const homeNodeBlockedReason = runtimeContext.routeDiagnostics?.['home-node']?.blockedReason || runtimeContext.routeDiagnostics?.['home-node']?.reason || '';
    if (runtimeContext.homeNode?.configured && homeNodeBlockedReason) {
      return {
        headline: 'Home PC node unavailable',
        summary: `Home PC node unavailable: ${homeNodeBlockedReason}`,
      };
    }

    return {
      headline: 'No reachable Stephanos route',
      summary: 'No reachable Stephanos route',
    };
  }

  if (routeKey === 'local-desktop') {
    return {
      headline: 'Local desktop runtime ready',
      summary: !backendAvailable
        ? 'Local desktop runtime reachable, but backend is offline'
        : route.reason || 'Local desktop runtime ready',
    };
  }

  if (routeKey === 'home-node') {
    return {
      headline: route.misconfigured ? 'Home PC node reachable with route issues' : 'Home PC node ready',
      summary: route.reason || 'Home PC node ready',
    };
  }

  if (routeKey === 'dist') {
    return {
      headline: 'Bundled dist route ready',
      summary: route.reason || 'Bundled dist runtime is reachable',
    };
  }

  if (routeKey === 'cloud') {
    return {
      headline: 'Cloud route ready',
      summary: route.reason || 'Cloud route ready',
    };
  }

  if (validationState === 'launching') {
    return {
      headline: 'Checking reachable Stephanos route',
      summary: 'Checking reachable Stephanos route',
    };
  }

  return {
    headline: 'No reachable Stephanos route',
    summary: route.reason || 'No reachable Stephanos route',
  };
}

function deriveNodeRoute({ runtimeContext, backendAvailable, cloudAvailable, validationState }) {
  const routeSelection = deriveRouteEvaluations({ runtimeContext, backendAvailable, cloudAvailable, validationState });
  const selectedRouteKey = routeSelection.preferredRoute;
  const selectedRoute = selectedRouteKey ? routeSelection.evaluations[selectedRouteKey] : null;
  const selectedSummary = summarizeSelectedRoute(
    selectedRouteKey,
    selectedRoute,
    runtimeContext,
    backendAvailable,
    validationState,
  );
  const localDesktop = routeSelection.evaluations['local-desktop'];
  const homeNode = routeSelection.evaluations['home-node'];
  const cloud = routeSelection.evaluations.cloud;
  let preferredTarget = runtimeContext.preferredTarget;
  let actualTargetUsed = runtimeContext.actualTargetUsed;

  if (selectedRouteKey === 'local-desktop') {
    preferredTarget = selectedRoute?.target || runtimeContext.actualTargetUsed || runtimeContext.apiBaseUrl || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || runtimeContext.actualTargetUsed || runtimeContext.apiBaseUrl || preferredTarget;
  } else if (selectedRouteKey === 'home-node') {
    preferredTarget = selectedRoute?.target || runtimeContext.homeNode?.backendUrl || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || runtimeContext.homeNode?.backendUrl || runtimeContext.actualTargetUsed || preferredTarget;
  } else if (selectedRouteKey === 'dist') {
    preferredTarget = selectedRoute?.target || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || selectedRoute?.target || runtimeContext.actualTargetUsed || preferredTarget;
  } else if (selectedRouteKey === 'cloud') {
    preferredTarget = selectedRoute?.target || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || selectedRoute?.target || runtimeContext.actualTargetUsed || preferredTarget;
  }

  const nodeAddressSource = selectedRoute?.kind === 'local-desktop'
    ? (selectedRoute.source || runtimeContext.nodeAddressSource || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'))
    : (runtimeContext.homeNode?.configured || runtimeContext.nodeAddressSource)
      ? ((runtimeContext.nodeAddressSource && runtimeContext.nodeAddressSource !== 'route-diagnostics')
        || (runtimeContext.homeNode?.configured && runtimeContext.homeNode?.source)
        ? (runtimeContext.nodeAddressSource || runtimeContext.homeNode?.source || selectedRoute?.source || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'))
        : (selectedRoute?.source || runtimeContext.nodeAddressSource || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics')))
      : (selectedRoute?.source || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'));

  const routeVariant = selectedRoute?.routeVariant
    || (selectedRouteKey === 'home-node'
      ? (String(selectedRoute?.source || '').includes('bridge') ? 'home-node-bridge' : 'home-node-lan')
      : (selectedRouteKey || 'unavailable'));

  return {
    routeKind: selectedRouteKey || 'unavailable',
    routeVariant,
    preferredTarget,
    actualTargetUsed,
    localNodeReachable: Boolean(localDesktop.available || homeNode.available || runtimeContext.localNodeReachableFromSession === true),
    homeNodeReachable: Boolean(homeNode.available),
    cloudRouteReachable: Boolean(cloud.available),
    routeSummary: selectedSummary.summary,
    routeHeadline: selectedSummary.headline,
    nodeAddressSource,
    routeEvaluations: routeSelection.evaluations,
    routePreferenceOrder: routeSelection.preferenceOrder,
    routeCandidates: routeSelection.candidateTruth?.candidates || [],
    routeCandidateWinner: routeSelection.candidateTruth?.winner || null,
    routeSelectionSource: routeSelection.candidateTruth?.selectionSource || 'route-preference-order',
    routeAutoSwitchActive: routeSelection.candidateTruth?.autoSwitch === true,
    routeAutoSwitchReason: routeSelection.candidateTruth?.autoSwitchReason || '',
    preferredRoute: selectedRouteKey,
    winnerReason: selectedRoute?.reason || '',
    classificationFailed: Boolean(routeSelection.localDesktopClassificationFailed || (backendAvailable && !selectedRouteKey)),
  };
}

function buildProviderEligibility({
  routeKind,
  routeEvaluations,
  backendAvailable,
  localAvailable,
  cloudAvailable,
} = {}) {
  const selectedRoute = routeKind ? routeEvaluations?.[routeKind] : null;
  const truthfulBackendReachable = routeKind === 'local-desktop' || routeKind === 'home-node';
  const fallbackOnlyRoute = routeKind === 'dist' || routeKind === 'unavailable';

  return {
    truthfulBackendRoute: truthfulBackendReachable,
    backendMediatedProviders: truthfulBackendReachable && backendAvailable,
    localProviders: truthfulBackendReachable && backendAvailable && localAvailable,
    cloudProviders: (truthfulBackendReachable || routeKind === 'cloud') && (backendAvailable || routeKind === 'cloud') && cloudAvailable,
    distFallbackOnly: routeKind === 'dist',
    mockFallbackOnly: fallbackOnlyRoute,
    selectedRouteAvailable: Boolean(selectedRoute?.available),
  };
}

export function finalizeRuntimeRouteResolution({
  runtimeContext,
  nodeRoute,
  backendAvailable,
  localAvailable,
  cloudAvailable,
} = {}) {
  const selectedRoute = nodeRoute?.preferredRoute ? nodeRoute.routeEvaluations?.[nodeRoute.preferredRoute] : null;
  const actualTarget = nodeRoute?.actualTargetUsed || '';
  const finalRoute = {
    routeKind: nodeRoute?.routeKind || 'unavailable',
    routeVariant: nodeRoute?.routeVariant || nodeRoute?.routeKind || 'unavailable',
    preferredTarget: nodeRoute?.preferredTarget || '',
    actualTarget,
    source: nodeRoute?.nodeAddressSource || runtimeContext?.nodeAddressSource || (runtimeContext?.frontendLocal ? 'local-browser-session' : 'route-diagnostics'),
    reachability: {
      backendAvailable: Boolean(backendAvailable),
      localNodeReachable: Boolean(nodeRoute?.localNodeReachable),
      homeNodeReachable: Boolean(nodeRoute?.homeNodeReachable),
      cloudRouteReachable: Boolean(nodeRoute?.cloudRouteReachable),
      selectedRouteReachable: Boolean(selectedRoute?.available),
    },
    providerEligibility: buildProviderEligibility({
      routeKind: nodeRoute?.routeKind || 'unavailable',
      routeEvaluations: nodeRoute?.routeEvaluations || {},
      backendAvailable,
      localAvailable,
      cloudAvailable,
    }),
    summary: nodeRoute?.routeSummary || '',
    headline: nodeRoute?.routeHeadline || '',
    winnerReason: nodeRoute?.winnerReason || '',
  };

  return finalRoute;
}

export function buildFinalRouteTruth({
  runtimeContext = {},
  nodeRoute = {},
  finalRoute = {},
  routePlan = {},
  backendAvailable = false,
  activeProvider = '',
  routeSelectedProvider = '',
  fallbackActive = false,
  validationState = 'healthy',
  appLaunchState = 'ready',
} = {}) {
  const selectedEvaluation = nodeRoute?.preferredRoute ? nodeRoute.routeEvaluations?.[nodeRoute.preferredRoute] : null;
  const homeNodeEvaluation = nodeRoute?.routeEvaluations?.['home-node'] || {};
  const localEvaluation = nodeRoute?.routeEvaluations?.['local-desktop'] || {};
  const routeKnown = appLaunchState !== 'pending' && (nodeRoute?.routeKind || 'unavailable') !== 'unavailable';
  const uiReachabilityState = routeKnown ? asTriState(selectedEvaluation?.uiReachable) : 'unknown';
  const bridgeTransportTruth = runtimeContext?.bridgeTransportTruth && typeof runtimeContext.bridgeTransportTruth === 'object'
    ? runtimeContext.bridgeTransportTruth
    : {};
  const runtimePersistence = runtimeContext?.persistence && typeof runtimeContext.persistence === 'object'
    ? runtimeContext.persistence
    : {};
  const bridgePersistence = bridgeTransportTruth.persistence && typeof bridgeTransportTruth.persistence === 'object'
    ? bridgeTransportTruth.persistence
    : {};
  const persistence = {
    lastWrite: runtimePersistence.lastWrite || bridgePersistence.lastWrite || null,
    lastSuccessTimestamp: runtimePersistence.lastSuccessTimestamp || bridgePersistence.lastSuccessTimestamp || null,
    lastFailureTimestamp: runtimePersistence.lastFailureTimestamp || bridgePersistence.lastFailureTimestamp || null,
    lastError: runtimePersistence.lastError || bridgePersistence.lastError || null,
    reconciledAcrossSurfaces: runtimePersistence.reconciledAcrossSurfaces === true
      || bridgePersistence.reconciledAcrossSurfaces === true,
  };

  return {
    sessionKind: runtimeContext.sessionKind || 'unknown',
    deviceContext: runtimeContext.deviceContext || 'unknown',
    runtimeModeLabel: nodeRoute?.routeVariant === 'home-node-bridge'
      ? 'home node/bridge'
      : nodeRoute?.routeKind === 'home-node'
      ? 'home node/lan'
      : (runtimeContext.sessionKind === 'hosted-web' ? 'hosted/web' : 'local desktop/dev'),
    requestedRouteMode: routePlan.requestedRouteMode || DEFAULT_ROUTE_MODE,
    effectiveRouteMode: routePlan.effectiveRouteMode || DEFAULT_ROUTE_MODE,
    preferredRoute: nodeRoute?.preferredRoute || 'unavailable',
    routeKind: nodeRoute?.routeKind || 'unavailable',
    selectedRouteKind: nodeRoute?.routeKind || 'unavailable',
    routeVariant: nodeRoute?.routeVariant || nodeRoute?.routeKind || 'unavailable',
    winnerReason: finalRoute?.winnerReason || selectedEvaluation?.reason || '',
    winningReason: finalRoute?.winnerReason || selectedEvaluation?.reason || '',
    winningTransportKind: nodeRoute?.routeCandidateWinner?.transportKind || 'none',
    routeSelectionSource: nodeRoute?.routeSelectionSource || 'route-preference-order',
    routeAutoSwitchActive: nodeRoute?.routeAutoSwitchActive === true,
    routeAutoSwitchReason: nodeRoute?.routeAutoSwitchReason || '',
    preferredTarget: finalRoute?.preferredTarget || '',
    preferredTargetUsed: finalRoute?.preferredTarget || '',
    actualTarget: finalRoute?.actualTarget || '',
    actualTargetUsed: finalRoute?.actualTarget || '',
    source: finalRoute?.source || runtimeContext.nodeAddressSource || 'route-diagnostics',
    backendReachable: Boolean(backendAvailable),
    uiReachabilityState,
    uiReachable: uiReachabilityState === 'reachable',
    selectedRouteReachable: selectedEvaluation?.available === true,
    routeUsable: selectedEvaluation?.usable === true,
    selectedRouteUsable: selectedEvaluation?.usable === true,
    homeNodeUsable: homeNodeEvaluation?.usable === true,
    localRouteUsable: localEvaluation?.usable === true,
    cloudRouteReachable: finalRoute?.reachability?.cloudRouteReachable === true,
    fallbackActive: Boolean(fallbackActive),
    fallbackRouteActive: nodeRoute?.routeKind === 'dist',
    requestedProvider: routePlan.requestedProvider || DEFAULT_PROVIDER_KEY,
    selectedProvider: routeSelectedProvider || routePlan.selectedProvider || DEFAULT_PROVIDER_KEY,
    executedProvider: activeProvider || '',
    validationState,
    appLaunchState,
    operatorAction: selectedEvaluation?.blockedReason || nodeRoute?.routeSummary || '',
    persistence,
  };
}

function buildDependencySummary({
  backendAvailable,
  localAvailable,
  localPending,
  cloudAvailable,
  effectiveRouteMode,
  fallbackActive,
  activeProvider,
  finalRouteTruth,
  nodeRoute,
  providerHealth,
}) {
  const selectedRouteKind = finalRouteTruth?.routeKind || nodeRoute?.preferredRoute || 'unavailable';
  const selectedRoute = nodeRoute.routeEvaluations[selectedRouteKind] || null;
  const localFailureSummary = getPreferredLocalFailure(providerHealth);
  const routeUsable = finalRouteTruth?.routeUsable === true || selectedRoute?.usable === true;
  const executedProvider = finalRouteTruth?.executedProvider || activeProvider || '';
  const selectedProvider = finalRouteTruth?.selectedProvider || '';

  if (!selectedRoute) {
    if (backendAvailable && finalRouteTruth?.sessionKind === 'local-desktop') {
      return 'Backend online, but Stephanos could not classify a valid route explicitly';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Checking local Ollama readiness';
    }

    const homeNodeEvaluation = nodeRoute.routeEvaluations['home-node'];
    if (homeNodeEvaluation?.configured && homeNodeEvaluation?.blockedReason) {
      return `Home PC node unavailable: ${homeNodeEvaluation.blockedReason}`;
    }

    return cloudAvailable ? 'Cloud route ready' : 'No reachable Stephanos route';
  }

  if (selectedRoute.kind === 'home-node') {
    if (String(selectedRoute.routeVariant || selectedRoute.source || '').includes('bridge')) {
      return selectedRoute.reason || 'Home-node bridge route ready';
    }

    if (selectedRoute.misconfigured) {
      return 'Home PC node reachable · published client route misconfigured';
    }

    if (selectedRoute.optional && nodeRoute.routeEvaluations['local-desktop']?.available) {
      return 'Home PC node optional on this device · local desktop route is valid';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Home PC node ready · checking local Ollama readiness';
    }

    if (cloudAvailable && !localAvailable) {
      return `Home PC node ready · ${localFailureSummary} · cloud route ready`;
    }

    return selectedRoute.reason || 'Home PC node ready';
  }

  if (selectedRoute.kind === 'local-desktop') {
    if (!backendAvailable) {
      return 'Local desktop runtime reachable, but backend is offline';
    }

    if (nodeRoute.routeEvaluations['home-node']?.configured && !nodeRoute.routeEvaluations['home-node']?.available) {
      return 'Local desktop runtime ready · optional home-node is unavailable';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Checking local Ollama readiness';
    }

    if (effectiveRouteMode === 'explicit') {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} explicitly selected`;
    }

    if (routeUsable && selectedProvider && executedProvider === 'mock' && selectedProvider !== 'mock') {
      return 'Local desktop route valid; using mock provider fallback';
    }

    if (localAvailable && !fallbackActive) {
      return 'Local Ollama ready';
    }

    if (!localAvailable && cloudAvailable) {
      return `${localFailureSummary} · cloud active because local Ollama is unavailable`;
    }

    if (effectiveRouteMode === 'cloud-first' && cloudAvailable) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} active for cloud routing`;
    }

    if (fallbackActive) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
    }

    if (!localAvailable && !cloudAvailable) {
      return `Local desktop route valid, but ${localFailureSummary.toLowerCase()}; cloud routing is unavailable`;
    }

    return selectedRoute.reason || 'Local desktop runtime ready';
  }

  if (selectedRoute.kind === 'dist') {
    if (selectedRoute.blockedReason) {
      return selectedRoute.reason || `Bundled dist runtime is reachable · fallback only because ${selectedRoute.blockedReason}`;
    }

    return selectedRoute.reason || 'Bundled dist runtime is reachable';
  }

  if (selectedRoute.kind === 'cloud') {
    if (fallbackActive) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
    }

    return selectedRoute.reason || 'Cloud route ready';
  }

  return selectedRoute.reason || 'No reachable Stephanos route';
}

export function createRuntimeStatusModel({
  appId = 'stephanos',
  appName = 'Stephanos OS',
  validationState = 'healthy',
  selectedProvider = DEFAULT_PROVIDER_KEY,
  routeMode = DEFAULT_ROUTE_MODE,
  fallbackEnabled = true,
  fallbackOrder = FALLBACK_PROVIDER_KEYS,
  providerHealth = {},
  backendAvailable = false,
  runtimeContext = {},
  activeProviderHint = '',
  providerMode = undefined,
} = {}) {
  const normalizedProvider = normalizeProviderSelection(selectedProvider);
  const health = normalizeProviderHealth(providerHealth);
  const localPending = LOCAL_PROVIDER_KEYS.some((providerKey) => health[providerKey]?.state === 'SEARCHING');
  const normalizedRuntimeContext = normalizeRuntimeContext(runtimeContext);
  const routePlan = deriveRoutePlan({
    selectedProvider: normalizedProvider,
    routeMode,
    fallbackEnabled,
    fallbackOrder,
    providerHealth: health,
    runtimeContext: normalizedRuntimeContext,
  });

  const nodeRoute = deriveNodeRoute({
    runtimeContext: normalizedRuntimeContext,
    backendAvailable,
    cloudAvailable: routePlan.cloudAvailable,
    validationState,
  });
  const liveRouteAvailable = nodeRoute.routeKind !== 'unavailable';
  const preferredLiveProvider = routePlan.attemptOrder.find((providerKey) => providerKey !== 'mock' && health[providerKey]?.ok)
    || (normalizedProvider !== 'mock' ? normalizedProvider : routePlan.selectedProvider);
  const routeSelectedProvider = routePlan.selectedProvider === 'mock' && normalizedProvider !== 'mock' && liveRouteAvailable
    ? preferredLiveProvider
    : routePlan.selectedProvider;

  const finalRoute = finalizeRuntimeRouteResolution({
    runtimeContext: normalizedRuntimeContext,
    nodeRoute,
    backendAvailable,
    localAvailable: routePlan.localAvailable,
    cloudAvailable: routePlan.cloudAvailable,
  });
  const reconciledRouteSelectedProvider = reconcileHostedSelectedProvider({
    runtimeContext: normalizedRuntimeContext,
    selectedProvider: routeSelectedProvider,
    requestedProvider: routePlan.requestedProvider,
    finalRoute,
    routePlan,
  });
  const hintedProvider = normalizeProviderSelection(activeProviderHint || reconciledRouteSelectedProvider);
  const executableProviderHealthy = Boolean(hintedProvider && health[hintedProvider]?.ok === true);
  const activeProvider = executableProviderHealthy ? hintedProvider : '';

  const activeRouteKind = LOCAL_PROVIDER_KEYS.includes(activeProvider)
    ? 'local'
    : CLOUD_PROVIDER_KEYS.includes(activeProvider)
      ? 'cloud'
      : 'dev';
  const selectedRouteKey = nodeRoute?.preferredRoute || '';
  const selectedEvaluationRaw = selectedRouteKey ? nodeRoute.routeEvaluations?.[selectedRouteKey] : null;
  const hostedCloudExecutionConfirmed = normalizedRuntimeContext.sessionKind === 'hosted-web'
    && selectedRouteKey === 'cloud'
    && selectedEvaluationRaw?.available === true
    && backendAvailable
    && routePlan.cloudAvailable
    && Boolean(activeProvider)
    && CLOUD_PROVIDER_KEYS.includes(activeProvider)
    && health[activeProvider]?.ok === true;
  const hostedCloudOperationalSelection = hostedCloudExecutionConfirmed
    && activeProvider === reconciledRouteSelectedProvider;
  const fallbackActive = Boolean(
    activeProvider
    && reconciledRouteSelectedProvider
    && activeProvider !== reconciledRouteSelectedProvider
    && providerMode !== 'explicit'
    && !hostedCloudOperationalSelection
  );
  if (hostedCloudExecutionConfirmed && selectedRouteKey === 'cloud') {
    nodeRoute.routeEvaluations = {
      ...nodeRoute.routeEvaluations,
      cloud: {
        ...nodeRoute.routeEvaluations.cloud,
        usable: true,
      },
    };
  }
  const selectedEvaluation = selectedRouteKey ? nodeRoute.routeEvaluations?.[selectedRouteKey] : null;
  const canonicalHostedRouteTruth = buildCanonicalHostedRouteTruth({
    runtimeContext: normalizedRuntimeContext,
    selectedRouteKind: selectedRouteKey || 'unavailable',
    selectedRoute: selectedEvaluation || {},
    backendAvailable,
  });
  const selectedRouteReachable = selectedEvaluation?.available === true;
  const selectedRouteUsable = selectedEvaluation?.usable === true;
  const selectedRouteBlocked = Boolean(selectedEvaluation?.blockedReason);
  const hasTileReadinessSignal = Boolean(
    normalizedRuntimeContext?.tileTruth
    && typeof normalizedRuntimeContext.tileTruth === 'object'
    && (
      Object.prototype.hasOwnProperty.call(normalizedRuntimeContext.tileTruth, 'ready')
      || Object.prototype.hasOwnProperty.call(normalizedRuntimeContext.tileTruth, 'executionReady')
      || Object.prototype.hasOwnProperty.call(normalizedRuntimeContext.tileTruth, 'reason')
      || Object.prototype.hasOwnProperty.call(normalizedRuntimeContext.tileTruth, 'blockedReason')
    )
  );
  const tileExecutionReady = normalizedRuntimeContext?.tileTruth?.ready === true
    || normalizedRuntimeContext?.tileTruth?.executionReady === true;
  const tileExecutionExplicitlyBlocked = hasTileReadinessSignal && !tileExecutionReady;
  const hostedCloudLaunchReady = normalizedRuntimeContext.sessionKind === 'hosted-web'
    && selectedRouteKey === 'cloud'
    && selectedRouteReachable
    && selectedRouteUsable
    && !selectedRouteBlocked
    && backendAvailable
    && routePlan.cloudAvailable
    && Boolean(activeProvider)
    && CLOUD_PROVIDER_KEYS.includes(activeProvider)
    && health[activeProvider]?.ok === true
    && !fallbackActive;

  const launchUnavailable = validationState === 'error' && nodeRoute.routeKind === 'unavailable';
  const launchDegraded = !launchUnavailable && (
    validationState === 'launching'
    || (nodeRoute.routeKind === 'unavailable' && !routePlan.cloudAvailable)
    || (nodeRoute.routeKind !== 'cloud' && !backendAvailable)
    || !selectedRouteReachable
    || !selectedRouteUsable
    || tileExecutionExplicitlyBlocked
    || (localPending && routePlan.effectiveRouteMode !== 'cloud-first' && !executableProviderHealthy)
    || (routePlan.effectiveRouteMode === 'local-first' && !routePlan.localAvailable && nodeRoute.routeKind === 'local-desktop')
    || (routePlan.effectiveRouteMode === 'cloud-first' && !routePlan.cloudAvailable)
    || fallbackActive
  ) && !hostedCloudLaunchReady;
  const appLaunchState = launchUnavailable ? 'unavailable' : (launchDegraded ? 'degraded' : 'ready');

  const headline = appLaunchState === 'unavailable'
    ? (nodeRoute.classificationFailed ? 'Backend online but route classification failed' : 'No reachable Stephanos route')
    : nodeRoute.routeHeadline || `${appName} ready with degraded dependencies`;

  const gatedRuntimeContext = enforceHostedRememberedTailscaleRevalidationTruthGate({
    runtimeContext: normalizedRuntimeContext,
    nodeRoute,
    finalRoute,
  });

  const model = {
    appId,
    appName,
    routeMode: routePlan.requestedRouteMode,
    requestedRouteMode: routePlan.requestedRouteMode,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    providerMode: routePlan.effectiveRouteMode,
    selectedProvider: normalizedProvider,
    routeSelectedProvider: reconciledRouteSelectedProvider,
    activeProvider,
    activeRouteKind,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    backendAvailable,
    fallbackActive,
    appLaunchState,
    validationState,
    readyCloudProviders: routePlan.readyCloudProviders,
    readyLocalProviders: routePlan.readyLocalProviders,
    attemptOrder: routePlan.attemptOrder,
    runtimeContext: {
      ...gatedRuntimeContext,
      canonicalHostedRouteTruth,
      finalRoute,
      routeCandidates: nodeRoute.routeCandidates || [],
      routeCandidateWinner: nodeRoute.routeCandidateWinner || null,
      routeSelectionSource: nodeRoute.routeSelectionSource || 'route-preference-order',
      routeAutoSwitchActive: nodeRoute.routeAutoSwitchActive === true,
      routeAutoSwitchReason: nodeRoute.routeAutoSwitchReason || '',
    },
    runtimeModeLabel: nodeRoute.routeVariant === 'home-node-bridge'
      ? 'home node/bridge'
      : nodeRoute.routeKind === 'home-node'
      ? 'home node/lan'
      : (gatedRuntimeContext.sessionKind === 'hosted-web' ? 'hosted/web' : 'local desktop/dev'),
    routeAdoptionMarker: STEPHANOS_ROUTE_ADOPTION_MARKER,
    providerRoutingMarker: STEPHANOS_PROVIDER_ROUTING_MARKER,
    dependencySummary: '',
    headline,
    statusTone: appLaunchState === 'unavailable' ? 'unavailable' : appLaunchState === 'degraded' ? 'degraded' : 'ready',
    finalRoute,
    routeKind: finalRoute.routeKind,
    preferredTarget: finalRoute.preferredTarget,
    actualTargetUsed: finalRoute.actualTarget,
    localNodeReachable: nodeRoute.localNodeReachable,
    homeNodeReachable: nodeRoute.homeNodeReachable,
    cloudRouteReachable: nodeRoute.cloudRouteReachable,
    nodeAddressSource: finalRoute.source,
    routeSummary: nodeRoute.routeSummary,
    routeEvaluations: nodeRoute.routeEvaluations,
    routeCandidates: nodeRoute.routeCandidates || [],
    routeCandidateWinner: nodeRoute.routeCandidateWinner || null,
    routeSelectionSource: nodeRoute.routeSelectionSource || 'route-preference-order',
    routeAutoSwitchActive: nodeRoute.routeAutoSwitchActive === true,
    routeAutoSwitchReason: nodeRoute.routeAutoSwitchReason || '',
    routePreferenceOrder: nodeRoute.routePreferenceOrder,
    preferredRoute: nodeRoute.preferredRoute,
    classificationFailed: nodeRoute.classificationFailed,
  };
  const finalRouteTruth = buildFinalRouteTruth({
    runtimeContext: gatedRuntimeContext,
    nodeRoute,
    finalRoute,
    routePlan,
    backendAvailable,
    activeProvider,
    routeSelectedProvider: reconciledRouteSelectedProvider,
    fallbackActive,
    validationState,
    appLaunchState,
  });
  const dependencySummary = buildDependencySummary({
    backendAvailable,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    fallbackActive,
    activeProvider,
    finalRouteTruth,
    nodeRoute,
    providerHealth: health,
  });
  const preliminaryModel = { ...model, finalRouteTruth, dependencySummary };
  const guardrails = evaluateRuntimeGuardrails(preliminaryModel);
  const runtimeAdjudication = adjudicateRuntimeTruth({
    runtimeContext: gatedRuntimeContext,
    finalRoute,
    finalRouteTruth,
    routePlan,
    routeEvaluations: nodeRoute.routeEvaluations,
    routePreferenceOrder: nodeRoute.routePreferenceOrder,
    selectedProvider: normalizedProvider,
    routeSelectedProvider: reconciledRouteSelectedProvider,
    activeProvider,
    providerHealth: health,
    fallbackActive,
    validationState,
    appLaunchState,
    guardrails,
  });

  return {
    ...model,
    dependencySummary,
    // Derived-only compatibility projection from canonicalRouteRuntimeTruth.
    finalRouteTruth: runtimeAdjudication.finalRouteTruth,
    canonicalRouteRuntimeTruth: runtimeAdjudication.canonicalRouteRuntimeTruth,
    runtimeTruth: runtimeAdjudication.runtimeTruth,
    runtimeTruthSnapshot: runtimeAdjudication.runtimeTruthSnapshot,
    compatibilityRuntimeTruthSnapshot: runtimeAdjudication.compatibilityRuntimeTruthSnapshot,
    runtimeAdjudication: {
      issues: runtimeAdjudication.issues,
      computedFromPersistence: false,
    },
    cognitiveAdjudication: runtimeAdjudication.cognitiveAdjudication,
    guardrails,
  };
}
