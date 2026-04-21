import {
  AI_SETTINGS_STORAGE_KEY,
  HOSTED_COGNITION_PROVIDER_KEYS,
  PROVIDER_KEYS,
  createDefaultHostedCloudCognitionSettings,
  createDefaultRouterSettings,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
} from '../ai/providerDefaults.mjs';
import { isLoopbackHost, isValidStephanosHomeNode, normalizeStephanosHomeNode } from './stephanosHomeNode.mjs';
import { sanitizeCoreTruthInput } from './truthContract.mjs';
import { createDefaultBridgeTransportPreferences, normalizeBridgeTransportPreferences } from './homeBridgeTransport.mjs';

export const STEPHANOS_SESSION_MEMORY_STORAGE_KEY = 'stephanos.session.memory.v1';
export const STEPHANOS_SESSION_MEMORY_SCHEMA_VERSION = 1;
export const STEPHANOS_UI_LAYOUT_STORAGE_KEY = 'stephanos_ui_layout';
export const STEPHANOS_ACTIVE_WORKSPACE = 'mission-console';
export const STEPHANOS_ACTIVE_SUBVIEW = 'assistant';
export const PORTABLE_SESSION_CONTINUITY_FIELDS = Object.freeze([
  'session.providerPreferences.provider',
  'session.providerPreferences.routeMode',
  'session.providerPreferences.devMode',
  'session.providerPreferences.fallbackEnabled',
  'session.providerPreferences.disableHomeNodeForLocalSession',
  'session.providerPreferences.fallbackOrder',
  'session.providerPreferences.providerConfigs.*.model',
  'session.providerPreferences.providerConfigs.*.enabled',
  'session.providerPreferences.providerConfigs.*.timeoutMs',
  'session.providerPreferences.providerConfigs.*.defaultOllamaTimeoutMs',
  'session.providerPreferences.providerConfigs.*.perModelTimeoutOverrides',
  'session.providerPreferences.ollamaConnection.lastSelectedModel',
  'session.providerPreferences.surfaceOverride',
  'session.ui.activeWorkspace',
  'session.ui.activeSubview',
  'session.ui.recentRoute',
  'session.ui.uiLayout',
  'session.ui.debugConsoleVisible',
  'session.ui.missionDashboard.selectedMilestoneId',
  'session.ui.missionDashboard.expandedMilestoneIds',
  'session.ui.missionDashboard.showBlockedOnly',
  'working.recentCommands',
  'working.currentTask',
  'working.activeFocusLabel',
  'working.missionNote',
  'working.lastIntentType',
  'working.lastMissionPacketSummary',
  'working.acceptedMissionCount',
  'working.blockedMissionCount',
  'working.lastExecutionLifecycleState',
  'working.lastMissionSubsystems',
  'working.lastMissionApprovalState',
  'working.missionLineage',
  'project.currentMilestone',
  'project.knownConstraints',
  'project.guardrails',
  'project.lessonsLearned',
  'project.repeatedProblemFamilies',
  'session.homeNodePreference',
  'session.bridgeTransportPreferences',
]);
export const DEVICE_LOCAL_SESSION_FIELDS = Object.freeze([
  'session.providerPreferences.providerConfigs.*.baseURL when loopback-only',
  'session.providerPreferences.ollamaConnection.lastSuccessfulBaseURL when loopback-only',
  'session.providerPreferences.ollamaConnection.lastSuccessfulHost when loopback-only',
  'session.providerPreferences.ollamaConnection.pcAddressHint when loopback-only',
  'session.providerPreferences.ollamaConnection.recentHosts loopback entries',
  'runtime.preferredTarget',
  'runtime.actualTargetUsed',
  'runtime.runtimeMode',
  'runtime.effectiveRouteMode when environment-derived',
  'runtime.routeKind',
  'runtime.selectedLiveRoute',
  'runtime.backendReachable/localAvailable/homeNodeReachable/cloudReachable',
  'runtime.nodeAddressSource when derived from current device/network',
]);

const DEFAULT_PROVIDER_PREFERENCES = Object.freeze({
  ...createDefaultRouterSettings(),
  ollamaConnection: {
    lastSuccessfulBaseURL: '',
    lastSuccessfulHost: '',
    recentHosts: [],
    pcAddressHint: '',
    lastSelectedModel: '',
  },
});

