import { useEffect, useMemo, useState } from 'react';
import {
  clearLocalProviderSecret,
  getApiRuntimeConfig,
  setLocalProviderSecret,
  testHostedCloudWorkerConnection,
} from '../ai/aiClient';
import { resolveAdminAuthorityUrl } from '../ai/apiConfig';
import { normalizeOllamaBaseUrl } from '../ai/ollamaDiscovery';
import { applyDetectedOllamaConnection, runOllamaDiscovery } from '../ai/ollamaRuntimeSync';
import { getOllamaUiState } from '../ai/ollamaUx';
import { resolveProviderSecretSaveFeedback } from '../ai/providerSecretFeedback';
import { OLLAMA_LOAD_MODE_KEYS, PROVIDER_KEYS, PROVIDER_DEFINITIONS, ROUTE_MODE_KEYS } from '../ai/providerConfig';
import { extractHostname, isMalformedStephanosHost } from '../../../shared/runtime/stephanosHomeNode.mjs';
import { useAIStore } from '../state/aiStore';

const PROVIDER_COMPONENT_MARKER = 'stephanos-ui/components/ProviderToggle.jsx::cloud-router-v2';
const OLLAMA_TIMEOUT_OVERRIDE_MODELS = ['qwen:32b', 'qwen:14b', 'gpt-oss:20b', 'llama3.2:3b'];

const FIELD_MAP = {
  mock: [
    { key: 'model', label: 'Mock model label', type: 'text' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['echo', 'canned', 'scenario'] },
    { key: 'latencyMs', label: 'Latency (ms)', type: 'number' },
    { key: 'failRate', label: 'Fail rate (0-1)', type: 'number', step: '0.05' },
  ],
  groq: [
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'freshWebModel', label: 'Fresh web model (optional)', type: 'text' },
    { key: 'freshWebModelCandidates', label: 'Fresh web model candidates (comma-separated)', type: 'text' },
    { key: 'baseURL', label: 'Base URL', type: 'text' },
    { key: 'apiKey', label: 'API key', type: 'password' },
  ],
  gemini: [
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'groundingEnabled', label: 'Enable Google Search grounding', type: 'checkbox' },
    { key: 'groundingMode', label: 'Grounding mode', type: 'select', options: ['google_search', 'none'] },
    { key: 'baseURL', label: 'Base URL', type: 'text' },
    { key: 'apiKey', label: 'API key', type: 'password' },
  ],
  ollama: [
    { key: 'baseURL', label: 'Base URL', type: 'text' },
  ],
  openrouter: [
    { key: 'enabled', label: 'Enable optional paid provider', type: 'checkbox' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'baseURL', label: 'Base URL', type: 'text' },
    { key: 'apiKey', label: 'API key', type: 'password' },
  ],
};

const ROUTE_MODE_COPY = {
  'auto': {
    label: 'Auto',
    detail: 'Stephanos picks the most sensible route from current runtime truth.',
  },
  'local-first': {
    label: 'Local First',
    detail: 'Prefer Ollama first, then Groq/cloud fallbacks.',
  },
  'cloud-first': {
    label: 'Cloud First',
    detail: 'Prefer Groq first for hosted or other-device access.',
  },
  'explicit': {
    label: 'Explicit Provider',
    detail: 'Use the selected provider directly without route-mode auto-selection.',
  },
};

function buildHomeNodeDraftFromPreference(homeNodePreference) {
  return {
    host: String(homeNodePreference?.host || ''),
    uiPort: Number(homeNodePreference?.uiPort) || 5173,
    backendPort: Number(homeNodePreference?.backendPort) || 8787,
  };
}

export function resolveHomeNodeDraftSync({ currentDraft, preference, isEditing }) {
  const nextFromPreference = buildHomeNodeDraftFromPreference(preference);
  const currentHost = String(currentDraft?.host || '').trim();
  const nextHost = String(nextFromPreference.host || '').trim();
  if (isEditing) {
    return {
      nextDraft: currentDraft,
      overwritten: false,
      overwriteSource: '',
      skippedBecauseEditing: true,
    };
  }

  if (!nextHost && currentHost) {
    return {
      nextDraft: currentDraft,
      overwritten: false,
      overwriteSource: '',
      skippedBecauseEditing: false,
      skippedBecauseEmptyPreference: true,
    };
  }

  const overwritten = String(currentDraft?.host || '') !== String(nextFromPreference.host || '')
    || Number(currentDraft?.uiPort) !== Number(nextFromPreference.uiPort)
    || Number(currentDraft?.backendPort) !== Number(nextFromPreference.backendPort);

  return {
    nextDraft: nextFromPreference,
    overwritten,
    overwriteSource: overwritten ? 'homeNodePreference-sync' : '',
    skippedBecauseEditing: false,
  };
}

