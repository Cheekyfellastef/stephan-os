import { validateStephanosHomeBridgeUrl } from './stephanosHomeNode.mjs';

export const BRIDGE_TRANSPORT_KEYS = Object.freeze(['manual', 'tailscale', 'wireguard']);

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

export function projectHomeBridgeTransportTruth(preferences = {}, { runtimeBridge = {} } = {}) {
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