const DEFAULT_WORKING_MEMORY = Object.freeze({
  recentCommands: [],
  currentTask: '',
  activeFocusLabel: '',
  missionNote: '',
  lastIntentType: '',
  lastMissionPacketSummary: '',
  acceptedMissionCount: 0,
  blockedMissionCount: 0,
  lastExecutionLifecycleState: 'inactive',
  lastMissionSubsystems: [],
  lastMissionApprovalState: 'analysis-only',
  missionPacketWorkflow: {
    schemaVersion: 1,
    decisions: [],
    proposalQueue: [],
    roadmapQueue: [],
    activity: [],
  },
  missionLineage: {
    schemaVersion: 1,
    activeMissionId: '',
    missions: [],
  },
});

const DEFAULT_PROJECT_MEMORY = Object.freeze({
  currentMilestone: '',
  knownConstraints: [],
  guardrails: [],
  lessonsLearned: [],
  repeatedProblemFamilies: [],
});

function isBrowserStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

function readJsonStorage(storage, key) {
  if (!isBrowserStorageAvailable(storage)) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(storage, key, value) {
  if (!isBrowserStorageAvailable(storage)) {
    return;
  }

  try {
    if (value == null) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep Stephanos usable even if browser storage is blocked or full.
  }
}

function normalizeString(value, fallback = '') {
  const nextValue = String(value ?? '').trim();
  return nextValue || fallback;
}

function normalizeStringList(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))];
}

function parseHostname(value = '') {
  try {
    return new URL(String(value || '')).hostname || '';
  } catch {
    return '';
  }
}

function isLoopbackUrl(value = '') {
  return isLoopbackHost(parseHostname(value));
}

function normalizeProviderConfigs(providerConfigs = {}, defaults = DEFAULT_PROVIDER_PREFERENCES.providerConfigs) {
  const source = providerConfigs && typeof providerConfigs === 'object' ? providerConfigs : {};
  return Object.fromEntries(
    PROVIDER_KEYS.map((providerKey) => [
      providerKey,
      {
        ...(defaults[providerKey] || {}),
        ...(source[providerKey] && typeof source[providerKey] === 'object' ? source[providerKey] : {}),
        apiKey: '',
      },
    ]),
  );
}

function normalizeOllamaConnection(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    lastSuccessfulBaseURL: normalizeString(source.lastSuccessfulBaseURL),
    lastSuccessfulHost: normalizeString(source.lastSuccessfulHost),
    recentHosts: normalizeStringList(source.recentHosts).slice(0, 5),
    pcAddressHint: normalizeString(source.pcAddressHint),
    lastSelectedModel: normalizeString(source.lastSelectedModel),
  };
}

function normalizeCommandEntry(entry = {}, index = 0) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const rawInput = normalizeString(entry.raw_input);
  const outputText = normalizeString(entry.output_text);

  if (!rawInput && !outputText) {
    return null;
  }

  return {
    id: normalizeString(entry.id, `restored_cmd_${index + 1}`),
    raw_input: rawInput,
    parsed_command: entry.parsed_command && typeof entry.parsed_command === 'object' ? entry.parsed_command : null,
    route: normalizeString(entry.route, STEPHANOS_ACTIVE_SUBVIEW),
    tool_used: entry.tool_used == null ? null : normalizeString(entry.tool_used),
    success: entry.success !== false,
    output_text: outputText,
    data_payload: entry.data_payload && typeof entry.data_payload === 'object' ? entry.data_payload : null,
    timing_ms: Number.isFinite(Number(entry.timing_ms)) ? Number(entry.timing_ms) : null,
    timestamp: normalizeString(entry.timestamp),
    error: normalizeString(entry.error),
    error_code: entry.error_code == null ? null : normalizeString(entry.error_code),
    response: entry.response && typeof entry.response === 'object' ? entry.response : null,
  };
}

