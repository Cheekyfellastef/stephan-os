import { validateStephanosHomeBridgeUrl } from './stephanosHomeNode.mjs';

export const BRIDGE_TRANSPORT_KEYS = Object.freeze(['manual', 'tailscale', 'wireguard']);
export const HOME_BRIDGE_MEMORY_SCHEMA_VERSION = 1;
export const DURABLE_PERSISTENCE_STORAGE_TARGET = 'durable-memory';

const TRANSPORT_CAPABILITIES = Object.freeze({
  manual: Object.freeze({
    privateOverlayCapable: false,
    internetReachableCapable: true,
    manualConfigRequired: true,
    runtimeProbeAvailable: true,
  }),
  tailscale: Object.freeze({
    privateOverlayCapable: true,
    internetReachableCapable: true,
    manualConfigRequired: true,
    runtimeProbeAvailable: false,
  }),
  wireguard: Object.freeze({
    privateOverlayCapable: true,
    internetReachableCapable: true,
    manualConfigRequired: true,
    runtimeProbeAvailable: false,
  }),
});

export const BRIDGE_TRANSPORT_DEFINITIONS = Object.freeze({
  manual: Object.freeze({
    key: 'manual',
    label: 'Manual / LAN',
    status: 'active',
    description: 'Operator-configured bridge URL for hosted/off-network reachability.',
    capabilities: TRANSPORT_CAPABILITIES.manual,
  }),
  tailscale: Object.freeze({
    key: 'tailscale',
    label: 'Tailscale',
    status: 'active',
    description: 'Private overlay bridge transport using a tailnet-routable node.',
    capabilities: TRANSPORT_CAPABILITIES.tailscale,
  }),
  wireguard: Object.freeze({
    key: 'wireguard',
    label: 'WireGuard',
    status: 'planned',
    description: 'Planned transport adapter. Not yet configurable in runtime probing.',
    capabilities: TRANSPORT_CAPABILITIES.wireguard,
  }),
});

const DEFAULT_BRIDGE_TRANSPORT_PREFERENCES = Object.freeze({
  selectedTransport: 'manual',
  transports: {
    manual: {
      enabled: true,
      backendUrl: '',
      accepted: false,
      reachability: 'unknown',
      reason: 'Manual/LAN bridge not configured.',
    },
    tailscale: {
      enabled: false,
      deviceName: '',
      nodeId: '',
      tailnetIp: '',
      hostOverride: '',
      backendUrl: '',
      accepted: false,
      active: false,
      reachability: 'unknown',
      usable: false,
      relay: 'unknown',
      authState: 'unknown',
      reason: 'Tailscale transport not configured.',
      diagnostics: [],
    },
  },
});

function normalizeString(value = '') {
  return String(value || '').trim();
}

function normalizeSessionKind(value = '') {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'local-desktop' || normalized === 'hosted-web') return normalized;
  return 'unknown';
}

export function resolveBridgeUrlRequireHttps({
  sessionKind = '',
  selectedTransport = 'manual',
  fallbackRequireHttps = true,
} = {}) {
  const normalizedTransport = normalizeBridgeTransportSelection(selectedTransport);
  if (normalizedTransport === 'tailscale') return true;
  const normalizedSessionKind = normalizeSessionKind(sessionKind);
  if (normalizedSessionKind === 'local-desktop') return false;
  if (normalizedSessionKind === 'hosted-web') return true;
  return fallbackRequireHttps !== false;
}

export function resolveBridgeValidationTruth({
  runtimeStatusModel = null,
  selectedTransport = 'manual',
  fallbackRequireHttps = true,
} = {}) {
  const model = runtimeStatusModel && typeof runtimeStatusModel === 'object' ? runtimeStatusModel : {};
  const canonicalTruth = model.canonicalRouteRuntimeTruth && typeof model.canonicalRouteRuntimeTruth === 'object'
    ? model.canonicalRouteRuntimeTruth
    : {};
  const runtimeTruth = model.runtimeTruth && typeof model.runtimeTruth === 'object' ? model.runtimeTruth : {};
  const finalRouteTruth = model.finalRouteTruth && typeof model.finalRouteTruth === 'object' ? model.finalRouteTruth : {};
  const runtimeContext = model.runtimeContext && typeof model.runtimeContext === 'object' ? model.runtimeContext : {};
  const sessionKind = normalizeSessionKind(
    canonicalTruth.sessionKind
    || runtimeTruth?.session?.sessionKind
    || finalRouteTruth.sessionKind
    || runtimeContext.sessionKind
    || '',
  );
  return {
    sessionKind,
    selectedTransport: normalizeBridgeTransportSelection(selectedTransport),
    requireHttps: resolveBridgeUrlRequireHttps({
      sessionKind,
      selectedTransport,
      fallbackRequireHttps,
    }),
  };
}

