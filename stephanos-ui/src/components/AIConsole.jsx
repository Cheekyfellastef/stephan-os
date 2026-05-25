import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getOllamaUiState } from '../ai/ollamaUx';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import CollapsiblePanel from './CollapsiblePanel';
import CommandResultCard from './CommandResultCard';
import { copyPerfDiagnosticsSnapshot, recordPerfCounter, recordPerfEvent, setPerfIdentityField } from '../state/perfDiagnostics.js';

const AICONSOLE_COMPONENT_MARKER = 'stephanos-ui/components/AIConsole.jsx::free-tier-router-v1';
const AICONSOLE_SOURCE_MARKER = 'F:stephanos-ui/src/components/AIConsole.jsx';
const COMMAND_DECK_OWNER_KEY = 'commandDeck-pane';
const MISSION_CONSOLE_OWNER_KEY = 'mission-console-section';
const UNKNOWN_OWNER_KEY = 'unknown-ai-console-surface';

const getCommandDeckOwnershipRegistry = () => {
  if (typeof window === 'undefined') return {};
  const existing = window.__STEPHANOS_COMMAND_DECK_OWNERSHIP__;
  if (existing && typeof existing === 'object') return existing;
  const next = {};
  window.__STEPHANOS_COMMAND_DECK_OWNERSHIP__ = next;
  return next;
};