function normalizeWorkingMemory(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const recentCommands = Array.isArray(source.recentCommands)
    ? source.recentCommands.map((entry, index) => normalizeCommandEntry(entry, index)).filter(Boolean).slice(-10)
    : [];
  const missionPacketWorkflow = source.missionPacketWorkflow && typeof source.missionPacketWorkflow === 'object'
    ? source.missionPacketWorkflow
    : DEFAULT_WORKING_MEMORY.missionPacketWorkflow;
  const missionLineage = source.missionLineage && typeof source.missionLineage === 'object'
    ? source.missionLineage
    : DEFAULT_WORKING_MEMORY.missionLineage;

  return {
    recentCommands,
    currentTask: normalizeString(source.currentTask),
    activeFocusLabel: normalizeString(source.activeFocusLabel),
    missionNote: normalizeString(source.missionNote),
    lastIntentType: normalizeString(source.lastIntentType),
    lastMissionPacketSummary: normalizeString(source.lastMissionPacketSummary),
    acceptedMissionCount: Number.isFinite(Number(source.acceptedMissionCount)) ? Number(source.acceptedMissionCount) : 0,
    blockedMissionCount: Number.isFinite(Number(source.blockedMissionCount)) ? Number(source.blockedMissionCount) : 0,
    lastExecutionLifecycleState: normalizeString(source.lastExecutionLifecycleState, 'inactive'),
    lastMissionSubsystems: normalizeStringList(source.lastMissionSubsystems).slice(0, 8),
    lastMissionApprovalState: normalizeString(source.lastMissionApprovalState, 'analysis-only'),
    missionPacketWorkflow: {
      schemaVersion: Number.isFinite(Number(missionPacketWorkflow.schemaVersion))
        ? Number(missionPacketWorkflow.schemaVersion)
        : 1,
      decisions: Array.isArray(missionPacketWorkflow.decisions) ? missionPacketWorkflow.decisions.slice(0, 24) : [],
      proposalQueue: Array.isArray(missionPacketWorkflow.proposalQueue) ? missionPacketWorkflow.proposalQueue.slice(0, 20) : [],
      roadmapQueue: Array.isArray(missionPacketWorkflow.roadmapQueue) ? missionPacketWorkflow.roadmapQueue.slice(0, 20) : [],
      activity: Array.isArray(missionPacketWorkflow.activity) ? missionPacketWorkflow.activity.slice(0, 40) : [],
    },
    missionLineage: {
      schemaVersion: Number.isFinite(Number(missionLineage.schemaVersion))
        ? Number(missionLineage.schemaVersion)
        : 1,
      activeMissionId: normalizeString(missionLineage.activeMissionId),
      missions: Array.isArray(missionLineage.missions) ? missionLineage.missions.slice(0, 24) : [],
    },
  };
}

function normalizeProjectMemory(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    currentMilestone: normalizeString(source.currentMilestone),
    knownConstraints: normalizeStringList(source.knownConstraints).slice(0, 12),
    guardrails: normalizeStringList(source.guardrails).slice(0, 12),
    lessonsLearned: normalizeStringList(source.lessonsLearned).slice(0, 12),
    repeatedProblemFamilies: normalizeStringList(source.repeatedProblemFamilies).slice(0, 12),
  };
}

function normalizeMissionDashboardUi(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const expandedMilestoneIds = Array.isArray(source.expandedMilestoneIds)
    ? [...new Set(source.expandedMilestoneIds.map((entry) => normalizeString(entry)).filter(Boolean))].slice(0, 20)
    : [];

  return {
    selectedMilestoneId: normalizeString(source.selectedMilestoneId),
    expandedMilestoneIds,
    showBlockedOnly: source.showBlockedOnly === true,
  };
}

function normalizeUiState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const baseUiLayout = source.uiLayout && typeof source.uiLayout === 'object' ? { ...source.uiLayout } : {};
  const uiLayout = {
    ...baseUiLayout,
    buildParityPanelVisible: baseUiLayout.buildParityPanelVisible === true,
  };
  const activeSubview = normalizeString(source.activeSubview || source.recentRoute, STEPHANOS_ACTIVE_SUBVIEW);
  return {
    activeWorkspace: normalizeString(source.activeWorkspace, STEPHANOS_ACTIVE_WORKSPACE),
    activeSubview,
    recentRoute: normalizeString(source.recentRoute, activeSubview),
    uiLayout,
    debugConsoleVisible: source.debugConsoleVisible === true || uiLayout.debugConsole === true,
    missionDashboard: normalizeMissionDashboardUi(source.missionDashboard),
  };
}

function normalizeHomeNodePreference(value = null) {
  const normalized = normalizeStephanosHomeNode(value || {}, { source: 'manual' });
  return isValidStephanosHomeNode(normalized) ? normalized : null;
}

