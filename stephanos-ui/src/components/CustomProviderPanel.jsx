import { useAIStore } from '../state/aiStore';

export default function CustomProviderPanel() {
  const {
    provider,
    providerDraftStatus,
    getDraftProviderConfig,
    updateDraftProviderConfig,
    saveDraftProviderConfig,
    revertDraftProviderConfig,
    resetProviderConfig,
    isDraftDirty,
  } = useAIStore();

  if (provider !== 'custom') return null;

  const draft = getDraftProviderConfig('custom');
  const draftState = providerDraftStatus.custom;
  const hasChanges = isDraftDirty('custom');
  const hasErrors = Object.keys(draftState.errors || {}).length > 0;

  return (
    <section className="custom-provider-panel">
      <h3>Custom Provider Settings</h3>
      <p className="provider-draft-status">
        Editing: <strong>Draft</strong> · Active requests use <strong>Saved</strong> config.
      </p>
      <div className="custom-provider-grid">
        <label>
          Provider Label
          <input
            value={draft.label}
            onChange={(event) => updateDraftProviderConfig('custom', { label: event.target.value })}
          />
        </label>
        <label>
          Base URL
          <input
            value={draft.baseUrl}
            placeholder="http://localhost:1234"
            onChange={(event) => updateDraftProviderConfig('custom', { baseUrl: event.target.value })}
          />
          {draftState.errors.baseUrl ? <small className="field-error">{draftState.errors.baseUrl}</small> : null}
        </label>
        <label>
          Chat Endpoint
          <input
            value={draft.chatEndpoint}
            onChange={(event) => updateDraftProviderConfig('custom', { chatEndpoint: event.target.value })}
          />
          {draftState.errors.chatEndpoint ? <small className="field-error">{draftState.errors.chatEndpoint}</small> : null}
        </label>
        <label>
          Model Name
          <input
            value={draft.model}
            placeholder="mistral"
            onChange={(event) => updateDraftProviderConfig('custom', { model: event.target.value })}
          />
          {draftState.errors.model ? <small className="field-error">{draftState.errors.model}</small> : null}
        </label>
        <label>
          API Key (optional, session-only)
          <input
            type="password"
            value={draft.apiKey}
            onChange={(event) => updateDraftProviderConfig('custom', { apiKey: event.target.value })}
          />
        </label>
        <label>
          Optional Headers JSON
          <textarea
            rows={3}
            value={draft.headersJson}
            placeholder='{"x-tenant":"dev"}'
            onChange={(event) => updateDraftProviderConfig('custom', { headersJson: event.target.value })}
          />
          {draftState.errors.headersJson ? <small className="field-error">{draftState.errors.headersJson}</small> : null}
        </label>
      </div>
      <div className="custom-provider-actions">
        <button type="button" onClick={() => saveDraftProviderConfig('custom')} disabled={!hasChanges && !hasErrors}>
          Save / Apply
        </button>
        <button type="button" onClick={() => revertDraftProviderConfig('custom')} disabled={!hasChanges}>
          Cancel / Revert
        </button>
        <button type="button" onClick={() => resetProviderConfig('custom')}>
          Reset
        </button>
      </div>
      {draftState.message ? <p className="provider-draft-message">{draftState.message}</p> : null}
      {draftState.savedAt ? <p className="provider-draft-meta">Last saved: {new Date(draftState.savedAt).toLocaleString()}</p> : null}
      <p className="provider-draft-meta">API keys are intentionally not persisted to localStorage.</p>
    </section>
  );
}
