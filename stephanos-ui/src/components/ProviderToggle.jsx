import { useEffect, useMemo, useState } from 'react';
import { getApiRuntimeConfig } from '../ai/aiClient';
import { deriveOllamaCandidates, detectOllamaHost, normalizeOllamaBaseUrl } from '../ai/ollamaDiscovery';
import { getOllamaUiState } from '../ai/ollamaUx';
import { PROVIDER_KEYS, PROVIDER_DEFINITIONS } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';

const PROVIDER_COMPONENT_MARKER = 'stephanos-ui/components/ProviderToggle.jsx::free-tier-router-v1';

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
    devMode,
    setDevMode,
    fallbackEnabled,
    setFallbackEnabled,
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
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();
  const [isAutoFindingOllama, setIsAutoFindingOllama] = useState(false);
  const [ollamaDiscovery, setOllamaDiscovery] = useState(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState([]);

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, providerToggleMounted: true, providerToggleMarker: PROVIDER_COMPONENT_MARKER }));
    return () => setUiDiagnostics((prev) => ({ ...prev, providerToggleMounted: false }));
  }, [setUiDiagnostics]);

  const ollamaModelOptions = useMemo(() => {
    const draft = getDraftProviderConfig('ollama');
    const savedModels = availableOllamaModels.filter(Boolean);
    if (draft.model && !savedModels.includes(draft.model)) {
      return [draft.model, ...savedModels];
    }
    return savedModels;
  }, [availableOllamaModels, getDraftProviderConfig]);

  const applyOllamaDetection = (result) => {
    const draft = getDraftProviderConfig('ollama');
    const nextModel = result.models.includes(draft.model)
      ? draft.model
      : (result.models[0] || draft.model || ollamaConnection.lastSelectedModel || '');

    updateDraftProviderConfig('ollama', {
      baseURL: result.baseURL,
      model: nextModel,
    });

    if (result.host || result.baseURL || nextModel) {
      rememberSuccessfulOllamaConnection({ baseURL: result.baseURL, host: result.host, model: nextModel });
    }
  };

  const runOllamaDiscovery = async ({ manualAddress = '' } = {}) => {
    const draft = getDraftProviderConfig('ollama');
    const normalizedHint = manualAddress ? normalizeOllamaBaseUrl(manualAddress) : '';
    const nextHintValue = manualAddress || ollamaConnection.pcAddressHint;
    if (manualAddress) {
      setOllamaConnection({ pcAddressHint: manualAddress });
    }

    const candidates = manualAddress
      ? [{
        baseURL: normalizedHint,
        host: new URL(normalizedHint).hostname,
        source: 'manual-hint',
        badge: 'Network PC',
      }]
      : deriveOllamaCandidates({
        frontendOrigin: runtimeConfig.frontendOrigin,
        lastSuccessfulBaseURL: ollamaConnection.lastSuccessfulBaseURL,
        lastSuccessfulHost: ollamaConnection.lastSuccessfulHost,
        pcAddressHint: nextHintValue,
        recentHosts: ollamaConnection.recentHosts,
      });

    const frontendHost = (() => { try { return new URL(runtimeConfig.frontendOrigin).hostname; } catch { return ''; } })();
    const localhostAttemptWillMismatch = !manualAddress && frontendHost && frontendHost !== 'localhost' && frontendHost !== '127.0.0.1';
    setIsAutoFindingOllama(true);
    setOllamaDiscovery({
      status: 'searching',
      detail: manualAddress
        ? 'Stephanos is trying the address you entered.'
        : 'Stephanos is checking localhost first, then a few likely PC addresses.',
      helpText: localhostAttemptWillMismatch
        ? ['localhost only works when Stephanos and Ollama are on the same computer. Stephanos will now try likely network addresses.']
        : [],
      attempts: candidates,
    });

    try {
      const result = await detectOllamaHost(candidates, { timeoutMs: Math.min(Number(draft.timeoutMs) || 1800, 2500) });
      if (result.success) {
        setAvailableOllamaModels(result.models || []);
        applyOllamaDetection(result);
        setOllamaDiscovery({ status: 'found', ...result });
        return result;
      }

      setOllamaDiscovery({
        status: 'not_found',
        failureBucket: result.failureBucket,
        reason: result.reason,
        attempts: result.attempts,
      });
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

    await runOllamaDiscovery({ manualAddress: normalized });
  };

  return (
    <div className="provider-toggle-block" data-component-marker={PROVIDER_COMPONENT_MARKER}>
      <div className="provider-switch-header">
        <div>
          <span className="provider-switch-label">Adaptive AI Router</span>
          <p className="provider-switch-subtitle">Stephanos prefers local Ollama when it is reachable, then falls through to configured cloud providers, with Mock reserved as a dev-safe fallback.</p>
        </div>
        <div className="provider-switch-actions">
          <button type="button" className="ghost-button" onClick={resetToFreeMode}>Reset to Local Defaults</button>
          <button type="button" className="ghost-button" onClick={onTestConnection}>Test Connection</button>
          <button type="button" onClick={onSendTestPrompt}>Send Test Prompt</button>
        </div>
      </div>

      <div className="toggle-row">
        <label className="toggle-chip"><input type="checkbox" checked={devMode} onChange={(event) => setDevMode(event.target.checked)} /> Dev-safe mode</label>
        <label className="toggle-chip"><input type="checkbox" checked={fallbackEnabled} onChange={(event) => setFallbackEnabled(event.target.checked)} /> Fallback enabled</label>
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
                  <span className={`health-badge ${String(health.badge || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>{isActive ? 'Active' : health.badge || 'Unknown'}</span>
                  {fallbackEnabled && providerKey !== provider && providerKey !== 'openrouter' ? <span className="health-badge fallback">Fallback</span> : null}
                </div>
              </button>

              <p className="provider-card-detail">{providerKey === 'ollama' ? ollamaState.title : (health.detail || 'No health data yet.')}</p>
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
                    <button type="button" onClick={() => runOllamaDiscovery()} disabled={isAutoFindingOllama}>
                      {isAutoFindingOllama ? 'Finding Ollama…' : 'Auto-Find Ollama'}
                    </button>
                    <button type="button" className="ghost-button" onClick={onTestConnection}>Test Connection</button>
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