function renderStandardField({
  field,
  providerKey,
  draft,
  draftState,
  updateDraftProviderConfig,
  secretDrafts,
  setSecretDrafts,
}) {
  if (field.key === 'apiKey') {
    return (
      <label key={field.key}>
        <span>{field.label}</span>
        <input
          type="password"
          value={secretDrafts[providerKey] ?? ''}
          autoComplete="off"
          onChange={(event) => setSecretDrafts((prev) => ({ ...prev, [providerKey]: event.target.value }))}
          placeholder="Enter new key (stored backend-only)"
        />
      </label>
    );
  }
  return (
    <label key={field.key}>
      <span>{field.label}</span>
      {field.type === 'select' ? (
        <select value={draft[field.key]} onChange={(event) => updateDraftProviderConfig(providerKey, { [field.key]: event.target.value })}>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : field.type === 'checkbox' ? (
        <input type="checkbox" checked={Boolean(draft[field.key])} onChange={(event) => updateDraftProviderConfig(providerKey, { [field.key]: event.target.checked })} />
      ) : (
        <input type={field.type} step={field.step} value={draft[field.key] ?? ''} onChange={(event) => updateDraftProviderConfig(providerKey, { [field.key]: field.type === 'number' ? Number(event.target.value) : event.target.value })} />
      )}
      {draftState.errors?.[field.key] ? <span className="field-error">{draftState.errors[field.key]}</span> : null}
    </label>
  );
}

export default function ProviderToggle({ onTestConnection, onSendTestPrompt }) {
  const {
    provider,
    setProvider,
    routeMode,
    setRouteMode,
    streamingMode,
    setStreamingMode,
    ollamaLoadMode,
    setOllamaLoadMode,
    devMode,
    setDevMode,
    fallbackEnabled,
    setFallbackEnabled,
    disableHomeNodeForLocalSession,
    setDisableHomeNodeForLocalSession,
    providerHealth,
    hostedCloudCognition,
    hostedCloudCognitionSaveState,
    hostedCloudCognitionDirty,
    setHostedCloudCognitionEnabled,
    setHostedCloudCognitionProvider,
    updateHostedCloudCognitionProviderConfig,
    saveHostedCloudCognitionSettings,
    setHostedCloudCognitionHealth,
    providerDraftStatus,
    getDraftProviderConfig,
    updateDraftProviderConfig,
    saveDraftProviderConfig,
    revertDraftProviderConfig,
    resetProviderConfig,
    resetToFreeMode,
    isDraftDirty,
    setUiDiagnostics,
    ollamaConnection,
    setOllamaConnection,
    rememberSuccessfulOllamaConnection,
    homeNodePreference,
    setHomeNodePreference,
    homeNodeLastKnown,
    homeNodeStatus,
    runtimeStatusModel,
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();
  const adminAuthority = resolveAdminAuthorityUrl(runtimeConfig);
  const [isAutoFindingOllama, setIsAutoFindingOllama] = useState(false);
  const [ollamaDiscovery, setOllamaDiscovery] = useState(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState([]);
  const [homeNodeDraft, setHomeNodeDraft] = useState(() => buildHomeNodeDraftFromPreference(homeNodePreference));
  const [isEditingHomeNode, setIsEditingHomeNode] = useState(false);
  const [homeNodeSaveResult, setHomeNodeSaveResult] = useState('');
  const [secretDrafts, setSecretDrafts] = useState({});
  const [secretSaveStatus, setSecretSaveStatus] = useState({});
  const [hostedProviderTestStatus, setHostedProviderTestStatus] = useState({});

  useEffect(() => {
    const syncResult = resolveHomeNodeDraftSync({
      currentDraft: homeNodeDraft,
      preference: homeNodePreference,
      isEditing: isEditingHomeNode,
    });
    setHomeNodeDraft(syncResult.nextDraft);
    setUiDiagnostics((prev) => ({
      ...prev,
      homeNodeInputStateOverwritten: syncResult.overwritten,
      homeNodeInputOverwriteSource: syncResult.overwriteSource || (syncResult.skippedBecauseEditing
        ? 'none:editing-active'
        : (syncResult.skippedBecauseEmptyPreference ? 'none:ignored-empty-preference' : 'none')),
    }));
  }, [homeNodePreference?.host, homeNodePreference?.uiPort, homeNodePreference?.backendPort, isEditingHomeNode]);

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, providerToggleMounted: true, providerToggleMarker: PROVIDER_COMPONENT_MARKER }));
    return () => setUiDiagnostics((prev) => ({ ...prev, providerToggleMounted: false }));
  }, [setUiDiagnostics]);

  useEffect(() => {
    const ollamaDraft = getDraftProviderConfig('ollama');
    const manualHomeNodeHost = String(homeNodeDraft.host || '').trim();
    const normalizedManualHomeNodeHost = extractHostname(manualHomeNodeHost);
    const homeNodeManualHostValidity = !manualHomeNodeHost
      ? 'empty'
      : (!normalizedManualHomeNodeHost || isMalformedStephanosHost(normalizedManualHomeNodeHost) ? 'invalid' : 'valid');
    setUiDiagnostics((prev) => ({
      ...prev,
      homeNodeInputDraftValue: String(homeNodeDraft.host || ''),
      homeNodeInputSavedValue: String(homeNodePreference?.host || ''),
      homeNodeInputEditingActive: isEditingHomeNode,
      backendUrlInUse: String(runtimeConfig.baseUrl || ''),
      ollamaBaseUrlInUse: String(ollamaDraft?.baseURL || ''),
      requestedProvider: provider,
      homeNodeEffectiveValue: String(homeNodePreference?.host || homeNodeLastKnown?.host || ''),
      homeNodeEffectiveSource: String(homeNodePreference?.host ? (homeNodePreference?.source || 'manual') : (homeNodeLastKnown?.source || 'none')),
      homeNodeSaveResult,
      homeNodeManualHostValidity,
    }));
  }, [getDraftProviderConfig, homeNodeDraft.host, homeNodeLastKnown?.host, homeNodeLastKnown?.source, homeNodePreference?.host, homeNodePreference?.source, homeNodeSaveResult, isEditingHomeNode, provider, runtimeConfig.baseUrl, setUiDiagnostics]);

  const ollamaModelOptions = useMemo(() => {
    const draft = getDraftProviderConfig('ollama');
    const savedModels = availableOllamaModels.filter(Boolean);
    if (draft.model && !savedModels.includes(draft.model)) {
      return [draft.model, ...savedModels];
    }
    return savedModels;
  }, [availableOllamaModels, getDraftProviderConfig]);
  const heavyModelSelected = ['gpt-oss:20b', 'qwen:14b', 'qwen:32b']
    .includes(String(getDraftProviderConfig('ollama')?.model || '').trim().toLowerCase());

  const handleDetectedOllamaConnection = (result) => applyDetectedOllamaConnection({
    result,
    draftConfig: getDraftProviderConfig('ollama'),
    ollamaConnection,
    updateDraftProviderConfig,
    rememberSuccessfulOllamaConnection,
  });

  const handleSaveProvider = async (providerKey) => {
    const pendingSecret = String(secretDrafts[providerKey] || '').trim();
    const saveResult = saveDraftProviderConfig(providerKey);
    if (!saveResult?.ok && !pendingSecret) {
      return;
    }

    if (!pendingSecret) {
      return;
    }

    const secretSave = await setLocalProviderSecret(providerKey, pendingSecret, runtimeConfig);
    const feedback = resolveProviderSecretSaveFeedback(secretSave, providerKey, PROVIDER_DEFINITIONS[providerKey]?.label);
    if (feedback.type === 'error') {
      setUiDiagnostics((prev) => ({
        ...prev,
        providerSecretSaveError: feedback.message,
      }));
      setSecretSaveStatus((prev) => ({ ...prev, [providerKey]: feedback }));
      return;
    }

    const saveWarning = saveResult?.ok
      ? ''
      : ' Provider settings were not applied because draft validation failed.';
    setSecretDrafts((prev) => ({ ...prev, [providerKey]: '' }));
    setSecretSaveStatus((prev) => ({ ...prev, [providerKey]: { ...feedback, message: `${feedback.message}${saveWarning}` } }));
    setUiDiagnostics((prev) => ({ ...prev, providerSecretSaveError: '' }));
    await onTestConnection();
  };

  const handleClearProviderSecret = async (providerKey) => {
    const clearResult = await clearLocalProviderSecret(providerKey, runtimeConfig);
    if (!clearResult.ok) {
      const errorMessage = clearResult.error || `Failed to clear ${providerKey} API key from backend local secret store.`;
      setSecretSaveStatus((prev) => ({ ...prev, [providerKey]: { type: 'error', message: errorMessage } }));
      setUiDiagnostics((prev) => ({ ...prev, providerSecretSaveError: errorMessage }));
      return;
    }

    setSecretDrafts((prev) => ({ ...prev, [providerKey]: '' }));
    setSecretSaveStatus((prev) => ({ ...prev, [providerKey]: { type: 'success', message: `${PROVIDER_DEFINITIONS[providerKey]?.label || providerKey} API key cleared from backend local secret store.` } }));
    setUiDiagnostics((prev) => ({ ...prev, providerSecretSaveError: '' }));
    await onTestConnection();
  };

  const handleRunOllamaDiscovery = async ({ manualAddress = '' } = {}) => {
    if (manualAddress) {
      setOllamaConnection({ pcAddressHint: manualAddress });
    }

    const draft = getDraftProviderConfig('ollama');
    setIsAutoFindingOllama(true);

    try {
      const discoveryRun = runOllamaDiscovery({
        runtimeConfig,
        ollamaConnection: {
          ...ollamaConnection,
          pcAddressHint: manualAddress || ollamaConnection.pcAddressHint,
        },
        draftConfig: draft,
        manualAddress,
      });
      setOllamaDiscovery({
        status: 'searching',
        detail: manualAddress
          ? 'Stephanos is trying the address you entered.'
          : 'Stephanos is checking localhost first, then a few likely PC addresses.',
        helpText: [],
        attempts: [],
      });

      const { result, searchingState, discoveryState } = await discoveryRun;
      setOllamaDiscovery(searchingState);

      if (result.success) {
        setAvailableOllamaModels(result.models || []);
        handleDetectedOllamaConnection(result);
      }

      setOllamaDiscovery(discoveryState);
      return result;
    } finally {
      setIsAutoFindingOllama(false);
    }
  };

  const handleTryManualOllamaAddress = async () => {
    const manualAddress = String(ollamaConnection.pcAddressHint || '').trim();
    if (!manualAddress) {
      setOllamaDiscovery({
        status: 'not_found',
        failureBucket: 'wrong_address',
        reason: 'Enter your PC address first, such as 192.168.1.42.',
        attempts: [],
      });
      return;
    }

    const normalized = normalizeOllamaBaseUrl(manualAddress);
    if (!normalized) {
      setOllamaDiscovery({
        status: 'not_found',
        failureBucket: 'wrong_address',
        reason: 'That address does not look valid yet. Try something like 192.168.1.42.',
        attempts: [],
      });
      return;
    }

    await handleRunOllamaDiscovery({ manualAddress: normalized });
  };


  const handleSaveHomeNode = () => {
    const trimmedHost = String(homeNodeDraft.host || '').trim();
    if (!trimmedHost) {
      setHomeNodeSaveResult('rejected:empty-host');
      setUiDiagnostics((prev) => ({
        ...prev,
        homeNodeManualHostState: 'empty',
        homeNodeManualHostValue: '',
        homeNodeSaveResult: 'rejected:empty-host',
      }));
      return;
    }

    const normalizedHost = extractHostname(trimmedHost);
    if (!normalizedHost || isMalformedStephanosHost(normalizedHost)) {
      setUiDiagnostics((prev) => ({
        ...prev,
        homeNodeManualHostState: 'invalid',
        homeNodeManualHostValue: trimmedHost,
        homeNodeSaveResult: 'rejected:invalid-host',
      }));
      setHomeNodeSaveResult('rejected:invalid-host');
      return;
    }

    setHomeNodePreference({
      host: normalizedHost,
      uiPort: homeNodeDraft.uiPort,
      backendPort: homeNodeDraft.backendPort,
      source: 'manual',
    });
    setIsEditingHomeNode(false);
    setHomeNodeDraft((prev) => ({ ...prev, host: normalizedHost }));
    setHomeNodeSaveResult('saved');
    setUiDiagnostics((prev) => ({
      ...prev,
      homeNodeManualHostState: 'saved',
      homeNodeManualHostValue: normalizedHost,
      homeNodeSaveResult: 'saved',
    }));
    onTestConnection();
  };

  const handleClearHomeNode = () => {
    setHomeNodeDraft({ host: '', uiPort: 5173, backendPort: 8787 });
    setIsEditingHomeNode(false);
    setHomeNodePreference(null);
    setHomeNodeSaveResult('cleared');
    onTestConnection();
  };

  const manualHomeNodeHost = String(homeNodeDraft.host || '').trim();
  const normalizedManualHomeNodeHost = extractHostname(manualHomeNodeHost);
  const homeNodeHostState = !manualHomeNodeHost
    ? 'empty'
    : (!normalizedManualHomeNodeHost || isMalformedStephanosHost(normalizedManualHomeNodeHost) ? 'invalid' : 'valid');
  const homeNodeSourceLabel = homeNodePreference?.source || homeNodeLastKnown?.source || 'none';
  const hostedTruth = runtimeStatusModel?.canonicalRouteRuntimeTruth || {};
  const hostedProvider = hostedCloudCognition?.selectedProvider || 'groq';
  const hostedSaveMessage = hostedCloudCognitionSaveState?.message || (hostedCloudCognitionDirty ? 'Unsaved changes' : 'Saved');

  const testHostedProvider = async (providerKey) => {
    const providerLabel = providerKey === 'gemini' ? 'Gemini Worker' : `${providerKey} Worker`;
    setHostedProviderTestStatus((prev) => ({
      ...prev,
      [providerKey]: { state: 'testing', message: `Testing ${providerLabel}…`, checkedAt: new Date().toISOString() },
    }));

    const result = await testHostedCloudWorkerConnection({
      providerKey,
      hostedCloudConfig: hostedCloudCognition,
      runtimeConfig,
    });
    const healthy = result.ok && result.reachable === true && result.parseSuccess === true;
    setHostedCloudCognitionHealth(providerKey, {
      ok: healthy,
      status: healthy ? 'healthy' : 'unhealthy',
      reachable: result.reachable === true,
      executableNow: healthy,
      reason: result.reason || '',
      detail: result.detail || '',
      checkedAt: result.checkedAt || new Date().toISOString(),
      model: result.model || hostedCloudCognition?.providers?.[providerKey]?.model || '',
      httpStatus: Number.isFinite(Number(result.status)) ? Number(result.status) : 0,
      parseSuccess: result.parseSuccess === true,
    });
    setHostedProviderTestStatus((prev) => ({
      ...prev,
      [providerKey]: {
        state: healthy ? 'passed' : 'failed',
        message: healthy
          ? `${providerLabel} reachable (${result.status})`
          : `${providerLabel} test failed (${result.status || 'no status'})`,
        checkedAt: result.checkedAt || new Date().toISOString(),
      },
    }));
    onTestConnection();
  };

  return (
    <div className="provider-toggle-block" data-component-marker={PROVIDER_COMPONENT_MARKER}>
      <div className="provider-switch-header">
        <div>
          <span className="provider-switch-label">Unified Stephanos Provider Router</span>
          <p className="provider-switch-subtitle">One Stephanos UI, one backend router: local Ollama for nearby desktop use, cloud Groq for hosted or other-device sessions, with truthful fallback reporting.</p>
        </div>
        <div className="provider-switch-actions">
          <button type="button" className="ghost-button" onClick={resetToFreeMode}>Reset Router Defaults</button>
          <button type="button" className="ghost-button" onClick={onTestConnection}>Refresh Status</button>
          <button type="button" onClick={onSendTestPrompt}>Send Test Prompt</button>
        </div>
      </div>

      <div className="provider-mode-grid">
        {ROUTE_MODE_KEYS.map((modeKey) => (
          <button
            key={modeKey}
            type="button"
            className={`provider-mode-card${routeMode === modeKey ? ' active' : ''}`}
            onClick={() => setRouteMode(modeKey)}
          >
            <strong>{ROUTE_MODE_COPY[modeKey].label}</strong>
            <span>{ROUTE_MODE_COPY[modeKey].detail}</span>
          </button>
        ))}
      </div>

      <p className="provider-dock-status">
        Requested Route Mode: <strong>{routeMode}</strong> · Explicit Provider Target: <strong>{provider}</strong> · Backend Target: <strong>{runtimeConfig.baseUrl}</strong>
      </p>
      <p className="provider-dock-status">
        Secret Authority: <strong>{adminAuthority.ok ? 'available' : 'denied'}</strong> · Target: <strong>{adminAuthority.target || 'n/a'}</strong> · Reason: <strong>{adminAuthority.reason || 'pc-local-admin'}</strong>
      </p>


      <div className="provider-hint-box found">
        <div className="provider-help-panel">
          <strong>Stephanos Home Node</strong>
          <p>Use this when your main PC hosts Stephanos on home WiFi and companion devices should connect to it automatically.</p>
          <p>Only non-secret host and port details are stored in the browser.</p>
        </div>
        <div className="provider-status-box">
          <strong>{homeNodeStatus.state === 'ready' ? 'Home PC node ready' : homeNodeStatus.state === 'unreachable' ? 'Home PC node unreachable' : 'Home PC node optional'}</strong>
          <p>{homeNodeStatus.detail}</p>
          <p><strong>Preferred source:</strong> {homeNodeStatus.source || homeNodePreference?.source || homeNodeLastKnown?.source || 'none'}</p>
          <p><strong>Last known node:</strong> {homeNodeLastKnown?.uiUrl || 'none'}</p>
          <p><strong>Preferred backend:</strong> {runtimeConfig.baseUrl}</p>
          <p>
            <strong>Manual host state:</strong>{' '}
            {homeNodeHostState === 'empty'
              ? 'empty'
              : (homeNodeHostState === 'invalid' ? 'invalid (not active until saved as a valid host/IP)' : 'valid draft')}
            {' · '}<strong>Source:</strong> {homeNodeSourceLabel}
          </p>
        </div>
      </div>

      <div className="provider-manual-address">
        <label>
          <span>Home PC Host or IP</span>
          <input
            type="text"
            placeholder="192.168.1.42"
            value={homeNodeDraft.host}
            onMouseDown={() => setUiDiagnostics((prev) => ({ ...prev, homeNodeInputClickReceived: true }))}
            onClick={() => setUiDiagnostics((prev) => ({ ...prev, homeNodeInputClickReceived: true }))}
            onFocus={() => {
              setIsEditingHomeNode(true);
              setUiDiagnostics((prev) => ({ ...prev, homeNodeInputFocusReceived: true, homeNodeInputEditingActive: true }));
            }}
            onBlur={() => {
              setIsEditingHomeNode(false);
              setUiDiagnostics((prev) => ({ ...prev, homeNodeInputEditingActive: false }));
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setHomeNodeDraft((prev) => ({ ...prev, host: nextValue }));
              setUiDiagnostics((prev) => ({
                ...prev,
                homeNodeInputEventReceived: true,
                homeNodeInputStateUpdated: true,
                homeNodeInputDraftValue: nextValue,
              }));
            }}
            onPaste={() => setUiDiagnostics((prev) => ({ ...prev, homeNodeInputPasteReceived: true }))}
          />
        </label>
        <label>
          <span>UI Port</span>
          <input
            type="number"
            placeholder="5173"
            value={homeNodeDraft.uiPort || 5173}
            onChange={(event) => setHomeNodeDraft((prev) => ({ ...prev, uiPort: Number(event.target.value) || 5173 }))}
          />
        </label>
        <label>
          <span>Backend Port</span>
          <input
            type="number"
            placeholder="8787"
            value={homeNodeDraft.backendPort || 8787}
            onChange={(event) => setHomeNodeDraft((prev) => ({ ...prev, backendPort: Number(event.target.value) || 8787 }))}
          />
        </label>
        <button type="button" className="ghost-button" onClick={handleSaveHomeNode}>Save Home Node</button>
        <button type="button" className="ghost-button" onClick={onTestConnection}>Find Home Node</button>
        <button type="button" className="ghost-button" onClick={handleClearHomeNode}>Clear</button>
      </div>
      <div className="toggle-row">
        <label className="toggle-chip"><input type="checkbox" checked={devMode} onChange={(event) => setDevMode(event.target.checked)} /> Dev-safe mode</label>
        <label className="toggle-chip"><input type="checkbox" checked={fallbackEnabled} onChange={(event) => setFallbackEnabled(event.target.checked)} /> Fallback enabled</label>
        <label className="toggle-chip"><input type="checkbox" checked={disableHomeNodeForLocalSession} onChange={(event) => setDisableHomeNodeForLocalSession(event.target.checked)} /> Force Local On This PC</label>
        <label className="toggle-chip">
          <span>Streaming</span>
          <select value={streamingMode} onChange={(event) => setStreamingMode(event.target.value)}>
            <option value="off">Off</option>
            <option value="auto">Auto</option>
            <option value="on">On</option>
          </select>
        </label>
        <label className="toggle-chip">
          <span>Ollama Load</span>
          <select value={ollamaLoadMode} onChange={(event) => setOllamaLoadMode(event.target.value)}>
            {OLLAMA_LOAD_MODE_KEYS.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
      </div>
      {provider === 'ollama' && heavyModelSelected && ollamaLoadMode !== 'performance' ? (
        <p className="provider-dock-status provider-dock-status-warning">
          Heavy Ollama model selected while Load Governor is <strong>{ollamaLoadMode}</strong>; Stephanos may auto-shift to lightweight local execution for short prompts.
        </p>
      ) : null}
      <section className="provider-hint-box hosted-cloud-cognition-pane">
        <div className="provider-help-panel">
          <strong>Hosted Cloud Cognition</strong>
          <p>Hosted-safe reasoning through Worker-backed providers. This is cognition-only authority and never local execution authority.</p>
        </div>
        <div className="provider-status-box">
          <p><strong>Authority:</strong> cognition-only (execution deferred)</p>
          <p><strong>Battle Bridge authority:</strong> {hostedTruth.battleBridgeAuthorityAvailable === true ? 'available' : 'unavailable'}</p>
          <p><strong>Gemini worker configured:</strong> {String(hostedCloudCognition?.providers?.gemini?.baseURL || '').trim() ? 'yes' : 'no'}</p>
          <p><strong>Gemini worker reachable:</strong> {hostedCloudCognition?.lastHealth?.gemini?.reachable === true ? 'yes' : (hostedCloudCognition?.lastHealth?.gemini?.reachable === false ? 'no' : 'unknown')}</p>
          <p><strong>Hosted cognition executable:</strong> {hostedTruth.hostedCloudPathAvailable === true && hostedCloudCognition?.lastHealth?.[hostedProvider]?.reachable === true ? 'yes' : 'no'}</p>
          <p><strong>Deferred local authority actions:</strong> {hostedTruth.executionDeferred === true ? 'yes' : 'no'}</p>
          <p><strong>Route posture:</strong> {hostedTruth.hostedCloudPathAvailable === true ? 'Worker-backed provider path active' : 'Execution deferred'}</p>
          <p><strong>Cloud cognition available:</strong> {hostedTruth.cloudCognitionAvailable === true ? 'yes' : 'no'}</p>
          <p><strong>Reason:</strong> {hostedTruth.operatorSummary || 'Battle Bridge authority unavailable'}</p>
          <p><strong>Save state:</strong> {hostedSaveMessage}</p>
          <p><strong>Restore:</strong> {hostedCloudCognitionSaveState?.diagnostics?.restoreSucceeded === true ? 'Restored from session' : 'Defaulted (no saved hosted session payload)'}</p>
          <p><strong>Restore diagnostics:</strong> {hostedCloudCognitionSaveState?.diagnostics?.hydrationFailure === true ? 'Restore payload hydrate failed' : 'Hydration ok'}</p>
          <p><strong>Last restored summary:</strong> {hostedCloudCognitionSaveState?.diagnostics?.lastRestoredSummary || 'n/a'}</p>
          <p><strong>Restore reason:</strong> {hostedCloudCognitionSaveState?.diagnostics?.lastRestoreReason || 'n/a'}</p>
          <div className="provider-quick-actions">
            <button type="button" className="ghost-button" onClick={() => saveHostedCloudCognitionSettings()}>Save Hosted Cloud Cognition</button>
          </div>
        </div>
        <div className="provider-form-grid hosted-cloud-form-grid">
          <label>
            <span>Hosted cognition enabled</span>
            <input type="checkbox" checked={hostedCloudCognition?.enabled === true} onChange={(event) => setHostedCloudCognitionEnabled(event.target.checked)} />
          </label>
          <label>
            <span>Hosted provider selection</span>
            <select value={hostedProvider} onChange={(event) => setHostedCloudCognitionProvider(event.target.value)}>
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          {['groq', 'gemini'].map((providerKey) => {
            const hostedProviderConfig = hostedCloudCognition?.providers?.[providerKey] || {};
            const hostedProviderHealth = hostedCloudCognition?.lastHealth?.[providerKey] || {};
            const hostedTest = hostedProviderTestStatus?.[providerKey] || {};
            return (
              <div key={`hosted-${providerKey}`} className="hosted-provider-card">
                <h4>{providerKey === 'groq' ? 'Groq hosted Worker route' : 'Gemini hosted Worker route'}</h4>
                <label>
                  <span>Enabled</span>
                  <input
                    type="checkbox"
                    checked={hostedProviderConfig.enabled !== false}
                    onChange={(event) => updateHostedCloudCognitionProviderConfig(providerKey, { enabled: event.target.checked })}
                  />
                </label>
                <label>
                  <span>Worker/proxy base URL</span>
                  <input
                    type="url"
                    value={hostedProviderConfig.baseURL || ''}
                    placeholder="https://worker.example.workers.dev"
                    onChange={(event) => updateHostedCloudCognitionProviderConfig(providerKey, { baseURL: event.target.value })}
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    type="text"
                    value={hostedProviderConfig.model || ''}
                    onChange={(event) => updateHostedCloudCognitionProviderConfig(providerKey, { model: event.target.value })}
                  />
                </label>
                <div className="provider-quick-actions">
                  <button type="button" className="ghost-button" onClick={() => testHostedProvider(providerKey)}>
                    {providerKey === 'gemini' ? 'Test Gemini Worker' : 'Test Groq Worker'}
                  </button>
                </div>
                <p><strong>Health:</strong> {hostedProviderHealth.status || (hostedProviderHealth.ok === true ? 'healthy' : 'unknown')}</p>
                <p><strong>HTTP status:</strong> {Number.isFinite(Number(hostedProviderHealth.httpStatus)) && Number(hostedProviderHealth.httpStatus) > 0 ? hostedProviderHealth.httpStatus : 'n/a'}</p>
                <p><strong>Parse success:</strong> {hostedProviderHealth.parseSuccess === true ? 'yes' : (hostedProviderHealth.parseSuccess === false ? 'no' : 'unknown')}</p>
                <p><strong>Reachable:</strong> {hostedProviderHealth.reachable === true ? 'yes' : (hostedProviderHealth.reachable === false ? 'no' : 'unknown')}</p>
                <p><strong>Executable now:</strong> {hostedProviderHealth.executableNow === true ? 'yes' : (hostedProviderHealth.executableNow === false ? 'no' : 'unknown')}</p>
                <p><strong>Model:</strong> {hostedProviderHealth.model || hostedProviderConfig.model || 'n/a'}</p>
                <p><strong>Last check:</strong> {hostedProviderHealth.checkedAt || 'n/a'}</p>
                <p><strong>Reason:</strong> {hostedProviderHealth.reason || hostedProviderHealth.detail || 'No health check result yet.'}</p>
                <p><strong>Test result:</strong> {hostedTest.message || 'Not tested yet.'}</p>
                <p><strong>Test checked at:</strong> {hostedTest.checkedAt || 'n/a'}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="provider-card-grid">
        {PROVIDER_KEYS.map((providerKey) => {
          const definition = PROVIDER_DEFINITIONS[providerKey];
          const health = providerHealth[providerKey] || {};
          const isActive = provider === providerKey;
          const draft = getDraftProviderConfig(providerKey);
          const draftState = providerDraftStatus[providerKey];
          const dirty = isDraftDirty(providerKey);
          const hasSecretField = FIELD_MAP[providerKey]?.some((field) => field.key === 'apiKey');
          const providerSecretStatus = secretSaveStatus[providerKey];
          const suggestedFallback = !health.ok && providerKey !== 'mock';
          const ollamaState = providerKey === 'ollama'
            ? getOllamaUiState({ health, config: draft, frontendOrigin: runtimeConfig.frontendOrigin, discovery: ollamaDiscovery })
            : null;

          return (
            <section key={providerKey} className={`provider-card${isActive ? ' active' : ''}`}>
              <button type="button" className="provider-card-button" onClick={() => setProvider(providerKey)}>
                <div>
                  <h3>{definition.label}</h3>
                  <p>{definition.targetSummary}</p>
                </div>
                <div className="provider-badges">
                  <span className={`health-badge ${String(health.badge || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>{isActive ? 'Selected' : health.badge || 'Unknown'}</span>
                  {fallbackEnabled && providerKey !== provider && routeMode !== 'explicit' && providerKey !== 'openrouter' ? <span className="health-badge fallback">Route candidate</span> : null}
                </div>
              </button>

              <p className="provider-card-detail">{providerKey === 'ollama' ? ollamaState.title : (health.detail || 'No health data yet.')}</p>
              {providerKey === 'groq' ? (
                <div className="provider-hint-box found">
                  <div className="provider-help-panel">
                    <strong>Cloud-backed Groq</strong>
                    <p>Groq requests still run only through the Stephanos backend.</p>
                    <p>Paste a Groq API key here for the current UI session, or set <code>GROQ_API_KEY</code> on the backend for shared/server-side configuration.</p>
                  </div>
                  <div className="provider-status-box">
                    <strong>{health.ok ? 'Groq is ready' : 'Groq needs a key'}</strong>
                    <p>{health.detail || 'Groq health has not been checked yet.'}</p>
                    <p><strong>Configured via:</strong> {health.configuredVia || 'missing'}</p>
                    <p><strong>Resolved model:</strong> {health.model || draft.model || 'n/a'}</p>
                    <p><strong>Configured fresh web model:</strong> {draft.freshWebModel || 'n/a'}</p>
                    <p><strong>Resolved base URL:</strong> {health.baseURL || draft.baseURL || 'n/a'}</p>
                    <p><strong>Supports fresh web:</strong> {String(health.providerCapability?.supportsFreshWeb ?? 'unknown')}</p>
                    <p><strong>Supports current answers:</strong> {String(health.providerCapability?.supportsCurrentAnswers ?? 'unknown')}</p>
                    <p><strong>Configured model supports fresh web:</strong> {String(health.providerCapability?.configuredModelSupportsFreshWeb ?? 'unknown')}</p>
                    <p><strong>Fresh candidate available:</strong> {String(health.providerCapability?.candidateFreshRouteAvailable ?? 'unknown')}</p>
                    <p><strong>Fresh candidate model:</strong> {health.providerCapability?.candidateFreshWebModel || 'n/a'}</p>
                    <p><strong>Fresh web path:</strong> {health.providerCapability?.freshWebPath || 'n/a'}</p>
                    <p><strong>Capability reason:</strong> {health.providerCapability?.capabilityReason || 'n/a'}</p>
                  </div>
                </div>
              ) : null}
              {providerKey === 'gemini' ? (
                <div className="provider-hint-box found">
                  <div className="provider-help-panel">
                    <strong>Gemini grounding</strong>
                    <p>Fresh/current answers require Google Search grounding in backend execution.</p>
                  </div>
                  <div className="provider-status-box">
                    <strong>{health.ok ? 'Gemini is ready' : 'Gemini needs a key'}</strong>
                    <p>{health.detail || 'Gemini health has not been checked yet.'}</p>
                    <p><strong>Fresh capable:</strong> {String(health.providerCapability?.supportsFreshWeb ?? 'unknown')}</p>
                    <p><strong>Grounding enabled:</strong> {String(health.providerCapability?.groundingEnabled ?? draft.groundingEnabled ?? false)}</p>
                    <p><strong>Grounding mode:</strong> {health.providerCapability?.groundingMode || draft.groundingMode || 'none'}</p>
                    <p><strong>Admin authority:</strong> {adminAuthority.ok ? 'available' : 'denied'}</p>
                  </div>
                </div>
              ) : null}
              {providerKey === 'ollama' ? (
                <div className={`provider-hint-box ${ollamaState.state.toLowerCase().replace(/_/g, '-')}`}>
                  <div className="provider-help-panel">
                    <strong>How this works</strong>
                    <p>Same computer: localhost usually works.</p>
                    <p>Different device: Stephanos needs your PC’s address.</p>
                    <p>Trusted home-network only: do not expose Ollama directly to the public Internet.</p>
                  </div>

                  <div className="provider-status-box">
                    <strong>{ollamaState.resultTitle || ollamaState.title}</strong>
                    <p>{ollamaState.resultBody || ollamaState.detail}</p>
                    {ollamaState.resultBadge ? <span className="provider-result-badge">{ollamaState.resultBadge}</span> : null}
                    {ollamaState.detectedAddress ? <p><strong>Detected address:</strong> {ollamaState.detectedAddress}</p> : null}
                    {ollamaState.models.length ? (
                      <div>
                        <strong>Available models</strong>
                        <ul>
                          {ollamaState.models.map((modelName) => <li key={modelName}>{modelName}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {ollamaState.emptyModels ? <p>Stephanos found Ollama, but no local models are installed yet.</p> : null}
                    {ollamaState.helpText.length ? (
                      <ul>
                        {ollamaState.helpText.map((item) => item ? <li key={item}>{item}</li> : null)}
                      </ul>
                    ) : null}
                    {ollamaState.reason ? <p className="provider-status-reason">{ollamaState.reason}</p> : null}
                  </div>

                  <div className="provider-quick-actions prominent-actions">
                    <button type="button" onClick={() => handleRunOllamaDiscovery()} disabled={isAutoFindingOllama}>
                      {isAutoFindingOllama ? 'Finding Ollama…' : 'Auto-Find Ollama'}
                    </button>
                    <button type="button" className="ghost-button" onClick={onTestConnection}>Refresh Status</button>
                    <button type="button" className="ghost-button" onClick={() => setProvider('mock')}>Switch to Mock Mode</button>
                    {ollamaState.showUseConnection ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          saveDraftProviderConfig('ollama');
                          setProvider('ollama');
                        }}
                      >
                        Use This Connection
                      </button>
                    ) : null}
                  </div>

                  <div className="provider-manual-address">
                    <label>
                      <span>PC Address (optional)</span>
                      <input
                        type="text"
                        placeholder="192.168.1.42"
                        value={ollamaConnection.pcAddressHint}
                        onChange={(event) => setOllamaConnection({ pcAddressHint: event.target.value })}
                      />
                    </label>
                    <div className="provider-manual-address-action">
                      <button type="button" className="ghost-button" onClick={handleTryManualOllamaAddress} disabled={isAutoFindingOllama}>Try This Address</button>
                    </div>
                  </div>
                </div>
              ) : null}
              {suggestedFallback && providerKey !== 'ollama' ? <button type="button" className="inline-link-button" onClick={() => setProvider('mock')}>Use Mock instead</button> : null}

              <div className="provider-form-grid">
                {providerKey === 'ollama' ? (
                  <>
                    <label key="ollama-model">
                      <span>Model</span>
                      {ollamaModelOptions.length ? (
                        <select
                          value={draft.model || ollamaModelOptions[0] || ''}
                          onChange={(event) => {
                            updateDraftProviderConfig('ollama', { model: event.target.value });
                            setOllamaConnection({ lastSelectedModel: event.target.value });
                          }}
                        >
                          {ollamaModelOptions.map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={draft.model ?? ''}
                          onChange={(event) => {
                            updateDraftProviderConfig('ollama', { model: event.target.value });
                            setOllamaConnection({ lastSelectedModel: event.target.value });
                          }}
                        />
                      )}
                      {draftState.errors?.model ? <span className="field-error">{draftState.errors.model}</span> : null}
                    </label>
                    <label key="ollama-default-timeout">
                      <span>Default Ollama Timeout (ms)</span>
                      <input
                        type="number"
                        min="1000"
                        value={draft.defaultOllamaTimeoutMs ?? draft.timeoutMs ?? 8000}
                        onChange={(event) => {
                          const nextTimeout = Number(event.target.value) || 0;
                          updateDraftProviderConfig('ollama', { defaultOllamaTimeoutMs: nextTimeout, timeoutMs: nextTimeout });
                        }}
                      />
                      {draftState.errors?.defaultOllamaTimeoutMs ? <span className="field-error">{draftState.errors.defaultOllamaTimeoutMs}</span> : null}
                    </label>
                    <details>
                      <summary>Optional Model Timeout Overrides</summary>
                      {OLLAMA_TIMEOUT_OVERRIDE_MODELS.map((modelName) => (
                        <label key={`override-${modelName}`}>
                          <span>{modelName}</span>
                          <input
                            type="number"
                            min="1000"
                            placeholder="Use default"
                            value={draft.perModelTimeoutOverrides?.[modelName] ?? ''}
                            onChange={(event) => {
                              const rawValue = event.target.value;
                              const nextOverrides = { ...(draft.perModelTimeoutOverrides || {}) };
                              if (rawValue === '') {
                                delete nextOverrides[modelName];
                              } else {
                                nextOverrides[modelName] = Number(rawValue);
                              }
                              updateDraftProviderConfig('ollama', { perModelTimeoutOverrides: nextOverrides });
                            }}
                          />
                          {draftState.errors?.[`perModelTimeoutOverrides.${modelName}`] ? (
                            <span className="field-error">{draftState.errors[`perModelTimeoutOverrides.${modelName}`]}</span>
                          ) : null}
                        </label>
                      ))}
                    </details>
                  </>
                ) : null}

                {FIELD_MAP[providerKey].map((field) => renderStandardField({
                  field,
                  providerKey,
                  draft,
                  draftState,
                  updateDraftProviderConfig,
                  secretDrafts,
                  setSecretDrafts,
                }))}
              </div>

              <div className="custom-provider-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => handleSaveProvider(providerKey)}
                  disabled={!dirty && !String(secretDrafts[providerKey] || '').trim()}
                >
                  Save
                </button>
                <button type="button" className="ghost-button" onClick={() => revertDraftProviderConfig(providerKey)} disabled={!dirty}>Revert</button>
                <button type="button" className="ghost-button" onClick={() => resetProviderConfig(providerKey)}>Reset</button>
                {hasSecretField ? <button type="button" className="ghost-button" onClick={() => handleClearProviderSecret(providerKey)}>Clear Stored Key</button> : null}
              </div>
              {providerSecretStatus?.message ? <p className={`provider-draft-message ${providerSecretStatus.type === 'error' ? 'field-error' : ''}`}>{providerSecretStatus.message}</p> : null}

              {draftState.message ? <p className="provider-draft-message">{draftState.message}</p> : null}
              {draftState.savedAt ? <p className="provider-draft-meta">Saved {new Date(draftState.savedAt).toLocaleTimeString()}</p> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
