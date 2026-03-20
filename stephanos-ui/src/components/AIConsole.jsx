import { useEffect } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';
import CommandResultCard from './CommandResultCard';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';

export default function AIConsole({ input, setInput, submitPrompt, commandHistory }) {
  const {
    isBusy,
    apiStatus,
    setUiDiagnostics,
    provider,
    providerHealth,
    getActiveProviderConfig,
    fallbackEnabled,
    fallbackOrder,
    lastExecutionMetadata,
  } = useAIStore();
  const activeHealth = providerHealth[provider] || {};
  const ollamaState = provider === 'ollama'
    ? getOllamaUiState({ health: activeHealth, config: getActiveProviderConfig(), frontendOrigin: apiStatus.frontendOrigin })
    : null;
  const runtimeStatus = createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos Mission Console',
    validationState: 'healthy',
    selectedProvider: provider,
    fallbackEnabled,
    fallbackOrder,
    providerHealth,
    backendAvailable: apiStatus.backendReachable,
    preferAuto: typeof window !== 'undefined' && window.innerWidth <= 820,
    activeProviderHint: lastExecutionMetadata?.actual_provider_used || '',
  });

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
      <div className={`api-banner ${runtimeStatus.statusTone}`}>
        <strong>{runtimeStatus.headline}</strong>
        <span>{runtimeStatus.dependencySummary}</span>
      </div>
      {provider === 'ollama' && !runtimeStatus.localAvailable ? (
        <div className="api-banner degraded">
          <strong>{runtimeStatus.cloudAvailable ? 'Cloud route available' : ollamaState.title}</strong>
          <span>
            {runtimeStatus.cloudAvailable
              ? `Stephanos can keep routing requests through ${runtimeStatus.activeProvider} while your local Ollama node is offline.`
              : (ollamaState.helpText[0] || 'Bring Ollama online or configure a cloud provider.')}
          </span>
        </div>
      ) : null}
      <div className="output-panel">
        {commandHistory.length === 0 ? (
          <p className="muted">Ready. Auto routing prefers local Ollama, then cloud when available. Try “Explain current AI mode” or /status.</p>
        ) : commandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)}
      </div>

      <form className="command-form" onSubmit={onSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter command or prompt..." disabled={isBusy} />
        <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
      </form>
    </section>
  );
}
