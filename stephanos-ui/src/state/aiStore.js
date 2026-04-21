// LIVE SOURCE OF TRUTH: this store backs the served Stephanos AI router/settings UI.
// Update provider state here, then rebuild stephanos-ui to refresh apps/stephanos/dist.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  HOSTED_COGNITION_PROVIDER_KEYS,
  createDefaultHostedCloudCognitionSettings,
  createDefaultRouterSettings,
  normalizeProviderDraft,
  normalizeProviderSelection,
  normalizeRouteMode,
  sanitizeConfigForStorage,
  validateProviderDraft,
} from '../ai/providerConfig';
import {
  clearPersistedStephanosHomeBridgeUrl,
  clearPersistedStephanosHomeNode,
  isValidStephanosHomeNode,
  normalizeStephanosHomeNode,
  persistStephanosHomeBridgeUrl,
  persistStephanosHomeNodePreference,
  persistStephanosLastKnownNode,
  readPersistedStephanosHomeBridgeUrl,
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  setStephanosHomeBridgeGlobal,
  validateStephanosHomeBridgeUrl,
} from '../../../shared/runtime/stephanosHomeNode.mjs';
import {
  STEPHANOS_ACTIVE_SUBVIEW,
  STEPHANOS_ACTIVE_WORKSPACE,
  clearPersistedStephanosSessionMemory,
  createDefaultStephanosSessionMemory,
  persistStephanosSessionMemory,
  readPortableStephanosHomeNodePreference,
  restoreStephanosSessionMemoryForDevice,
} from '../../../shared/runtime/stephanosSessionMemory.mjs';
import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';
import { createDefaultMissionDashboardUiState, normalizeMissionDashboardUiState } from './missionDashboardUiState';
import { getApiRuntimeConfig } from '../ai/apiConfig';
import { checkApiHealth } from '../ai/aiClient';
import { ensureRuntimeStatusModel } from './runtimeStatusDefaults';
import {
  createDefaultBridgeTransportPreferences,
  deriveBridgeMemoryFromPreferences,
  listBridgeTransportDefinitions,
  normalizeHomeBridgeMemory,
  normalizePersistenceResult,
  normalizeBridgeTransportPreferences,
  normalizeBridgeTransportSelection,
  projectHomeBridgeTransportTruth,
  projectPersistenceTruth,
  resolvePersistenceWriteSource,
  resolveAutoBridgeRevalidationPlan,
  resolveBridgeValidationTruth,
  resolveBridgeUrlRequireHttps,
} from '../../../shared/runtime/homeBridgeTransport.mjs';
import {
  applyMissionPacketAction,
  createDefaultMissionPacketWorkflow,
  normalizeMissionPacketWorkflow,
} from './missionPacketWorkflow';
import {
  applyMissionLineageUpdate,
  createDefaultMissionLineageStore,
  normalizeMissionLineageStore,
} from './missionLineage.js';
import {
  normalizeSurfaceOverride,
  resolveSurfaceAwareness,
  resolveSurfaceUiLayoutDefaults,
} from '../system/surface/surfaceAwareness';
import {
  acceptSurfaceProtocolRecommendation,
  appendAcceptedSurfaceRule,
  appendFrictionEvent,
  createFrictionEvent,
  detectSurfaceFrictionPatterns,
  generateSurfaceProtocolRecommendations,
  revertAcceptedSurfaceRule,
} from '../system/friction/frictionPipeline.js';
import { explainStephanosMemory } from '../system/friction/memoryExplanation.js';
import {
  buildBridgeRevalidationAttemptedConfigKey,
  shouldTreatBridgeHealthProbeAsReachable,
} from './bridgeAutoRevalidation.mjs';

const AIStoreContext = createContext(null);
const DEFAULT_UI_LAYOUT = {
  providerControlsPanel: true,
  homeBridgePanel: true,
  commandDeck: true,
  powerShellMergeConsolePanel: true,
  statusPanel: true,
  toolsPanel: true,
  memoryPanel: true,
  knowledgeGraphPanel: true,
  simulationListPanel: true,
  simulationPanel: true,
  simulationHistoryPanel: true,
  proposalPanel: true,
  activityPanel: true,
  telemetryFeedPanel: true,
  cockpitPanel: true,
  agentsPanel: true,
  promptBuilderPanel: true,
  roadmapPanel: true,
  missionDashboardPanel: true,
  intentEnginePanel: true,
  missionFingerprintPanel: true,
  missionPacketQueuePanel: true,
  debugConsole: false,
};
const DEFAULT_OPERATOR_PANE_ORDER = [
  'aiConsole',
  'statusPanel',
  'toolsPanel',
  'memoryPanel',
  'knowledgeGraphPanel',
  'simulationListPanel',
  'simulationPanel',
  'simulationHistoryPanel',
  'proposalPanel',
  'activityPanel',
  'telemetryFeedPanel',
  'cockpitPanel',
  'agentsPanel',
  'promptBuilderPanel',
  'roadmapPanel',
  'missionDashboardPanel',
  'intentEnginePanel',
  'missionFingerprintPanel',
  'missionPacketQueuePanel',
];
const DEFAULT_OLLAMA_CONNECTION = {
  lastSuccessfulBaseURL: '',
  lastSuccessfulHost: '',
  recentHosts: [],
  pcAddressHint: '',
  lastSelectedModel: '',
};
const DEFAULT_HOME_NODE_STATUS = {
  state: 'idle',
  detail: 'Home node not checked yet.',
  attempts: [],
};
const DEFAULT_SURFACE_OVERRIDE = 'auto';
const MAX_PERSISTED_COMMANDS = 10;
const MAX_PERSISTED_OUTPUT_LENGTH = 4000;
const MAX_FRICTION_EVENTS = 10;
const BRIDGE_MEMORY_RECORD_NAMESPACE = 'continuity';
const BRIDGE_MEMORY_RECORD_ID = 'home-bridge.transport-memory';
const DEFAULT_BRIDGE_AUTO_REVALIDATION = Object.freeze({
  state: 'idle',
  reason: '',
  attemptedAt: '',
  attemptedConfigKey: '',
  attemptCount: 0,
  nextRetryAt: '',
  trigger: '',
  promotionReason: '',
  directReachability: 'unknown',
  executionCompatibility: 'unknown',
  executionTarget: '',
  executionReason: '',
  infrastructureRequirement: '',
});
const BRIDGE_AUTO_REVALIDATION_MAX_ATTEMPTS = 2;
const BRIDGE_AUTO_REVALIDATION_BACKOFF_MS = 60_000;

function resolveBridgeMemoryStorageKey() {
  return typeof globalThis.STEPHANOS_DURABLE_MEMORY_STORAGE_KEY === 'string'
    ? globalThis.STEPHANOS_DURABLE_MEMORY_STORAGE_KEY
    : 'stephanos.durable.memory.v2';
}

function summarizeBridgeMemoryPayload(bridgeMemory = {}) {
  const normalized = normalizeHomeBridgeMemory(bridgeMemory);
  if (normalized.transport === 'none' || !normalized.backendUrl) {
    return 'none';
  }
  return `normalized-memory:${normalized.transport}:${normalized.backendUrl}`;
}

function getStephanosMemoryRuntime() {
  return globalThis.stephanosMemory || globalThis.parent?.stephanosMemory || null;
}

function readPersistedBridgeMemory() {
  const memory = getStephanosMemoryRuntime();
  const storageKey = resolveBridgeMemoryStorageKey();
  const storageScope = memory ? 'shared-runtime-memory' : 'unavailable';
  if (!memory?.getRecord) {
    return {
      bridgeMemory: normalizeHomeBridgeMemory(),
      diagnostics: {
        state: 'memory-read-empty',
        reason: 'Shared durable memory runtime is unavailable on this surface.',
        at: new Date().toISOString(),
        bridgeMemoryReadAttempted: true,
        bridgeMemoryReadSource: 'runtime-unavailable',
        bridgeMemoryReadResult: 'empty',
        bridgeMemoryStorageKey: storageKey,
        bridgeMemoryStorageScope: storageScope,
        bridgeMemoryLastRawValueSummary: 'none',
        bridgeRehydratedValue: '',
      },
    };
  }
  try {
    const record = memory.getRecord({
      namespace: BRIDGE_MEMORY_RECORD_NAMESPACE,
      id: BRIDGE_MEMORY_RECORD_ID,
    });
    const payloadBridgeMemory = record?.payload?.bridgeMemory;
    const normalized = normalizeHomeBridgeMemory(payloadBridgeMemory || {});
    const payloadHasShape = payloadBridgeMemory && typeof payloadBridgeMemory === 'object'
      && Object.keys(payloadBridgeMemory).length > 0;
    const hasRememberedBridge = normalized.transport !== 'none' && Boolean(normalized.backendUrl);
    return {
      bridgeMemory: normalized,
      diagnostics: {
        state: hasRememberedBridge
          ? 'memory-read-success'
          : (payloadHasShape ? 'memory-shape-invalid' : 'memory-read-empty'),
        reason: hasRememberedBridge
          ? 'Read remembered Home Bridge config from shared durable memory.'
          : (payloadHasShape
            ? 'Home Bridge durable memory payload exists but is invalid after canonical normalization.'
            : 'No remembered Home Bridge config found in shared durable memory.'),
        at: new Date().toISOString(),
        bridgeMemoryReadAttempted: true,
        bridgeMemoryReadSource: 'shared-runtime-memory',
        bridgeMemoryReadResult: hasRememberedBridge ? 'remembered-bridge' : 'empty',
        bridgeMemoryStorageKey: storageKey,
        bridgeMemoryStorageScope: storageScope,
        bridgeMemoryLastRawValueSummary: payloadHasShape
          ? `record-payload:${Object.keys(payloadBridgeMemory || {}).slice(0, 6).join(',')}`
          : 'none',
        bridgeRehydratedValue: normalized.backendUrl || '',
      },
    };
  } catch {
    return {
      bridgeMemory: normalizeHomeBridgeMemory(),
      diagnostics: {
        state: 'memory-read-empty',
        reason: 'Failed to read shared durable memory record for Home Bridge transport.',
        at: new Date().toISOString(),
        bridgeMemoryReadAttempted: true,
        bridgeMemoryReadSource: 'shared-runtime-memory',
        bridgeMemoryReadResult: 'error',
        bridgeMemoryStorageKey: storageKey,
        bridgeMemoryStorageScope: storageScope,
        bridgeMemoryLastRawValueSummary: 'read-error',
        bridgeRehydratedValue: '',
      },
    };
  }
}