function normalizeHostedCloudCognition(value = {}) {
  const defaults = createDefaultHostedCloudCognitionSettings();
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...defaults,
    ...source,
    enabled: source.enabled === true,
    selectedProvider: HOSTED_COGNITION_PROVIDER_KEYS.includes(source.selectedProvider)
      ? source.selectedProvider
      : defaults.selectedProvider,
    providers: Object.fromEntries(HOSTED_COGNITION_PROVIDER_KEYS.map((providerKey) => {
      const defaultProvider = defaults.providers?.[providerKey] || {};
      const sourceProvider = source.providers?.[providerKey] || {};
      return [providerKey, {
        ...defaultProvider,
        ...sourceProvider,
        enabled: sourceProvider.enabled !== false,
        baseURL: normalizeString(sourceProvider.baseURL),
        model: normalizeString(sourceProvider.model || defaultProvider.model),
      }];
    })),
    lastHealth: Object.fromEntries(HOSTED_COGNITION_PROVIDER_KEYS.map((providerKey) => {
      const defaultHealth = defaults.lastHealth?.[providerKey] || {};
      const sourceHealth = source.lastHealth?.[providerKey] || {};
      return [providerKey, {
        ...defaultHealth,
        ...sourceHealth,
        status: normalizeString(sourceHealth.status || defaultHealth.status || 'unknown', 'unknown'),
        reason: normalizeString(sourceHealth.reason || defaultHealth.reason || ''),
        checkedAt: normalizeString(sourceHealth.checkedAt || defaultHealth.checkedAt || ''),
        lastSuccessAt: normalizeString(sourceHealth.lastSuccessAt || defaultHealth.lastSuccessAt || ''),
        lastFailureAt: normalizeString(sourceHealth.lastFailureAt || defaultHealth.lastFailureAt || ''),
      }];
    })),
    chatPath: normalizeString(source.chatPath || defaults.chatPath, defaults.chatPath),
  };
}

function normalizeProviderPreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const surfaceOverride = String(source.surfaceOverride || 'auto').trim().toLowerCase();
  return {
    provider: normalizeProviderSelection(source.provider),
    routeMode: normalizeRouteMode(source.routeMode),
    devMode: source.devMode !== false,
    fallbackEnabled: source.fallbackEnabled !== false,
    disableHomeNodeForLocalSession: source.disableHomeNodeForLocalSession === true,
    fallbackOrder: normalizeFallbackOrder(source.fallbackOrder),
    providerConfigs: normalizeProviderConfigs(source.providerConfigs),
    hostedCloudCognition: normalizeHostedCloudCognition(source.hostedCloudCognition),
    ollamaConnection: normalizeOllamaConnection(source.ollamaConnection),
    surfaceOverride: ['auto', 'force-desktop', 'force-tablet', 'force-phone', 'force-vr'].includes(surfaceOverride)
      ? surfaceOverride
      : 'auto',
  };
}

function summarizeIgnoredSessionFields(ignoredFields = []) {
  if (!ignoredFields.length) {
    return 'Portable session state restored.';
  }

  return `Ignored device-incompatible saved session fields: ${ignoredFields.join(', ')}.`;
}

