import { useEffect, useState } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { AI_ACTION_MODES } from '../ai/missionActionService';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import CommandResultCard from './CommandResultCard';
import CollapsiblePanel from './CollapsiblePanel';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';

const AI_ACTION_LABELS = {
  [AI_ACTION_MODES.NEXT_MOVE]: 'Best Next Move',
  [AI_ACTION_MODES.BLOCKERS]: 'Top Blockers',
  [AI_ACTION_MODES.CODEX_PROMPT]: 'Suggest Codex Prompt',
  [AI_ACTION_MODES.MISSION_UPDATE]: 'Suggest Mission Update',
};

export default function AIConsole({
  input,
  setInput,
  submitPrompt,
  commandHistory,
  runAiButlerAction,
  aiActionState,
}) {
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
  const showStartupPlaceholder = safeCommandHistory.length === 0
    && (runtimeStatus.appLaunchState === 'pending' || safeApiStatus.state === 'checking');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [fallbackCopyText, setFallbackCopyText] = useState('');

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, aiConsoleRendered: true, aiConsoleMarker: AICONSOLE_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  const onSubmit = (event) => {
    event.preventDefault();
    submitPrompt(input);
    setInput('');
  };

  async function handleRunAction(mode) {
    setCopyFeedback('');
    setFallbackCopyText('');
    await runAiButlerAction(mode);
  }

  async function handleCopyActionOutput() {
    if (!aiActionState?.output) {
      setCopyFeedback('Nothing to copy yet.');
      return;
    }
    const copyResult = await writeTextToClipboard(aiActionState.output, { navigatorObject: navigator });
    if (copyResult.ok) {
      setCopyFeedback('AI action output copied.');
      console.info('[AI ACTION] copy output succeeded');
      return;
    }

    setFallbackCopyText(aiActionState.output);
    setCopyFeedback('Clipboard unavailable. Manual copy fallback opened.');
    console.info('[AI ACTION] fallback copy opened');
  }

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
        <span>Route kind: {routeTruthView.routeKind} · Requested: {routeTruthView.requestedProvider} · Selected: {routeTruthView.selectedProvider} · Executed: {routeTruthView.executedProvider} · Usable: {routeTruthView.routeUsableState} · Preferred target: {routeTruthView.preferredTarget} · Source: {routeTruthView.source}</span>
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
      <section className="ai-action-panel" aria-label="AI Butler Actions">
        <div className="ai-action-header">
          <h3>AI Butler Actions</h3>
          <p>Grounded suggestions from mission dashboard truth, workspace visibility state, and recent runtime diagnostics.</p>
        </div>
        <div className="ai-action-buttons">
          {Object.entries(AI_ACTION_LABELS).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className="ghost-button"
              onClick={() => handleRunAction(mode)}
              disabled={isBusy || aiActionState?.isRunning}
            >
              {aiActionState?.isRunning && aiActionState.mode === mode ? `Running ${label}...` : label}
            </button>
          ))}
        </div>

        {aiActionState?.missingContext?.length ? (
          <p className="ai-action-context-warning" role="status" aria-live="polite">
            Missing context: {aiActionState.missingContext.join(', ')}. Output may be partial.
          </p>
        ) : null}
        {aiActionState?.error ? (
          <p className="ai-action-context-warning" role="status" aria-live="polite">
            {aiActionState.error}
          </p>
        ) : null}
        {aiActionState?.output ? (
          <div className="ai-action-result">
            <div className="ai-action-result-header">
              <strong>{AI_ACTION_LABELS[aiActionState.mode] || 'AI Action Result'}</strong>
              <span>{aiActionState.generatedAt ? new Date(aiActionState.generatedAt).toLocaleTimeString() : ''}</span>
            </div>
            <textarea value={aiActionState.output} rows={10} readOnly />
            <div className="ai-action-buttons">
              <button type="button" onClick={handleCopyActionOutput}>Copy Output</button>
            </div>
            {copyFeedback ? <p className="ai-action-copy-feedback">{copyFeedback}</p> : null}
          </div>
        ) : null}
      </section>

      {fallbackCopyText ? (
        <div className="clipboard-sanitiser-fallback" role="dialog" aria-modal="true" aria-label="AI action manual copy fallback">
          <h3>Manual Copy AI Action Output</h3>
          <p>Clipboard write was unavailable. Select all and copy manually.</p>
          <textarea value={fallbackCopyText} readOnly rows={12} onFocus={(event) => event.target.select()} />
          <button type="button" onClick={() => setFallbackCopyText('')}>Close</button>
        </div>
      ) : null}

      <form className="command-form" onSubmit={onSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter command or prompt..." disabled={isBusy} />
        <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
      </form>
    </CollapsiblePanel>
  );
}