function normalizeReason(value = '', fallback = '') {
  return normalizeString(value) || fallback;
}

function normalizeReachability(value = '', fallback = 'unknown') {
  const normalized = normalizeString(value).toLowerCase();
  if (['reachable', 'unreachable', 'unknown', 'invalid', 'pending'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeList(value = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))].slice(0, 8);
}

function normalizeTimestamp(value = '') {
  const text = normalizeString(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString();
}

export function resolvePersistenceWriteSource(sessionKind = '') {
  return normalizeSessionKind(sessionKind) === 'hosted-web' ? 'hosted' : 'local';
}

export function normalizePersistenceResult(value = {}, {
  defaultSource = 'local',
  defaultTimestamp = '',
} = {}) {
  const source = normalizeString(value?.source || defaultSource).toLowerCase() === 'hosted' ? 'hosted' : 'local';
  const attempted = value?.attempted === true;
  const succeeded = attempted && value?.succeeded === true;
  const timestamp = normalizeTimestamp(value?.timestamp || defaultTimestamp || '');
  const code = normalizeString(value?.error?.code);
  const message = normalizeString(value?.error?.message);
  return {
    attempted,
    succeeded,
    timestamp: timestamp || (attempted ? new Date().toISOString() : ''),
    source,
    storageTarget: DURABLE_PERSISTENCE_STORAGE_TARGET,
    ...(code || message ? {
      error: {
        code: code || (succeeded ? '' : 'unknown-persistence-error'),
        message: message || (succeeded ? '' : 'Persistence write failed.'),
      },
    } : {}),
  };
}

export function projectPersistenceTruth({
  lastWrite = null,
  previousPersistence = {},
  reconciledAcrossSurfaces = false,
} = {}) {
  const prior = previousPersistence && typeof previousPersistence === 'object' ? previousPersistence : {};
  const normalizedLastWrite = lastWrite ? normalizePersistenceResult(lastWrite, {
    defaultSource: prior?.lastWrite?.source || 'local',
    defaultTimestamp: prior?.lastWrite?.timestamp || '',
  }) : null;
  const lastSuccessTimestamp = normalizedLastWrite?.succeeded
    ? normalizedLastWrite.timestamp
    : normalizeTimestamp(prior.lastSuccessTimestamp || '');
  const lastFailureTimestamp = normalizedLastWrite?.attempted && normalizedLastWrite.succeeded === false
    ? normalizedLastWrite.timestamp
    : normalizeTimestamp(prior.lastFailureTimestamp || '');
  const lastError = normalizedLastWrite?.succeeded === false
    ? normalizeString(normalizedLastWrite?.error?.message || '')
    : '';
  return {
    lastWrite: normalizedLastWrite,
    lastSuccessTimestamp: lastSuccessTimestamp || null,
    lastFailureTimestamp: lastFailureTimestamp || null,
    lastError: lastError || null,
    reconciledAcrossSurfaces: reconciledAcrossSurfaces === true,
  };
}

function normalizeAutoRevalidationState(value = '') {
  const normalized = normalizeString(value).toLowerCase();
  if ([
    'idle',
    'skipped',
    'validating',
    'validation-failed',
    'probing',
    'unreachable',
    'revalidated',
  ].includes(normalized)) {
    return normalized;
  }
  return 'idle';
}

function createEmptyBridgeMemory() {
  return {
    schemaVersion: HOME_BRIDGE_MEMORY_SCHEMA_VERSION,
    transport: 'none',
    backendUrl: '',
    tailscaleDeviceName: '',
    tailscaleHostnameOverride: '',
    tailscaleIp: '',
    rememberedAt: '',
    savedBySurface: '',
    savedBySession: '',
    reason: 'No remembered Home Bridge transport.',
  };
}

export function normalizeHomeBridgeMemory(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const transport = normalizeBridgeTransportSelection(source.transport);
  const backendUrl = normalizeString(source.backendUrl);
  const rememberedAt = normalizeTimestamp(source.rememberedAt);
  const normalizedTransport = backendUrl ? transport : 'none';
  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion))
      ? Number(source.schemaVersion)
      : HOME_BRIDGE_MEMORY_SCHEMA_VERSION,
    transport: normalizedTransport,
    backendUrl: normalizedTransport === 'none' ? '' : backendUrl,
    tailscaleDeviceName: normalizeString(source.tailscaleDeviceName),
    tailscaleHostnameOverride: normalizeString(source.tailscaleHostnameOverride),
    tailscaleIp: normalizeString(source.tailscaleIp),
    rememberedAt,
    savedBySurface: normalizeString(source.savedBySurface),
    savedBySession: normalizeString(source.savedBySession),
    reason: normalizeReason(
      source.reason,
      normalizedTransport === 'none'
        ? 'No remembered Home Bridge transport.'
        : 'Remembered Home Bridge transport found in shared memory.',
    ),
  };
}