function persistBridgeMemoryToDurableStore(bridgeMemory, { sessionKind = '' } = {}) {
  const memory = getStephanosMemoryRuntime();
  const storageKey = resolveBridgeMemoryStorageKey();
  const storageScope = memory ? 'shared-runtime-memory' : 'unavailable';
  const lastRawValueSummary = summarizeBridgeMemoryPayload(bridgeMemory);
  if (!memory?.saveRecord) {
    const persistenceResult = normalizePersistenceResult({
      attempted: true,
      succeeded: false,
      source: resolvePersistenceWriteSource(sessionKind),
      timestamp: new Date().toISOString(),
      error: {
        code: 'runtime-unavailable',
        message: 'Shared durable memory runtime is unavailable; Home Bridge memory cannot be persisted.',
      },
    });
    return {
      ok: false,
      persistenceResult,
      diagnostics: {
        state: 'save-clobbered',
        reason: persistenceResult.error?.message || 'Shared durable memory runtime is unavailable; Home Bridge memory cannot be persisted.',
        at: persistenceResult.timestamp,
        bridgeMemoryWriteAttempted: persistenceResult.attempted,
        bridgeMemoryWriteSucceeded: persistenceResult.succeeded,
        lastWrite: persistenceResult,
        persistence: projectPersistenceTruth({ lastWrite: persistenceResult }),
        reconciledAcrossSurfaces: false,
        bridgeMemoryClearedBy: 'runtime-unavailable',
        bridgeMemoryStorageKey: storageKey,
        bridgeMemoryStorageScope: storageScope,
        bridgeMemoryLastRawValueSummary: lastRawValueSummary,
      },
    };
  }
  const normalizedBridgeMemory = normalizeHomeBridgeMemory(bridgeMemory);
  try {
    memory.saveRecord({
      namespace: BRIDGE_MEMORY_RECORD_NAMESPACE,
      id: BRIDGE_MEMORY_RECORD_ID,
      type: 'workspace.state',
      summary: 'Home Bridge transport memory',
      scope: 'runtime',
      tags: ['home-bridge', 'bridge-memory'],
      importance: 'normal',
      payload: { bridgeMemory: normalizedBridgeMemory },
    });
    const persistenceResult = normalizePersistenceResult({
      attempted: true,
      succeeded: true,
      source: resolvePersistenceWriteSource(sessionKind),
      timestamp: new Date().toISOString(),
    });
    return {
      ok: true,
      persistenceResult,
      diagnostics: {
        state: 'save-persisted',
        reason: normalizedBridgeMemory.transport !== 'none' && normalizedBridgeMemory.backendUrl
          ? `Remembered ${normalizedBridgeMemory.transport} Home Bridge config persisted to shared durable memory.`
          : 'Remembered Home Bridge config cleared from shared durable memory.',
        at: persistenceResult.timestamp,
        bridgeMemoryWriteAttempted: persistenceResult.attempted,
        bridgeMemoryWriteSucceeded: persistenceResult.succeeded,
        lastWrite: persistenceResult,
        persistence: projectPersistenceTruth({ lastWrite: persistenceResult, reconciledAcrossSurfaces: true }),
        reconciledAcrossSurfaces: true,
        bridgeMemoryClearedBy: normalizedBridgeMemory.transport === 'none' ? 'explicit-clear-or-empty-normalization' : '',
        bridgeMemoryStorageKey: storageKey,
        bridgeMemoryStorageScope: storageScope,
        bridgeMemoryLastRawValueSummary: lastRawValueSummary,
      },
    };
  } catch (error) {
    const persistenceResult = normalizePersistenceResult({
      attempted: true,
      succeeded: false,
      source: resolvePersistenceWriteSource(sessionKind),
      timestamp: new Date().toISOString(),
      error: {
        code: 'save-failed',
        message: error?.message
          ? `Shared durable memory write failed while persisting Home Bridge memory: ${error.message}`
          : 'Shared durable memory write failed while persisting Home Bridge memory.',
      },
    });
    return {
      ok: false,
      persistenceResult,
      diagnostics: {
        state: 'save-clobbered',
        reason: persistenceResult.error?.message || 'Shared durable memory write failed while persisting Home Bridge memory.',
        at: persistenceResult.timestamp,
        bridgeMemoryWriteAttempted: persistenceResult.attempted,
        bridgeMemoryWriteSucceeded: persistenceResult.succeeded,
        lastWrite: persistenceResult,
        persistence: projectPersistenceTruth({ lastWrite: persistenceResult }),
        reconciledAcrossSurfaces: false,
        bridgeMemoryClearedBy: 'save-failed',
        bridgeMemoryStorageKey: storageKey,
        bridgeMemoryStorageScope: storageScope,
        bridgeMemoryLastRawValueSummary: lastRawValueSummary,
      },
    };
  }
}

function normalizeUiLayout(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_UI_LAYOUT).map(([key, defaultValue]) => [
      key,
      defaultValue ? value[key] !== false : value[key] === true,
    ]),
  );
}

function normalizeOperatorPaneOrder(value = []) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(value) ? value : []).forEach((paneId) => {
    const normalizedPaneId = String(paneId || '');
    if (!DEFAULT_OPERATOR_PANE_ORDER.includes(normalizedPaneId) || seen.has(normalizedPaneId)) {
      return;
    }
    seen.add(normalizedPaneId);
    normalized.push(normalizedPaneId);
  });
  DEFAULT_OPERATOR_PANE_ORDER.forEach((paneId) => {
    if (!seen.has(paneId)) {
      normalized.push(paneId);
    }
  });
  return normalized;
}

function normalizeOllamaConnection(value = {}) {
  return {
    lastSuccessfulBaseURL: String(value.lastSuccessfulBaseURL || ''),
    lastSuccessfulHost: String(value.lastSuccessfulHost || ''),
    recentHosts: Array.isArray(value.recentHosts)
      ? [...new Set(value.recentHosts.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 5)
      : [],
    pcAddressHint: String(value.pcAddressHint || ''),
    lastSelectedModel: String(value.lastSelectedModel || ''),
  };
}

function extractHostname(value = '') {
  try {
    return new URL(String(value || '')).hostname || '';
  } catch {
    return '';
  }
}

function isLoopbackHostname(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname || '').trim().toLowerCase());
}

function resolveCompatibleTarget(candidate = '', fallback = '', { allowLoopback = false } = {}) {
  const candidateHost = extractHostname(candidate);
  if (candidate && (allowLoopback || !isLoopbackHostname(candidateHost))) {
    return candidate;
  }

  const fallbackHost = extractHostname(fallback);
  if (fallback && (allowLoopback || !isLoopbackHostname(fallbackHost))) {
    return fallback;
  }

  return allowLoopback ? (candidate || fallback || '') : '';
}

function truncateText(value, limit = MAX_PERSISTED_OUTPUT_LENGTH) {
  return String(value || '').slice(0, limit);
}

function sanitizePersistedCommandHistory(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_PERSISTED_COMMANDS)
    .map((entry, index) => ({
      id: String(entry.id || `restored_cmd_${index + 1}`),
      raw_input: String(entry.raw_input || ''),
      parsed_command: entry.parsed_command && typeof entry.parsed_command === 'object' ? entry.parsed_command : null,
      route: String(entry.route || STEPHANOS_ACTIVE_SUBVIEW),
      tool_used: entry.tool_used ?? null,
      success: entry.success !== false,
      output_text: truncateText(entry.output_text),
      data_payload: entry.data_payload && typeof entry.data_payload === 'object' ? entry.data_payload : null,
      timing_ms: Number.isFinite(Number(entry.timing_ms)) ? Number(entry.timing_ms) : null,
      timestamp: String(entry.timestamp || ''),
      error: String(entry.error || ''),
      error_code: entry.error_code ?? null,
      response: entry.response && typeof entry.response === 'object'
        ? {
          type: entry.response.type,
          route: entry.response.route,
          success: entry.response.success,
          output_text: truncateText(entry.response.output_text),
          error: entry.response.error,
          error_code: entry.response.error_code,
          debug: entry.response.debug && typeof entry.response.debug === 'object'
            ? { selected_subsystem: entry.response.debug.selected_subsystem || null }
            : undefined,
        }
        : null,
    }));
}

function sanitizeSurfaceFrictionEvents(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_FRICTION_EVENTS);
}

function sanitizeObjectList(entries = [], max = 12) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-max);
}

function normalizeStoredSettings(persistedSession) {
  const defaults = createDefaultRouterSettings();
  const persistedSettings = persistedSession?.session?.providerPreferences || {};

  return {
    ...defaults,
    provider: normalizeProviderSelection(persistedSettings.provider),
    routeMode: normalizeRouteMode(persistedSettings.routeMode),
    devMode: persistedSettings.devMode !== false,
    fallbackEnabled: persistedSettings.fallbackEnabled !== false,
    disableHomeNodeForLocalSession: persistedSettings.disableHomeNodeForLocalSession === true,
    fallbackOrder: Array.isArray(persistedSettings.fallbackOrder)
      ? persistedSettings.fallbackOrder
      : defaults.fallbackOrder,
    providerConfigs: Object.fromEntries(
      PROVIDER_KEYS.map((key) => [key, normalizeProviderDraft(key, {
        ...defaults.providerConfigs[key],
        ...(persistedSettings.providerConfigs?.[key] || {}),
        apiKey: '',
      })]),
    ),
    hostedCloudCognition: (() => {
      const defaultsHosted = createDefaultHostedCloudCognitionSettings();
      const persistedHosted = persistedSettings.hostedCloudCognition && typeof persistedSettings.hostedCloudCognition === 'object'
        ? persistedSettings.hostedCloudCognition
        : {};
      return {
        ...defaultsHosted,
        ...persistedHosted,
        enabled: persistedHosted.enabled === true,
        selectedProvider: HOSTED_COGNITION_PROVIDER_KEYS.includes(persistedHosted.selectedProvider)
          ? persistedHosted.selectedProvider
          : defaultsHosted.selectedProvider,
        providers: Object.fromEntries(HOSTED_COGNITION_PROVIDER_KEYS.map((providerKey) => {
          const defaultsProvider = defaultsHosted.providers?.[providerKey] || {};
          const persistedProvider = persistedHosted.providers?.[providerKey] || {};
          return [providerKey, {
            ...defaultsProvider,
            ...persistedProvider,
            enabled: persistedProvider.enabled !== false,
            baseURL: String(persistedProvider.baseURL || ''),
            model: String(persistedProvider.model || defaultsProvider.model || ''),
          }];
        })),
        lastHealth: Object.fromEntries(HOSTED_COGNITION_PROVIDER_KEYS.map((providerKey) => {
          const defaultsHealth = defaultsHosted.lastHealth?.[providerKey] || {};
          const persistedHealth = persistedHosted.lastHealth?.[providerKey] || {};
          return [providerKey, {
            ...defaultsHealth,
            ...persistedHealth,
          }];
        })),
      };
    })(),
    ollamaConnection: normalizeOllamaConnection(persistedSettings.ollamaConnection || {}),
    surfaceOverride: normalizeSurfaceOverride(persistedSettings.surfaceOverride || DEFAULT_SURFACE_OVERRIDE),
  };
}

function buildInitialRuntimeContext(initialApiRuntimeConfig, { sessionRestoreDiagnostics, homeNodePreference, homeNodeLastKnown }) {
  const frontendOrigin = initialApiRuntimeConfig?.frontendOrigin || '';
  const frontendHost = typeof window !== 'undefined' && window.location?.hostname
    ? String(window.location.hostname || '')
    : '';
  const localDesktopSession = frontendHost === 'localhost' || frontendHost === '127.0.0.1';
  const homeNode = initialApiRuntimeConfig?.homeNode || homeNodePreference || homeNodeLastKnown || null;
  const preferredTarget = localDesktopSession
    ? (initialApiRuntimeConfig?.baseUrl || '')
    : resolveCompatibleTarget(homeNode?.uiUrl || '', frontendOrigin || '', { allowLoopback: false });
  const actualTargetUsed = localDesktopSession
    ? (initialApiRuntimeConfig?.baseUrl || '')
    : resolveCompatibleTarget(homeNode?.backendUrl || '', initialApiRuntimeConfig?.baseUrl || '', { allowLoopback: false });

  return {
    ...initialApiRuntimeConfig,
    apiBaseUrl: initialApiRuntimeConfig?.baseUrl || '',
    backendBaseUrl: initialApiRuntimeConfig?.baseUrl || '',
    preferredTarget,
    actualTargetUsed,
    nodeAddressSource: localDesktopSession
      ? 'local-backend-session'
      : (homeNode?.source || 'route-diagnostics'),
    restoreDecision: sessionRestoreDiagnostics?.reasons?.[0] || '',
    homeNode,
  };
}

