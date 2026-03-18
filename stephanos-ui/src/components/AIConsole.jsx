import { useEffect } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import CommandResultCard from './CommandResultCard';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';

export default function AIConsole({ input, setInput, submitPrompt, commandHistory }) {
  const { isBusy, apiStatus, setUiDiagnostics, provider, providerHealth, getActiveProviderConfig } = useAIStore();
  const activeHealth = providerHealth[provider] || {};
  const ollamaState = provider === 'ollama'
    ? getOllamaUiState({ health: activeHealth, config: getActiveProviderConfig(), frontendOrigin: apiStatus.frontendOrigin })
    : null;

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, aiConsoleRendered: true, aiConsoleMarker: AICONSOLE_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  const onSubmit = (event) => {
    event.preventDefault();
    submitPrompt(input);
    setInput('');
  };

  return (
    <section className="panel mission-console">
      <h1>Stephanos Mission Console</h1>
      <div className={`api-connection-banner ${apiStatus.state}`}>
        <strong>{apiStatus.label}</strong>
        <span>{apiStatus.detail}</span>
      </div>
      {!activeHealth.ok && provider !== 'mock' ? (
        <div className="api-banner offline">
          <strong>{provider === 'ollama' ? ollamaState.title : (activeHealth.detail || 'Selected provider is not ready.')}</strong>
          <span>
            {provider === 'ollama'
              ? (ollamaState.helpText[0] || 'Switch to Mock Mode if you want a quick working fallback.')
              : 'Switch to Mock for a zero-cost fallback without leaving the console.'}
          </span>
        </div>
      ) : null}
      <div className="output-panel">
        {commandHistory.length === 0 ? (
          <p className="muted">Ready. Default mode is Mock Free Dev Mode. Try “Explain current AI mode” or /status.</p>
        ) : commandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)}
      </div>

      <form className="command-form" onSubmit={onSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter command or prompt..." disabled={isBusy} />
        <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
      </form>
    </section>
  );
}