export function deriveBridgeMemoryFromPreferences(preferences = {}, metadata = {}, options = {}) {
  const selectedTransport = normalizeBridgeTransportSelection(preferences?.selectedTransport);
  const manual = preferences?.transports?.manual || {};
  const tailscale = preferences?.transports?.tailscale || {};
  const remembered = normalizeHomeBridgeMemory(options?.fallbackMemory || {});
  const preferredTransport = normalizeBridgeTransportSelection(options?.preferredTransport || selectedTransport);
  const backendByTransport = {
    manual: normalizeString(manual.backendUrl),
    tailscale: normalizeString(tailscale.backendUrl),
  };
  const candidateOrder = [
    selectedTransport,
    preferredTransport,
    normalizeBridgeTransportSelection(remembered.transport),
    'tailscale',
    'manual',
  ];
  const resolvedTransport = candidateOrder.find((transport) => transport !== 'wireguard' && Boolean(backendByTransport[transport])) || 'none';
  const backendUrl = resolvedTransport === 'none' ? '' : backendByTransport[resolvedTransport];
  if (!backendUrl) {
    if (options?.preserveExisting === true && remembered.transport !== 'none' && remembered.backendUrl) {
      return normalizeHomeBridgeMemory({
        ...remembered,
        reason: metadata.reason || remembered.reason || 'Remembered Home Bridge transport preserved from durable memory.',
      });
    }
    return createEmptyBridgeMemory();
  }
  return normalizeHomeBridgeMemory({
    schemaVersion: HOME_BRIDGE_MEMORY_SCHEMA_VERSION,
    transport: resolvedTransport,
    backendUrl,
    tailscaleDeviceName: tailscale.deviceName,
    tailscaleHostnameOverride: tailscale.hostOverride,
    tailscaleIp: tailscale.tailnetIp,
    rememberedAt: metadata.rememberedAt || new Date().toISOString(),
    savedBySurface: metadata.savedBySurface || '',
    savedBySession: metadata.savedBySession || '',
    reason: metadata.reason || 'Bridge transport saved by operator.',
  });
}

export function normalizeBridgeTransportSelection(value = '') {
  const normalized = normalizeString(value).toLowerCase();
  return BRIDGE_TRANSPORT_KEYS.includes(normalized) ? normalized : 'manual';
}

function normalizeManualTransport(value = {}, { frontendOrigin = '', requireHttps = true } = {}) {
  const backendUrl = normalizeString(value.backendUrl);
  const validation = validateStephanosHomeBridgeUrl(backendUrl, { frontendOrigin, requireHttps });
  const enabled = value.enabled !== false;
  return {
    enabled,
    backendUrl: validation.ok ? validation.normalizedUrl : '',
    accepted: value.accepted === true && validation.ok,
    reachability: normalizeReachability(value.reachability, validation.ok ? 'unknown' : 'invalid'),
    reason: normalizeReason(value.reason, validation.ok ? 'Manual/LAN bridge URL stored.' : (backendUrl ? (validation.reason || 'Manual/LAN bridge URL is invalid.') : 'Manual/LAN bridge not configured.')),
  };
}

