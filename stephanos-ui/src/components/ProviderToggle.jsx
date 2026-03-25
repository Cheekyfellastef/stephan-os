import { useEffect, useMemo, useState } from 'react';
import { getApiRuntimeConfig } from '../ai/aiClient';
import { normalizeOllamaBaseUrl } from '../ai/ollamaDiscovery';
import { applyDetectedOllamaConnection, runOllamaDiscovery } from '../ai/ollamaRuntimeSync';
import { getOllamaUiState } from '../ai/ollamaUx';
import { PROVIDER_KEYS, PROVIDER_DEFINITIONS, ROUTE_MODE_KEYS } from '../ai/providerConfig';
import { extractHostname, isMalformedStephanosHost } from '../../../shared/runtime/stephanosHomeNode.mjs';
import { useAIStore } from '../state/aiStore';

const PROVIDER_COMPONENT_MARKER = 'stephanos-ui/components/ProviderToggle.jsx::cloud-router-v2';

const FIELD_MAP = {
  mock: [
    { key: 'model', label: 'Mock model label', type: 'text' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['echo', 'canned', 'scenario'] },
    { key: 'latencyMs', label: 'Latency (ms)', type: 'number' },
    { key: 'failRate', label: 'Fail rate (0-1)', type: 'number', step: '0.05' },
  ],
  groq: [
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'baseURL', label: 'Base URL', type: 'text' },
    { key: 'apiKey', label: 'API key', type: 'password' },
  ],
  gemini: [
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'baseURL', label: 'Base URL', type: 'text' },
    { key: 'apiKey', label: 'API key', type: 'password' },
  ],
  ollama: [
    { key: 'baseURL', label: 'Base URL', type: 'text' },
    { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number' },
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

function renderStandardField({ field, providerKey, draft, draftState, updateDraftProviderConfig }) {

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
    devMode,
    setDevMode,
    fallbackEnabled,
    setFallbackEnabled,
    disableHomeNodeForLocalSession,
    setDisableHomeNodeForLocalSession,
    providerHealth,
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
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();
  const [isAutoFindingOllama, setIsAutoFindingOllama] = useState(false);
  const [ollamaDiscovery, setOllamaDiscovery] = useState(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState([]);
  const [homeNodeDraft, setHomeNodeDraft] = useState(() => buildHomeNodeDraftFromPreference(homeNodePreference));
  const [isEditingHomeNode, setIsEditingHomeNode] = useState(false);
  const [homeNodeSaveResult, setHomeNodeSaveResult] = useState('');

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

  const handleDetectedOllamaConnection = (result) => applyDetectedOllamaConnection({
    result,
    draftConfig: getDraftProviderConfig('ollama'),
    ollamaConnection,
    updateDraftProviderConfig,
    rememberSuccessfulOllamaConnection,
  });

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
      </div>

      <div className="provider-card-grid">
        {PROVIDER_KEYS.map((providerKey) => {
          const definition = PROVIDER_DEFINITIONS[providerKey];
          const health = providerHealth[providerKey] || {};
          const isActive = provider === providerKey;
          const draft = getDraftProviderConfig(providerKey);
          const draftState = providerDraftStatus[providerKey];
          const dirty = isDraftDirty(providerKey);
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
                    <p><strong>Resolved base URL:</strong> {health.baseURL || draft.baseURL || 'n/a'}</p>
                  </div>
                </div>
              ) : null}
              {providerKey === 'ollama' ? (
                <div className={`provider-hint-box ${ollamaState.state.toLowerCase().replace(/_/g, '-')}`}>
                  <div className="provider-help-panel">
                    <strong>How this works</strong>
                    <p>Same computer: localhost usually works.</p>
                    <p>Different device: Stephanos needs your PC’s address.</p>
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
                    <button type="button" className="ghost-button" onClick={handleTryManualOllamaAddress} disabled={isAutoFindingOllama}>Try This Address</button>
                  </div>
                </div>
              ) : null}
              {suggestedFallback && providerKey !== 'ollama' ? <button type="button" className="inline-link-button" onClick={() => setProvider('mock')}>Use Mock instead</button> : null}

              <div className="provider-form-grid">
                {providerKey === 'ollama' ? (
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
                ) : null}

                {FIELD_MAP[providerKey].map((field) => renderStandardField({ field, providerKey, draft, draftState, updateDraftProviderConfig }))}
              </div>

              <div className="custom-provider-actions">
                <button type="button" className="ghost-button" onClick={() => saveDraftProviderConfig(providerKey)} disabled={!dirty}>Save</button>
                <button type="button" className="ghost-button" onClick={() => revertDraftProviderConfig(providerKey)} disabled={!dirty}>Revert</button>
                <button type="button" className="ghost-button" onClick={() => resetProviderConfig(providerKey)}>Reset</button>
              </div>

              {draftState.message ? <p className="provider-draft-message">{draftState.message}</p> : null}
              {draftState.savedAt ? <p className="provider-draft-meta">Saved {new Date(draftState.savedAt).toLocaleTimeString()}</p> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