function createInitialMemorySnapshot() {
  const currentOrigin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
  const portableHomeNodePreference = readPortableStephanosHomeNodePreference() || null;
  const homeNodePreference = readPersistedStephanosHomeNode() || portableHomeNodePreference || null;
  const homeNodeLastKnown = readPersistedStephanosLastKnownNode() || null;
  const currentHostname = typeof window !== 'undefined' && window.location?.hostname
    ? String(window.location.hostname || '').trim().toLowerCase()
    : '';
  const initialSessionKind = currentHostname === 'localhost' || currentHostname === '127.0.0.1'
    ? 'local-desktop'
    : 'hosted-web';
  const homeBridgeUrl = readPersistedStephanosHomeBridgeUrl(undefined, {
    frontendOrigin: currentOrigin,
    requireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'manual' }),
  }) || '';
  setStephanosHomeBridgeGlobal(homeBridgeUrl);
  const bridgeMemoryRead = readPersistedBridgeMemory();
  const bridgeMemory = bridgeMemoryRead.bridgeMemory;
  const restoredSession = restoreStephanosSessionMemoryForDevice({
    currentOrigin,
    manualNode: homeNodePreference,
    lastKnownNode: homeNodeLastKnown,
  });
  const persistedSession = restoredSession.memory;
  const defaults = createDefaultStephanosSessionMemory();
  const initialApiRuntimeConfig = getApiRuntimeConfig();
  const restoredVisibilityEntries = Object.entries(persistedSession?.session?.ui?.uiLayout || {})
    .filter(([, value]) => typeof value === 'boolean');
  console.info('[WORKSPACE] restored pane visibility state from session memory', {
    panes: restoredVisibilityEntries.length,
    open: restoredVisibilityEntries.filter(([, value]) => value === true).length,
    closed: restoredVisibilityEntries.filter(([, value]) => value === false).length,
  });
  const surfaceOverride = normalizeSurfaceOverride(persistedSession?.session?.providerPreferences?.surfaceOverride || DEFAULT_SURFACE_OVERRIDE);
  const surfaceAwareness = resolveSurfaceAwareness({
    runtimeContext: initialApiRuntimeConfig || {},
    operatorSurfaceOverrides: { mode: surfaceOverride },
  });
  const hasPersistedUiLayout = restoredVisibilityEntries.length > 0;
  const normalizedUiLayout = normalizeUiLayout(persistedSession?.session?.ui?.uiLayout || DEFAULT_UI_LAYOUT);
  const effectiveUiLayout = hasPersistedUiLayout
    ? normalizedUiLayout
    : normalizeUiLayout(resolveSurfaceUiLayoutDefaults(normalizedUiLayout, surfaceAwareness.effectiveSurfaceExperience));

  const initialBridgeTransportPreferences = normalizeBridgeTransportPreferences(
    persistedSession?.session?.bridgeTransportPreferences,
    {
      homeBridgeUrl,
      frontendOrigin: initialApiRuntimeConfig?.frontendOrigin || '',
      manualRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'manual' }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'tailscale' }),
    },
  );
  const rehydratedBridgeTransportPreferences = bridgeMemory.transport !== 'none' && bridgeMemory.backendUrl
    ? normalizeBridgeTransportPreferences({
      ...initialBridgeTransportPreferences,
      selectedTransport: bridgeMemory.transport,
      transports: {
        ...initialBridgeTransportPreferences.transports,
        [bridgeMemory.transport]: {
          ...(initialBridgeTransportPreferences.transports?.[bridgeMemory.transport] || {}),
          backendUrl: bridgeMemory.backendUrl,
          executionUrl: bridgeMemory.executionUrl || '',
          accepted: false,
          active: false,
          usable: false,
          reachability: 'unknown',
          ...(bridgeMemory.transport === 'tailscale'
            ? {
              enabled: true,
              deviceName: bridgeMemory.tailscaleDeviceName,
              hostOverride: bridgeMemory.tailscaleHostnameOverride,
              tailnetIp: bridgeMemory.tailscaleIp,
            }
            : {}),
          reason: 'Remembered from shared memory; validation pending on this surface.',
        },
      },
    }, {
      homeBridgeUrl: bridgeMemory.transport === 'manual' ? bridgeMemory.backendUrl : homeBridgeUrl,
      frontendOrigin: initialApiRuntimeConfig?.frontendOrigin || '',
      manualRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'manual' }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'tailscale' }),
    })
    : initialBridgeTransportPreferences;

  return {
    persistedSession,
    sessionRestoreDiagnostics: restoredSession.diagnostics,
    initialApiRuntimeContext: buildInitialRuntimeContext(initialApiRuntimeConfig, {
      sessionRestoreDiagnostics: restoredSession.diagnostics,
      homeNodePreference,
      homeNodeLastKnown,
    }),
    settings: normalizeStoredSettings(persistedSession),
    uiLayout: effectiveUiLayout,
    paneLayout: {
      order: normalizeOperatorPaneOrder(persistedSession?.session?.ui?.operatorPaneLayout?.order),
    },
    lastRoute: String(persistedSession?.session?.ui?.recentRoute || STEPHANOS_ACTIVE_SUBVIEW),
    commandHistory: sanitizePersistedCommandHistory(
      persistedSession?.working?.recentCommands || defaults.working.recentCommands,
    ),
    workingMemory: {
      ...defaults.working,
      ...(persistedSession?.working || {}),
      recentCommands: sanitizePersistedCommandHistory(persistedSession?.working?.recentCommands || []),
      surfaceFrictionEvents: sanitizeSurfaceFrictionEvents(persistedSession?.working?.surfaceFrictionEvents || []),
      surfaceFrictionPatterns: sanitizeObjectList(persistedSession?.working?.surfaceFrictionPatterns || [], 12),
      surfaceProtocolRecommendations: sanitizeObjectList(persistedSession?.working?.surfaceProtocolRecommendations || [], 12),
      acceptedSurfaceRules: sanitizeObjectList(persistedSession?.working?.acceptedSurfaceRules || [], 24),
      missionPacketWorkflow: normalizeMissionPacketWorkflow(
        persistedSession?.working?.missionPacketWorkflow || createDefaultMissionPacketWorkflow(),
      ),
      missionLineage: normalizeMissionLineageStore(
        persistedSession?.working?.missionLineage || createDefaultMissionLineageStore(),
      ),
    },
    projectMemory: {
      ...defaults.project,
      ...(persistedSession?.project || {}),
    },
    homeNodePreference,
    homeNodeLastKnown,
    homeBridgeUrl,
    bridgeTransportPreferences: rehydratedBridgeTransportPreferences,
    bridgeMemory,
    bridgeMemoryPersistence: bridgeMemoryRead.diagnostics,
    bridgeMemoryRehydrated: bridgeMemory.transport !== 'none' && bridgeMemory.backendUrl
      ? rehydratedBridgeTransportPreferences.transports?.[bridgeMemory.transport]?.accepted !== true
      : false,
    surfaceAwareness,
    surfaceOverride,
  };
}

