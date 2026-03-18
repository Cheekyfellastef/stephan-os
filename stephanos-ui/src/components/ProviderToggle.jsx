import { useEffect } from 'react';
import { getApiRuntimeConfig } from '../ai/aiClient';
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
    { key: 'model', label: 'Model', type: 'text' },
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
  } = useAIStore();

  const runtimeConfig = getApiRuntimeConfig();

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, providerToggleMounted: true, providerToggleMarker: PROVIDER_COMPONENT_MARKER }));
    return () => setUiDiagnostics((prev) => ({ ...prev, providerToggleMounted: false }));
  }, [setUiDiagnostics]);

  return (
    <div className="provider-toggle-block" data-component-marker={PROVIDER_COMPONENT_MARKER}>
      <div className="provider-switch-header">
        <div>
          <span className="provider-switch-label">Free-Tier AI Router</span>
          <p className="provider-switch-subtitle">Default mode is zero-cost. Mock is active on clean installs and works with no API keys.</p>
        </div>
        <div className="provider-switch-actions">
          <button type="button" className="ghost-button" onClick={resetToFreeMode}>Reset to Free Mode</button>
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
            ? getOllamaUiState({ health, config: draft, frontendOrigin: runtimeConfig.frontendOrigin })
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
                  <strong>How Ollama works</strong>
                  <p><strong>Same device = localhost works</strong></p>
                  <p><strong>Different device = use your PC&apos;s IP address</strong></p>
                  <div className="provider-status-box">
                    <strong>{ollamaState.title}</strong>
                    <p>{ollamaState.detail}</p>
                    {ollamaState.helpText.length ? (
                      <ul>
                        {ollamaState.helpText.map((item) => item ? <li key={item}>{item}</li> : null)}
                      </ul>
                    ) : null}
                    {ollamaState.reason ? <p className="provider-status-reason">{ollamaState.reason}</p> : null}
                  </div>
                  <div className="provider-quick-actions">
                    <button type="button" className="ghost-button" onClick={onTestConnection}>Test Connection</button>
                    <button type="button" className="ghost-button" onClick={() => setProvider('mock')}>Switch to Mock Mode</button>
                    {ollamaState.showAutoDetect ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => updateDraftProviderConfig('ollama', { baseURL: ollamaState.autoDetectBaseUrl })}
                      >
                        Auto-detect IP
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {suggestedFallback && providerKey !== 'ollama' ? <button type="button" className="inline-link-button" onClick={() => setProvider('mock')}>Use Mock instead</button> : null}

              <div className="provider-form-grid">
                {FIELD_MAP[providerKey].map((field) => (
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
                ))}
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