function normalizeTailscaleTransport(value = {}, { frontendOrigin = '', requireHttps = true } = {}) {
  const enabled = value.enabled === true;
  const backendUrlCandidate = normalizeString(value.backendUrl);
  const backendValidation = backendUrlCandidate
    ? validateStephanosHomeBridgeUrl(backendUrlCandidate, { frontendOrigin, requireHttps })
    : { ok: false, normalizedUrl: '', reason: 'Tailscale backend URL not set.' };
  const hostOverride = normalizeString(value.hostOverride);
  const tailnetIp = normalizeString(value.tailnetIp);
  const deviceName = normalizeString(value.deviceName);
  const nodeId = normalizeString(value.nodeId);
  const accepted = value.accepted === true && backendValidation.ok;
  const active = value.active === true && accepted;
  const reachability = normalizeReachability(value.reachability, backendValidation.ok ? 'unknown' : 'invalid');
  const usable = value.usable === true && active && reachability === 'reachable';
  const diagnostics = normalizeList(value.diagnostics);
  if (enabled && !backendValidation.ok) {
    diagnostics.push(backendValidation.reason || 'Tailscale backend URL is invalid or missing.');
  }
  if (enabled && !tailnetIp && !hostOverride) {
    diagnostics.push('Set a Tailnet IP or hostname override to identify the remote node.');
  }

  return {
    enabled,
    deviceName,
    nodeId,
    tailnetIp,
    hostOverride,
    backendUrl: backendValidation.ok ? backendValidation.normalizedUrl : '',
    accepted,
    active,
    reachability,
    usable,
    relay: normalizeString(value.relay || 'unknown') || 'unknown',
    authState: normalizeString(value.authState || 'unknown') || 'unknown',
    reason: normalizeReason(
      value.reason,
      !enabled
        ? 'Tailscale transport disabled.'
        : accepted
          ? (usable ? 'Tailscale bridge is active and usable.' : 'Tailscale bridge accepted; awaiting reachability evidence.')
          : 'Tailscale selected but not yet accepted.',
    ),
    diagnostics,
  };
}

export function createDefaultBridgeTransportPreferences() {
  return JSON.parse(JSON.stringify(DEFAULT_BRIDGE_TRANSPORT_PREFERENCES));
}

export function normalizeBridgeTransportPreferences(value = {}, {
  homeBridgeUrl = '',
  frontendOrigin = '',
  manualRequireHttps = true,
  tailscaleRequireHttps = true,
} = {}) {
  const defaults = createDefaultBridgeTransportPreferences();
  const source = value && typeof value === 'object' ? value : {};
  const selectedTransport = normalizeBridgeTransportSelection(source.selectedTransport);
  const transports = source.transports && typeof source.transports === 'object' ? source.transports : {};

  const manual = normalizeManualTransport({
    ...defaults.transports.manual,
    ...transports.manual,
    backendUrl: transports.manual?.backendUrl || homeBridgeUrl || '',
  }, { frontendOrigin, requireHttps: manualRequireHttps });

  const tailscale = normalizeTailscaleTransport({
    ...defaults.transports.tailscale,
    ...transports.tailscale,
    backendUrl: transports.tailscale?.backendUrl || '',
  }, { frontendOrigin, requireHttps: tailscaleRequireHttps });

  return {
    selectedTransport,
    transports: {
      manual,
      tailscale,
    },
  };
}

export function listBridgeTransportDefinitions() {
  return BRIDGE_TRANSPORT_KEYS.map((key) => BRIDGE_TRANSPORT_DEFINITIONS[key]);
}

