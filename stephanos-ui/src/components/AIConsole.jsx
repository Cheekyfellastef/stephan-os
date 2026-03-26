import { useEffect } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
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
  const safeApiStatus = apiStatus || {};
  const safeProviderHealth = providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
  const safeUiLayout = uiLayout || {};
  const safeCommandHistory = Array.isArray(commandHistory) ? commandHistory : [];
  const activeHealth = safeProviderHealth[provider] || {};
  const ollamaState = provider === 'ollama'
    ? getOllamaUiState({ health: activeHealth, config: getActiveProviderConfig(), frontendOrigin: safeApiStatus.frontendOrigin })
    : null;
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
  const executedProviderLabel = routeTruthView.executedProvider || 'none';
  const showStartupPlaceholder = safeCommandHistory.length === 0
    && (runtimeStatus.appLaunchState === 'pending' || safeApiStatus.state === 'checking');

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
      isOpen={safeUiLayout.commandDeck !== false}
      onToggle={() => togglePanel('commandDeck')}
    >
      <div className={`api-connection-banner ${safeApiStatus.state || 'checking'}`}>
        <strong>{safeApiStatus.label || 'Checking backend...'}</strong>
        <span>{safeApiStatus.detail || 'Waiting for health check.'}</span>
      </div>
      <div className={`api-banner ${runtimeStatus.statusTone}`}>
        <strong>{runtimeStatus.headline}</strong>
        <span>{runtimeStatus.dependencySummary}</span>
        <span>Route kind: {routeTruthView.routeKind} · Requested: {routeTruthView.requestedProvider} · Selected: {routeTruthView.selectedProvider} · Executed: {executedProviderLabel} · Usable: {routeTruthView.routeUsableState} · Preferred target: {routeTruthView.preferredTarget} · Source: {routeTruthView.source}</span>
      </div>
      {provider === 'ollama' && !runtimeStatus.localAvailable ? (
        <div className="api-banner degraded">
          <strong>{runtimeStatus.cloudAvailable ? 'Cloud route available' : ollamaState.title}</strong>
          <span>
            {runtimeStatus.cloudAvailable
              ? `Stephanos can keep routing requests through ${executedProviderLabel} while your local Ollama node is offline.`
              : (ollamaState.helpText[0] || 'Bring Ollama online or configure a cloud provider.')}
          </span>
        </div>
      ) : null}
      <div className="output-panel">
        {showStartupPlaceholder ? (
          <div className="api-banner degraded" role="status" aria-live="polite">
            <strong>{runtimeStatus.headline || 'Diagnostics pending'}</strong>
            <span>{runtimeStatus.dependencySummary || 'Stephanos is loading runtime diagnostics and provider reachability.'}</span>
          </div>
        ) : null}
        {safeCommandHistory.length === 0 ? (
          <p className="muted">Ready. Stephanos now supports auto, local-first, cloud-first, and explicit provider routing. Try “Explain current AI mode” or /status.</p>
        ) : safeCommandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)}
      </div>

      <form className="command-form" onSubmit={onSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter command or prompt..." disabled={isBusy} />
        <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
      </form>
    </CollapsiblePanel>
  );
}
