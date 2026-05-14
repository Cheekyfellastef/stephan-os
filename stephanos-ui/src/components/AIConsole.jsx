import { useEffect, useRef, useState } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import CollapsiblePanel from './CollapsiblePanel';
import CommandResultCard from './CommandResultCard';
import { copyPerfDiagnosticsSnapshot, recordPerfCounter, recordPerfEvent, setPerfIdentityField } from '../state/perfDiagnostics.js';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';

export default function AIConsole({
  input,
  setInput,
  submitPrompt,
  cancelActivePrompt,
  emergencyReleaseOllamaLoad,
  commandHistory,
}) {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const documentScrollTopRef = useRef(0);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [perfCopyState, setPerfCopyState] = useState('idle');
  const [perfCopyMessage, setPerfCopyMessage] = useState('');
  const lastHistoryRenderKeyRef = useRef('');
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
  const historyRenderKey = `${safeCommandHistory.length}:${latestCommand?.id || 'none'}`;
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
  recordPerfCounter('render', 'AIConsole');

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, aiConsoleRendered: true, aiConsoleMarker: AICONSOLE_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  useEffect(() => {
    setPerfIdentityField('component.AIConsole.mounted', true);
    recordPerfCounter('surface_mount', 'AIConsole.mount');
    return () => {
      setPerfIdentityField('component.AIConsole.mounted', false);
      recordPerfCounter('surface_mount', 'AIConsole.unmount');
    };
  }, []);

  const preserveDocumentScrollPosition = () => {
    if (typeof window === 'undefined') return;
    documentScrollTopRef.current = window.scrollY || window.pageYOffset || 0;
  };

  const restoreDocumentScrollPosition = () => {
    if (typeof window === 'undefined') return;
    const previousScrollTop = documentScrollTopRef.current || 0;
    const currentScrollTop = window.scrollY || window.pageYOffset || 0;
    if (Math.abs(currentScrollTop - previousScrollTop) < 1) return;

    window.scrollTo({
      top: previousScrollTop,
      behavior: 'auto',
    });
  };

  const scrollMessageContainerToBottom = (behavior = 'auto') => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    preserveDocumentScrollPosition();
    scrollMessageContainerToBottom('auto');
    restoreDocumentScrollPosition();
  }, []);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (lastHistoryRenderKeyRef.current === historyRenderKey) {
      recordPerfCounter('timers', 'ai_core.autoscroll_skipped_same_history');
      return;
    }
    lastHistoryRenderKeyRef.current = historyRenderKey;
    recordPerfCounter('timers', 'ai_core.autoscroll_run');
    preserveDocumentScrollPosition();
    scrollMessageContainerToBottom('smooth');
    requestAnimationFrame(() => {
      recordPerfCounter('timers', 'ai_core.autoscroll_raf');
      restoreDocumentScrollPosition();
    });
  }, [autoScrollEnabled, historyRenderKey]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;

    const threshold = 50;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAutoScrollEnabled((previous) => {
      if (previous === isNearBottom) {
        return previous;
      }
      recordPerfCounter('events', 'ai_core.scroll.autoscroll_toggle');
      return isNearBottom;
    });
  };

  const copyPerfDiagnostics = async () => {
    recordPerfCounter('events', 'ai_core.copy_perf.click');
    const result = await copyPerfDiagnosticsSnapshot();
    if (result?.ok) {
      setPerfCopyState('success');
      setPerfCopyMessage('Perf diagnostics copied.');
      recordPerfCounter('events', 'ai_core.copy_perf.success');
    } else {
      setPerfCopyState('error');
      setPerfCopyMessage(result?.error || 'Unable to copy perf diagnostics.');
      recordPerfEvent('events', 'ai_core.copy_perf.error', result?.error || 'unknown');
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    submitPrompt(input);
    setInput('');
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <CollapsiblePanel
      panelId="commandDeck"
      title="Stephanos AI Chat Command Deck"
      description="Immediate access to prompts, AI chat, answer history, command execution, and route/provider feedback."
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
        <div className="api-banner ready">
          <strong>Routing Notice</strong>
          <span>This console uses the assistant/provider router. Use Agent Mission Console for mission packets and agent orchestration.</span>
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
        <section className="mission-console-pane" data-pane-id="answer-history">
          <header className="mission-console-pane__header">
            <strong>Answer History</strong>
          </header>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="output-panel ai-console-messages mission-console__history mission-console-pane__body"
          >
          {showStartupPlaceholder ? (
            <div className="api-banner degraded" role="status" aria-live="polite">
              <strong>{runtimeStatus.headline || 'Diagnostics pending'}</strong>
              <span>{runtimeStatus.dependencySummary || 'Stephanos is loading runtime diagnostics and provider reachability.'}</span>
            </div>
          ) : null}
          {safeCommandHistory.length === 0 ? <p className="muted">Ready. Ask Stephanos anything.</p> : safeCommandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)}
          {latestCommand?.continuity_context ? (
            <details>
              <summary>Continuity Context Used ({continuityRecords.length})</summary>
              <p className="muted">{latestCommand.continuity_context.summary || 'No continuity summary available.'}</p>
              <ul className="compact-list">
                {continuityRecords.map((record) => <li key={record.id || `${record.subsystem}-${record.timestamp}`}>{record.timestamp} · {record.subsystem} · {record.summary}</li>)}
              </ul>
            </details>
          ) : null}
          </div>
        </section>
        <form className="command-form mission-console-input paneFormLayout mission-console__composer" onSubmit={onSubmit}>
          <div className="mission-console__input-row">
            <input
              className="paneInput paneControl"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Enter command or prompt..."
              disabled={isBusy}
            />
          </div>
          <div className="mission-console__action-row">
            <button type="submit" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
            {isBusy ? (
              <button type="button" className="ghost-button" onClick={() => cancelActivePrompt?.()}>
                Stop generating
              </button>
            ) : null}
          </div>
          <div className="mission-console__safety-row">
            <button type="button" className="ghost-button" onClick={() => emergencyReleaseOllamaLoad?.()}>
              Emergency release Ollama load
            </button>
            <button type="button" className="ghost-button" onClick={copyPerfDiagnostics}>
              {perfCopyState === 'success' ? 'Perf Diagnostics Copied' : 'Copy Perf Diagnostics'}
            </button>
          </div>
          {perfCopyMessage ? <p className={`muted ${perfCopyState === 'error' ? 'status-error' : ''}`}>{perfCopyMessage}</p> : null}
        </form>
      </div>
    </CollapsiblePanel>
  );
}