export function projectHomeBridgeTransportTruth(
  preferences = {},
  {
    runtimeBridge = {},
    bridgeMemory = {},
    bridgeMemoryRehydrated = false,
    autoRevalidation = {},
    bridgeMemoryPersistence = {},
  } = {},
) {
  const selectedTransport = normalizeBridgeTransportSelection(preferences?.selectedTransport);
  const manualConfig = preferences?.transports?.manual || {};
  const tailscaleConfig = preferences?.transports?.tailscale || {};

  const configuredTransport = selectedTransport === 'tailscale'
    ? (tailscaleConfig.enabled && tailscaleConfig.backendUrl ? 'tailscale' : 'none')
    : (manualConfig.backendUrl ? 'manual' : 'none');
  const activeTransport = selectedTransport === 'tailscale'
    ? (tailscaleConfig.active ? 'tailscale' : 'none')
    : (runtimeBridge?.accepted === true && runtimeBridge?.backendUrl ? 'manual' : 'none');

  const reachability = selectedTransport === 'tailscale'
    ? normalizeReachability(tailscaleConfig.reachability)
    : normalizeReachability(runtimeBridge?.reachability || manualConfig.reachability);

  const usable = selectedTransport === 'tailscale'
    ? tailscaleConfig.usable === true
    : runtimeBridge?.accepted === true && reachability === 'reachable';

  const state = activeTransport !== 'none'
    ? (usable ? 'active' : 'degraded')
    : (configuredTransport !== 'none' ? 'configured' : 'unconfigured');

  const detail = selectedTransport === 'tailscale'
    ? (tailscaleConfig.reason || 'Tailscale transport status pending.')
    : (runtimeBridge?.reason || manualConfig.reason || 'Manual/LAN bridge status pending.');

  const rememberedMemory = normalizeHomeBridgeMemory(bridgeMemory);
  const hasMemory = rememberedMemory.transport !== 'none' && Boolean(rememberedMemory.backendUrl);
  const memoryNeedsValidation = hasMemory && !(selectedTransport === 'tailscale'
    ? tailscaleConfig.accepted === true
    : runtimeBridge?.accepted === true);
  const memoryValidationState = !hasMemory
    ? 'absent'
    : (selectedTransport === 'tailscale'
      ? (tailscaleConfig.accepted === true ? 'validated' : (tailscaleConfig.reachability === 'unreachable' ? 'unreachable' : 'awaiting-validation'))
      : (runtimeBridge?.accepted === true ? 'validated' : 'awaiting-validation'));
  const reconciliation = resolveBridgeMemoryReconciliation({
    preferences,
    runtimeBridge,
    bridgeMemory: rememberedMemory,
    autoRevalidation,
  });
  const persistenceTruth = projectPersistenceTruth({
    lastWrite: bridgeMemoryPersistence?.lastWrite || null,
    previousPersistence: bridgeMemoryPersistence?.persistence || bridgeMemoryPersistence || {},
    reconciledAcrossSurfaces: bridgeMemoryPersistence?.reconciledAcrossSurfaces === true
      || reconciliation.state === 'remembered-revalidated',
  });

  return {
    selectedTransport,
    configuredTransport,
    activeTransport,
    state,
    detail,
    reason: detail,
    reachability,
    usability: usable ? 'yes' : 'no',
    source: activeTransport === 'tailscale' ? 'bridgeTransport:tailscale' : (activeTransport === 'manual' ? 'homeBridge:manual' : 'bridgeTransport:unresolved'),
    bridgeMemoryPresent: hasMemory,
    bridgeMemoryTransport: hasMemory ? rememberedMemory.transport : 'none',
    bridgeMemoryUrl: hasMemory ? rememberedMemory.backendUrl : '',
    bridgeMemoryRememberedAt: rememberedMemory.rememberedAt || '',
    bridgeMemoryRehydrated: bridgeMemoryRehydrated === true,
    bridgeMemoryNeedsValidation: memoryNeedsValidation,
    bridgeMemoryValidationState: memoryValidationState,
    bridgeMemoryReason: rememberedMemory.reason,
    bridgeMemoryReconciliationState: reconciliation.state,
    bridgeMemoryReconciliationReason: reconciliation.reason,
    bridgeMemoryReconciliationProvenance: reconciliation.provenance || '',
    bridgeAutoRevalidationState: normalizeAutoRevalidationState(autoRevalidation?.state),
    bridgeAutoRevalidationReason: normalizeReason(autoRevalidation?.reason, ''),
    bridgeAutoRevalidationAttemptedAt: normalizeTimestamp(autoRevalidation?.attemptedAt || ''),
    bridgeMemoryPersistenceState: normalizeReason(bridgeMemoryPersistence?.state, 'idle'),
    bridgeMemoryPersistenceReason: normalizeReason(bridgeMemoryPersistence?.reason, 'No bridge memory persistence event recorded.'),
    bridgeMemoryPersistenceAt: normalizeTimestamp(bridgeMemoryPersistence?.at || ''),
    bridgeMemoryWriteAttempted: bridgeMemoryPersistence?.bridgeMemoryWriteAttempted === true,
    bridgeMemoryWriteSucceeded: bridgeMemoryPersistence?.bridgeMemoryWriteSucceeded === true,
    persistence: persistenceTruth,
    persistenceLastWrite: persistenceTruth.lastWrite,
    persistenceAttempted: persistenceTruth.lastWrite?.attempted === true,
    persistenceSucceeded: persistenceTruth.lastWrite?.succeeded === true,
    persistenceLastWriteTimestamp: persistenceTruth.lastWrite?.timestamp || '',
    persistenceLastSuccessTimestamp: persistenceTruth.lastSuccessTimestamp || '',
    persistenceLastFailureTimestamp: persistenceTruth.lastFailureTimestamp || '',
    persistenceLastError: persistenceTruth.lastError || '',
    persistenceReconciledAcrossSurfaces: persistenceTruth.reconciledAcrossSurfaces === true,
    bridgeMemoryReadAttempted: bridgeMemoryPersistence?.bridgeMemoryReadAttempted === true,
    bridgeMemoryReadSource: normalizeReason(bridgeMemoryPersistence?.bridgeMemoryReadSource, 'none'),
    bridgeMemoryReadResult: normalizeReason(bridgeMemoryPersistence?.bridgeMemoryReadResult, 'none'),
    bridgeMemoryClearedBy: normalizeReason(bridgeMemoryPersistence?.bridgeMemoryClearedBy, ''),
    bridgeMemoryClobberDetected: bridgeMemoryPersistence?.state === 'save-clobbered',
    bridgeMemoryStorageKey: normalizeReason(bridgeMemoryPersistence?.bridgeMemoryStorageKey, 'stephanos.durable.memory.v2'),
    bridgeMemoryStorageScope: normalizeReason(bridgeMemoryPersistence?.bridgeMemoryStorageScope, 'shared-runtime-memory'),
    bridgeMemoryLastRawValueSummary: normalizeReason(bridgeMemoryPersistence?.bridgeMemoryLastRawValueSummary, 'none'),
    tailscale: {
      deviceName: tailscaleConfig.deviceName || '',
      tailnetIp: tailscaleConfig.tailnetIp || '',
      backendUrl: tailscaleConfig.backendUrl || '',
      accepted: tailscaleConfig.accepted === true,
      reachable: tailscaleConfig.reachability === 'reachable',
      usable: tailscaleConfig.usable === true,
      reason: tailscaleConfig.reason || '',
      diagnostics: Array.isArray(tailscaleConfig.diagnostics) ? tailscaleConfig.diagnostics : [],
    },
  };
}

