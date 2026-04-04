import { useEffect, useRef, useState } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import CommandResultCard from './CommandResultCard';
import CollapsiblePanel from './CollapsiblePanel';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';

export default function AIConsole({
  input,
  setInput,
  submitPrompt,
  commandHistory,
}) {
  const endOfMessagesRef = useRef(null);
  const containerRef = useRef(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
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
  const latestCommand = safeCommandHistory.length > 0 ? safeCommandHistory[safeCommandHistory.length - 1] : null;
  const continuityMode = latestCommand?.continuity_mode || 'recording-only';
  const continuityRecords = Array.isArray(latestCommand?.continuity_context?.records) ? latestCommand.continuity_context.records : [];
  const activeHealth = safeProviderHealth[provider] || {};
  const ollamaState = provider === 'ollama'
    ? getOllamaUiState({ health: activeHealth, config: getActiveProviderConfig(), frontendOrigin: safeApiStatus.frontendOrigin })
    : null;
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
  const showStartupPlaceholder = safeCommandHistory.length === 0
    && (runtimeStatus.appLaunchState === 'pending' || safeApiStatus.state === 'checking');

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, aiConsoleRendered: true, aiConsoleMarker: AICONSOLE_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView();
  }, []);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (!endOfMessagesRef.current) return;

    endOfMessagesRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [autoScrollEnabled, safeCommandHistory]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;

    const threshold = 50;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAutoScrollEnabled(isNearBottom);
  };

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
      <div className="mission-console-shell">
        <div className={`api-connection-banner ${safeApiStatus.state || 'checking'}`}>
          <strong>{safeApiStatus.label || 'Checking backend...'}</strong>
          <span>{safeApiStatus.detail || 'Waiting for health check.'}</span>
        </div>
        <div className={`api-banner ${runtimeStatus.statusTone}`}>
          <strong>{runtimeStatus.headline}</strong>
          <span>{runtimeStatus.dependencySummary}</span>
          <span>Route kind: {routeTruthView.routeKind} · Requested: {routeTruthView.requestedProvider} · Selected: {routeTruthView.selectedProvider} · Executed: {routeTruthView.executedProvider} · Usable: {routeTruthView.routeUsableState} · Preferred target: {routeTruthView.preferredTarget} · Source: {routeTruthView.source}</span>
          <span>Continuity mode: {continuityMode}</span>
        </div>
        {provider === 'ollama' && !runtimeStatus.localAvailable ? (
          <div className="api-banner degraded">
            <strong>{runtimeStatus.cloudAvailable ? 'Cloud route available' : ollamaState.title}</strong>
            <span>
              {runtimeStatus.cloudAvailable
                ? `Stephanos can keep routing requests through ${routeTruthView.executedProvider} while your local Ollama node is offline.`
                : (ollamaState.helpText[0] || 'Bring Ollama online or configure a cloud provider.')}
            </span>
          </div>
        ) : null}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="output-panel ai-console-messages"
        >
          {showStartupPlaceholder ? (
            <div className="api-banner degraded" role="status" aria-live="polite">
              <strong>{runtimeStatus.headline || 'Diagnostics pending'}</strong>
              <span>{runtimeStatus.dependencySummary || 'Stephanos is loading runtime diagnostics and provider reachability.'}</span>
            </div>
          ) : null}
          {safeCommandHistory.length === 0 ? (
            <p className="muted">Ready. Stephanos now supports auto, local-first, cloud-first, and explicit provider routing. Try “Explain current AI mode” or /status.</p>
          ) : safeCommandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)}
          {latestCommand?.continuity_context ? (
            <details>
              <summary>Continuity Context Used ({continuityRecords.length})</summary>
              <p className="muted">{latestCommand.continuity_context.summary || 'No continuity summary available.'}</p>
              <ul className="compact-list">
                {continuityRecords.map((record) => <li key={record.id || `${record.subsystem}-${record.timestamp}`}>{record.timestamp} · {record.subsystem} · {record.summary}</li>)}
              </ul>
            </details>
          ) : null}
          <div ref={endOfMessagesRef} />
        </div>
        <form className="command-form mission-console-input" onSubmit={onSubmit}>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter command or prompt..." disabled={isBusy} />
          <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
        </form>
      </div>
    </CollapsiblePanel>
  );
}
