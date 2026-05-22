import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const [codexDispatchCopyState, setCodexDispatchCopyState] = useState('idle');
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
    lastExecutionMetadata,
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

  const isAssistantHistoryEntry = (entry) => {
    const responseType = String(entry?.response?.type || '').trim().toLowerCase();
    const route = String(entry?.route || '').trim().toLowerCase();
    return responseType === 'assistant_response' || route === 'assistant';
  };

  const hasFinalAssistantAnswerText = (entry) => {
    if (!isAssistantHistoryEntry(entry)) return false;
    const text = String(entry?.output_text || '').trim();
    return text.length > 0 && entry?.stream_finalized !== false;
  };

  const latestAssistantAnswerId = useMemo(() => {
    for (let index = safeCommandHistory.length - 1; index >= 0; index -= 1) {
      const entry = safeCommandHistory[index];
      if (hasFinalAssistantAnswerText(entry)) {
        return String(entry.id || '');
      }
    }
    return '';
  }, [safeCommandHistory]);

  const latestAssistantAnswerRef = useRef(null);
  const latestScrollTargetRef = useRef({ kind: 'none', id: '' });
  const answerScrollDiagnosticsRef = useRef({
    targetKind: 'none',
    targetId: 'none',
    containerKind: 'none',
    method: 'none',
    completed: 'no',
    topVisible: 'no',
    bottomVisible: 'no',
    fullyVisible: 'no',
    occlusionReason: 'none',
    lastRequestedAt: 'none',
    lastCompletedAt: 'none',
  });

  const getAnswerHistoryScrollContainer = () => {
    const el = containerRef.current;
    if (!el) return null;
    const style = window.getComputedStyle(el);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || '') && el.scrollHeight > el.clientHeight;
    if (canScroll) return el;
    return el;
  };

  const computeAnswerScrollVisibility = (targetRect, containerRect) => {
    const topVisible = targetRect.top >= containerRect.top;
    const bottomVisible = targetRect.bottom <= containerRect.bottom;
    const fullyVisible = topVisible && bottomVisible;
    const occlusionReason = fullyVisible
      ? 'none'
      : (!topVisible && !bottomVisible ? 'target-larger-than-container-or-clipped-both-edges' : (!topVisible ? 'target-top-clipped' : 'target-bottom-clipped'));
    return { topVisible, bottomVisible, fullyVisible, occlusionReason };
  };

  recordPerfCounter('render', 'AIConsole');

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, aiConsoleRendered: true, aiConsoleMarker: AICONSOLE_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  useEffect(() => {
    const answerHistorySummary = safeCommandHistory.reduce((acc, entry) => {
      const isAssistant = isAssistantHistoryEntry(entry);
      const hasText = String(entry?.output_text || '').trim().length > 0;
      const isPendingShell = isAssistant && !hasText;
      const isAssistantPane = isAssistant && hasText;
      const isPromptOnly = !isAssistant;
      if (isAssistantPane) acc.assistantPaneCount += 1;
      if (isPromptOnly) acc.promptOnlyCount += 1;
      if (isPendingShell) acc.pendingPaneCount += 1;
      return acc;
    }, { assistantPaneCount: 0, promptOnlyCount: 0, pendingPaneCount: 0 });
    const latestAssistantEntry = [...safeCommandHistory].reverse().find((entry) => hasFinalAssistantAnswerText(entry)) || null;
    const duplicateAnswerPaneDetected = answerHistorySummary.assistantPaneCount > 1 && safeCommandHistory.length <= 2;
    setUiDiagnostics((prev) => ({
      ...prev,
      aiConsoleAnswerHistory: {
        totalItemCount: safeCommandHistory.length,
        assistantPaneCount: answerHistorySummary.assistantPaneCount,
        promptOnlyPaneCount: answerHistorySummary.promptOnlyCount,
        pendingPaneCount: answerHistorySummary.pendingPaneCount,
        latestAnswerPaneId: latestAssistantEntry?.id || 'none',
        latestAnswerEnvelopeId: latestAssistantEntry?.envelope_id || latestAssistantEntry?.envelopeId || 'none',
        scrollTargetKind: latestScrollTargetRef.current.kind || 'none',
        scrollTargetId: latestScrollTargetRef.current.id || 'none',
        scrollTargetIsLatestAssistantAnswer: latestScrollTargetRef.current.kind === 'latest-assistant-answer-pane' && String(latestScrollTargetRef.current.id || '') === String(latestAssistantEntry?.id || ''),
        duplicateAnswerPaneDetected,
        duplicateAnswerPaneReason: duplicateAnswerPaneDetected ? 'multiple-assistant-answer-panes-for-single-execute-window' : 'none',
        promptOnlyRenderedAsAnswerPane: false,
      },
    }));
  }, [safeCommandHistory, setUiDiagnostics]);

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

  useLayoutEffect(() => {
    if (!autoScrollEnabled) return;
    if (lastHistoryRenderKeyRef.current === historyRenderKey) {
      recordPerfCounter('timers', 'ai_core.autoscroll_skipped_same_history');
      return;
    }
    lastHistoryRenderKeyRef.current = historyRenderKey;
    recordPerfCounter('timers', 'ai_core.autoscroll_run');
    preserveDocumentScrollPosition();

    const nowIso = new Date().toISOString();
    const latestAssistantAnswerEl = latestAssistantAnswerRef.current;
    const scrollContainer = getAnswerHistoryScrollContainer();

    const applyScrollDiagnostics = (targetEl, method, completed) => {
      const containerRect = scrollContainer?.getBoundingClientRect?.() || { top: 0, bottom: window.innerHeight };
      const targetRect = targetEl?.getBoundingClientRect?.() || { top: 0, bottom: 0 };
      const visibility = computeAnswerScrollVisibility(targetRect, containerRect);
      answerScrollDiagnosticsRef.current = {
        targetKind: latestScrollTargetRef.current.kind || 'none',
        targetId: latestScrollTargetRef.current.id || 'none',
        containerKind: scrollContainer === window ? 'window' : 'answer-history-container',
        method,
        completed: completed ? 'yes' : 'no',
        topVisible: visibility.topVisible ? 'yes' : 'no',
        bottomVisible: visibility.bottomVisible ? 'yes' : 'no',
        fullyVisible: visibility.fullyVisible ? 'yes' : 'no',
        occlusionReason: visibility.occlusionReason,
        lastRequestedAt: answerScrollDiagnosticsRef.current.lastRequestedAt || nowIso,
        lastCompletedAt: completed ? new Date().toISOString() : 'none',
      };
      setUiDiagnostics((prev) => ({ ...prev, aiConsoleAnswerScroll: { ...answerScrollDiagnosticsRef.current } }));
    };

    if (latestAssistantAnswerEl && scrollContainer) {
      latestScrollTargetRef.current = { kind: 'latest-assistant-answer-pane', id: latestAssistantAnswerId || '' };
      answerScrollDiagnosticsRef.current.lastRequestedAt = nowIso;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        latestAssistantAnswerEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
        recordPerfCounter('timers', 'ai_core.autoscroll_raf');
        applyScrollDiagnostics(latestAssistantAnswerEl, 'scrollIntoView(start,smooth)', true);
        restoreDocumentScrollPosition();
      }));
    } else {
      latestScrollTargetRef.current = { kind: 'history-bottom-fallback', id: 'answer-history' };
      answerScrollDiagnosticsRef.current.lastRequestedAt = nowIso;
      scrollMessageContainerToBottom('smooth');
      requestAnimationFrame(() => {
        applyScrollDiagnostics(scrollContainer, 'scrollToBottomFallback(smooth)', true);
        restoreDocumentScrollPosition();
      });
    }
  }, [autoScrollEnabled, historyRenderKey, latestAssistantAnswerId, setUiDiagnostics]);

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


  const copyCodexDispatchPrompt = async () => {
    const prompt = String(lastExecutionMetadata?.codex_dispatch_prompt || '').trim();
    if (!prompt) {
      setCodexDispatchCopyState('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setCodexDispatchCopyState('success');
    } catch (_error) {
      setCodexDispatchCopyState('error');
    }
  };


  const commandPipelineFailureReason = String(lastExecutionMetadata?.command_pipeline_last_failure_reason || '').trim().toLowerCase();
  const routeLayerHealthy = String(routeTruthView?.routeLayerStatus || '').trim().toLowerCase() === 'healthy';
  const routeUsableHealthy = String(routeTruthView?.selectedRouteReachableState || '').trim().toLowerCase() === 'yes'
    && String(routeTruthView?.routeUsableState || '').trim().toLowerCase() === 'yes';
  const routeFailureIsHistorical = (routeLayerHealthy || routeUsableHealthy)
    && (commandPipelineFailureReason === 'route_unavailable' || commandPipelineFailureReason === 'backend-route-unavailable');
  const contextPackStatusView = routeFailureIsHistorical ? 'active' : (lastExecutionMetadata?.chat_context_pack_status || 'unavailable');
  const responsePlannerStatusView = routeFailureIsHistorical ? 'active' : (lastExecutionMetadata?.response_planner_status || 'unavailable');

  const onSubmit = async (event) => {
    event.preventDefault();
    const submittedInput = input;
    const submitResult = await submitPrompt(submittedInput);
    if (submitResult?.inputCleared === true || submitResult?.submitAccepted === true) {
      setInput('');
    } else if (submitResult?.restoreInput === true) {
      setInput(submittedInput);
    }
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
        <div className="api-banner ready">
          <strong>Context Used</strong>
          <span>Context Pack: {contextPackStatusView} · Envelope: {lastExecutionMetadata?.command_envelope_status || 'unavailable'} · Response Mode: {lastExecutionMetadata?.command_envelope_response_mode || lastExecutionMetadata?.chat_context_response_mode || 'direct-answer'} · Providers Used: {String(lastExecutionMetadata?.command_envelope_context_providers_used || lastExecutionMetadata?.chat_context_provider_ids_used || '').split('|').filter(Boolean).length || 0} · UI Reality: {lastExecutionMetadata?.command_envelope_ui_reality_status || lastExecutionMetadata?.chat_context_ui_reality_status || 'UNKNOWN'} · Execution: {lastExecutionMetadata?.command_envelope_execution_status || 'pending'}</span>
          <span>UI Reality Status: {lastExecutionMetadata?.chat_context_ui_reality_status || runtimeStatus?.uiRealityStatus?.severity || 'UNKNOWN'} · Mission State: {lastExecutionMetadata?.chat_context_mission_state || runtimeStatus?.missionStatus || 'unknown'} · Next Action: {lastExecutionMetadata?.chat_context_next_action || 'Answer directly with bounded confidence.'}</span>
          <span>Response Planner: {responsePlannerStatusView} · Answer Shape: {lastExecutionMetadata?.response_planner_answer_shape || 'direct-answer'} · Risk Level: {lastExecutionMetadata?.response_planner_risk_level || 'low'} · Next Action: {lastExecutionMetadata?.response_planner_next_action || 'answer directly with bounded confidence'}</span>
          <span>Provider Registry: {lastExecutionMetadata?.chat_context_provider_registry_status || 'inactive'} · Providers Used Count: {String(lastExecutionMetadata?.chat_context_provider_ids_used || '').split('|').filter((item) => item && item !== 'none').length || 0} · Key Providers Used: {String(lastExecutionMetadata?.chat_context_provider_ids_used || 'none').split('|').filter((item) => item && item !== 'none').slice(0, 6).join(', ') || 'none'} · Provider Warning Count: {lastExecutionMetadata?.chat_context_provider_warning_count ?? 0}</span>
          <span>Mission Repair Loop: {lastExecutionMetadata?.mission_repair_loop_status || runtimeStatus?.missionRepairLoopStatus || 'idle'} · Failing Field: {lastExecutionMetadata?.mission_repair_loop_latest_failing_field || runtimeStatus?.missionRepairLoopLatestFailingField || 'none'} · Next Action: {lastExecutionMetadata?.mission_repair_loop_next_action || runtimeStatus?.missionRepairLoopNextAction || 'collect proof'} · Merge Recommendation: {lastExecutionMetadata?.mission_repair_loop_merge_recommendation || runtimeStatus?.missionRepairLoopMergeRecommendation || 'hold'} · Codex Prompt: {lastExecutionMetadata?.mission_repair_loop_codex_prompt_available || runtimeStatus?.missionRepairLoopCodexPromptAvailable || 'no'} · Approval Required: {lastExecutionMetadata?.mission_repair_loop_operator_approval_required || 'yes'}</span>
          <span>PR Evidence: {lastExecutionMetadata?.command_envelope_pr_evidence_status || lastExecutionMetadata?.pr_evidence_status || runtimeStatus?.prEvidenceStatus || 'none'} · PR: {lastExecutionMetadata?.command_envelope_pr_number || runtimeStatus?.prEvidenceParsedPrNumber || 'unknown'} · Merge Recommendation: {lastExecutionMetadata?.command_envelope_pr_merge_readiness || lastExecutionMetadata?.pr_evidence_merge_readiness || runtimeStatus?.prEvidenceMergeReadiness || 'hold'} · Next Action: {lastExecutionMetadata?.command_envelope_pr_next_action || lastExecutionMetadata?.pr_evidence_recommended_next_action || runtimeStatus?.prEvidenceRecommendedNextAction || 'paste PR evidence'}</span>
          <span>Repair Loop Status: {lastExecutionMetadata?.mission_repair_loop_status || runtimeStatus?.missionRepairLoopStatus || 'idle'} · Codex Dispatch Packet Status: {lastExecutionMetadata?.command_envelope_codex_dispatch_status || 'not-ready'} · Approval Required: {lastExecutionMetadata?.command_envelope_codex_dispatch_approval_required || 'yes'}</span>
          <span>Codex Dispatch Packet: {lastExecutionMetadata?.command_envelope_codex_dispatch_status || 'not-ready'} · Packet ID: {lastExecutionMetadata?.command_envelope_codex_dispatch_packet_id || 'none'} · Target: {lastExecutionMetadata?.command_envelope_codex_dispatch_target_subsystems || 'none'} · Approval Required: {lastExecutionMetadata?.command_envelope_codex_dispatch_approval_required || 'yes'}</span>
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
          {safeCommandHistory.length === 0 ? <p className="muted">Ready. Ask Stephanos anything.</p> : safeCommandHistory.map((entry) => {
            const isAssistantEntry = isAssistantHistoryEntry(entry);
            const hasAssistantText = String(entry?.output_text || '').trim().length > 0;
            if (isAssistantEntry && hasAssistantText) {
              const isLatestAssistantAnswer = latestAssistantAnswerId && String(entry.id || '') === latestAssistantAnswerId;
              return (
                <div
                  key={entry.id || `${entry.timestamp || 'entry'}-${entry.raw_input || ''}`}
                  data-testid={isLatestAssistantAnswer ? 'latest-assistant-answer-pane' : 'assistant-answer-pane'}
                  ref={isLatestAssistantAnswer ? latestAssistantAnswerRef : null}
                >
                  <CommandResultCard entry={entry} />
                </div>
              );
            }
            if (isAssistantEntry) {
              return (
                <div key={entry.id || `${entry.timestamp || 'entry'}-${entry.raw_input || ''}`} className="result-row result-row--pending" data-testid="pending-answer-pane">
                  <p className="muted">Awaiting assistant answer…</p>
                </div>
              );
            }
            return (
              <div key={entry.id || `${entry.timestamp || 'entry'}-${entry.raw_input || ''}`} className="result-row result-row--operator" data-testid="operator-prompt-row">
                <p className="result-input">{entry.raw_input}</p>
              </div>
            );
          })}
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
            <button type="button" className="ghost-button" onClick={copyCodexDispatchPrompt}>
              {codexDispatchCopyState === 'success' ? 'Codex Dispatch Prompt Copied' : 'Copy Codex Dispatch Prompt'}
            </button>
          </div>
          {perfCopyMessage ? <p className={`muted ${perfCopyState === 'error' ? 'status-error' : ''}`}>{perfCopyMessage}</p> : null}
        </form>
      </div>
    </CollapsiblePanel>
  );
}