export function resolveBridgeMemoryReconciliation({
  preferences = {},
  runtimeBridge = {},
  bridgeMemory = {},
  autoRevalidation = {},
} = {}) {
  const rememberedMemory = normalizeHomeBridgeMemory(bridgeMemory);
  const hasMemory = rememberedMemory.transport !== 'none' && Boolean(rememberedMemory.backendUrl);
  if (!hasMemory) {
    return {
      state: 'no-remembered-bridge',
      reason: 'No remembered Home Bridge transport.',
      superseded: false,
      provenance: 'no-remembered-bridge',
    };
  }
  const selectedTransport = normalizeBridgeTransportSelection(preferences?.selectedTransport);
  const manual = preferences?.transports?.manual || {};
  const tailscale = preferences?.transports?.tailscale || {};
  const tailscaleAcceptedReachable = tailscale.accepted === true && normalizeReachability(tailscale.reachability) === 'reachable';
  const liveUrl = selectedTransport === 'tailscale'
    ? normalizeString(tailscale.backendUrl)
    : normalizeString(runtimeBridge?.backendUrl || manual.backendUrl);
  const liveAccepted = selectedTransport === 'tailscale'
    ? tailscale.accepted === true
    : runtimeBridge?.accepted === true;
  const liveReachability = selectedTransport === 'tailscale'
    ? normalizeReachability(tailscale.reachability)
    : normalizeReachability(runtimeBridge?.reachability);
  const autoState = normalizeAutoRevalidationState(autoRevalidation?.state);

  const superseded = Boolean(
    liveUrl
    && liveUrl !== rememberedMemory.backendUrl
    && liveAccepted
    && !(rememberedMemory.transport === 'tailscale' && tailscaleAcceptedReachable),
  );
  if (superseded) {
    const supersededTransport = selectedTransport === 'none' ? 'none' : selectedTransport;
    return {
      state: 'remembered-superseded-by-live-config',
      reason: 'Remembered bridge exists, but a stronger live bridge config is currently active.',
      superseded: true,
      provenance: `remembered-${rememberedMemory.transport}-superseded-by-${supersededTransport}`,
    };
  }
  if (autoState === 'revalidated') {
    const liveTransport = rememberedMemory.transport === 'tailscale' && tailscaleAcceptedReachable
      ? 'tailscale'
      : (selectedTransport === 'none' ? rememberedMemory.transport : selectedTransport);
    return {
      state: 'remembered-revalidated',
      reason: autoRevalidation?.reason || 'Remembered bridge revalidated on this surface.',
      superseded: false,
      provenance: `remembered-${rememberedMemory.transport}-revalidated-as-${liveTransport}`,
    };
  }
  if (autoState === 'validation-failed') {
    return {
      state: 'remembered-validation-failed',
      reason: autoRevalidation?.reason || 'Remembered bridge failed canonical validation on this surface.',
      superseded: false,
      provenance: `remembered-${rememberedMemory.transport}-validation-failed`,
    };
  }
  if (autoState === 'unreachable' || liveReachability === 'unreachable') {
    return {
      state: 'remembered-unreachable',
      reason: autoRevalidation?.reason || 'Remembered bridge validated structurally but is unreachable from this surface.',
      superseded: false,
      provenance: `remembered-${rememberedMemory.transport}-unreachable`,
    };
  }
  if (liveAccepted && liveReachability === 'reachable') {
    const liveTransport = selectedTransport === 'none' ? rememberedMemory.transport : selectedTransport;
    return {
      state: 'remembered-revalidated',
      reason: 'Remembered bridge now matches reachable live bridge truth.',
      superseded: false,
      provenance: `remembered-${rememberedMemory.transport}-revalidated-as-${liveTransport}`,
    };
  }
  return {
    state: 'remembered-awaiting-validation',
    reason: autoRevalidation?.reason || 'Remembered bridge exists and still needs validation on this surface.',
    superseded: false,
    provenance: `remembered-${rememberedMemory.transport}-awaiting-validation`,
  };
}