export function AIStoreProvider({ children }) {
  const initialSnapshot = useMemo(() => createInitialMemorySnapshot(), []);
  const initialSettings = initialSnapshot.settings;
  const [commandHistory, setCommandHistory] = useState(initialSnapshot.commandHistory);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState(initialSnapshot.lastRoute);
  const [uiLayout, setUiLayout] = useState(initialSnapshot.uiLayout);
  const [paneLayout, setPaneLayout] = useState(initialSnapshot.paneLayout);
  const [missionDashboardUiState, setMissionDashboardUiStateState] = useState(normalizeMissionDashboardUiState(initialSnapshot.persistedSession?.session?.ui?.missionDashboard || createDefaultMissionDashboardUiState()));
  const [debugData, setDebugData] = useState({});
  const [provider, setProviderState] = useState(initialSettings.provider);
  const [providerSelectionSource, setProviderSelectionSource] = useState('default:free-tier');
  const [routeMode, setRouteModeState] = useState(initialSettings.routeMode || DEFAULT_ROUTE_MODE);
  const [devMode, setDevModeState] = useState(initialSettings.devMode);
  const [fallbackEnabled, setFallbackEnabledState] = useState(initialSettings.fallbackEnabled);
  const [disableHomeNodeForLocalSession, setDisableHomeNodeForLocalSessionState] = useState(initialSettings.disableHomeNodeForLocalSession === true);
  const [fallbackOrder, setFallbackOrderState] = useState(initialSettings.fallbackOrder);
  const [savedProviderConfigs, setSavedProviderConfigs] = useState(initialSettings.providerConfigs);
  const [draftProviderConfigs, setDraftProviderConfigs] = useState(initialSettings.providerConfigs);
  const [hostedCloudCognition, setHostedCloudCognitionState] = useState(initialSettings.hostedCloudCognition || createDefaultHostedCloudCognitionSettings());
  const [providerDraftStatus, setProviderDraftStatus] = useState(Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { mode: 'saved', message: '', savedAt: null, errors: {} }] )));
  const [providerHealth, setProviderHealth] = useState({});
  const [ollamaConnection, setOllamaConnectionState] = useState(initialSettings.ollamaConnection || DEFAULT_OLLAMA_CONNECTION);
  const [surfaceOverride, setSurfaceOverrideState] = useState(initialSettings.surfaceOverride || DEFAULT_SURFACE_OVERRIDE);
  const [workingMemory, setWorkingMemory] = useState(initialSnapshot.workingMemory);
  const [surfaceFrictionEvents, setSurfaceFrictionEvents] = useState(
    sanitizeSurfaceFrictionEvents(initialSnapshot.workingMemory?.surfaceFrictionEvents || []),
  );
  const [surfaceFrictionPatterns, setSurfaceFrictionPatterns] = useState(
    sanitizeObjectList(initialSnapshot.workingMemory?.surfaceFrictionPatterns || [], 12),
  );
  const [surfaceProtocolRecommendations, setSurfaceProtocolRecommendations] = useState(
    sanitizeObjectList(initialSnapshot.workingMemory?.surfaceProtocolRecommendations || [], 12),
  );
  const [acceptedSurfaceRules, setAcceptedSurfaceRules] = useState(
    sanitizeObjectList(initialSnapshot.workingMemory?.acceptedSurfaceRules || [], 24),
  );
  const [missionPacketWorkflow, setMissionPacketWorkflow] = useState(
    normalizeMissionPacketWorkflow(initialSnapshot.workingMemory?.missionPacketWorkflow || createDefaultMissionPacketWorkflow()),
  );
  const [missionLineage, setMissionLineage] = useState(
    normalizeMissionLineageStore(initialSnapshot.workingMemory?.missionLineage || createDefaultMissionLineageStore()),
  );
  const [projectMemory] = useState(initialSnapshot.projectMemory);
  const [homeNodePreference, setHomeNodePreferenceState] = useState(initialSnapshot.homeNodePreference);
  const [homeNodeLastKnown, setHomeNodeLastKnownState] = useState(initialSnapshot.homeNodeLastKnown);
  const [homeBridgeUrl, setHomeBridgeUrlState] = useState(initialSnapshot.homeBridgeUrl || '');
  const [bridgeTransportPreferences, setBridgeTransportPreferencesState] = useState(
    initialSnapshot.bridgeTransportPreferences || createDefaultBridgeTransportPreferences(),
  );
  const [bridgeMemory, setBridgeMemoryState] = useState(initialSnapshot.bridgeMemory || normalizeHomeBridgeMemory());
  const [bridgeMemoryPersistence, setBridgeMemoryPersistence] = useState(initialSnapshot.bridgeMemoryPersistence || {
    state: 'idle',
    reason: 'No bridge memory persistence event recorded.',
    at: '',
    lastWrite: null,
    persistence: projectPersistenceTruth({ lastWrite: null }),
    reconciledAcrossSurfaces: false,
  });
  const [bridgeMemoryHydrationPending, setBridgeMemoryHydrationPending] = useState(Boolean(getStephanosMemoryRuntime()?.hydrate));
  const [bridgeMemoryRehydrated, setBridgeMemoryRehydrated] = useState(initialSnapshot.bridgeMemoryRehydrated === true);
  const [bridgeAutoRevalidation, setBridgeAutoRevalidation] = useState(DEFAULT_BRIDGE_AUTO_REVALIDATION);
  const [bridgeRevalidationNonce, setBridgeRevalidationNonce] = useState(0);
  const [homeNodeStatus, setHomeNodeStatusState] = useState(DEFAULT_HOME_NODE_STATUS);
  const [sessionRestoreDiagnostics] = useState(initialSnapshot.sessionRestoreDiagnostics || {
    nonLocalSession: false,
    localDesktopSession: true,
    currentHost: '',
    homeNodeHost: '',
    ignoredFields: [],
    reasons: [],
    message: 'Portable session state restored.',
    activeProvider: initialSettings.provider,
    activeProviderConfigAdjusted: false,
  });
  const [lastExecutionMetadata, setLastExecutionMetadata] = useState(null);
  const [uiDiagnostics, setUiDiagnostics] = useState({
    appRootRendered: false,
    aiConsoleRendered: false,
    providerToggleMounted: false,
    componentMarker: 'uninitialized',
    aiConsoleMarker: 'uninitialized',
    providerToggleMarker: 'uninitialized',
  });
  const [apiStatus, setApiStatus] = useState({
    state: 'checking',
    label: 'Checking backend...',
    detail: 'Waiting for health check.',
    target: initialSnapshot.initialApiRuntimeContext?.target || 'local',
    baseUrl: initialSnapshot.initialApiRuntimeContext?.baseUrl || '',
    frontendOrigin: initialSnapshot.initialApiRuntimeContext?.frontendOrigin || '',
    strategy: initialSnapshot.initialApiRuntimeContext?.strategy || 'default:local-stephanos-backend',
    backendTargetEndpoint: initialSnapshot.initialApiRuntimeContext?.backendTargetEndpoint || '',
    healthEndpoint: initialSnapshot.initialApiRuntimeContext?.healthEndpoint || '',
    backendReachable: false,
    backendDefaultProvider: DEFAULT_PROVIDER_KEY,
    runtimeContext: initialSnapshot.initialApiRuntimeContext || null,
    lastCheckedAt: null,
    meta: null,
  });
  const surfaceAwareness = useMemo(() => resolveSurfaceAwareness({
    runtimeContext: apiStatus.runtimeContext || initialSnapshot.initialApiRuntimeContext || {},
    operatorSurfaceOverrides: { mode: surfaceOverride, protocolIds: [] },
  }), [apiStatus.runtimeContext, initialSnapshot.initialApiRuntimeContext, surfaceOverride]);
  const bridgeTransportTruth = useMemo(() => projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
    runtimeBridge: apiStatus?.runtimeContext?.homeNodeBridge || {},
    bridgeMemory,
    bridgeMemoryRehydrated,
    autoRevalidation: bridgeAutoRevalidation,
    bridgeMemoryPersistence,
  }), [apiStatus?.runtimeContext?.homeNodeBridge, bridgeMemory, bridgeMemoryPersistence, bridgeMemoryRehydrated, bridgeTransportPreferences, bridgeAutoRevalidation]);
  const runtimeStatusModel = useMemo(() => ensureRuntimeStatusModel(createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos Mission Console',
    validationState: apiStatus.state === 'offline'
      ? 'error'
      : (apiStatus.state === 'checking' ? 'launching' : 'healthy'),
    selectedProvider: provider,
    routeMode,
    fallbackEnabled,
    fallbackOrder,
    providerHealth,
    backendAvailable: apiStatus.backendReachable,
    runtimeContext: {
      ...(apiStatus.runtimeContext || {
        frontendOrigin: apiStatus.frontendOrigin,
        apiBaseUrl: apiStatus.baseUrl,
        homeNode: apiStatus.runtimeContext?.homeNode || null,
      }),
      surfaceAwareness: {
        ...surfaceAwareness,
        recentFrictionEvents: surfaceFrictionEvents,
        frictionPatterns: surfaceFrictionPatterns,
        surfaceProtocolRecommendations,
        acceptedSurfaceRules,
      },
      bridgeMemory,
      bridgeMemoryRehydrated,
      bridgeAutoRevalidation,
      bridgeTransportTruth,
      persistence: bridgeTransportTruth?.persistence || null,
    },
    activeProviderHint: lastExecutionMetadata?.actual_provider_used || '',
  })), [
    apiStatus.backendReachable,
    apiStatus.baseUrl,
    apiStatus.frontendOrigin,
    apiStatus.runtimeContext,
    apiStatus.state,
    fallbackEnabled,
    fallbackOrder,
    lastExecutionMetadata?.actual_provider_used,
    provider,
    providerHealth,
    routeMode,
    surfaceAwareness,
    bridgeAutoRevalidation,
    bridgeMemory,
    bridgeMemoryRehydrated,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    bridgeTransportTruth,
  ]);
  const bridgeValidationTruth = useMemo(() => resolveBridgeValidationTruth({
    runtimeStatusModel,
    selectedTransport: bridgeTransportPreferences?.selectedTransport || 'manual',
  }), [runtimeStatusModel, bridgeTransportPreferences?.selectedTransport]);
  const canonicalBridgeTransportTruth = runtimeStatusModel?.runtimeContext?.bridgeTransportTruth || bridgeTransportTruth;

  const debugVisible = uiLayout.debugConsole === true;

  useEffect(() => {
    if (!devMode || typeof console?.warn !== 'function') {
      return;
    }

    if (!runtimeStatusModel?.guardrails?.summary?.total) {
      return;
    }

    const issues = [
      ...(runtimeStatusModel.guardrails.errors || []),
      ...(runtimeStatusModel.guardrails.warnings || []),
    ].map((issue) => `${issue.severity.toUpperCase()}: ${issue.message}`);

    if (issues.length > 0) {
      console.warn('[Stephanos Routing Guardrails]', {
        summary: runtimeStatusModel.guardrails.summary,
        issues,
        finalRoute: runtimeStatusModel.finalRoute,
      });
    }
  }, [devMode, runtimeStatusModel]);

  useEffect(() => {
    if (!bridgeMemoryHydrationPending) {
      return;
    }
    let cancelled = false;
    const memory = getStephanosMemoryRuntime();
    if (!memory?.hydrate) {
      setBridgeMemoryHydrationPending(false);
      return;
    }
    void memory.hydrate()
      .catch(() => null)
      .then(() => {
        if (cancelled) return;
        const read = readPersistedBridgeMemory();
        setBridgeMemoryPersistence(read.diagnostics);
        setBridgeMemoryState(read.bridgeMemory);
        if (read.bridgeMemory.transport !== 'none' && read.bridgeMemory.backendUrl) {
          const frontendOrigin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
          setBridgeMemoryRehydrated(true);
          setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
            ...prev,
            selectedTransport: read.bridgeMemory.transport,
            transports: {
              ...(prev?.transports || {}),
              [read.bridgeMemory.transport]: {
                ...(prev?.transports?.[read.bridgeMemory.transport] || {}),
                backendUrl: read.bridgeMemory.backendUrl,
                executionUrl: read.bridgeMemory.executionUrl || '',
                enabled: true,
                accepted: false,
                active: false,
                usable: false,
                reachability: 'unknown',
                ...(read.bridgeMemory.transport === 'tailscale'
                  ? {
                    deviceName: read.bridgeMemory.tailscaleDeviceName,
                    hostOverride: read.bridgeMemory.tailscaleHostnameOverride,
                    tailnetIp: read.bridgeMemory.tailscaleIp,
                    reason: 'Remembered Tailscale bridge loaded from shared memory; validation pending on this surface.',
                  }
                  : {
                    reason: 'Remembered Manual/LAN bridge loaded from shared memory; validation pending on this surface.',
                  }),
              },
            },
          }, {
            homeBridgeUrl: read.bridgeMemory.transport === 'manual' ? read.bridgeMemory.backendUrl : homeBridgeUrl,
            frontendOrigin,
            manualRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: bridgeValidationTruth.sessionKind, selectedTransport: 'manual', fallbackRequireHttps: bridgeValidationTruth.requireHttps }),
            tailscaleRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: bridgeValidationTruth.sessionKind, selectedTransport: 'tailscale' }),
          }));
        }
        setBridgeMemoryHydrationPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridgeMemoryHydrationPending, bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind, homeBridgeUrl]);

  useEffect(() => {
    if (bridgeMemoryHydrationPending) {
      return;
    }
    const rememberedAt = bridgeMemory?.rememberedAt || new Date().toISOString();
    const previousBridgeMemory = normalizeHomeBridgeMemory(bridgeMemory || {});
    const nextBridgeMemory = deriveBridgeMemoryFromPreferences(bridgeTransportPreferences, {
      rememberedAt,
      savedBySurface: surfaceAwareness?.surfaceIdentity?.surfaceId || 'unknown-surface',
      savedBySession: sessionRestoreDiagnostics?.currentHost || 'unknown-session',
      reason: bridgeMemoryRehydrated
        ? 'Remembered Home Bridge loaded from shared memory and awaiting validation on this surface.'
        : 'Home Bridge configuration saved by operator.',
    }, {
      preferredTransport: previousBridgeMemory.transport,
      fallbackMemory: previousBridgeMemory,
      preserveExisting: true,
    });
    const hasManualCandidate = Boolean(bridgeTransportPreferences?.transports?.manual?.backendUrl);
    const hasTailscaleCandidate = Boolean(bridgeTransportPreferences?.transports?.tailscale?.backendUrl);
    const hasAnyCandidate = hasManualCandidate || hasTailscaleCandidate;
    setBridgeMemoryState(nextBridgeMemory);
    setBridgeMemoryPersistence({
      state: 'save-requested',
      reason: nextBridgeMemory.transport !== 'none'
        ? `Persisting remembered ${nextBridgeMemory.transport} Home Bridge config.`
        : 'Persisting cleared Home Bridge memory state.',
      at: new Date().toISOString(),
    });
    const persisted = persistBridgeMemoryToDurableStore(nextBridgeMemory, {
      sessionKind: bridgeValidationTruth.sessionKind,
    });
    if (persisted?.diagnostics) {
      setBridgeMemoryPersistence(persisted.diagnostics);
    }
    if (
      nextBridgeMemory.transport === 'none'
      && previousBridgeMemory.transport !== 'none'
      && hasAnyCandidate
    ) {
      setBridgeMemoryPersistence({
        state: 'save-clobbered',
        reason: 'Bridge config candidates exist, but remembered bridge memory normalized to empty.',
        at: new Date().toISOString(),
      });
    }
  }, [
    bridgeMemoryHydrationPending,
    bridgeMemory?.rememberedAt,
    bridgeMemoryRehydrated,
    bridgeTransportPreferences,
    sessionRestoreDiagnostics?.currentHost,
    surfaceAwareness?.surfaceIdentity?.surfaceId,
  ]);

  useEffect(() => {
    persistStephanosSessionMemory({
      session: {
        providerPreferences: {
          provider,
          routeMode,
          devMode,
          fallbackEnabled,
          disableHomeNodeForLocalSession,
          fallbackOrder,
          providerConfigs: sanitizeConfigForStorage(savedProviderConfigs),
          hostedCloudCognition,
          ollamaConnection: normalizeOllamaConnection(ollamaConnection),
          surfaceOverride: normalizeSurfaceOverride(surfaceOverride),
        },
        bridgeTransportPreferences: normalizeBridgeTransportPreferences(bridgeTransportPreferences, {
          homeBridgeUrl,
          manualRequireHttps: resolveBridgeUrlRequireHttps({
            sessionKind: bridgeValidationTruth.sessionKind,
            selectedTransport: 'manual',
            fallbackRequireHttps: bridgeValidationTruth.requireHttps,
          }),
          tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
            sessionKind: bridgeValidationTruth.sessionKind,
            selectedTransport: 'tailscale',
          }),
        }),
        ui: {
          activeWorkspace: STEPHANOS_ACTIVE_WORKSPACE,
          activeSubview: lastRoute || STEPHANOS_ACTIVE_SUBVIEW,
          recentRoute: lastRoute || STEPHANOS_ACTIVE_SUBVIEW,
          uiLayout: normalizeUiLayout(uiLayout),
          operatorPaneLayout: {
            order: normalizeOperatorPaneOrder(paneLayout.order),
          },
          debugConsoleVisible: debugVisible,
          missionDashboard: normalizeMissionDashboardUiState(missionDashboardUiState),
        },
        homeNodePreference,
      },
      working: {
        ...workingMemory,
        missionPacketWorkflow,
        missionLineage,
        surfaceFrictionEvents: sanitizeSurfaceFrictionEvents(surfaceFrictionEvents),
        surfaceFrictionPatterns: sanitizeObjectList(surfaceFrictionPatterns, 12),
        surfaceProtocolRecommendations: sanitizeObjectList(surfaceProtocolRecommendations, 12),
        acceptedSurfaceRules: sanitizeObjectList(acceptedSurfaceRules, 24),
        recentCommands: sanitizePersistedCommandHistory(commandHistory),
      },
      project: projectMemory,
    });
  }, [
    provider,
    routeMode,
    devMode,
    fallbackEnabled,
    disableHomeNodeForLocalSession,
    fallbackOrder,
    savedProviderConfigs,
    hostedCloudCognition,
    ollamaConnection,
    surfaceOverride,
    bridgeTransportPreferences,
    homeBridgeUrl,
    uiLayout,
    missionDashboardUiState,
    paneLayout,
    lastRoute,
    commandHistory,
    workingMemory,
    missionPacketWorkflow,
    missionLineage,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    projectMemory,
    debugVisible,
  ]);


  const setMissionDashboardUiState = useCallback((nextState) => {
    setMissionDashboardUiStateState((prev) => normalizeMissionDashboardUiState(
      typeof nextState === 'function' ? nextState(prev) : nextState,
    ));
  }, []);

  const setPaneOrder = useCallback((nextOrder) => {
    setPaneLayout((prev) => {
      const resolvedOrder = normalizeOperatorPaneOrder(typeof nextOrder === 'function' ? nextOrder(prev.order) : nextOrder);
      console.info('[PANES] pane order updated', { order: resolvedOrder });
      return { ...prev, order: resolvedOrder };
    });
  }, []);

  const updateUiLayout = useCallback((updater) => {
    setUiLayout((prev) => {
      const candidate = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeUiLayout(candidate);
    });
  }, []);

  const setDebugVisible = useCallback((nextVisible) => {
    updateUiLayout((prev) => ({
      ...prev,
      debugConsole: typeof nextVisible === 'function' ? nextVisible(prev.debugConsole) : nextVisible,
    }));
  }, [updateUiLayout]);

  const setPanelState = useCallback((panelId, isOpen) => {
    if (!(panelId in DEFAULT_UI_LAYOUT)) return;

    setUiLayout((prev) => {
      const resolvedOpen = typeof isOpen === 'function' ? isOpen(prev[panelId]) : isOpen;
      const nextLayout = normalizeUiLayout({
        ...prev,
        [panelId]: resolvedOpen,
      });
      console.info(
        resolvedOpen === true
          ? '[WORKSPACE] persisted open action for pane'
          : '[WORKSPACE] persisted close action for pane',
        { paneId: panelId },
      );
      return nextLayout;
    });
  }, []);

  const togglePanel = useCallback((panelId) => {
    if (!(panelId in DEFAULT_UI_LAYOUT)) return;
    setPanelState(panelId, (prev) => !prev);
  }, [setPanelState]);

  const setProvider = useCallback((nextProvider) => {
    const resolved = normalizeProviderSelection(nextProvider);
    setProviderState(resolved);
    setProviderSelectionSource('saved:user-selection');
  }, []);

  const setRouteMode = useCallback((nextRouteMode) => {
    setRouteModeState(normalizeRouteMode(nextRouteMode));
  }, []);

  const setDevMode = useCallback((next) => {
    setDevModeState(Boolean(next));
  }, []);

  const setFallbackEnabled = useCallback((next) => {
    setFallbackEnabledState(Boolean(next));
  }, []);

  const setDisableHomeNodeForLocalSession = useCallback((next) => {
    setDisableHomeNodeForLocalSessionState(Boolean(next));
  }, []);

  const setOllamaConnection = useCallback((patch = {}) => {
    const nextConnection = normalizeOllamaConnection({ ...ollamaConnection, ...patch });
    setOllamaConnectionState(nextConnection);
    return nextConnection;
  }, [ollamaConnection]);

  const setSurfaceOverride = useCallback((nextMode) => {
    setSurfaceOverrideState(normalizeSurfaceOverride(nextMode));
  }, []);
  const setHostedCloudCognitionEnabled = useCallback((enabled) => {
    setHostedCloudCognitionState((prev) => ({ ...prev, enabled: enabled === true }));
  }, []);
  const setHostedCloudCognitionProvider = useCallback((providerKey) => {
    setHostedCloudCognitionState((prev) => ({
      ...prev,
      selectedProvider: HOSTED_COGNITION_PROVIDER_KEYS.includes(providerKey) ? providerKey : prev.selectedProvider,
    }));
  }, []);
  const updateHostedCloudCognitionProviderConfig = useCallback((providerKey, patch = {}) => {
    if (!HOSTED_COGNITION_PROVIDER_KEYS.includes(providerKey)) return;
    setHostedCloudCognitionState((prev) => ({
      ...prev,
      providers: {
        ...(prev.providers || {}),
        [providerKey]: {
          ...(prev.providers?.[providerKey] || {}),
          ...(patch && typeof patch === 'object' ? patch : {}),
        },
      },
    }));
  }, []);
  const setHostedCloudCognitionHealth = useCallback((providerKey, healthPatch = {}) => {
    if (!HOSTED_COGNITION_PROVIDER_KEYS.includes(providerKey)) return;
    setHostedCloudCognitionState((prev) => ({
      ...prev,
      lastHealth: {
        ...(prev.lastHealth || {}),
        [providerKey]: {
          ...(prev.lastHealth?.[providerKey] || {}),
          ...(healthPatch && typeof healthPatch === 'object' ? healthPatch : {}),
        },
      },
    }));
  }, []);

  const reportSurfaceFriction = useCallback(({ userText = '', source = 'operator-text', now = new Date() } = {}) => {
    const frictionEvent = createFrictionEvent({
      userText,
      source,
      now,
      sessionId: `route:${lastRoute || 'assistant'}`,
      surfaceProfileId: surfaceAwareness.effectiveSurfaceExperience?.selectedProfileId || 'generic-surface',
      activeProtocolIds: surfaceAwareness.effectiveSurfaceExperience?.activeProtocolIds || [],
    });
    setSurfaceFrictionEvents((prev) => {
      const nextEvents = appendFrictionEvent(prev, frictionEvent);
      const nextPatterns = detectSurfaceFrictionPatterns({ events: nextEvents, existingPatterns: surfaceFrictionPatterns });
      setSurfaceFrictionPatterns(nextPatterns);
      const nextRecommendations = generateSurfaceProtocolRecommendations({
        patterns: nextPatterns,
        existingRecommendations: surfaceProtocolRecommendations,
      });
      setSurfaceProtocolRecommendations(nextRecommendations);
      return nextEvents;
    });
    return frictionEvent;
  }, [lastRoute, surfaceAwareness, surfaceFrictionPatterns, surfaceProtocolRecommendations]);

  const clearSurfaceFrictionEvents = useCallback(() => {
    setSurfaceFrictionEvents([]);
    setSurfaceFrictionPatterns([]);
    setSurfaceProtocolRecommendations([]);
    setAcceptedSurfaceRules((prev) => prev.filter((rule) => rule.scope !== 'session'));
  }, []);

  const acceptSurfaceRecommendation = useCallback(({ recommendationId = '', scope = 'session', operatorId = 'operator' } = {}) => {
    const recommendation = surfaceProtocolRecommendations.find((entry) => entry.id === recommendationId);
    if (!recommendation) {
      return null;
    }
    const acceptedRule = acceptSurfaceProtocolRecommendation({
      recommendation,
      scope,
      operatorId,
      now: new Date(),
    });
    setAcceptedSurfaceRules((prev) => appendAcceptedSurfaceRule(prev, acceptedRule));
    setSurfaceProtocolRecommendations((prev) => prev.map((entry) => (
      entry.id === recommendationId ? { ...entry, status: 'accepted', acceptedAt: new Date().toISOString() } : entry
    )));
    return acceptedRule;
  }, [surfaceProtocolRecommendations]);

  const rejectSurfaceRecommendation = useCallback(({ recommendationId = '', operatorId = 'operator' } = {}) => {
    const timestamp = new Date().toISOString();
    setSurfaceProtocolRecommendations((prev) => prev.map((entry) => (
      entry.id === recommendationId
        ? { ...entry, status: 'rejected', rejectedAt: timestamp, rejectionReason: `Rejected by ${operatorId}` }
        : entry
    )));
  }, []);

  const revertSurfaceRule = useCallback(({ ruleId = '', operatorId = 'operator' } = {}) => {
    setAcceptedSurfaceRules((prev) => revertAcceptedSurfaceRule(prev, ruleId, { now: new Date(), operatorId }));
  }, []);

  const explainMemoryToOperator = useCallback(({ mode = 'summary' } = {}) => explainStephanosMemory({
    acceptedSurfaceRules,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    elevatedMemories: [
      ...(Array.isArray(projectMemory?.lessonsLearned) ? projectMemory.lessonsLearned.map((entry, index) => ({
        id: `lesson_${index + 1}`,
        summary: String(entry || ''),
        confidence: 0.74,
        sourceType: 'project.lessonsLearned',
        memoryClass: 'high-confidence-elevated-memory',
      })) : []),
      ...(Array.isArray(projectMemory?.knownConstraints) ? projectMemory.knownConstraints.map((entry, index) => ({
        id: `constraint_${index + 1}`,
        summary: String(entry || ''),
        confidence: 0.71,
        sourceType: 'project.knownConstraints',
        memoryClass: 'high-confidence-elevated-memory',
      })) : []),
    ],
  }, { mode }), [
    acceptedSurfaceRules,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    projectMemory,
  ]);

  const rememberSuccessfulOllamaConnection = useCallback(({ baseURL = '', host = '', model = '' } = {}) => {
    const normalizedHost = String(host || '').trim();
    const nextConnection = normalizeOllamaConnection({
      ...ollamaConnection,
      lastSuccessfulBaseURL: baseURL || ollamaConnection.lastSuccessfulBaseURL,
      lastSuccessfulHost: normalizedHost || ollamaConnection.lastSuccessfulHost,
      lastSelectedModel: model || ollamaConnection.lastSelectedModel,
      recentHosts: [normalizedHost, ...(ollamaConnection.recentHosts || [])].filter(Boolean),
    });
    setOllamaConnectionState(nextConnection);
    return nextConnection;
  }, [ollamaConnection]);

  const resetToFreeMode = () => {
    const defaults = createDefaultRouterSettings();
    const sessionSafe = Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { ...defaults.providerConfigs[key], apiKey: '' }]));
    const nextUiLayout = { ...DEFAULT_UI_LAYOUT };
    const nextWorkingMemory = createDefaultStephanosSessionMemory().working;
    setProviderState(defaults.provider);
    setRouteModeState(defaults.routeMode);
    setDevModeState(defaults.devMode);
    setFallbackEnabledState(defaults.fallbackEnabled);
    setDisableHomeNodeForLocalSessionState(defaults.disableHomeNodeForLocalSession === true);
    setFallbackOrderState(defaults.fallbackOrder);
    setSavedProviderConfigs(sessionSafe);
    setDraftProviderConfigs(sessionSafe);
    setSurfaceOverrideState(DEFAULT_SURFACE_OVERRIDE);
    setOllamaConnectionState(DEFAULT_OLLAMA_CONNECTION);
    setWorkingMemory(nextWorkingMemory);
    setMissionPacketWorkflow(normalizeMissionPacketWorkflow(nextWorkingMemory.missionPacketWorkflow || createDefaultMissionPacketWorkflow()));
    setCommandHistory([]);
    setLastRoute(STEPHANOS_ACTIVE_SUBVIEW);
    setHomeNodePreferenceState(null);
    setHomeNodeLastKnownState(null);
    setHomeBridgeUrlState('');
    setBridgeTransportPreferencesState(createDefaultBridgeTransportPreferences());
    setBridgeAutoRevalidation(DEFAULT_BRIDGE_AUTO_REVALIDATION);
    setHomeNodeStatusState(DEFAULT_HOME_NODE_STATUS);
    setProviderSelectionSource('default:free-tier');
    setUiLayout(nextUiLayout);
    setPaneLayout({ order: [...DEFAULT_OPERATOR_PANE_ORDER] });
    clearPersistedStephanosSessionMemory();
    clearPersistedStephanosHomeNode();
    clearPersistedStephanosHomeBridgeUrl();
    persistStephanosLastKnownNode(null);
    setStephanosHomeBridgeGlobal('');
  };

  const getDraftProviderConfig = useCallback((providerKey) => draftProviderConfigs[providerKey], [draftProviderConfigs]);
  const getSavedProviderConfig = useCallback((providerKey) => savedProviderConfigs[providerKey], [savedProviderConfigs]);
  const getEffectiveProviderConfig = useCallback((providerKey) => (
    isDraftDirty(providerKey) ? draftProviderConfigs[providerKey] : savedProviderConfigs[providerKey]
  ), [draftProviderConfigs, savedProviderConfigs]);
  const getEffectiveProviderConfigs = useCallback(() => Object.fromEntries(
    PROVIDER_KEYS.map((key) => [key, getEffectiveProviderConfig(key)]),
  ), [getEffectiveProviderConfig]);
  const getActiveProviderConfig = useCallback(() => getEffectiveProviderConfig(provider), [getEffectiveProviderConfig, provider]);
  const getActiveProviderConfigSource = useCallback(() => {
    if (isDraftDirty(provider)) {
      return 'draft:unsaved';
    }

    if (sessionRestoreDiagnostics.activeProvider === provider && sessionRestoreDiagnostics.activeProviderConfigAdjusted) {
      return 'saved:portable-session';
    }

    if (sessionRestoreDiagnostics.ignoredFields?.includes(`providerConfigs.${provider}.baseURL`)) {
      return 'saved:portable-session';
    }

    return 'saved:session';
  }, [provider, draftProviderConfigs, savedProviderConfigs, sessionRestoreDiagnostics]);

  const updateDraftProviderConfig = useCallback((providerKey, patch) => {
    const sanitizedPatch = patch && typeof patch === 'object'
      ? Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'apiKey'))
      : {};
    setDraftProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: normalizeProviderDraft(providerKey, { ...prev[providerKey], ...sanitizedPatch, apiKey: '' }),
    }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'draft', message: '', errors: {} } }));
  }, []);

  const saveDraftProviderConfig = useCallback((providerKey) => {
    const draft = normalizeProviderDraft(providerKey, { ...draftProviderConfigs[providerKey], apiKey: '' });
    const validation = validateProviderDraft(providerKey, draft);
    if (!validation.isValid) {
      setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'draft', message: 'Fix validation errors before saving.', errors: validation.errors } }));
      return { ok: false, errors: validation.errors };
    }

    const nextSaved = { ...savedProviderConfigs, [providerKey]: draft };
    const nextConnection = providerKey === 'ollama'
      ? normalizeOllamaConnection({
        ...ollamaConnection,
        lastSelectedModel: draft.model || ollamaConnection.lastSelectedModel,
      })
      : ollamaConnection;

    setSavedProviderConfigs(nextSaved);
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: draft }));
    if (providerKey === 'ollama') {
      setOllamaConnectionState(nextConnection);
    }
    const savedAt = new Date().toISOString();
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { mode: 'saved', message: `${PROVIDER_DEFINITIONS[providerKey].label} settings applied.`, savedAt, errors: {} } }));
    return { ok: true, savedAt };
  }, [draftProviderConfigs, savedProviderConfigs, ollamaConnection]);

  const revertDraftProviderConfig = useCallback((providerKey) => {
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: savedProviderConfigs[providerKey] }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'saved', message: 'Draft reverted.', errors: {} } }));
  }, [savedProviderConfigs]);

  const resetProviderConfig = useCallback((providerKey) => {
    const nextConfig = { ...PROVIDER_DEFINITIONS[providerKey].defaults, apiKey: '' };
    const nextSaved = { ...savedProviderConfigs, [providerKey]: nextConfig };
    setSavedProviderConfigs(nextSaved);
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: nextConfig }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'saved', message: `${PROVIDER_DEFINITIONS[providerKey].label} reset.`, errors: {} } }));
  }, [savedProviderConfigs]);

  const isDraftDirty = (providerKey) => JSON.stringify(draftProviderConfigs[providerKey]) !== JSON.stringify(savedProviderConfigs[providerKey]);

  const setHomeNodePreference = useCallback((patch = {}) => {
    const normalizedPreference = patch === null
      ? null
      : normalizeStephanosHomeNode({ ...(homeNodePreference || {}), ...patch }, { source: 'manual' });
    const nextPreference = normalizedPreference && isValidStephanosHomeNode(normalizedPreference)
      ? normalizedPreference
      : null;
    setHomeNodePreferenceState(nextPreference);
    if (nextPreference) {
      persistStephanosHomeNodePreference(nextPreference);
    } else {
      clearPersistedStephanosHomeNode();
    }
    return nextPreference;
  }, [homeNodePreference]);

  const setHomeNodeLastKnown = useCallback((node = null) => {
    const nextNode = node ? normalizeStephanosHomeNode(node, { source: node.source || 'lastKnown' }) : null;
    setHomeNodeLastKnownState(nextNode);
    persistStephanosLastKnownNode(nextNode);
    return nextNode;
  }, []);

  const setHomeNodeStatus = useCallback((nextStatus = DEFAULT_HOME_NODE_STATUS) => {
    setHomeNodeStatusState({
      ...DEFAULT_HOME_NODE_STATUS,
      ...(nextStatus || {}),
      attempts: Array.isArray(nextStatus?.attempts) ? nextStatus.attempts : [],
    });
  }, []);

  const saveBridgeTransportConfig = useCallback((transportKey, candidateUrl = '', patch = {}) => {
    const normalizedTransport = normalizeBridgeTransportSelection(transportKey);
    const frontendOrigin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
    const requireHttps = resolveBridgeUrlRequireHttps({
      sessionKind: bridgeValidationTruth.sessionKind,
      selectedTransport: normalizedTransport,
      fallbackRequireHttps: bridgeValidationTruth.requireHttps,
    });
    const validation = validateStephanosHomeBridgeUrl(candidateUrl, { frontendOrigin, requireHttps });
    if (!validation.ok) {
      setBridgeMemoryPersistence({
        state: 'save-clobbered',
        reason: validation.reason || 'Home Bridge save blocked by canonical validation.',
        at: new Date().toISOString(),
        bridgeMemoryWriteAttempted: true,
        bridgeMemoryWriteSucceeded: false,
        bridgeMemoryStorageKey: resolveBridgeMemoryStorageKey(),
        bridgeMemoryStorageScope: getStephanosMemoryRuntime() ? 'shared-runtime-memory' : 'unavailable',
        bridgeMemoryLastRawValueSummary: 'validation-blocked',
        bridgeInputRaw: String(candidateUrl || '').trim(),
        bridgeInputNormalized: validation.normalizedUrl || '',
        lastWrite: normalizePersistenceResult({
          attempted: true,
          succeeded: false,
          timestamp: new Date().toISOString(),
          source: resolvePersistenceWriteSource(bridgeValidationTruth.sessionKind),
          error: {
            code: 'validation-blocked',
            message: validation.reason || 'Home Bridge save blocked by canonical validation.',
          },
        }),
        persistence: projectPersistenceTruth({
          lastWrite: normalizePersistenceResult({
            attempted: true,
            succeeded: false,
            timestamp: new Date().toISOString(),
            source: resolvePersistenceWriteSource(bridgeValidationTruth.sessionKind),
            error: {
              code: 'validation-blocked',
              message: validation.reason || 'Home Bridge save blocked by canonical validation.',
            },
          }),
          reconciledAcrossSurfaces: false,
        }),
        reconciledAcrossSurfaces: false,
      });
      return { ok: false, reason: validation.reason || 'invalid-home-bridge-url', normalizedUrl: '' };
    }

    if (normalizedTransport === 'manual') {
      const persistedManual = persistStephanosHomeBridgeUrl(validation.normalizedUrl, undefined, {
        frontendOrigin,
        requireHttps,
      });
      if (!persistedManual.ok) {
        setBridgeMemoryPersistence({
          state: 'save-clobbered',
          reason: persistedManual.reason || 'Failed to persist manual bridge URL.',
          at: new Date().toISOString(),
          bridgeMemoryWriteAttempted: true,
          bridgeMemoryWriteSucceeded: false,
          bridgeMemoryStorageKey: resolveBridgeMemoryStorageKey(),
          bridgeMemoryStorageScope: getStephanosMemoryRuntime() ? 'shared-runtime-memory' : 'unavailable',
          bridgeMemoryLastRawValueSummary: 'manual-url-persist-failed',
          bridgeInputRaw: String(candidateUrl || '').trim(),
          bridgeInputNormalized: validation.normalizedUrl || '',
        });
        return { ok: false, reason: persistedManual.reason || 'Failed to persist bridge URL.', normalizedUrl: '' };
      }
      setStephanosHomeBridgeGlobal(validation.normalizedUrl);
      setHomeBridgeUrlState(validation.normalizedUrl);
    }

    const now = new Date().toISOString();
    const nextPreferences = normalizeBridgeTransportPreferences({
      ...bridgeTransportPreferences,
      selectedTransport: normalizedTransport,
      transports: {
        ...(bridgeTransportPreferences?.transports || {}),
        [normalizedTransport]: {
          ...(bridgeTransportPreferences?.transports?.[normalizedTransport] || {}),
          ...(patch && typeof patch === 'object' ? patch : {}),
          enabled: true,
          backendUrl: validation.normalizedUrl,
        },
      },
    }, {
      homeBridgeUrl: normalizedTransport === 'manual' ? validation.normalizedUrl : homeBridgeUrl,
      frontendOrigin,
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    });
    setBridgeTransportPreferencesState(nextPreferences);
    setBridgeAutoRevalidation(DEFAULT_BRIDGE_AUTO_REVALIDATION);
    setBridgeMemoryRehydrated(false);

    const nextBridgeMemory = deriveBridgeMemoryFromPreferences(nextPreferences, {
      rememberedAt: bridgeMemory?.rememberedAt || now,
      savedBySurface: surfaceAwareness?.surfaceIdentity?.surfaceId || 'unknown-surface',
      savedBySession: sessionRestoreDiagnostics?.currentHost || 'unknown-session',
      reason: 'Home Bridge configuration saved by operator.',
    }, {
      preferredTransport: normalizedTransport,
      fallbackMemory: normalizeHomeBridgeMemory(bridgeMemory || {}),
      preserveExisting: true,
    });
    setBridgeMemoryState(nextBridgeMemory);
    setBridgeMemoryPersistence({
      state: 'save-requested',
      reason: `Persisting remembered ${nextBridgeMemory.transport || normalizedTransport} Home Bridge config.`,
      at: now,
      bridgeMemoryWriteAttempted: true,
      bridgeMemoryWriteSucceeded: false,
      bridgeMemoryStorageKey: resolveBridgeMemoryStorageKey(),
      bridgeMemoryStorageScope: getStephanosMemoryRuntime() ? 'shared-runtime-memory' : 'unavailable',
      bridgeMemoryLastRawValueSummary: summarizeBridgeMemoryPayload(nextBridgeMemory),
      bridgeInputRaw: String(candidateUrl || '').trim(),
      bridgeInputNormalized: validation.normalizedUrl,
      bridgePersistedValue: validation.normalizedUrl,
      lastWrite: normalizePersistenceResult({
        attempted: true,
        succeeded: false,
        timestamp: now,
        source: resolvePersistenceWriteSource(bridgeValidationTruth.sessionKind),
        error: {
          code: 'save-pending',
          message: 'Saving…',
        },
      }),
      persistence: projectPersistenceTruth({
        lastWrite: normalizePersistenceResult({
          attempted: true,
          succeeded: false,
          timestamp: now,
          source: resolvePersistenceWriteSource(bridgeValidationTruth.sessionKind),
          error: {
            code: 'save-pending',
            message: 'Saving…',
          },
        }),
      }),
      reconciledAcrossSurfaces: false,
    });
    const persisted = persistBridgeMemoryToDurableStore(nextBridgeMemory, {
      sessionKind: bridgeValidationTruth.sessionKind,
    });
    if (persisted?.diagnostics) {
      setBridgeMemoryPersistence(persisted.diagnostics);
    }
    return {
      ok: Boolean(persisted?.ok),
      reason: persisted?.ok ? '' : (persisted?.diagnostics?.reason || 'Shared durable memory write failed.'),
      normalizedUrl: validation.normalizedUrl,
      persistenceResult: persisted?.persistenceResult || null,
    };
  }, [
    bridgeMemory,
    bridgeTransportPreferences,
    bridgeValidationTruth.requireHttps,
    bridgeValidationTruth.sessionKind,
    homeBridgeUrl,
    sessionRestoreDiagnostics?.currentHost,
    surfaceAwareness?.surfaceIdentity?.surfaceId,
  ]);

  const saveHomeBridgeUrl = useCallback((candidateUrl = '') => saveBridgeTransportConfig('manual', candidateUrl, {
    accepted: true,
    reason: 'Manual/LAN bridge URL saved by operator.',
  }), [saveBridgeTransportConfig]);

  const clearHomeBridgeUrl = useCallback(() => {
    clearPersistedStephanosHomeBridgeUrl();
    setStephanosHomeBridgeGlobal('');
    setHomeBridgeUrlState('');
    const clearedBridgeMemory = normalizeHomeBridgeMemory();
    setBridgeMemoryState(clearedBridgeMemory);
    setBridgeMemoryRehydrated(false);
    setBridgeAutoRevalidation(DEFAULT_BRIDGE_AUTO_REVALIDATION);
    const clearedPersistence = persistBridgeMemoryToDurableStore(clearedBridgeMemory, {
      sessionKind: bridgeValidationTruth.sessionKind,
    });
    setBridgeMemoryPersistence(clearedPersistence?.diagnostics || {
      state: 'save-clobbered',
      reason: 'Failed to clear remembered Home Bridge memory in shared durable store.',
      at: new Date().toISOString(),
    });
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      transports: {
        ...(prev?.transports || {}),
        manual: {
          ...(prev?.transports?.manual || {}),
          backendUrl: '',
          accepted: false,
          reachability: 'unknown',
          reason: 'Manual/LAN bridge not configured.',
        },
      },
    }, {
      homeBridgeUrl: '',
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    return { ok: true };
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind]);



  const setBridgeTransportSelection = useCallback((transportKey) => {
    const selectedTransport = normalizeBridgeTransportSelection(transportKey);
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      selectedTransport,
    }, {
      homeBridgeUrl,
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    return selectedTransport;
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind, homeBridgeUrl]);

  const updateBridgeTransportConfig = useCallback((transportKey, patch = {}) => {
    const normalizedTransport = normalizeBridgeTransportSelection(transportKey);
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      transports: {
        ...(prev?.transports || {}),
        [normalizedTransport]: {
          ...(prev?.transports?.[normalizedTransport] || {}),
          ...(patch && typeof patch === 'object' ? patch : {}),
        },
      },
    }, {
      homeBridgeUrl,
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    if (patch?.accepted === true || patch?.backendUrl === '') {
      setBridgeMemoryRehydrated(false);
    }
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind, homeBridgeUrl]);

  const revalidateRememberedBridge = useCallback((trigger = 'manual') => {
    setBridgeAutoRevalidation((prev) => ({
      ...prev,
      state: 'idle',
      reason: trigger === 'manual'
        ? 'Manual remembered-bridge revalidation requested.'
        : 'Remembered bridge revalidation scheduled.',
      trigger,
      nextRetryAt: '',
    }));
    setBridgeRevalidationNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sessionKind = bridgeValidationTruth?.sessionKind || 'unknown';
    const plan = resolveAutoBridgeRevalidationPlan({
      bridgeMemory,
      preferences: bridgeTransportPreferences,
      bridgeValidationTruth,
    });
    const attemptedConfigKey = buildBridgeRevalidationAttemptedConfigKey(plan, bridgeMemory);
    const attemptCount = Number(bridgeAutoRevalidation?.attemptCount || 0);
    const terminalStates = new Set(['skipped', 'validation-failed', 'unreachable', 'revalidated', 'execution-incompatible', 'blocked-by-policy', 'backoff']);
    const alreadyAttemptedCurrentConfig = bridgeRevalidationNonce === 0
      && bridgeAutoRevalidation.attemptedConfigKey === attemptedConfigKey
      && attemptCount >= BRIDGE_AUTO_REVALIDATION_MAX_ATTEMPTS
      && terminalStates.has(bridgeAutoRevalidation.state);
    if (alreadyAttemptedCurrentConfig) {
      return () => {
        cancelled = true;
      };
    }
    if (!plan.shouldAttempt || !plan.transport || !plan.candidateUrl) {
      setBridgeAutoRevalidation((prev) => (
        prev.state === 'revalidated' && prev.attemptedConfigKey === attemptedConfigKey
          ? prev
          : {
            ...prev,
            state: plan.policyAllowed === false ? 'blocked-by-policy' : 'skipped',
            reason: plan.reason || 'Remembered bridge not eligible for auto-revalidation.',
            attemptedAt: prev.attemptedAt || new Date().toISOString(),
            attemptedConfigKey,
            trigger: prev.trigger || 'startup',
            attemptCount: prev.attemptCount || 0,
            promotionReason: prev.promotionReason || 'Remembered bridge retained but not promoted.',
          }
      ));
      return () => {
        cancelled = true;
      };
    }
    if (bridgeAutoRevalidation.state === 'revalidated' && bridgeAutoRevalidation.attemptedAt
      && bridgeAutoRevalidation.attemptedConfigKey === attemptedConfigKey) {
      return () => {
        cancelled = true;
      };
    }
    const nextRetryAtMs = Date.parse(bridgeAutoRevalidation?.nextRetryAt || '');
    if (Number.isFinite(nextRetryAtMs) && Date.now() < nextRetryAtMs && bridgeRevalidationNonce === 0) {
      setBridgeAutoRevalidation((prev) => ({
        ...prev,
        state: 'backoff',
        reason: prev.reason || 'Remembered bridge retry is backing off after a prior failure.',
        attemptedConfigKey,
      }));
      return () => {
        cancelled = true;
      };
    }
    if (attemptCount >= BRIDGE_AUTO_REVALIDATION_MAX_ATTEMPTS && bridgeRevalidationNonce === 0) {
      setBridgeAutoRevalidation((prev) => ({
        ...prev,
        state: 'backoff',
        reason: 'Remembered bridge auto-validation exhausted bounded retries for this surface session.',
        attemptedConfigKey,
        nextRetryAt: new Date(Date.now() + BRIDGE_AUTO_REVALIDATION_BACKOFF_MS).toISOString(),
      }));
      return () => {
        cancelled = true;
      };
    }

    const frontendOrigin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
    const trigger = bridgeRevalidationNonce > 0 ? 'manual-retry' : (bridgeAutoRevalidation.trigger || 'startup');
    const nextAttemptCount = bridgeAutoRevalidation.attemptedConfigKey === attemptedConfigKey
      ? attemptCount + 1
      : 1;
    const executeAutoRevalidation = async () => {
      setBridgeAutoRevalidation({
        state: 'validating',
        reason: `Validating remembered ${plan.transport} bridge for this surface (${sessionKind}).`,
        attemptedAt: new Date().toISOString(),
        attemptedConfigKey,
        attemptCount: nextAttemptCount,
        trigger,
        nextRetryAt: '',
        promotionReason: '',
      });
      const validation = validateStephanosHomeBridgeUrl(plan.candidateUrl, {
        frontendOrigin,
        requireHttps: plan.requireHttps !== false,
      });
      if (!validation.ok) {
        if (cancelled) return;
        updateBridgeTransportConfig(plan.transport, {
          accepted: false,
          active: false,
          usable: false,
          reachability: 'invalid',
          reason: validation.reason || 'Remembered bridge failed canonical validation on this surface.',
        });
        setBridgeAutoRevalidation({
          state: 'validation-failed',
          reason: validation.reason || 'Remembered bridge failed canonical validation on this surface.',
          attemptedAt: new Date().toISOString(),
          attemptedConfigKey,
          attemptCount: nextAttemptCount,
          trigger,
          nextRetryAt: new Date(Date.now() + BRIDGE_AUTO_REVALIDATION_BACKOFF_MS).toISOString(),
          promotionReason: 'Remembered bridge retained but not promoted because canonical validation failed.',
        });
        return;
      }
      if (plan.transport === 'manual') {
        setHomeBridgeUrlState(validation.normalizedUrl);
        setStephanosHomeBridgeGlobal(validation.normalizedUrl);
      }
      const frontendProtocol = (() => {
        try {
          return new URL(frontendOrigin).protocol;
        } catch {
          return '';
        }
      })();
      const bridgeProtocol = (() => {
        try {
          return new URL(validation.normalizedUrl).protocol;
        } catch {
          return '';
        }
      })();
      const backendTargetDiagnostic = apiStatus?.runtimeContext?.routeDiagnostics?.['backend-target'] || {};
      const existingDirectReachability = backendTargetDiagnostic.available === true
        ? 'reachable'
        : 'unknown';
      const preferredHostedExecutionUrl = plan.transport === 'tailscale'
        ? String(plan.hostedExecutionCandidate || bridgeTransportPreferences?.transports?.tailscale?.executionUrl || '').trim()
        : '';
      const preferredHostedExecutionValidation = preferredHostedExecutionUrl
        ? validateStephanosHomeBridgeUrl(preferredHostedExecutionUrl, {
          frontendOrigin,
          requireHttps: true,
        })
        : { ok: false, normalizedUrl: '' };
      const executionProbeTarget = preferredHostedExecutionValidation.ok
        ? preferredHostedExecutionValidation.normalizedUrl
        : validation.normalizedUrl;
      if (sessionKind === 'hosted-web' && frontendProtocol === 'https:' && bridgeProtocol === 'http:') {
        if (preferredHostedExecutionValidation.ok) {
          updateBridgeTransportConfig(plan.transport, {
            enabled: true,
            backendUrl: validation.normalizedUrl,
            executionUrl: preferredHostedExecutionValidation.normalizedUrl,
            accepted: false,
            active: false,
            usable: false,
            reachability: 'pending',
            reason: 'Remembered operator transport is HTTP; using configured HTTPS hosted execution bridge target.',
          });
          setBridgeAutoRevalidation({
            state: 'probing',
            reason: 'Using configured HTTPS hosted execution bridge target for hosted revalidation.',
            attemptedAt: new Date().toISOString(),
            attemptedConfigKey,
            attemptCount: nextAttemptCount,
            trigger,
            directReachability: existingDirectReachability,
            executionCompatibility: 'compatible',
            executionTarget: preferredHostedExecutionValidation.normalizedUrl,
            executionReason: '',
            infrastructureRequirement: '',
            promotionReason: '',
          });
        } else {
          const reason = 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.';
          updateBridgeTransportConfig(plan.transport, {
            enabled: true,
            backendUrl: validation.normalizedUrl,
            accepted: false,
            active: false,
            usable: false,
            reachability: existingDirectReachability === 'reachable' ? 'reachable' : 'unknown',
            reason,
          });
          setBridgeAutoRevalidation({
            state: 'execution-incompatible',
            reason,
            attemptedAt: new Date().toISOString(),
            attemptedConfigKey,
            attemptCount: nextAttemptCount,
            trigger,
            directReachability: existingDirectReachability,
            executionCompatibility: 'mixed-scheme-blocked',
            executionTarget: '',
            executionReason: reason,
            infrastructureRequirement: 'Publish the Home Bridge on HTTPS (or provide an HTTPS reverse proxy) to allow hosted execution from HTTPS surfaces.',
            nextRetryAt: new Date(Date.now() + BRIDGE_AUTO_REVALIDATION_BACKOFF_MS).toISOString(),
            promotionReason: 'Remembered bridge retained but blocked by hosted/browser policy; not promoted.',
          });
          return;
        }
      }
      updateBridgeTransportConfig(plan.transport, {
        backendUrl: validation.normalizedUrl,
        ...(preferredHostedExecutionValidation.ok ? { executionUrl: preferredHostedExecutionValidation.normalizedUrl } : {}),
        accepted: false,
        active: false,
        usable: false,
        reachability: 'pending',
        reason: 'Remembered bridge passed validation; probing current-surface reachability.',
      });
      setBridgeAutoRevalidation({
        state: 'probing',
        reason: 'Remembered bridge validated; probing reachability from this surface.',
        attemptedAt: new Date().toISOString(),
        attemptedConfigKey,
        attemptCount: nextAttemptCount,
        trigger,
        directReachability: 'unknown',
        executionCompatibility: 'compatible',
        executionTarget: executionProbeTarget,
        executionReason: '',
        infrastructureRequirement: '',
        promotionReason: '',
      });
      setBridgeMemoryPersistence((prev) => ({
        ...(prev || {}),
        bridgeProbeTarget: executionProbeTarget,
      }));
      try {
        const probe = await checkApiHealth({ baseUrl: executionProbeTarget, timeoutMs: 12000 });
        if (cancelled) return;
        const serviceOk = shouldTreatBridgeHealthProbeAsReachable(probe);
        const nextReachability = serviceOk ? 'reachable' : 'unreachable';
        updateBridgeTransportConfig(plan.transport, {
          enabled: true,
          backendUrl: validation.normalizedUrl,
          ...(preferredHostedExecutionValidation.ok ? { executionUrl: preferredHostedExecutionValidation.normalizedUrl } : {}),
          accepted: serviceOk,
          active: serviceOk,
          usable: serviceOk,
          reachability: nextReachability,
          reason: serviceOk
            ? 'Remembered bridge revalidated and reachable on this hosted surface.'
            : (probe.data?.error || 'Remembered bridge probe failed from this hosted surface.'),
        });
        setApiStatus((prev) => ({
          ...prev,
          runtimeContext: {
            ...(prev?.runtimeContext || {}),
            homeNodeBridge: {
              ...(prev?.runtimeContext?.homeNodeBridge || {}),
              configured: true,
              accepted: serviceOk,
              backendUrl: executionProbeTarget,
              reachability: nextReachability,
              reason: serviceOk
                ? 'Remembered bridge revalidated and promoted to live route truth.'
                : (probe.data?.error || 'Remembered bridge unreachable from this hosted surface.'),
              source: `bridge-memory:auto-revalidation:${plan.transport}`,
              lastCheckedAt: new Date().toISOString(),
            },
          },
        }));
        setBridgeAutoRevalidation({
          state: serviceOk ? 'revalidated' : 'unreachable',
          reason: serviceOk
            ? 'Remembered Home Bridge revalidated successfully.'
            : (probe.data?.error || 'Remembered Home Bridge is unreachable from this surface.'),
          attemptedAt: new Date().toISOString(),
          attemptedConfigKey,
          attemptCount: nextAttemptCount,
          trigger,
          directReachability: serviceOk ? 'reachable' : 'unreachable',
          executionCompatibility: 'compatible',
          executionTarget: executionProbeTarget,
          executionReason: '',
          infrastructureRequirement: '',
          nextRetryAt: serviceOk ? '' : new Date(Date.now() + BRIDGE_AUTO_REVALIDATION_BACKOFF_MS).toISOString(),
          promotionReason: serviceOk
            ? `Remembered ${plan.transport} bridge auto-validated and promoted into live route candidates on this surface.`
            : 'Remembered bridge retained but not promoted because current-surface reachability failed.',
        });
        if (serviceOk) {
          setBridgeTransportSelection(plan.transport);
          setBridgeMemoryRehydrated(false);
        }
      } catch (error) {
        if (cancelled) return;
        updateBridgeTransportConfig(plan.transport, {
          accepted: false,
          active: false,
          usable: false,
          reachability: 'unreachable',
          reason: error?.message || 'Remembered bridge probe failed before receiving a response.',
        });
        setBridgeAutoRevalidation({
          state: 'unreachable',
          reason: error?.message || 'Remembered Home Bridge probe failed from this surface.',
          attemptedAt: new Date().toISOString(),
          attemptedConfigKey,
          attemptCount: nextAttemptCount,
          trigger,
          directReachability: 'unknown',
          executionCompatibility: 'unknown',
          executionTarget: executionProbeTarget,
          executionReason: error?.message || '',
          infrastructureRequirement: '',
          nextRetryAt: new Date(Date.now() + BRIDGE_AUTO_REVALIDATION_BACKOFF_MS).toISOString(),
          promotionReason: 'Remembered bridge retained but not promoted because probe failed on this surface.',
        });
      }
    };
    void executeAutoRevalidation();
    return () => {
      cancelled = true;
    };
  }, [
    apiStatus?.runtimeContext?.routeDiagnostics,
    bridgeMemory,
    bridgeTransportPreferences,
    bridgeValidationTruth,
    bridgeAutoRevalidation.attemptedAt,
    bridgeAutoRevalidation.attemptCount,
    bridgeAutoRevalidation.attemptedConfigKey,
    bridgeAutoRevalidation.nextRetryAt,
    bridgeAutoRevalidation.state,
    bridgeAutoRevalidation.trigger,
    bridgeRevalidationNonce,
    setBridgeTransportSelection,
    setApiStatus,
    updateBridgeTransportConfig,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || bridgeMemoryHydrationPending) {
      return undefined;
    }
    const terminalFailed = new Set(['unreachable', 'validation-failed', 'execution-incompatible', 'blocked-by-policy']);
    const attemptCount = Number(bridgeAutoRevalidation?.attemptCount || 0);
    if (!terminalFailed.has(bridgeAutoRevalidation?.state) || attemptCount >= BRIDGE_AUTO_REVALIDATION_MAX_ATTEMPTS) {
      return undefined;
    }
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const nextRetryAtMs = Date.parse(bridgeAutoRevalidation?.nextRetryAt || '');
      if (Number.isFinite(nextRetryAtMs) && Date.now() < nextRetryAtMs) return;
      revalidateRememberedBridge('focus-retry');
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [
    bridgeAutoRevalidation?.attemptCount,
    bridgeAutoRevalidation?.nextRetryAt,
    bridgeAutoRevalidation?.state,
    bridgeMemoryHydrationPending,
    revalidateRememberedBridge,
  ]);
  const value = useMemo(() => ({
    commandHistory,
    setCommandHistory,
    status,
    setStatus,
    isBusy,
    setIsBusy,
    lastRoute,
    setLastRoute,
    debugVisible,
    setDebugVisible,
    debugData,
    setDebugData,
    uiLayout,
    paneLayout,
    missionDashboardUiState,
    togglePanel,
    setPanelState,
    setPaneOrder,
    setMissionDashboardUiState,
    provider,
    setProvider,
    providerSelectionSource,
    routeMode,
    setRouteMode,
    devMode,
    setDevMode,
    fallbackEnabled,
    setFallbackEnabled,
    disableHomeNodeForLocalSession,
    setDisableHomeNodeForLocalSession,
    fallbackOrder,
    setFallbackOrderState,
    savedProviderConfigs,
    draftProviderConfigs,
    hostedCloudCognition,
    providerDraftStatus,
    providerHealth,
    setProviderHealth,
    ollamaConnection,
    setOllamaConnection,
    surfaceAwareness,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    surfaceOverride,
    setSurfaceOverride,
    setHostedCloudCognitionEnabled,
    setHostedCloudCognitionProvider,
    updateHostedCloudCognitionProviderConfig,
    setHostedCloudCognitionHealth,
    reportSurfaceFriction,
    clearSurfaceFrictionEvents,
    acceptSurfaceRecommendation,
    rejectSurfaceRecommendation,
    revertSurfaceRule,
    explainMemoryToOperator,
    workingMemory,
    setWorkingMemory,
    missionPacketWorkflow,
    setMissionPacketWorkflow,
    missionLineage,
    setMissionLineage,
    projectMemory,
    homeNodePreference,
    setHomeNodePreference,
    homeNodeLastKnown,
    setHomeNodeLastKnown,
    homeBridgeUrl,
    bridgeTransportDefinitions: listBridgeTransportDefinitions(),
    bridgeTransportPreferences,
    bridgeTransportTruth: canonicalBridgeTransportTruth,
    bridgeMemory,
    bridgeMemoryPersistence,
    bridgeMemoryRehydrated,
    bridgeAutoRevalidation,
    revalidateRememberedBridge,
    setBridgeTransportSelection,
    updateBridgeTransportConfig,
    saveBridgeTransportConfig,
    saveHomeBridgeUrl,
    clearHomeBridgeUrl,
    homeNodeStatus,
    setHomeNodeStatus,
    sessionRestoreDiagnostics,
    lastExecutionMetadata,
    setLastExecutionMetadata,
    rememberSuccessfulOllamaConnection,
    getDraftProviderConfig,
    getEffectiveProviderConfig,
    getEffectiveProviderConfigs,
    getActiveProviderConfig,
    getSavedProviderConfig,
    getActiveProviderConfigSource,
    updateDraftProviderConfig,
    saveDraftProviderConfig,
    revertDraftProviderConfig,
    resetProviderConfig,
    resetToFreeMode,
    isDraftDirty,
    apiStatus,
    setApiStatus,
    runtimeStatusModel,
    uiDiagnostics,
    setUiDiagnostics,
    applyMissionPacketWorkflowAction: (action, packetTruth, now) => {
      setMissionPacketWorkflow((prev) => applyMissionPacketAction(prev, { action, packetTruth, now }));
    },
    applyMissionLineageAction: ({ packetTruth, selectors, envelope, now }) => {
      setMissionLineage((prev) => applyMissionLineageUpdate(prev, { packetTruth, selectors, envelope, now }));
    },
  }), [
    commandHistory,
    status,
    isBusy,
    lastRoute,
    debugVisible,
    debugData,
    uiLayout,
    paneLayout,
    missionDashboardUiState,
    provider,
    providerSelectionSource,
    routeMode,
    devMode,
    fallbackEnabled,
    disableHomeNodeForLocalSession,
    fallbackOrder,
    savedProviderConfigs,
    draftProviderConfigs,
    hostedCloudCognition,
    providerDraftStatus,
    providerHealth,
    ollamaConnection,
    surfaceAwareness,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    surfaceOverride,
    workingMemory,
    missionPacketWorkflow,
    missionLineage,
    projectMemory,
    homeNodePreference,
    homeNodeLastKnown,
    homeBridgeUrl,
    bridgeTransportPreferences,
    canonicalBridgeTransportTruth,
    bridgeMemory,
    bridgeMemoryRehydrated,
    bridgeAutoRevalidation,
    revalidateRememberedBridge,
    homeNodeStatus,
    sessionRestoreDiagnostics,
    lastExecutionMetadata,
    apiStatus,
    runtimeStatusModel,
    uiDiagnostics,
    setDebugVisible,
    togglePanel,
    setPanelState,
    setPaneOrder,
    setMissionDashboardUiState,
    setProvider,
    setRouteMode,
    setDevMode,
    setFallbackEnabled,
    setDisableHomeNodeForLocalSession,
    setOllamaConnection,
    setSurfaceOverride,
    setHostedCloudCognitionEnabled,
    setHostedCloudCognitionProvider,
    updateHostedCloudCognitionProviderConfig,
    setHostedCloudCognitionHealth,
    reportSurfaceFriction,
    clearSurfaceFrictionEvents,
    acceptSurfaceRecommendation,
    rejectSurfaceRecommendation,
    revertSurfaceRule,
    explainMemoryToOperator,
    setHomeNodePreference,
    setHomeNodeLastKnown,
    saveBridgeTransportConfig,
    saveHomeBridgeUrl,
    clearHomeBridgeUrl,
    setHomeNodeStatus,
    setBridgeTransportSelection,
    updateBridgeTransportConfig,
    rememberSuccessfulOllamaConnection,
    getDraftProviderConfig,
    getEffectiveProviderConfig,
    getEffectiveProviderConfigs,
    getActiveProviderConfig,
    getSavedProviderConfig,
    getActiveProviderConfigSource,
    updateDraftProviderConfig,
    saveDraftProviderConfig,
    revertDraftProviderConfig,
    resetProviderConfig,
    setMissionPacketWorkflow,
  ]);

  return createElement(AIStoreContext.Provider, { value }, children);
}

export function useAIStore() {
  const context = useContext(AIStoreContext);
  if (!context) throw new Error('useAIStore must be used inside AIStoreProvider');
  return context;
}
