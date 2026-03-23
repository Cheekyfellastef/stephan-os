import { useEffect } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import CommandResultCard from './CommandResultCard';
import CollapsiblePanel from './CollapsiblePanel';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';

export default function AIConsole({ input, setInput, submitPrompt, commandHistory }) {
  const {
    isBusy,
    apiStatus,
    setUiDiagnostics,
    provider,
    providerHealth,
    getActiveProviderConfig,
    runtimeStatusModel,
    uiLayout,
    togglePanel,
  } = useAIStore();
  const activeHealth = providerHealth[provider] || {};
  const ollamaState = provider === 'ollama'
    ? getOllamaUiState({ health: activeHealth, config: getActiveProviderConfig(), frontendOrigin: apiStatus.frontendOrigin })
    : null;
  const runtimeStatus = runtimeStatusModel;

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, aiConsoleRendered: true, aiConsoleMarker: AICONSOLE_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  const onSubmit = (event) => {
    event.preventDefault();
    submitPrompt(input);
    setInput('');
  };

  return (
    <CollapsiblePanel
      panelId="commandDeck"
      title="Stephanos Mission Console"
      description="Command deck for prompts, command execution, and route feedback."
      className="mission-console"
      titleAs="h1"
      isOpen={uiLayout.commandDeck}
      onToggle={() => togglePanel('commandDeck')}
    >
      <div className={`api-connection-banner ${apiStatus.state}`}>
        <strong>{apiStatus.label}</strong>
        <span>{apiStatus.detail}</span>
      </div>
      <div className={`api-banner ${runtimeStatus.statusTone}`}>
        <strong>{runtimeStatus.headline}</strong>
        <span>{runtimeStatus.dependencySummary}</span>
        <span>Route kind: {runtimeStatus.routeKind} · Preferred target: {runtimeStatus.preferredTarget || 'n/a'} · Source: {runtimeStatus.nodeAddressSource}</span>
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
          <p className="muted">Ready. Stephanos now supports auto, local-first, cloud-first, and explicit provider routing. Try “Explain current AI mode” or /status.</p>
        ) : commandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)}
      </div>

      <form className="command-form" onSubmit={onSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter command or prompt..." disabled={isBusy} />
        <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
      </form>
    </CollapsiblePanel>
  );
}