export default function AIConsole({
  surfaceOwnerKey,
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
  const [composerContractFailure, setComposerContractFailure] = useState(false);
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
    const route = String(entry?.route || entry?.response?.route || '').trim().toLowerCase();
    const role = String(entry?.role || entry?.response?.role || entry?.message?.role || '').trim().toLowerCase();
    const selectedSubsystem = String(entry?.response?.debug?.selected_subsystem || '').trim().toLowerCase();
    return responseType === 'assistant_response'
      || route === 'assistant'
      || role === 'assistant'
      || selectedSubsystem === 'assistant';
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
  const answerDeliveryStatus = String(lastExecutionMetadata?.answer_delivery_status || '').trim().toLowerCase();
  const deliveredFinalAssistantMessageId = String(lastExecutionMetadata?.final_assistant_message_id || '').trim();
  const deliveryAnchoredAssistantAnswerId = answerDeliveryStatus === 'delivered' && deliveredFinalAssistantMessageId
    ? deliveredFinalAssistantMessageId
    : latestAssistantAnswerId;

  const latestAssistantAnswerRef = useRef(null);
  const latestScrollTargetRef = useRef({ kind: 'none', id: '' });
  const lastScrolledAnswerSignatureRef = useRef('');
  const answerScrollDiagnosticsRef = useRef({
    source: 'uninitialized',
    visibleDeckInstanceMounted: 'no',
    visibleDeckRootFound: 'no',
    historyContainerFound: 'no',
    composerFound: 'no',
    inputFound: 'no',
    executeFound: 'no',
    latestFinalAssistantCardFound: 'no',
    revealOwnerInstanceId: 'none',
    deliveryOwnerInstanceId: 'none',
    ownerMismatch: 'no',
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
    skipReason: 'effect-not-fired-yet',
    latestAssistantAnswerId: 'none',
    latestAssistantAnswerPresent: 'no',
    latestAssistantAnswerFinal: 'no',
    latestAssistantAnswerTextLength: 0,
    lastSeenSignature: 'none',
    currentSignature: 'none',
    signatureChanged: 'no',
    effectFired: 'no',
    effectFiredAt: 'none',
    commandDeckComposerFound: 'no',
    commandDeckComposerVisible: 'no',
    commandDeckInputFound: 'no',
    commandDeckInputVisible: 'no',
    commandDeckExecuteButtonVisible: 'no',
    commandDeckPaneClientHeight: 0,
    commandDeckBodyClientHeight: 0,
    answerHistoryClientHeight: 0,
    answerHistoryOverflowY: 'none',
    answerPaneCount: 0,
    latestAssistantAnswerDomFound: 'no',
    latestAssistantAnswerVisible: 'no',
    viewPaneHeight: 0,
    outerRevealRequested: 'no',
    outerRevealSkipped: 'no',
    outerRevealSkipReason: 'none',
    outerRevealMethod: 'none',
    outerRevealBlockMode: 'none',
    answerAlreadyVisibleBeforeOuterReveal: 'no',
    latestAnswerVisibleRatio: 0,
    commandDeckVisibleRatio: 0,
    pageScrollDeltaY: 0,
    pageJumpPrevented: 'no',
    innerHistoryScrollRequested: 'no',
    innerHistoryScrollCompleted: 'no',
  });

  const getAnswerHistoryScrollContainer = () => resolveVisibleAnswerHistoryContainer() || containerRef.current || null;
  const resolveOwnerKey = () => {
    if (typeof surfaceOwnerKey === 'string' && surfaceOwnerKey.trim()) {
      return surfaceOwnerKey.trim();
    }
    const localRoot = resolveLocalCommandDeckRoot();
    const ownerPanel = localRoot?.closest?.('[data-panel-id]') || inputRef.current?.closest?.('[data-panel-id]') || null;
    const panelId = String(ownerPanel?.getAttribute?.('data-panel-id') || '').trim();
    if (panelId === 'commandDeck') return COMMAND_DECK_OWNER_KEY;
    if (panelId === 'missionConsolePanel' || panelId === 'aiCoreMissionConsolePanel') return MISSION_CONSOLE_OWNER_KEY;
    return UNKNOWN_OWNER_KEY;
  };
  const isCommandDeckOwner = () => resolveOwnerKey() === COMMAND_DECK_OWNER_KEY;
  const buildOwnershipProjection = () => {
    const ownership = Object.values(getCommandDeckOwnershipRegistry());
    const commandDeckOwnership = ownership.filter((entry) => entry?.ownerKey === COMMAND_DECK_OWNER_KEY);
    const visibleOwner = commandDeckOwnership.find((entry) => entry?.isVisible === 'yes') || commandDeckOwnership[0] || null;
    const deliveryOwner = commandDeckOwnership.find((entry) => entry?.ownsDeliveryState === 'yes') || null;
    const revealOwner = commandDeckOwnership.find((entry) => entry?.ownsRevealEffect === 'yes') || null;
    const noCommandDeckOwner = commandDeckOwnership.length === 0;
    return {
      ownershipInstanceCount: commandDeckOwnership.length,
      visibleOwnerInstanceId: noCommandDeckOwner ? 'command-deck-owner-not-found' : (visibleOwner?.instanceId || 'none'),
      deliveryOwnerInstanceId: noCommandDeckOwner ? 'command-deck-owner-not-found' : (deliveryOwner?.instanceId || 'none'),
      revealOwnerInstanceId: noCommandDeckOwner ? 'command-deck-owner-not-found' : (revealOwner?.instanceId || 'none'),
      ownershipMismatch: visibleOwner && deliveryOwner && revealOwner
        ? (visibleOwner.instanceId === deliveryOwner.instanceId && visibleOwner.instanceId === revealOwner.instanceId ? 'no' : 'yes')
        : (noCommandDeckOwner ? 'yes' : 'yes'),
      visibleOwnerSourceMarker: noCommandDeckOwner ? 'command-deck-owner-not-found' : (visibleOwner?.sourceMarker || 'none'),
      deliveryOwnerSourceMarker: noCommandDeckOwner ? 'command-deck-owner-not-found' : (deliveryOwner?.sourceMarker || 'none'),
      revealOwnerSourceMarker: noCommandDeckOwner ? 'command-deck-owner-not-found' : (revealOwner?.sourceMarker || 'none'),
      visibleOwnerHasHistory: visibleOwner?.hasHistory || 'no',
      visibleOwnerHasInput: visibleOwner?.hasInput || 'no',
      visibleOwnerHasLatestAnswer: visibleOwner?.latestAnswerDomFound || 'no',
    };
  };
  const isElementActuallyVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  };

  const resolveVisibleCommandDeckRoot = () => {
    const localRoot = containerRef.current?.closest?.('[data-testid="command-deck-root"]')
      || inputRef.current?.closest?.('[data-testid="command-deck-root"]')
      || null;
    if (localRoot) return localRoot;
    const roots = Array.from(document.querySelectorAll('[data-testid="command-deck-root"]'));
    return roots.find((root) => isElementActuallyVisible(root)) || roots[0] || null;
  };
  const resolveLocalCommandDeckRoot = () => (
    containerRef.current?.closest?.('[data-testid="command-deck-root"]')
    || inputRef.current?.closest?.('[data-testid="command-deck-root"]')
    || null
  );

  const resolveVisibleAnswerHistoryContainer = () => {
    const visibleDeckRoot = resolveVisibleCommandDeckRoot();
    if (!visibleDeckRoot) return null;
    const localContainer = containerRef.current;
    if (localContainer && visibleDeckRoot.contains(localContainer)) {
      return localContainer;
    }
    const historyNodes = Array.from(visibleDeckRoot.querySelectorAll('[data-testid="command-deck-answer-history"]'));
    return historyNodes.find((node) => isElementActuallyVisible(node)) || historyNodes[0] || null;
  };

  const resolveLatestVisibleAssistantAnswerElement = (assistantAnswerId = '') => {
    const visibleDeckRoot = resolveVisibleCommandDeckRoot();
    if (!visibleDeckRoot) return null;
    const historyContainer = resolveVisibleAnswerHistoryContainer();
    const queryRoot = historyContainer || visibleDeckRoot;
    const finalAssistantAnswers = Array.from(queryRoot.querySelectorAll('[data-answer-role="assistant"][data-answer-final="true"][data-assistant-answer-id]'));
    if (finalAssistantAnswers.length === 0) return null;
    if (assistantAnswerId) {
      const idMatch = finalAssistantAnswers.find((node) => String(node.getAttribute('data-assistant-answer-id') || '') === String(assistantAnswerId));
      if (idMatch) return idMatch;
    }
    return finalAssistantAnswers[finalAssistantAnswers.length - 1] || null;
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
  const computeVisibleRatio = (rect, viewportRect) => {
    if (!rect || !viewportRect) return 0;
    const rectHeight = Math.max(0, rect.height || (rect.bottom - rect.top));
    if (rectHeight <= 0) return 0;
    const visibleTop = Math.max(rect.top, viewportRect.top);
    const visibleBottom = Math.min(rect.bottom, viewportRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    return Number((visibleHeight / rectHeight).toFixed(3));
  };

  recordPerfCounter('render', 'AIConsole');
  const aiConsoleInstanceIdRef = useRef(`ai-console-${Math.random().toString(36).slice(2, 10)}`);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

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

  useEffect(() => {
    const viteEnvFromGlobal = typeof globalThis !== 'undefined' ? globalThis.__STEPHANOS_IMPORT_META_ENV__ : undefined;
    const viteEnvFromImportMeta = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
    const viteEnv = viteEnvFromGlobal || viteEnvFromImportMeta;
    const isViteDev = Boolean(viteEnv && viteEnv.DEV);
    const isNodeDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
    const isDevMode = Boolean(isViteDev || isNodeDev);
    if (!isDevMode) return;
    const visibleDeckRoot = resolveVisibleCommandDeckRoot();
    const composerEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-composer"]') || null;
    const inputEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-input"]') || null;
    const executeButtonEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-execute"]') || null;
    setComposerContractFailure(!(composerEl && inputEl && executeButtonEl));
  }, [safeUiLayout.commandDeck, safeCommandHistory.length, isBusy]);

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
    if (!isCommandDeckOwner()) return;
    const localDeckRoot = resolveLocalCommandDeckRoot();
    if (!localDeckRoot) return;
    const visibleDeckRoot = localDeckRoot;
    const historyContainer = resolveVisibleAnswerHistoryContainer();
    const composerEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-composer"]') || null;
    const inputEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-input"]') || null;
    const executeButtonEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-execute"]') || null;
    const latestFinalAssistantCard = resolveLatestVisibleAssistantAnswerElement(deliveryAnchoredAssistantAnswerId);
    const deliveryOwnerInstanceId = String(lastExecutionMetadata?.ai_console_instance_id || '').trim() || aiConsoleInstanceIdRef.current;
    const ownerMismatch = deliveryOwnerInstanceId !== aiConsoleInstanceIdRef.current;
    const canaryDiagnostics = {
      source: 'mounted-ai-console-instance',
      visibleDeckInstanceMounted: 'yes',
      visibleDeckRootFound: visibleDeckRoot ? 'yes' : 'no',
      historyContainerFound: historyContainer ? 'yes' : 'no',
      composerFound: composerEl ? 'yes' : 'no',
      inputFound: inputEl ? 'yes' : 'no',
      executeFound: executeButtonEl ? 'yes' : 'no',
      latestFinalAssistantCardFound: latestFinalAssistantCard ? 'yes' : 'no',
      finalAssistantMessageId: deliveryAnchoredAssistantAnswerId || 'none',
      revealOwnerInstanceId: aiConsoleInstanceIdRef.current,
      deliveryOwnerInstanceId,
      ownerMismatch: ownerMismatch ? 'yes' : 'no',
      ...buildOwnershipProjection(),
    };
    answerScrollDiagnosticsRef.current = { ...answerScrollDiagnosticsRef.current, ...canaryDiagnostics };
    if (isCommandDeckOwner()) {
      setUiDiagnostics((prev) => ({ ...prev, aiConsoleAnswerScroll: { ...answerScrollDiagnosticsRef.current } }));
    }
  }, [deliveryAnchoredAssistantAnswerId, historyRenderKey, safeUiLayout.commandDeck, setUiDiagnostics, lastExecutionMetadata?.ai_console_instance_id]);

  useLayoutEffect(() => {
    if (!isCommandDeckOwner()) return;
    const nowIso = new Date().toISOString();
    const latestAssistantEntry = [...safeCommandHistory].reverse().find((entry) => hasFinalAssistantAnswerText(entry)) || null;
    const deliveryAnchoredAssistantEntry = deliveryAnchoredAssistantAnswerId
      ? safeCommandHistory.find((entry) => String(entry?.id || '') === String(deliveryAnchoredAssistantAnswerId)) || null
      : null;
    const resolvedLatestAssistantEntry = deliveryAnchoredAssistantEntry || latestAssistantEntry;
    const latestAssistantText = String(resolvedLatestAssistantEntry?.output_text || '').trim();
    const latestAssistantAnswerFinal = !!resolvedLatestAssistantEntry && latestAssistantText.length > 0 && resolvedLatestAssistantEntry?.stream_finalized !== false;
    const latestAnswerEnvelopeId = String(resolvedLatestAssistantEntry?.envelope_id || resolvedLatestAssistantEntry?.envelopeId || 'none');
    const latestAnswerIdForSig = String(deliveryAnchoredAssistantAnswerId || resolvedLatestAssistantEntry?.id || 'none');
    const deliveredAnchorAvailable = answerDeliveryStatus === 'delivered' && latestAnswerIdForSig !== 'none';
    const currentSignature = (latestAssistantAnswerFinal || deliveredAnchorAvailable)
      ? `${latestAnswerEnvelopeId}|${latestAnswerIdForSig}|${latestAssistantText.length}|${answerDeliveryStatus || 'unknown'}`
      : 'none';
    const signatureChanged = currentSignature !== 'none' && currentSignature !== lastScrolledAnswerSignatureRef.current;
    const latestAssistantAnswerEl = latestAssistantAnswerRef.current;
    const scrollContainer = getAnswerHistoryScrollContainer();
    const targetKind = deliveryAnchoredAssistantAnswerId ? 'final-assistant-message-id' : 'none';
    const targetId = deliveryAnchoredAssistantAnswerId || 'none';
    const viewPaneEl = containerRef.current?.closest?.('.panel-body') || null;
    const answerPaneCount = safeCommandHistory.filter((entry) => isAssistantHistoryEntry(entry) && String(entry?.output_text || '').trim().length > 0).length;
    latestScrollTargetRef.current = { kind: targetKind, id: targetId };

    const publishScrollDiagnostics = (overrides = {}) => {
      const localDeckRoot = resolveLocalCommandDeckRoot();
      if (!localDeckRoot) return;
      const targetElFromRef = latestAssistantAnswerRef.current;
      const containerEl = getAnswerHistoryScrollContainer();
      const visibleDeckRoot = localDeckRoot;
      const visibleLatestAssistantAnswerEl = resolveLatestVisibleAssistantAnswerElement(deliveryAnchoredAssistantAnswerId);
      const targetEl = visibleLatestAssistantAnswerEl || targetElFromRef;
      const visibleAnswerPanes = visibleDeckRoot ? Array.from(visibleDeckRoot.querySelectorAll('[data-testid="assistant-answer-pane"], [data-testid="latest-assistant-answer-pane"]')).filter((node) => isElementActuallyVisible(node)) : [];
      const composerEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-composer"]') || null;
      const inputEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-input"]') || null;
      const executeButtonEl = visibleDeckRoot?.querySelector('[data-testid="command-deck-execute"]') || null;
      const targetRect = targetEl?.getBoundingClientRect?.() || { top: 0, bottom: 0 };
      const containerRect = containerEl?.getBoundingClientRect?.() || { top: 0, bottom: window.innerHeight };
      const viewRect = viewPaneEl?.getBoundingClientRect?.() || { top: 0, bottom: window.innerHeight };
      const viewportRect = { top: 0, bottom: window.innerHeight };
      const composerRect = composerEl?.getBoundingClientRect?.() || { top: 0, bottom: 0, height: 0 };
      const inputRect = inputEl?.getBoundingClientRect?.() || { top: 0, bottom: 0 };
      const executeRect = executeButtonEl?.getBoundingClientRect?.() || { top: 0, bottom: 0 };
      const composerBottomWithinView = !!composerEl && composerRect.bottom <= viewRect.bottom && composerRect.top >= viewRect.top;
      const inputVisible = !!inputEl && inputRect.bottom > viewRect.top && inputRect.top < viewRect.bottom;
      const executeVisible = !!executeButtonEl && executeRect.bottom > viewRect.top && executeRect.top < viewRect.bottom;
      const visibility = computeAnswerScrollVisibility(targetRect, containerRect);
      const latestAnswerVisibleRatio = targetEl ? computeVisibleRatio(targetRect, viewportRect) : 0;
      const commandDeckRect = visibleDeckRoot?.getBoundingClientRect?.() || null;
      const commandDeckVisibleRatio = commandDeckRect ? computeVisibleRatio(commandDeckRect, viewportRect) : 0;
      const containerScrollable = !!(containerEl && containerEl.scrollHeight > containerEl.clientHeight);
      const latestAnswerCardClientHeight = targetEl?.clientHeight ?? 0;
      const latestAnswerCardScrollHeight = targetEl?.scrollHeight ?? 0;
      const answerViewportClientHeight = containerEl?.clientHeight ?? 0;
      const answerViewportScrollHeight = containerEl?.scrollHeight ?? 0;
      const normalCardPaddingAllowance = 24;
      const answerViewportFitRatio = latestAnswerCardClientHeight > 0
        ? Number((answerViewportClientHeight / latestAnswerCardClientHeight).toFixed(3))
        : 0;
      const answerViewportFitsLatestAnswer = latestAnswerCardClientHeight > 0
        && answerViewportClientHeight >= (latestAnswerCardClientHeight + normalCardPaddingAllowance);
      const latestAnswerIsLong = latestAnswerCardScrollHeight > latestAnswerCardClientHeight + 16;
      const answerHistoryOverflowY = containerEl ? getComputedStyle(containerEl).overflowY : 'none';
      const standardAnswerFitTarget = 'standard-10-item-answer-card';
      const standardTenItemAnswerFitVerdict = answerViewportFitsLatestAnswer ? 'pass' : (latestAnswerIsLong ? 'long-answer-internal-scroll' : 'fail');
      const answerViewportFitVerdict = answerViewportFitsLatestAnswer
        ? 'fits-normal-answer-card'
        : (latestAnswerIsLong && (answerHistoryOverflowY === 'auto' || answerHistoryOverflowY === 'scroll'))
          ? 'long-answer-internal-scroll'
          : 'viewport-too-small-for-latest-answer';
      const answerViewportTooSmallReason = answerViewportFitsLatestAnswer
        ? 'none'
        : latestAnswerIsLong
          ? (answerHistoryOverflowY === 'auto' || answerHistoryOverflowY === 'scroll')
            ? 'none'
            : 'long-answer-without-internal-scroll'
          : 'normal-answer-card-clipped';
      const previous = answerScrollDiagnosticsRef.current || {};
      answerScrollDiagnosticsRef.current = {
        source: previous.source || 'mounted-ai-console-instance',
        visibleDeckInstanceMounted: previous.visibleDeckInstanceMounted || 'yes',
        visibleDeckRootFound: visibleDeckRoot ? 'yes' : previous.visibleDeckRootFound || 'no',
        historyContainerFound: containerEl ? 'yes' : previous.historyContainerFound || 'no',
        composerFound: composerEl ? 'yes' : previous.composerFound || 'no',
        inputFound: inputEl ? 'yes' : previous.inputFound || 'no',
        executeFound: executeButtonEl ? 'yes' : previous.executeFound || 'no',
        latestFinalAssistantCardFound: targetEl ? 'yes' : previous.latestFinalAssistantCardFound || 'no',
        revealOwnerInstanceId: previous.revealOwnerInstanceId || aiConsoleInstanceIdRef.current,
        deliveryOwnerInstanceId: previous.deliveryOwnerInstanceId || aiConsoleInstanceIdRef.current,
        ownerMismatch: previous.ownerMismatch || 'no',
        requested: previous.requested || 'no',
        requestReason: previous.requestReason || 'none',
        skipReason: previous.skipReason || 'effect-not-fired-yet',
        targetKind,
        targetId,
        targetFound: targetEl ? 'yes' : 'no',
        containerKind: containerEl ? 'answer-history-container' : 'none',
        containerFound: containerEl ? 'yes' : 'no',
        containerScrollable: containerScrollable ? 'yes' : 'no',
        method: previous.method || 'none',
        previousScrollTop: previous.previousScrollTop ?? 'n/a',
        nextScrollTop: previous.nextScrollTop ?? 'n/a',
        completed: previous.completed || 'no',
        topVisible: visibility.topVisible ? 'yes' : 'no',
        bottomVisible: visibility.bottomVisible ? 'yes' : 'no',
        fullyVisible: visibility.fullyVisible ? 'yes' : 'no',
        occlusionReason: visibility.occlusionReason,
        lastRequestedAt: previous.lastRequestedAt || 'none',
        lastCompletedAt: previous.lastCompletedAt || 'none',
        latestAssistantAnswerId: deliveryAnchoredAssistantAnswerId || 'none',
        latestAssistantAnswerPresent: resolvedLatestAssistantEntry ? 'yes' : 'no',
        latestAssistantAnswerFinal: latestAssistantAnswerFinal ? 'yes' : 'no',
        latestAssistantAnswerTextLength: latestAssistantText.length,
        lastSeenSignature: lastScrolledAnswerSignatureRef.current || 'none',
        currentSignature,
        signatureChanged: signatureChanged ? 'yes' : 'no',
        effectFired: 'yes',
        effectFiredAt: nowIso,
        answerPaneCount: visibleAnswerPanes.length || answerPaneCount,
        latestAssistantAnswerDomFound: targetEl ? 'yes' : 'no',
        latestAssistantAnswerVisible: visibility.fullyVisible ? 'yes' : 'no',
        answerPaneClientHeight: latestAnswerCardClientHeight,
        answerPaneScrollHeight: latestAnswerCardScrollHeight,
        answerContainerClientHeight: answerViewportClientHeight,
        answerContainerScrollHeight: answerViewportScrollHeight,
        answerContainerOverflowY: answerHistoryOverflowY,
        latestAnswerCardClientHeight,
        latestAnswerCardScrollHeight,
        answerViewportClientHeight,
        answerViewportScrollHeight,
        answerViewportFitsLatestAnswer: answerViewportFitsLatestAnswer ? 'yes' : 'no',
        answerViewportFitRatio,
        answerViewportFitVerdict,
        standardAnswerFitTarget,
        standardTenItemAnswerFitVerdict,
        answerViewportTooSmallReason,
        answerPaneClippedReason: visibility.occlusionReason,
        commandDeckComposerFound: composerEl ? 'yes' : 'no',
        commandDeckComposerVisible: isElementActuallyVisible(composerEl) ? 'yes' : 'no',
        commandDeckComposerBottomWithinView: composerBottomWithinView ? 'yes' : 'no',
        commandDeckInputFound: inputEl ? 'yes' : 'no',
        commandDeckInputVisible: isElementActuallyVisible(inputEl) && inputVisible ? 'yes' : 'no',
        commandDeckExecuteButtonVisible: isElementActuallyVisible(executeButtonEl) && executeVisible ? 'yes' : 'no',
        commandDeckPaneClientHeight: viewPaneEl?.clientHeight ?? 0,
        commandDeckBodyClientHeight: visibleDeckRoot?.clientHeight ?? 0,
        commandDeckBodyScrollHeight: visibleDeckRoot?.scrollHeight ?? 0,
        answerHistoryClientHeight: containerEl?.clientHeight ?? 0,
        answerHistoryScrollHeight: containerEl?.scrollHeight ?? 0,
        answerHistoryOverflowY: containerEl ? getComputedStyle(containerEl).overflowY : 'none',
        composerClientHeight: composerEl?.clientHeight ?? 0,
        composerBottom: Math.round(composerRect.bottom ?? 0),
        composerVisible: composerEl ? 'yes' : 'no',
        viewPaneHeight: viewPaneEl?.clientHeight ?? 0,
        viewPaneAvailableHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        commandDeckLayoutVerdict: (composerEl && inputVisible && executeVisible && (viewPaneEl?.clientHeight ?? 0) > 0 && (containerEl?.clientHeight ?? 0) > 0) ? 'pass' : 'fail',
        commandDeckLayoutBlocker: !composerEl ? 'composer-missing'
          : !composerBottomWithinView ? 'composer-clipped-outside-view'
            : !inputVisible ? 'input-not-visible'
              : !executeVisible ? 'execute-not-visible'
                : (viewPaneEl?.clientHeight ?? 0) <= 0 ? 'view-pane-zero-height'
                  : (containerEl?.clientHeight ?? 0) <= 0 ? 'answer-history-zero-height'
                    : 'none',
        outerRevealRequested: previous.outerRevealRequested || 'no',
        outerRevealSkipped: previous.outerRevealSkipped || 'no',
        outerRevealSkipReason: previous.outerRevealSkipReason || 'none',
        outerRevealMethod: previous.outerRevealMethod || 'none',
        outerRevealBlockMode: previous.outerRevealBlockMode || 'none',
        answerAlreadyVisibleBeforeOuterReveal: previous.answerAlreadyVisibleBeforeOuterReveal || 'no',
        latestAnswerVisibleRatio,
        commandDeckVisibleRatio,
        pageScrollDeltaY: previous.pageScrollDeltaY ?? 0,
        pageJumpPrevented: previous.pageJumpPrevented || 'no',
        innerHistoryScrollRequested: previous.innerHistoryScrollRequested || 'no',
        innerHistoryScrollCompleted: previous.innerHistoryScrollCompleted || 'no',
        ...buildOwnershipProjection(),
        ...overrides,
      };
      if (isCommandDeckOwner()) {
        setUiDiagnostics((prev) => ({ ...prev, aiConsoleAnswerScroll: { ...answerScrollDiagnosticsRef.current } }));
      }
    };

    if (!autoScrollEnabled) {
      publishScrollDiagnostics({ requested: 'no', requestReason: 'reveal-skipped-by-policy', skipReason: 'autoscroll-disabled' });
      return;
    }
    if (answerScrollDiagnosticsRef.current.ownerMismatch === 'yes') {
      publishScrollDiagnostics({ requested: 'yes', requestReason: 'reveal-owner-mismatch', skipReason: 'reveal-owner-mismatch', completed: 'no' });
      return;
    }
    if (!resolvedLatestAssistantEntry && !deliveredAnchorAvailable) {
      publishScrollDiagnostics({ requested: 'no', requestReason: 'missing-target-diagnostic-failure', skipReason: 'no-final-assistant-answer' });
      return;
    }
    if (!latestAssistantAnswerFinal && !deliveredAnchorAvailable) {
      publishScrollDiagnostics({ requested: 'no', requestReason: 'reveal-skipped-by-policy', skipReason: 'pending-answer-only' });
      return;
    }
    if (!deliveryAnchoredAssistantAnswerId) {
      publishScrollDiagnostics({ requested: 'no', requestReason: 'missing-target-diagnostic-failure', skipReason: 'latest-assistant-id-missing' });
      return;
    }
    if (!signatureChanged) {
      recordPerfCounter('timers', 'ai_core.autoscroll_skipped_same_signature');
      publishScrollDiagnostics({ requested: 'no', requestReason: 'already-visible-confirmed', skipReason: 'same-answer-signature-already-scrolled', completed: 'yes', method: 'already-visible-confirmed' });
      return;
    }
    lastHistoryRenderKeyRef.current = historyRenderKey;
    recordPerfCounter('timers', 'ai_core.autoscroll_run');
    preserveDocumentScrollPosition();

    publishScrollDiagnostics({ requested: 'yes', requestReason: 'final-assistant-answer-rendered', skipReason: 'none', lastRequestedAt: nowIso });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const pageScrollBefore = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;
        const latestAssistantAnswerTarget = resolveLatestVisibleAssistantAnswerElement(deliveryAnchoredAssistantAnswerId) || latestAssistantAnswerRef.current;
        const scrollContainerEl = getAnswerHistoryScrollContainer();
        if (!latestAssistantAnswerTarget) {
          publishScrollDiagnostics({ requested: 'yes', requestReason: 'missing-target-diagnostic-failure', method: 'skipped-no-target-after-raf', completed: 'no', skipReason: 'target-missing-after-render' });
              return;
        }
        if (!scrollContainerEl) {
          publishScrollDiagnostics({ requested: 'yes', requestReason: 'missing-container-diagnostic-failure', method: 'skipped-no-container', completed: 'no', skipReason: 'scroll-container-missing' });
              return;
        }
        const latestScrollKey = `${latestAnswerEnvelopeId}|${deliveryAnchoredAssistantAnswerId}|${latestAssistantText.length}|final`;
        lastScrolledAnswerSignatureRef.current = latestScrollKey;
        const previousScrollTop = scrollContainerEl.scrollTop;
        const safeTopPadding = 12;
        const targetRect = latestAssistantAnswerTarget.getBoundingClientRect();
        const containerRect = scrollContainerEl.getBoundingClientRect();
        const targetTopRelativeToContainer = targetRect.top - containerRect.top + scrollContainerEl.scrollTop;
        const targetHeight = Math.max(0, targetRect.height || (targetRect.bottom - targetRect.top));
        const containerHeight = Math.max(1, scrollContainerEl.clientHeight);
        const maxTop = Math.max(0, scrollContainerEl.scrollHeight - containerHeight);
        let nextScrollTop = Math.max(0, targetTopRelativeToContainer - safeTopPadding);
        if (targetHeight <= containerHeight) {
          const bottomAligned = Math.max(0, targetTopRelativeToContainer + targetHeight - containerHeight + safeTopPadding);
          nextScrollTop = Math.min(nextScrollTop, bottomAligned);
        }
        nextScrollTop = Math.min(maxTop, Math.max(0, nextScrollTop));
        const innerScrollNeeded = Math.abs(nextScrollTop - previousScrollTop) >= 1;
        scrollContainerEl.scrollTo({ top: nextScrollTop, behavior: 'auto' });
        const viewportRect = { top: 0, bottom: window.innerHeight };
        const latestAnswerRect = latestAssistantAnswerTarget.getBoundingClientRect();
        const commandDeckRoot = resolveVisibleCommandDeckRoot();
        const commandDeckRect = commandDeckRoot?.getBoundingClientRect?.() || null;
        const latestAnswerVisibleRatio = computeVisibleRatio(latestAnswerRect, viewportRect);
        const commandDeckVisibleRatio = commandDeckRect ? computeVisibleRatio(commandDeckRect, viewportRect) : 0;
        const answerAlreadyVisibleEnough = latestAnswerVisibleRatio >= 0.6 || commandDeckVisibleRatio >= 0.8;
        const prefersReducedMotion = typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const outerBehavior = prefersReducedMotion ? 'auto' : 'smooth';
        const outerBlockMode = 'nearest';
        let outerRevealSkipped = 'no';
        let outerRevealSkipReason = 'none';
        let outerRevealMethod = `scrollIntoView:${outerBehavior}`;
        if (answerAlreadyVisibleEnough) {
          outerRevealSkipped = 'yes';
          outerRevealSkipReason = 'already-visible-confirmed';
          outerRevealMethod = 'already-visible-confirmed';
        } else {
          const revealTarget = latestAssistantAnswerTarget.closest('[data-testid="command-deck-body"]') || commandDeckRoot || latestAssistantAnswerTarget;
          revealTarget?.scrollIntoView?.({ block: outerBlockMode, inline: 'nearest', behavior: outerBehavior });
        }
        const pageScrollAfter = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;
        const pageScrollDeltaY = Math.round(pageScrollAfter - pageScrollBefore);
        recordPerfCounter('timers', 'ai_core.autoscroll_raf');
        publishScrollDiagnostics({
          method: 'inner-container-scroll|conditional-outer-reveal',
          previousScrollTop,
          nextScrollTop,
          completed: 'yes',
          skipReason: 'none',
          lastCompletedAt: new Date().toISOString(),
          outerRevealRequested: answerAlreadyVisibleEnough ? 'no' : 'yes',
          outerRevealSkipped,
          outerRevealSkipReason,
          outerRevealMethod,
          outerRevealBlockMode: outerBlockMode,
          answerAlreadyVisibleBeforeOuterReveal: answerAlreadyVisibleEnough ? 'yes' : 'no',
          pageScrollDeltaY,
          pageJumpPrevented: (answerAlreadyVisibleEnough || Math.abs(pageScrollDeltaY) < 160) ? 'yes' : 'no',
          innerHistoryScrollRequested: innerScrollNeeded ? 'yes' : 'no',
          innerHistoryScrollCompleted: innerScrollNeeded ? 'yes' : 'no',
        });
      } catch (error) {
        publishScrollDiagnostics({ method: `error:${error?.name || 'unknown'}`, completed: 'no', skipReason: 'scroll-exception', occlusionReason: String(error?.message || 'scroll-exception') });
      }
    }));
  }, [autoScrollEnabled, answerDeliveryStatus, deliveredFinalAssistantMessageId, historyRenderKey, latestAssistantAnswerId, deliveryAnchoredAssistantAnswerId, safeCommandHistory, setUiDiagnostics]);

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




  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const localRoot = resolveLocalCommandDeckRoot();
    const rootElement = localRoot;
    const historyElement = rootElement?.querySelector('[data-testid="command-deck-answer-history"]') || null;
    const composerElement = rootElement?.querySelector('[data-testid="command-deck-composer"]') || null;
    const inputElement = rootElement?.querySelector('[data-testid="command-deck-input"]') || null;
    const executeElement = rootElement?.querySelector('[data-testid="command-deck-execute"]') || null;
    const paneAncestor = rootElement?.closest?.('[data-pane-id], [data-pane-title], [data-title], .panel') || null;
    const ownerKey = resolveOwnerKey();
    const isCanonicalOwner = ownerKey === COMMAND_DECK_OWNER_KEY;
    const paneId = paneAncestor?.getAttribute?.('data-pane-id') || 'unknown';
    const paneTitle = paneAncestor?.getAttribute?.('data-pane-title') || paneAncestor?.getAttribute?.('data-title') || 'unknown';
    const finalAssistantNode = resolveLatestVisibleAssistantAnswerElement(deliveryAnchoredAssistantAnswerId);
    const finalAssistantId = String(finalAssistantNode?.getAttribute?.('data-assistant-answer-id') || deliveryAnchoredAssistantAnswerId || latestAssistantAnswerId || 'none');
    const answerNodes = historyElement ? Array.from(historyElement.querySelectorAll('[data-answer-role="assistant"][data-answer-final="true"]')) : [];
    const ownership = {
      instanceId: aiConsoleInstanceIdRef.current,
      component: 'AIConsole',
      sourceMarker: `${AICONSOLE_SOURCE_MARKER}#${AICONSOLE_COMPONENT_MARKER}`,
      rootElementFound: rootElement ? 'yes' : 'no',
      isVisible: isElementActuallyVisible(rootElement) ? 'yes' : 'no',
      paneId,
      paneTitle,
      ownerKey,
      hasComposer: composerElement ? 'yes' : 'no',
      hasInput: inputElement ? 'yes' : 'no',
      hasExecute: executeElement ? 'yes' : 'no',
      hasHistory: historyElement ? 'yes' : 'no',
      finalAssistantMessageId: finalAssistantId,
      answerCount: answerNodes.length,
      latestAnswerDomFound: finalAssistantNode ? 'yes' : 'no',
      ownsRevealEffect: isCanonicalOwner && answerScrollDiagnosticsRef.current.revealOwnerInstanceId === aiConsoleInstanceIdRef.current ? 'yes' : 'no',
      ownsDeliveryState: isCanonicalOwner && answerScrollDiagnosticsRef.current.deliveryOwnerInstanceId === aiConsoleInstanceIdRef.current ? 'yes' : 'no',
      renderCount: renderCountRef.current,
      ownerInputRef: inputRef.current ? 'yes' : 'no',
      ownerContainerRef: containerRef.current ? 'yes' : 'no',
      ownerHistoryRef: historyElement && containerRef.current === historyElement ? 'yes' : (historyElement ? 'shared' : 'no'),
      ownerAnswerDeliveryState: answerDeliveryStatus === 'delivered' ? 'yes' : 'no',
    };
    const registry = getCommandDeckOwnershipRegistry();
    registry[aiConsoleInstanceIdRef.current] = ownership;
    window.__STEPHANOS_COMMAND_DECK_OWNERSHIP__ = registry;
    window.__COPY_STEPHANOS_COMMAND_DECK_OWNERSHIP__ = () => {
      const payload = JSON.stringify(Object.values(window.__STEPHANOS_COMMAND_DECK_OWNERSHIP__ || {}), null, 2);
      if (window.navigator?.clipboard?.writeText) {
        window.navigator.clipboard.writeText(payload).catch(() => {});
      }
      return payload;
    };
    setUiDiagnostics((prev) => ({
      ...prev,
      aiConsoleCommandDeckOwnership: Object.values(registry),
    }));
    return () => {
      const active = getCommandDeckOwnershipRegistry();
      delete active[aiConsoleInstanceIdRef.current];
      window.__STEPHANOS_COMMAND_DECK_OWNERSHIP__ = active;
    };
  }, [historyRenderKey, deliveryAnchoredAssistantAnswerId, latestAssistantAnswerId, answerDeliveryStatus, safeUiLayout.commandDeck, setUiDiagnostics, surfaceOwnerKey]);

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
      <div className="mission-console-shell" data-testid="command-deck-root" data-ai-chat-command-deck="true" data-ai-console-instance-id={aiConsoleInstanceIdRef.current}>
        <div data-testid="command-deck-ownership-stamp" style={{ fontSize: '0.75rem', color: '#2f6f3e', paddingBottom: '0.25rem' }}>
          CD Ownership · component=AIConsole · instance={aiConsoleInstanceIdRef.current} · render={renderCountRef.current} · src={AICONSOLE_SOURCE_MARKER} · owns(inputRef={inputRef.current ? 'yes' : 'no'},containerRef={containerRef.current ? 'yes' : 'no'},historyRef={containerRef.current ? 'yes' : 'no'}) · ownsDeliveryState={answerDeliveryStatus === 'delivered' ? 'yes' : 'no'} · finalAssistant={deliveryAnchoredAssistantAnswerId || 'none'}
        </div>
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
        {/* Protected Command Deck Answer Viewport Canon:
            keep a professionally sized answer viewport (clamp min/ideal/max),
            keep composer visible below it, fit normal latest answer cards,
            and let long answers scroll internally instead of collapsing viewport. */}
        <section className="mission-console-pane" data-pane-id="answer-history" data-testid="command-deck-body">
          <header className="mission-console-pane__header">
            <strong>Answer History</strong>
          </header>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="output-panel ai-console-messages mission-console__history mission-console-pane__body"
            data-testid="command-deck-answer-history"
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
              const isLatestAssistantAnswer = deliveryAnchoredAssistantAnswerId && String(entry.id || '') === String(deliveryAnchoredAssistantAnswerId);
              return (
                <div
                  key={entry.id || `${entry.timestamp || 'entry'}-${entry.raw_input || ''}`}
                  data-testid={isLatestAssistantAnswer ? 'latest-assistant-answer-pane' : 'assistant-answer-pane'}
                  data-assistant-answer-id={String(entry.id || '')}
                  data-answer-final={entry?.stream_finalized === false ? 'false' : 'true'}
                  data-answer-role="assistant"
                  data-delivery-anchored={deliveryAnchoredAssistantAnswerId && String(entry.id || '') === String(deliveryAnchoredAssistantAnswerId) ? 'true' : 'false'}
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
        {composerContractFailure ? (
          <div className="mission-console-composer-failure" role="alert">
            Command Deck composer missing — protected canon failure.
          </div>
        ) : null}
        <form className="command-form mission-console-input paneFormLayout mission-console__composer" data-testid="command-deck-composer" onSubmit={onSubmit}>
          <div className="mission-console__input-row">
            <input
              className="paneInput paneControl"
              data-testid="command-deck-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Enter command or prompt..."
              disabled={isBusy}
            />
          </div>
          <div className="mission-console__action-row">
            <button type="submit" data-testid="command-deck-execute" disabled={isBusy}>{isBusy ? 'Routing...' : 'Execute'}</button>
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