export function sanitizeStephanosSessionMemoryForDevice(memory, {
  currentOrigin = '',
  manualNode = null,
  lastKnownNode = null,
} = {}) {
  const normalized = normalizeStephanosSessionMemory(memory);
  const currentHost = parseHostname(currentOrigin);
  const localDesktopSession = !currentHost || isLoopbackHost(currentHost);
  const homeNode = normalizeStephanosHomeNode(
    manualNode || lastKnownNode || {},
    { source: manualNode?.source || lastKnownNode?.source || 'manual' },
  );
  const nonLocalSession = !localDesktopSession && (Boolean(currentHost) || Boolean(homeNode?.configured));
  const ignoredFields = [];
  const reasons = [];
  const sanitizedProviderConfigs = { ...normalized.session.providerPreferences.providerConfigs };
  const sanitizedOllamaConnection = {
    ...normalized.session.providerPreferences.ollamaConnection,
  };

  if (nonLocalSession) {
    for (const providerKey of PROVIDER_KEYS) {
      const providerConfig = normalized.session.providerPreferences.providerConfigs?.[providerKey];
      const baseURL = String(providerConfig?.baseURL || '').trim();
      if (!baseURL || !isLoopbackUrl(baseURL)) {
        continue;
      }

      sanitizedProviderConfigs[providerKey] = {
        ...providerConfig,
        baseURL: '',
      };
      ignoredFields.push(`providerConfigs.${providerKey}.baseURL`);
      reasons.push(`Saved ${providerKey} localhost endpoint was ignored for non-local session ${currentHost || homeNode.host || 'remote-device'}.`);
    }

    if (isLoopbackUrl(sanitizedOllamaConnection.lastSuccessfulBaseURL)) {
      sanitizedOllamaConnection.lastSuccessfulBaseURL = '';
      ignoredFields.push('ollamaConnection.lastSuccessfulBaseURL');
    }
    if (isLoopbackHost(sanitizedOllamaConnection.lastSuccessfulHost)) {
      sanitizedOllamaConnection.lastSuccessfulHost = '';
      ignoredFields.push('ollamaConnection.lastSuccessfulHost');
    }
    if (isLoopbackHost(sanitizedOllamaConnection.pcAddressHint)) {
      sanitizedOllamaConnection.pcAddressHint = '';
      ignoredFields.push('ollamaConnection.pcAddressHint');
    }

    const filteredRecentHosts = sanitizedOllamaConnection.recentHosts.filter((host) => !isLoopbackHost(host));
    if (filteredRecentHosts.length !== sanitizedOllamaConnection.recentHosts.length) {
      sanitizedOllamaConnection.recentHosts = filteredRecentHosts;
      ignoredFields.push('ollamaConnection.recentHosts');
    }

    if (ignoredFields.some((field) => field.startsWith('ollamaConnection.'))) {
      reasons.push('Saved Ollama discovery memory was reduced to non-loopback hosts so other devices recompute against the current network context.');
    }
  }

  let sanitizedHomeNodePreference = normalized.session.homeNodePreference;

  if (nonLocalSession && sanitizedHomeNodePreference?.host && isLoopbackHost(sanitizedHomeNodePreference.host)) {
    sanitizedHomeNodePreference = null;
    ignoredFields.push('session.homeNodePreference');
    reasons.push(`Saved manual home-node localhost address was ignored for non-local session ${currentHost || homeNode.host || 'remote-device'}.`);
  }

  const sanitizedMemory = normalizeStephanosSessionMemory({
    ...normalized,
    session: {
      ...normalized.session,
      providerPreferences: {
        ...normalized.session.providerPreferences,
        providerConfigs: sanitizedProviderConfigs,
        ollamaConnection: sanitizedOllamaConnection,
      },
      homeNodePreference: sanitizedHomeNodePreference,
    },
  });

  const activeProvider = sanitizedMemory.session.providerPreferences.provider;
  const activeProviderConfigAdjusted = ignoredFields.includes(`providerConfigs.${activeProvider}.baseURL`);

  return {
    memory: sanitizedMemory,
    diagnostics: {
      nonLocalSession,
      localDesktopSession,
      currentHost,
      homeNodeHost: homeNode?.host || '',
      ignoredFields,
      reasons,
      message: summarizeIgnoredSessionFields(ignoredFields),
      activeProvider,
      activeProviderConfigAdjusted,
    },
  };
}

export function createDefaultStephanosSessionMemory() {
  return {
    schemaVersion: STEPHANOS_SESSION_MEMORY_SCHEMA_VERSION,
    updatedAt: '',
    session: {
      providerPreferences: normalizeProviderPreferences(DEFAULT_PROVIDER_PREFERENCES),
      bridgeTransportPreferences: createDefaultBridgeTransportPreferences(),
      ui: normalizeUiState(),
      homeNodePreference: null,
    },
    working: normalizeWorkingMemory(DEFAULT_WORKING_MEMORY),
    project: normalizeProjectMemory(DEFAULT_PROJECT_MEMORY),
  };
}

export function normalizeStephanosSessionMemory(value = {}) {
  const defaults = createDefaultStephanosSessionMemory();
  const source = value && typeof value === 'object' ? value : {};
  const session = source.session && typeof source.session === 'object' ? source.session : {};

  return {
    schemaVersion: STEPHANOS_SESSION_MEMORY_SCHEMA_VERSION,
    updatedAt: normalizeString(source.updatedAt),
    session: {
      providerPreferences: normalizeProviderPreferences(session.providerPreferences),
      bridgeTransportPreferences: normalizeBridgeTransportPreferences(session.bridgeTransportPreferences),
      ui: normalizeUiState(session.ui),
      homeNodePreference: normalizeHomeNodePreference(session.homeNodePreference),
    },
    working: normalizeWorkingMemory(source.working || defaults.working),
    project: normalizeProjectMemory(source.project || defaults.project),
  };
}