export function resolveAutoBridgeRevalidationPlan({
  bridgeMemory = {},
  preferences = {},
  bridgeValidationTruth = {},
} = {}) {
  const remembered = normalizeHomeBridgeMemory(bridgeMemory);
  if (remembered.transport === 'none' || !remembered.backendUrl) {
    return {
      shouldAttempt: false,
      reason: 'No remembered bridge config exists.',
      outcome: 'no-remembered-bridge',
    };
  }
  const selectedTransport = normalizeBridgeTransportSelection(preferences?.selectedTransport || remembered.transport);
  const manual = preferences?.transports?.manual || {};
  const tailscale = preferences?.transports?.tailscale || {};
  const activeConfig = selectedTransport === 'tailscale' ? tailscale : manual;
  const activeUrl = normalizeString(activeConfig.backendUrl);
  if (activeConfig.accepted === true && activeUrl && activeUrl !== remembered.backendUrl) {
    return {
      shouldAttempt: false,
      reason: 'Live bridge config is already accepted and supersedes remembered config.',
      outcome: 'remembered-superseded-by-live-config',
    };
  }
  const requireHttps = resolveBridgeUrlRequireHttps({
    sessionKind: bridgeValidationTruth?.sessionKind || 'unknown',
    selectedTransport: remembered.transport,
    fallbackRequireHttps: bridgeValidationTruth?.requireHttps !== false,
  });
  return {
    shouldAttempt: true,
    reason: 'Remembered bridge config is eligible for canonical auto-revalidation.',
    outcome: 'remembered-awaiting-validation',
    transport: remembered.transport,
    candidateUrl: remembered.backendUrl,
    requireHttps,
  };
}
