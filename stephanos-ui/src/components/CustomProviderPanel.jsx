import { useAIStore } from '../state/aiStore';

export default function CustomProviderPanel() {
  const { provider, customProviderConfig, updateCustomProviderConfig, resetCustomProviderConfig } = useAIStore();

  if (provider !== 'custom') return null;

  return (
    <section className="custom-provider-panel">
      <h3>Custom Provider Settings</h3>
      <div className="custom-provider-grid">
        <label>
          Provider Label
          <input value={customProviderConfig.label} onChange={(event) => updateCustomProviderConfig({ label: event.target.value })} />
        </label>
        <label>
          Base URL
          <input value={customProviderConfig.baseUrl} placeholder="http://localhost:1234" onChange={(event) => updateCustomProviderConfig({ baseUrl: event.target.value })} />
        </label>
        <label>
          Chat Endpoint
          <input value={customProviderConfig.chatEndpoint} onChange={(event) => updateCustomProviderConfig({ chatEndpoint: event.target.value })} />
        </label>
        <label>
          Model Name
          <input value={customProviderConfig.model} placeholder="mistral" onChange={(event) => updateCustomProviderConfig({ model: event.target.value })} />
        </label>
        <label>
          API Key (optional, not persisted)
          <input type="password" value={customProviderConfig.apiKey} onChange={(event) => updateCustomProviderConfig({ apiKey: event.target.value })} />
        </label>
        <label>
          Optional Headers JSON
          <textarea
            rows={3}
            value={customProviderConfig.headersJson}
            placeholder='{"x-tenant":"dev"}'
            onChange={(event) => updateCustomProviderConfig({ headersJson: event.target.value })}
          />
        </label>
      </div>
      <div className="custom-provider-actions">
        <button type="button" onClick={resetCustomProviderConfig}>Reset</button>
      </div>
    </section>
  );
}