function readLegacyProviderPreferences(storage) {
  const defaults = normalizeProviderPreferences(DEFAULT_PROVIDER_PREFERENCES);
  const parsed = readJsonStorage(storage, AI_SETTINGS_STORAGE_KEY);
  if (!parsed || typeof parsed !== 'object') {
    return defaults;
  }

  return normalizeProviderPreferences({
    ...defaults,
    provider: parsed.provider,
    routeMode: parsed.routeMode,
    devMode: parsed.devMode,
    fallbackEnabled: parsed.fallbackEnabled,
    fallbackOrder: parsed.fallbackOrder,
    providerConfigs: parsed.providerConfigs,
    ollamaConnection: parsed.ollamaConnection,
  });
}

function readLegacyUiState(storage) {
  const parsed = readJsonStorage(storage, STEPHANOS_UI_LAYOUT_STORAGE_KEY);
  const uiLayout = parsed && typeof parsed === 'object' ? parsed : {};
  return normalizeUiState({
    activeWorkspace: STEPHANOS_ACTIVE_WORKSPACE,
    activeSubview: STEPHANOS_ACTIVE_SUBVIEW,
    recentRoute: STEPHANOS_ACTIVE_SUBVIEW,
    uiLayout,
    debugConsoleVisible: uiLayout.debugConsole === true,
  });
}

export function readPersistedStephanosSessionMemory(storage = globalThis?.localStorage) {
  if (!isBrowserStorageAvailable(storage)) {
    return createDefaultStephanosSessionMemory();
  }

  const parsed = readJsonStorage(storage, STEPHANOS_SESSION_MEMORY_STORAGE_KEY);
  if (parsed && typeof parsed === 'object') {
    return normalizeStephanosSessionMemory(parsed);
  }

  return normalizeStephanosSessionMemory({
    session: {
      providerPreferences: readLegacyProviderPreferences(storage),
      ui: readLegacyUiState(storage),
    },
  });
}


export function readPortableStephanosHomeNodePreference(storage = globalThis?.localStorage) {
  const persisted = readPersistedStephanosSessionMemory(storage);
  return normalizeHomeNodePreference(persisted?.session?.homeNodePreference);
}

export function readPersistedStephanosHomeNodePreference(storage = globalThis?.localStorage) {
  return readPortableStephanosHomeNodePreference(storage);
}

export function restoreStephanosSessionMemoryForDevice({
  storage = globalThis?.localStorage,
  currentOrigin = '',
  manualNode = null,
  lastKnownNode = null,
} = {}) {
  return sanitizeStephanosSessionMemoryForDevice(
    readPersistedStephanosSessionMemory(storage),
    { currentOrigin, manualNode, lastKnownNode },
  );
}

function createLegacyProviderPreferencesPayload(memory) {
  const providerPreferences = normalizeProviderPreferences(memory?.session?.providerPreferences);
  return {
    provider: providerPreferences.provider,
    routeMode: providerPreferences.routeMode,
    devMode: providerPreferences.devMode,
    fallbackEnabled: providerPreferences.fallbackEnabled,
    fallbackOrder: providerPreferences.fallbackOrder,
    providerConfigs: providerPreferences.providerConfigs,
    hostedCloudCognition: providerPreferences.hostedCloudCognition,
    ollamaConnection: providerPreferences.ollamaConnection,
    surfaceOverride: providerPreferences.surfaceOverride,
  };
}

export function persistStephanosSessionMemory(memory, storage = globalThis?.localStorage) {
  const { sanitized } = sanitizeCoreTruthInput(memory || {});
  const normalized = normalizeStephanosSessionMemory({
    ...sanitized,
    updatedAt: new Date().toISOString(),
  });

  writeJsonStorage(storage, STEPHANOS_SESSION_MEMORY_STORAGE_KEY, normalized);
  writeJsonStorage(storage, AI_SETTINGS_STORAGE_KEY, createLegacyProviderPreferencesPayload(normalized));
  writeJsonStorage(storage, STEPHANOS_UI_LAYOUT_STORAGE_KEY, normalized.session.ui.uiLayout || {});
  return normalized;
}

export function clearPersistedStephanosSessionMemory(storage = globalThis?.localStorage) {
  writeJsonStorage(storage, STEPHANOS_SESSION_MEMORY_STORAGE_KEY, null);
  writeJsonStorage(storage, AI_SETTINGS_STORAGE_KEY, null);
  writeJsonStorage(storage, STEPHANOS_UI_LAYOUT_STORAGE_KEY, null);
}
